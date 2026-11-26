// Demo Director — Director console. A presenter-only window for the second
// screen: live state of everything, its shortcut, and click-to-trigger as a
// backup to the Stream Deck. Pure view over the service worker's state.

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
const sizeLabel = (size) => (typeof size === 'number' ? `${size}px` : String(size || 'm').toUpperCase());

function renderCamera({ camera, settings }) {
  const secs = Number(settings.camera.blinkSeconds) || 30;
  clearTimeout(blinkTimer);
  let big = camera.on ? 'On' : 'Off';
  let sub = camera.on ? `Size ${sizeLabel(camera.size)}` : 'Not visible to the audience';
  let hiddenPhase = false;
  const wait = camera.on && camera.showAt ? camera.showAt - Date.now() : 0;
  if (wait > 0) {
    big = 'Starting…';
    sub = `Appears in ${Math.ceil(wait / 1000)}s${camera.blink ? ', then blinks' : ''} · size ${sizeLabel(camera.size)}`;
    hiddenPhase = true;
    blinkTimer = setTimeout(() => renderCamera(state), Math.min(1000, wait) + 10);
  } else if (camera.on && camera.blink) {
    const ms = secs * 1000;
    const elapsed = Math.max(0, Date.now() - camera.blinkStart);
    hiddenPhase = Math.floor(elapsed / ms) % 2 === 1;
    const left = Math.ceil((ms - (elapsed % ms)) / 1000);
    big = hiddenPhase ? 'Blinking · hidden' : 'Blinking · visible';
    sub = `${hiddenPhase ? 'Back' : 'Hides'} in ${left}s · every ${secs}s · size ${sizeLabel(camera.size)}`;
    blinkTimer = setTimeout(() => renderCamera(state), 1000 - (elapsed % 1000) + 10);
  }
  // Mirror into the Slides-mode strip.
  $('#slCam').classList.toggle('cam-on', camera.on);
  $('#slCamText').textContent = camera.on ? 'Camera on' : 'Camera off';
  $('#slBlink').classList.toggle('on', camera.blink);
  $('#slBlink').classList.toggle('blink-hidden', hiddenPhase);
  $('#slCamText').textContent = wait > 0 ? `On in ${Math.ceil(wait / 1000)}s` : $('#slCamText').textContent;
  $('#slBlinkText').textContent = camera.on && camera.blink && wait <= 0 ? sub.split(' · ')[0] : 'Blink';
  document.querySelectorAll('#slSize [data-s]').forEach((x) => x.classList.toggle('on', x.dataset.s === camera.size));
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
  const conn = $('#conn');
  conn.classList.toggle('ok', !!s.bridge?.connected);
  conn.querySelector('span').textContent = s.bridge?.connected ? 'Stream Deck: connected' : 'Stream Deck: not connected';
  conn.title = s.bridge?.connected ? 'The Stream Deck plugin is driving this console' : 'Start the Stream Deck app (with the Demo Director plugin) to connect';
  renderCamera(s);
  renderTopics(s);
  renderVeils(s);
  renderSlack(s);
  refreshTabs(); // settings (tab list) may have changed
  renderTimers();
}

// ---------- segments: timers + talking points ----------

const fmt = (ms) => {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
};
const segKey = (t) => t.id || `u:${t.url}`;
const validSeg = (t) => /^https?:\/\/\S+$/.test(t.url || '');
function spent(id) {
  if (!state) return 0;
  const cur = state.segCurrent;
  return (state.segTime[id] || 0) + (cur?.id === id ? Date.now() - cur.since : 0);
}
// '' | 'warnt' (≥ 80% of budget) | 'overt' (over budget)
function pace(id, minutes) {
  const budget = (Number(minutes) || 0) * 60000;
  if (!budget) return '';
  const r = spent(id) / budget;
  return r > 1 ? 'overt' : r >= 0.8 ? 'warnt' : '';
}
const timeText = (id, minutes) => {
  const budget = (Number(minutes) || 0) * 60000;
  return budget ? `${fmt(spent(id))} / ${fmt(budget)}` : fmt(spent(id));
};

