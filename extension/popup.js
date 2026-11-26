const send = (action) => chrome.runtime.sendMessage({ type: 'action', action });
const $ = (s) => document.querySelector(s);

function render(state) {
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
$('#reset').onclick = () => send({ type: 'reset' });
$('#settings').onclick = () => chrome.runtime.openOptionsPage();
$('#pick').onclick = async () => {
  const res = await send({ type: 'picker.start' });
  if (res?.ok) window.close();
  else $('#msg').textContent = res?.error || 'Could not start picker';
};

chrome.runtime.onMessage.addListener((msg) => msg?.type === 'state' && render(msg.state));
send({ type: 'state.get' }).then(render);
