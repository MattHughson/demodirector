// Demo Director — Director console. A presenter-only window for the second
// screen: live state of everything, its shortcut, and click-to-trigger as a
// backup to the Stream Deck. Pure view over the service worker's state.

const send = (action) => chrome.runtime.sendMessage({ type: 'action', action });
const $ = (s) => document.querySelector(s);
let state = null;
let shortcuts = {};

// ---------- shortcuts ----------

const MAC = /Mac/.test(navigator.platform);
const pretty = (k) =>
  MAC ? k.replace(/MacCtrl\+|Ctrl\+/g, '⌃').replace(/Shift\+/g, '⇧').replace(/Alt\+/g, '⌥').replace(/Command\+/g, '⌘') : k;

function kbd(cmd) {
  const k = shortcuts[cmd];
  const el = document.createElement('kbd');
  el.textContent = k ? pretty(k) : 'unset';
  el.classList.toggle('unset', !k);
  return el;
}

function fillStaticKeys() {
  document.querySelectorAll('kbd[data-cmd]').forEach((el) => {
    const fresh = kbd(el.dataset.cmd);
    el.textContent = fresh.textContent;
    el.className = fresh.className;
  });
}

async function loadShortcuts() {
  const cmds = await chrome.commands.getAll();
  shortcuts = Object.fromEntries(cmds.map((c) => [c.name, c.shortcut]));
  fillStaticKeys();
  if (state) render(state);
}

// ---------- render ----------

let blinkTimer = 0;

function renderCamera({ camera, settings }) {
  const secs = Number(settings.camera.blinkSeconds) || 30;
  clearTimeout(blinkTimer);
  let big = camera.on ? 'On' : 'Off';
  let sub = camera.on ? `Size ${camera.size.toUpperCase()}` : 'Not visible to the audience';
  let hiddenPhase = false;
  if (camera.on && camera.blink) {
    const ms = secs * 1000;
    const elapsed = Math.max(0, Date.now() - camera.blinkStart);
    hiddenPhase = Math.floor(elapsed / ms) % 2 === 1;
    const left = Math.ceil((ms - (elapsed % ms)) / 1000);
    big = hiddenPhase ? 'Blinking · hidden' : 'Blinking · visible';
    sub = `${hiddenPhase ? 'Back' : 'Hides'} in ${left}s · every ${secs}s · size ${camera.size.toUpperCase()}`;
    blinkTimer = setTimeout(() => renderCamera(state), 1000 - (elapsed % 1000) + 10);
  }
  $('#camBig').textContent = big;
  $('#camSub').textContent = sub;
  const dot = $('#camDot');
  dot.className = `cam-dot${camera.on ? ' on' : ''}${hiddenPhase ? ' hidden-phase' : ''}`;
  dot.innerHTML = DDIcons.svg('camera', 28);
  $('#camOn').classList.toggle('on', camera.on);
  $('#camBlink').classList.toggle('on', camera.blink);
  document.querySelectorAll('#camSize [data-s]').forEach((s) => s.classList.toggle('on', s.dataset.s === camera.size));
}

function renderTopics({ topic, settings }) {
  const t = settings.topics[topic.index - 1];
  const now = $('#now');
  now.classList.toggle('on', topic.shown);
  now.innerHTML = `<span class="ico">${DDIcons.svg(t?.icon || 'star', 24)}</span><span><div class="k"></div><div class="t"></div></span>`;
  now.querySelector('.k').textContent = t ? `Step ${topic.index} · ${topic.shown ? 'on screen' : 'hidden'}` : 'No topic yet';
  now.querySelector('.t').textContent = t ? t.title : 'Press Next to show Step 1';

  const list = $('#topics');
  list.replaceChildren();
  settings.topics.forEach((x, i) => {
    const n = i + 1;
    const b = document.createElement('button');
    b.className = 'topic';
    if (n === topic.index) b.classList.add('current');
    if (n === topic.index && topic.shown) b.classList.add('on');
    if (n === (topic.index || 0) + 1) b.classList.add('next');
    b.innerHTML = `<span class="n">${n}</span>${DDIcons.svg(x.icon, 18)}<span class="ti"></span>`;
    b.querySelector('.ti').textContent = x.title;
    b.append(kbd(`topic-${n}`));
    b.onclick = () => send(n === topic.index && topic.shown ? { type: 'topic.hide' } : { type: 'topic.show', index: n });
    list.append(b);
  });
}

function renderVeils({ veils, active }) {
  const root = $('#veils');
  root.replaceChildren();
  if (!veils.length) {
    root.innerHTML = '<div class="msg">No veils yet. Pick some in Rehearse mode from the toolbar popup.</div>';
    return;
  }
  veils.forEach((v, i) => {
    const on = active.includes(v.id);
    const b = document.createElement('button');
    b.className = `item${on ? ' on' : ''}`;
    b.innerHTML = `<span class="slot">${i + 1}</span><span class="label"><span class="name"></span><span class="sub"></span></span>`;
    b.querySelector('.name').textContent = v.name;
    b.querySelector('.sub').innerHTML = `<span class="pill">${on ? 'HIDDEN' : 'SHOWN'}</span>`;
    b.append(kbd(`veil-${i + 1}`));
    b.onclick = () => send({ type: 'veil.toggle', id: v.id });
    root.append(b);
  });
}