function renderTimers() {
  if (!state) return;
  const clock = $('#clock');
  clock.classList.toggle('off', !state.liveStart);
  clock.textContent = state.liveStart ? `⏱ ${fmt(Date.now() - state.liveStart)}` : 'clock starts when you go Live';

  const segs = state.settings.tabs.filter(validSeg);
  const i = segs.findIndex((t) => segKey(t) === state.segCurrent?.id);
  const seg = segs[i];
  const ns = $('#nowSeg');
  ns.classList.toggle('on', !!seg);
  ns.classList.remove('warnt', 'overt');
  if (!seg) {
    $('#nsKicker').textContent = segs.length ? 'Not on a segment' : 'No segments yet';
    $('#nsLabel').textContent = segs.length ? 'Switch to one of your demo tabs' : 'Add them in Settings → Segments';
    $('#nsTime').textContent = '';
    $('#nsBar').style.width = '0';
    $('#nsNotes').textContent = '';
    $('#nsNotes').dataset.src = '';
    $('#nsNotes').classList.add('empty');
  } else {
    const id = segKey(seg);
    const budget = (Number(seg.minutes) || 0) * 60000;
    const p = pace(id, seg.minutes);
    if (p) ns.classList.add(p);
    $('#nsKicker').textContent = `Segment ${i + 1} / ${segs.length}`;
    $('#nsLabel').textContent = seg.label || seg.url;
    $('#nsTime').textContent = timeText(id, seg.minutes);
    $('#nsBar').style.width = budget ? `${Math.min(100, (spent(id) / budget) * 100)}%` : '0';
    // Only re-render when the notes change (renderTimers runs every second).
    const html = DDRich.toHtml(seg.notes) || 'No talking points for this segment. Add some in Settings → Segments.';
    if ($('#nsNotes').dataset.src !== html) {
      $('#nsNotes').innerHTML = html;
      $('#nsNotes').dataset.src = html;
    }
    $('#nsNotes').classList.toggle('empty', DDRich.isEmpty(seg.notes));
  }
  // Slides mode: the deck segment's timer next to the slide number
  const st = $('#slSegTime');
  st.className = `segt ${seg ? pace(segKey(seg), seg.minutes) : ''}`;
  st.textContent = seg ? timeText(segKey(seg), seg.minutes) : '';
  // Run-of-show rows
  document.querySelectorAll('#tablist .tabi').forEach((row) => {
    const t = segs.find((x) => segKey(x) === row.dataset.id);
    if (!t) return;
    const pill = row.querySelector('.pill');
    const time = spent(row.dataset.id);
    pill.textContent = Number(t.minutes) || time ? timeText(row.dataset.id, t.minutes) : row.dataset.status;
    pill.className = `pill ${pace(row.dataset.id, t.minutes)}`;
  });
}
setInterval(renderTimers, 1000);

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
    b.dataset.id = t.id;
    b.dataset.status = t.active ? 'ON SCREEN' : t.open ? 'OPEN' : 'NOT OPEN';
    b.innerHTML = `<span class="n">${i + 1}</span><span class="l"><b></b><small></small></span><span class="pill"></span>`;
    b.querySelector('b').textContent = t.label || new URL(t.url).host;
    b.querySelector('small').textContent = t.url.replace(/^https?:\/\//, '');
    b.querySelector('.pill').textContent = t.active ? 'ON SCREEN' : t.open ? 'OPEN' : 'NOT OPEN';
    b.title = t.open ? 'Switch to this tab' : 'Open this tab';
    b.onclick = () => send({ type: 'tab.activate', index: i });
    root.append(b);
  });
  renderTimers();
  if (st.extra) {
    const note = document.createElement('div');
    note.className = 'tip warn';
    note.textContent = `${st.extra} other tab${st.extra === 1 ? '' : 's'} open in the demo window. Reset demo closes them.`;
    root.append(note);
  }
}

// ---------- Slides mode ----------
// When the demo window's active tab is a Google Slides deck, the console swaps
// the demo controls for that slide's speaker notes. Any other tab → Demo mode.

const isSlidesUrl = (u) => /^https:\/\/docs\.google\.com\/presentation\//.test(u || '');
let deck = null;
let peek = false;
const thumbs = new Map(); // pageId → blob URL (or null if unavailable)

chrome.storage.local.get('deck').then(({ deck: d }) => {
  deck = d || null;
  renderSlides();
});
chrome.storage.onChanged.addListener((c, area) => {
  if (area === 'local' && c.deck) {
    deck = c.deck.newValue || null;
    thumbs.clear();
    renderSlides();
  }
});

let notesScale = Number(localStorage.getItem('dd-notes-scale')) || 1;
const applyScale = () => document.documentElement.style.setProperty('--notes-scale', String(notesScale));
applyScale();
const bump = (d) => {
  notesScale = Math.min(2.5, Math.max(0.6, +(notesScale + d).toFixed(2)));
  try { localStorage.setItem('dd-notes-scale', String(notesScale)); } catch {}
  applyScale();
};

