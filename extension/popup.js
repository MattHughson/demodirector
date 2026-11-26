const send = (action) => chrome.runtime.sendMessage({ type: 'action', action });
const $ = (s) => document.querySelector(s);

// Ask the service worker for state; right after an extension reload the worker
// may still be starting, so retry briefly instead of rendering nothing.
async function getState(tries = 10) {
  for (let i = 0; i < tries; i++) {
    try {
      const s = await chrome.runtime.sendMessage({ type: 'action', action: { type: 'state.get' } });
      if (s && s.camera && s.settings) return s;
    } catch {}
    await new Promise((r) => setTimeout(r, 200 + i * 100));
  }
  return null;
}

function pressed(btn, on, onText, offText) {
  btn.setAttribute('aria-pressed', String(on));
  btn.textContent = on ? onText : offText;
}

function render(state) {
  const { camera, topic, slack, settings } = state;
  pressed($('#camOn'), camera.on, 'Camera on', 'Camera off');
  pressed($('#camBlink'), camera.blink, `Blinking ${settings.camera.blinkSeconds}s`, 'Blink');
  document.querySelectorAll('#camSize button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.size === camera.size)));
  const t = settings.topics[topic.index - 1];
  pressed($('#topicName'), topic.shown, `${topic.index} · ${t?.title}`, t ? `${topic.index} · ${t.title} (hidden)` : 'No topic yet: press ▶');
  pressed($('#slack'), slack.shown, `Showing: ${settings.slack.sender}`, `Send ${settings.slack.sender}'s message`);

  document.querySelectorAll('.mode button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode)));
  $('#pick').disabled = state.mode === 'live';
  $('#pick').title = state.mode === 'live' ? 'Switch to Rehearse to pick' : '';

  const list = $('#veils');
  list.replaceChildren();
  if (!state.veils.length) {
    const li = document.createElement('li');
    li.className = 'empty muted';
    li.textContent = 'No veils yet. Open your demo page and click "Pick element".';
    list.append(li);
    return;
  }
  state.veils.forEach((v, i) => {
    const on = state.active.includes(v.id);
    const li = document.createElement('li');
    li.innerHTML = `<span class="slot">${i + 1}</span><span class="name"></span><button class="toggle"></button>`;
    li.querySelector('.name').textContent = v.name;
    const btn = li.querySelector('.toggle');
    btn.textContent = on ? 'Hidden' : 'Shown';
    btn.setAttribute('aria-pressed', String(on));
    btn.title = on ? 'Veiled — click to reveal' : 'Revealed — click to veil';
    btn.onclick = () => send({ type: 'veil.toggle', id: v.id });
    list.append(li);
  });
}

document.querySelectorAll('.mode button').forEach((b) => (b.onclick = () => send({ type: 'mode.set', mode: b.dataset.mode })));
$('#camOn').onclick = () => send({ type: 'camera.toggle' });
$('#camBlink').onclick = () => send({ type: 'camera.blink' });
document.querySelectorAll('#camSize button').forEach((b) => (b.onclick = () => send({ type: 'camera.size', size: b.dataset.size })));
$('#topicPrev').onclick = () => send({ type: 'topic.prev' });
$('#topicNext').onclick = () => send({ type: 'topic.next' });
$('#topicName').onclick = () => send({ type: 'topic.toggle' });
$('#slack').onclick = () => send({ type: 'slack.toggle' });
$('#reset').onclick = () => send({ type: 'reset' });
$('#console').onclick = () => send({ type: 'console.open' }).then(() => window.close());
$('#settings').onclick = () => chrome.runtime.openOptionsPage();
$('#pick').onclick = async () => {
  const res = await send({ type: 'picker.start' });
  if (res?.ok) window.close();
  else $('#msg').textContent = res?.error || 'Could not start picker';
};

chrome.runtime.onMessage.addListener((msg) => msg?.type === 'state' && msg.state?.camera && render(msg.state));
getState().then((s) => s && render(s));