function renderSlack({ slack, settings }) {
  const cfg = settings.slack;
  $('#slack').classList.toggle('on', slack.shown);
  $('#slackName').textContent = slack.shown ? `On screen: ${cfg.sender}` : `Send ${cfg.sender}'s message`;
  $('#slackSub').innerHTML = `<span class="pill">${slack.shown ? 'SHOWING' : 'HIDDEN'}</span>`;
  const m = $('#slackMsg');
  m.classList.toggle('on', slack.shown);
  m.innerHTML = '<b></b> <span class="muted"></span><div></div>';
  m.querySelector('b').textContent = cfg.sender;
  m.querySelector('span').textContent = [cfg.channel, cfg.workspace].filter(Boolean).join(' · ');
  m.querySelector('div').textContent = cfg.message;
}

function render(s) {
  state = s;
  const live = s.mode === 'live';
  $('#mode').classList.toggle('live', live);
  $('#modeText').textContent = live ? 'LIVE' : 'REHEARSE';
  document.title = `${live ? '● LIVE' : 'Rehearse'} — Demo Director`;
  renderCamera(s);
  renderTopics(s);
  renderVeils(s);
  renderSlack(s);
  refreshTabs(); // settings (tab list) may have changed
}

// ---------- demo tabs ----------

async function renderTabs() {
  const st = await send({ type: 'tabs.status' });
  const root = $('#tablist');
  root.replaceChildren();
  if (!st?.tabs?.length) {
    root.innerHTML = '<div class="msg">No demo tabs set. Add them in Settings → Demo tabs. Prev/Next will cycle all tabs until then.</div>';
    return;
  }
  st.tabs.forEach((t, i) => {
    const b = document.createElement('button');
    b.className = `tabi${t.active ? ' active' : ''}${t.open ? '' : ' missing'}`;
    b.innerHTML = `<span class="n">${i + 1}</span><span class="l"><b></b><small></small></span><span class="pill"></span>`;
    b.querySelector('b').textContent = t.label || new URL(t.url).host;
    b.querySelector('small').textContent = t.url.replace(/^https?:\/\//, '');
    b.querySelector('.pill').textContent = t.active ? 'ON SCREEN' : t.open ? 'OPEN' : 'NOT OPEN';
    b.title = t.open ? 'Switch to this tab' : 'Open this tab';
    b.onclick = () => send({ type: 'tab.activate', index: i });
    root.append(b);
  });
  if (st.extra) {
    const note = document.createElement('div');
    note.className = 'tip warn';
    note.textContent = `${st.extra} other tab${st.extra === 1 ? '' : 's'} open in the demo window. Reset demo closes them.`;
    root.append(note);
  }
}

let tabsTimer = 0;
const refreshTabs = () => {
  clearTimeout(tabsTimer);
  tabsTimer = setTimeout(renderTabs, 120);
};
['onActivated', 'onCreated', 'onRemoved', 'onMoved', 'onAttached', 'onDetached'].forEach((e) => chrome.tabs[e].addListener(refreshTabs));
chrome.tabs.onUpdated.addListener((id, info) => (info.url || info.status === 'complete' || info.title) && refreshTabs());
chrome.windows.onFocusChanged.addListener(refreshTabs);

// ---------- inputs ----------

$('#mode').onclick = () => send({ type: 'mode.toggle' });
$('#reset').onclick = () => send({ type: 'reset' });
$('#camOn').onclick = () => send({ type: 'camera.toggle' });
$('#camBlink').onclick = () => send({ type: 'camera.blink' });
$('#camSize').onclick = () => send({ type: 'camera.size' });
$('#now').onclick = $('#toggle').onclick = () => send({ type: 'topic.toggle' });
$('#prev').onclick = () => send({ type: 'topic.prev' });
$('#next').onclick = () => send({ type: 'topic.next' });
$('#slack').onclick = () => send({ type: 'slack.toggle' });
$('#tabPrev').onclick = () => send({ type: 'tab.prev' });
$('#tabNext').onclick = () => send({ type: 'tab.next' });
$('#settings').onclick = () => chrome.runtime.openOptionsPage();
$('#shortcuts').onclick = () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });

// Shortcuts can be rebound while the console is open; refresh when it regains focus.
addEventListener('focus', loadShortcuts);

chrome.runtime.onMessage.addListener((msg) => msg?.type === 'state' && render(msg.state));

// Remember where the window lives (your second screen) for next time.
let saveTimer = 0;
function rememberBounds() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    chrome.storage.local.set({
      consoleBounds: { left: screenX, top: screenY, width: outerWidth, height: outerHeight },
    });
  }, 400);
}
addEventListener('resize', rememberBounds);
setInterval(() => {
  // There's no "window moved" event in a page; poll cheaply.
  if (screenX !== rememberBounds.x || screenY !== rememberBounds.y) {
    rememberBounds.x = screenX;
    rememberBounds.y = screenY;
    rememberBounds();
  }
}, 1500);

await loadShortcuts();
render(await send({ type: 'state.get' }));