async function activeDemoTab() {
  try {
    const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    const [tab] = await chrome.tabs.query({ windowId: win.id, active: true });
    return tab || null;
  } catch {
    return null;
  }
}

async function thumbInto(el, pageId) {
  el.replaceChildren();
  if (!deck?.id || !pageId) {
    el.textContent = 'No preview';
    return;
  }
  if (!thumbs.has(pageId)) {
    el.textContent = 'Loading…';
    const has = await chrome.permissions.contains({ origins: DDDeck.GOOGLE_ORIGINS });
    thumbs.set(pageId, has ? await DDDeck.fetchThumb(deck.id, pageId) : null);
  }
  const src = thumbs.get(pageId);
  el.replaceChildren();
  if (!src) return void (el.textContent = 'Preview unavailable');
  const img = new Image();
  img.src = src;
  img.alt = '';
  el.append(img);
}

async function renderSlides() {
  const tab = await activeDemoTab();
  const slidesTab = isSlidesUrl(tab?.url);
  const on = slidesTab && !peek;
  $('#slidesView').hidden = !on;
  $('#demoView').hidden = on;
  $('#viewPill').textContent = slidesTab ? (peek ? 'SLIDES TAB · DEMO CONTROLS' : 'SLIDES MODE') : 'DEMO MODE';
  $('#viewPill').classList.toggle('slides-on', slidesTab);
  $('#peek').textContent = peek ? 'Back to notes' : 'Demo controls';
  if (!slidesTab) peek = false;
  if (!on) return;

  const warn = $('#slWarn');
  warn.replaceChildren();
  const say = (t) => {
    const d = document.createElement('div');
    d.className = 'warn-box';
    d.textContent = t;
    warn.append(d);
  };
  if (!deck) {
    $('#slNum').textContent = 'Slides';
    $('#slTitle').textContent = '';
    $('#slNotes').textContent = 'No notes loaded. Settings → Slides & speaker notes → Load notes.';
    $('#slNotes').classList.add('empty');
    $('#thNow').textContent = $('#thNext').textContent = '';
    $('#thNextTitle').textContent = '';
    return;
  }
  const tabDeck = DDDeck.deckIdFrom(tab.url);
  if (deck.id && tabDeck && tabDeck !== deck.id && !tab.url.includes('/d/e/')) say('This tab is a different deck from the one whose notes are loaded.');

  const where = DDDeck.slideFrom(tab.url);
  let i = DDDeck.indexOf(deck, where);
  if (i < 0 && !where) i = 0; // e.g. Present mode just started, before the URL names a slide
  if (i < 0) say("Can't match this slide to the loaded notes. Reload notes if the deck changed.");
  const cur = deck.slides[i];
  const next = deck.slides[i + 1];
  $('#slNum').textContent = i >= 0 ? `Slide ${i + 1} / ${deck.slides.length}` : `Slide ? / ${deck.slides.length}`;
  $('#slTitle').textContent = cur?.title || '';
  $('#slNotes').textContent = cur?.notes || 'No speaker notes on this slide.';
  $('#slNotes').classList.toggle('empty', !cur?.notes);
  thumbInto($('#thNow'), cur?.pageId);
  if (next) thumbInto($('#thNext'), next.pageId);
  else $('#thNext').textContent = 'End of deck';
  $('#thNextTitle').textContent = next?.title || '';
}

const slideMsg = (t) => {
  $('#slMsg').textContent = t || '';
  clearTimeout(slideMsg.t);
  if (t) slideMsg.t = setTimeout(() => ($('#slMsg').textContent = ''), 4000);
};
$('#slPrev').onclick = () => send({ type: 'slide.prev' }).then((r) => slideMsg(r?.ok ? '' : r?.error));
$('#slNext').onclick = () => send({ type: 'slide.next' }).then((r) => slideMsg(r?.ok ? '' : r?.error));
$('#slCam').onclick = () => send({ type: 'camera.toggle' });
$('#slBlink').onclick = () => send({ type: 'camera.blink' });
$('#slSize').onclick = () => send({ type: 'camera.size' });
$('#fontDown').onclick = () => bump(-0.1);
$('#fontUp').onclick = () => bump(0.1);
$('#peek').onclick = () => {
  peek = !peek;
  renderSlides();
};

let tabsTimer = 0;
const refreshTabs = () => {
  clearTimeout(tabsTimer);
  tabsTimer = setTimeout(() => {
    renderTabs();
    renderSlides();
  }, 120);
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

chrome.runtime.onMessage.addListener((msg) => msg?.type === 'state' && msg.state?.camera && render(msg.state));

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
const first = await getState();
if (first) render(first);
