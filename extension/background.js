// Demo Director — service worker.
// Single source of truth and command bus. Every input (hotkeys, popup, options,
// content-script picker, and later the Stream Deck bridge and console) calls
// dispatch(action); state changes are broadcast to all pages.
//
// chrome.storage.local   → definitions
//   veils:    [{ id, name, selectors[] }]
//   settings: { camera, topics, lowerThird, slack } (overrides over bundled defaults)
//   avatar:   data: URL for the Slack sender (kept out of broadcasts)
// chrome.storage.session → the live stage (cleared when the browser or extension restarts)
//   revealed: [veilId]  — a veil is ON unless listed here, so fresh = fully veiled
//   mode:     'rehearse' | 'live'
//   camera:   { on, blink, blinkStart, size: 's'|'m'|'l' }
//   topic:    { index: 0-10, shown, shownAt, cued } — cued: auto-hidden, index already moved to the next one
//   slack:    { shown, at }

// Built-in sites; any other demo site (e.g. the storefront) is added at runtime
// once you allow it in Settings → Demo tabs.
const STATIC_MATCHES = ['https://*.app.github.dev/*', 'http://localhost:3333/*'];
const DYNAMIC_SCRIPT_ID = 'dd-demo-sites';

async function pageMatches() {
  const { origins = [] } = await chrome.permissions.getAll();
  return [...new Set([...STATIC_MATCHES, ...origins])];
}

// Keep one dynamic content-script registration covering every site you've allowed.
async function syncDynamicSites() {
  const { origins = [] } = await chrome.permissions.getAll();
  // Google access (granted for speaker notes) only puts us on Slides pages, never
  // across all of Docs/Drive, and never on googleusercontent download hosts.
  const extra = origins
    .filter((o) => !STATIC_MATCHES.includes(o) && !o.includes('googleusercontent.com'))
    .map((o) => (o === 'https://docs.google.com/*' ? 'https://docs.google.com/presentation/*' : o));
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [DYNAMIC_SCRIPT_ID] });
  if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [DYNAMIC_SCRIPT_ID] });
  if (!extra.length) return;
  const files = chrome.runtime.getManifest().content_scripts[0].js;
  await chrome.scripting.registerContentScripts([
    { id: DYNAMIC_SCRIPT_ID, matches: extra, js: files, runAt: 'document_start', persistAcrossSessions: true },
  ]);
  // Also bring already-open tabs on those sites to life (the script guards against double-injection).
  const tabs = await chrome.tabs.query({ url: extra });
  for (const t of tabs) chrome.scripting.executeScript({ target: { tabId: t.id }, files }).catch(() => {});
}

chrome.permissions.onAdded.addListener(syncDynamicSites);
chrome.permissions.onRemoved.addListener(syncDynamicSites);
const EXPORT_VERSION = 2;
const SIZES = ['s', 'm', 'l'];
// 's'|'m'|'l' → 'M'; a dragged px size → '300px'
const sizeLabel = (size) => (typeof size === 'number' ? `${size}px` : String(size || 'm').toUpperCase());

const LIVE_DEFAULTS = {
  revealed: [],
  mode: 'rehearse',
  // size: 's' | 'm' | 'l' | <px>; pos: null (default top-right) or { corner: 'tl'|'tr'|'bl'|'br', x, y }
  // showAt: while in the future, the bubble is on but held hidden (segment arrival delay).
  camera: { on: false, blink: false, blinkStart: 0, size: 'm', pos: null, showAt: null },
  topic: { index: 0, shown: false, shownAt: 0, cued: false },
  slack: { shown: false, at: 0 },
  // Segments (demo tabs) timing: ms spent per segment id, the one on screen now, and the Live clock.
  segTime: {},
  segCurrent: null, // { id, since, tabId }
  liveStart: null,
};

const CAMERA_DEFAULTS = {
  deviceId: '',
  mirror: true,
  blinkSeconds: 30,
  sizes: { s: 160, m: 240, l: 360 },
  offsetTop: 24,
  offsetRight: 24,
  ringColor: '#ffffff', // the frame around the bubble
  ringWidth: 3, // px; 0 = no ring
  background: { mode: 'none', color: '#0b0f17' }, // none | color | blur (MediaPipe, local)
};

// autoHide: seconds a topic stays up before it hides and the next one is cued (0 = stays up).
const LOWER_THIRD_DEFAULTS = { offsetLeft: 32, offsetBottom: 48, scale: 1, accent: '#f79009', autoHide: 5 };

// ---------- defaults (bundled JSON files, editable without touching code) ----------

let defaultsPromise;
function loadDefaults() {
  defaultsPromise ??= Promise.all(
    ['topics.json', 'slack-toast.json'].map((f) => fetch(chrome.runtime.getURL(f)).then((r) => r.json()))
  ).then(([topics, slack]) => ({
    camera: CAMERA_DEFAULTS,
    topics,
    lowerThird: LOWER_THIRD_DEFAULTS,
    slack,
    tabs: [], // [{ label, url }] — the demo's tabs, in order
    resetTabs: true, // Reset also rebuilds the demo window's tabs
    bridge: { enabled: true, port: 47821 }, // Stream Deck plugin on 127.0.0.1
  }));
  return defaultsPromise;
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
function merge(base, over) {
  if (!isObj(base) || !isObj(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = merge(base[k], v);
  return out;
}

// ---------- demo tabs ----------

// A tab "is" a demo tab if it's on the same origin and at or below the
// configured path, so /structure/drops still matches after you click around.
function tabMatches(tabUrl, cfgUrl) {
  try {
    const t = new URL(tabUrl);
    const c = new URL(cfgUrl);
    const base = c.pathname.replace(/\/+$/, '');
    return t.origin === c.origin && (t.pathname === c.pathname || t.pathname.startsWith(`${base}/`) || base === '');
  } catch {
    return false;
  }
}

// The demo window is the last normal browser window you used (never the console popup).
async function demoWindow() {
  try {
    return await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
  } catch {
    return null;
  }
}

// Pair each configured tab with an open tab in the window (each open tab used once).
function pairTabs(cfg, tabs) {
  const used = new Set();
  return cfg.map((c) => {
    const tab = tabs.find((t) => !used.has(t.id) && tabMatches(t.url || t.pendingUrl || '', c.url));
    if (tab) used.add(tab.id);
    return { ...c, tab };
  });
}

const newSegId = () => `seg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
// Older lists have no ids: fall back to the URL so timing still has a key.
const segId = (t) => t.id || `u:${t.url}`;
const withIds = (list) => (list || []).map((t) => ({ ...t, id: t.id || newSegId() }));

const configuredTabs = (settings) => settings.tabs.filter((t) => /^https?:\/\/\S+$/.test(t.url || ''));

async function tabsStatus() {
  const { settings } = await loadState();
  const win = await demoWindow();
  const tabs = win ? await chrome.tabs.query({ windowId: win.id }) : [];
  const pairs = pairTabs(configuredTabs(settings), tabs);
  return {
    windowId: win?.id,
    tabs: pairs.map((p) => ({ id: segId(p), label: p.label, url: p.url, open: !!p.tab, active: !!p.tab?.active, tabId: p.tab?.id })),
    extra: tabs.filter((t) => !pairs.some((p) => p.tab?.id === t.id)).length,
  };
}

async function rebuildTabs() {
  const { settings } = await loadState();
  const cfg = configuredTabs(settings);
  if (!cfg.length) return { ok: false, error: 'No demo tabs configured' }; // never close everything
  const win = await demoWindow();
  if (!win) return { ok: false, error: 'No browser window' };
  const tabs = await chrome.tabs.query({ windowId: win.id });
  const pairs = pairTabs(cfg, tabs);

  // Open / restart first, close after, so the window never empties out.
  const ids = [];
  for (const p of pairs) {
    if (p.tab) {
      await chrome.tabs.update(p.tab.id, { url: p.url });
      ids.push(p.tab.id);
    } else {
      ids.push((await chrome.tabs.create({ windowId: win.id, url: p.url, active: false })).id);
    }
  }
  await chrome.tabs.move(ids, { index: 0 });
  const keep = new Set(ids);
  const extra = tabs.filter((t) => !keep.has(t.id)).map((t) => t.id);
  if (extra.length) await chrome.tabs.remove(extra);
  await chrome.tabs.update(ids[0], { active: true });
  return { ok: true, opened: pairs.filter((p) => !p.tab).length, closed: extra.length };
}

async function stepTab(delta) {
  const { settings } = await loadState();
  const win = await demoWindow();
  if (!win) return { ok: false };
  const tabs = await chrome.tabs.query({ windowId: win.id });
  // Cycle through the demo tabs if any are configured and open; otherwise all tabs.
  let ring = pairTabs(configuredTabs(settings), tabs).filter((p) => p.tab).map((p) => p.tab);
  if (!ring.length) ring = tabs;
  if (!ring.length) return { ok: false };
  const i = ring.findIndex((t) => t.active);
  const next = ring[(i + delta + ring.length) % ring.length];
  await chrome.tabs.update(next.id, { active: true });
  return { ok: true };
}

// ---------- segments: which demo tab is on screen ----------

// The segment (configured demo tab) a browser tab belongs to, if any.
async function segmentForTab(tabId) {
  const { settings } = await loadState();
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return null;
  const tabs = await chrome.tabs.query({ windowId: tab.windowId });
  const pair = pairTabs(configuredTabs(settings), tabs).find((p) => p.tab?.id === tabId);
  return pair ? { ...pair, id: segId(pair) } : null;
}

// Camera preset → live camera. mode: keep | off | on | blink; delay (s) holds an
// on/blink camera hidden after arrival; pos/size optional.
function cameraForSegment(camera, preset) {
  const next = { ...camera, showAt: null };
  const mode = preset?.mode || 'keep';
  const delay = Math.max(0, Math.min(600, Number(preset?.delay) || 0)) * 1000;
  const showAt = (mode === 'on' || mode === 'blink') && delay ? Date.now() + delay : null;
  if (mode === 'keep') next.showAt = camera.showAt; // leave any pending delay alone
  if (mode === 'off') Object.assign(next, { on: false, blink: false });
  if (mode === 'on') Object.assign(next, { on: true, blink: false, showAt });
  if (mode === 'blink') {
    // The blink cycle starts when the bubble appears.
    const blinkStart = showAt || (camera.blink && !camera.showAt ? camera.blinkStart : Date.now());
    Object.assign(next, { on: true, blink: true, blinkStart, showAt });
  }
  if (preset?.pos) Object.assign(next, { pos: preset.pos, size: preset.size || camera.size });
  else next.pos = null; // back to the default spot
  return next;
}

// Called whenever the demo window's active tab may have changed: bank the time
// spent on the previous segment and apply the new segment's camera preset.
let trackQueued = null;
function trackSegment() {
  clearTimeout(trackQueued);
  trackQueued = setTimeout(() => dispatch({ type: 'segment.track' }), 80);
}

async function trackSegmentNow() {
  const s = await loadState();
  const win = await demoWindow();
  const [active] = win ? await chrome.tabs.query({ windowId: win.id, active: true }) : [];
  // Once you're in a segment, its tab stays that segment however its URL changes
  // (clicking around, redirects, another origin): only switching tabs moves on.
  if (active && s.segCurrent?.tabId === active.id) return { ok: true, unchanged: true };
  const seg = active ? await segmentForTab(active.id) : null;
  const curId = s.segCurrent?.id || null;
  if ((seg?.id || null) === curId) {
    if (seg && s.segCurrent.tabId !== active.id) await saveLive({ segCurrent: { ...s.segCurrent, tabId: active.id } });
    return { ok: true, unchanged: true };
  }
  const now = Date.now();
  const segTime = { ...s.segTime };
  if (curId) segTime[curId] = (segTime[curId] || 0) + Math.max(0, now - s.segCurrent.since);
  const patch = { segTime, segCurrent: seg ? { id: seg.id, since: now, tabId: active.id } : null };
  if (seg) patch.camera = cameraForSegment(s.camera, seg.camera);
  await saveLive(patch);
  return { ok: true, segment: seg?.id || null };
}

chrome.tabs.onActivated.addListener(trackSegment);
chrome.tabs.onUpdated.addListener((id, info) => info.url && trackSegment());
chrome.tabs.onRemoved.addListener(trackSegment);
chrome.windows.onFocusChanged.addListener(trackSegment);

// ---------- Google Slides control ----------

const SLIDES_URL = /^https:\/\/docs\.google\.com\/presentation\//;

// The deck tab in the demo window: the active tab if it's a deck, else the first deck tab.
async function deckTab() {
  const win = await demoWindow();
  if (!win) return null;
  const tabs = (await chrome.tabs.query({ windowId: win.id })).filter((t) => SLIDES_URL.test(t.url || ''));
  return tabs.find((t) => t.active) || tabs[0] || null;
}

// Same rule as deck.js: the hash wins over the query string.
function slideInUrl(url) {
  const hashAt = url.indexOf('#');
  const parts = hashAt >= 0 ? [url.slice(hashAt), url.slice(0, hashAt)] : [url];
  for (const part of parts) {
    const id = /[#?&]slide=id\.([^&#]+)/.exec(part);
    if (id) return { pageId: decodeURIComponent(id[1]) };
    const n = /[#?&]slide=(\d+)\b/.exec(part);
    if (n) return { index: Number(n[1]) - 1 };
  }
  return null;
}

// Present mode ignores URL changes, so press the arrow key inside the deck instead.
function pressKey(key) {
  const keyCode = key === 'ArrowRight' ? 39 : 37;
  const target = document.activeElement && document.activeElement !== document.body ? document.activeElement : document.body;
  for (const type of ['keydown', 'keyup']) {
    const e = new KeyboardEvent(type, { key, code: key, bubbles: true, cancelable: true, composed: true });
    Object.defineProperty(e, 'keyCode', { get: () => keyCode });
    Object.defineProperty(e, 'which', { get: () => keyCode });
    target.dispatchEvent(e);
  }
  return true;
}

async function stepSlide(delta) {
  const tab = await deckTab();
  if (!tab) return { ok: false, error: 'No Google Slides tab in the demo window' };
  const url = new URL(tab.url);
  const { deck } = await chrome.storage.local.get('deck');
  const mapped = deck?.slides?.length && deck.slides.every((s) => s.pageId);
  const presenting = /\/present\b/.test(url.pathname);

  if (!presenting && mapped) {
    const where = slideInUrl(tab.url);
    let i = where?.pageId ? deck.slides.findIndex((s) => s.pageId === where.pageId) : where?.index ?? 0;
    if (i < 0) i = 0;
    const j = Math.max(0, Math.min(deck.slides.length - 1, i + delta));
    url.hash = `slide=id.${deck.slides[j].pageId}`;
    await chrome.tabs.update(tab.id, { url: url.toString() }); // hash-only: no reload
    return { ok: true, via: 'url', index: j };
  }
  try {
    // MAIN world: the page's own handlers must see keyCode/which, which isolated-world props hide.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: pressKey, args: [delta > 0 ? 'ArrowRight' : 'ArrowLeft'] });
    return { ok: true, via: 'keys' };
  } catch {
    return { ok: false, error: 'Allow Google access (Settings → Slides) so Demo Director can move the deck' };
  }
}

// ---------- state ----------

async function loadState() {
  const [{ veils = [], settings: stored = {} }, live, defaults] = await Promise.all([
    chrome.storage.local.get(['veils', 'settings']),
    chrome.storage.session.get(LIVE_DEFAULTS),
    loadDefaults(),
  ]);
  const settings = merge(defaults, stored);
  // Topics: always exactly as many as the defaults; stored entries override per slot.
  settings.topics = defaults.topics.map((t, i) => ({ ...t, ...(stored.topics?.[i] || {}) }));
  const ids = new Set(veils.map((v) => v.id));
  const revealed = live.revealed.filter((id) => ids.has(id));
  const active = veils.filter((v) => !revealed.includes(v.id)).map((v) => v.id);
  return {
    veils,
    revealed,
    active,
    mode: live.mode,
    camera: { ...LIVE_DEFAULTS.camera, ...live.camera },
    topic: { ...LIVE_DEFAULTS.topic, ...live.topic },
    slack: { ...LIVE_DEFAULTS.slack, ...live.slack },
    segTime: live.segTime || {},
    segCurrent: live.segCurrent || null,
    liveStart: live.liveStart || null,
    bridge: { connected: bridgeUp },
    settings,
  };
}

const saveVeils = (veils) => chrome.storage.local.set({ veils });
const saveLive = (patch) => chrome.storage.session.set(patch);

function slugify(name) {
  return (
    String(name)
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'veil'
  );
}

function uniqueId(base, veils) {
  const taken = new Set(veils.map((v) => v.id));
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

function cleanSelectors(list) {
  return [...new Set((list || []).map((s) => String(s).trim()).filter(Boolean))];
}

// Optional text filter: hide only matches whose text starts with / contains / matches.
function cleanText(t) {
  if (!t || typeof t !== 'object') return undefined;
  const mode = ['date', 'starts', 'contains', 'regex'].includes(t.mode) ? t.mode : null;
  const value = String(t.value || '').trim();
  if (mode === 'date') return { mode };
  return mode && value ? { mode, value } : undefined;
}

function normaliseVeil(v, veils) {
  const name = String(v.name || v.id || 'Veil').trim();
  const text = cleanText(v.text);
  return {
    id: uniqueId(slugify(v.id || name), veils),
    name,
    selectors: cleanSelectors(v.selectors),
    ...(text && { text }),
  };
}

// ---------- actions ----------

const handlers = {
  async 'state.get'() {
    return loadState();
  },

  // ----- veils -----

  // Toggle by id, or by 1-based slot (position in the list) for hotkeys/Deck.
  async 'veil.toggle'({ id, slot }) {
    const s = await loadState();
    const veil = id ? s.veils.find((v) => v.id === id) : s.veils[slot - 1];
    if (!veil) return { ok: false, error: 'No such veil' };
    const revealed = s.revealed.includes(veil.id)
      ? s.revealed.filter((x) => x !== veil.id)
      : [...s.revealed, veil.id];
    await saveLive({ revealed });
    return { ok: true, id: veil.id, on: !revealed.includes(veil.id) };
  },

  async 'veil.set'({ id, on }) {
    const s = await loadState();
    const revealed = s.revealed.filter((x) => x !== id);
    if (!on) revealed.push(id);
    await saveLive({ revealed });
    return { ok: true };
  },

  async 'veil.create'({ name, selectors, text }) {
    const { veils } = await loadState();
    const veil = normaliseVeil({ name, selectors, text }, veils);
    if (!veil.selectors.length) return { ok: false, error: 'A veil needs at least one selector' };
    await saveVeils([...veils, veil]);
    return { ok: true, veil };
  },

  // text: pass null to remove the filter, an object to set it, or omit to keep it.
  async 'veil.update'({ id, name, selectors, text }) {
    const { veils } = await loadState();
    const next = veils.map((v) => {
      if (v.id !== id) return v;
      const out = {
        ...v,
        ...(name !== undefined && { name: String(name).trim() || v.name }),
        ...(selectors !== undefined && { selectors: cleanSelectors(selectors) }),
      };
      if (text !== undefined) {
        const t = cleanText(text);
        if (t) out.text = t;
        else delete out.text;
      }
      return out;
    });
    await saveVeils(next);
    return { ok: true };
  },

  async 'veil.delete'({ id }) {
    const { veils } = await loadState();
    await saveVeils(veils.filter((v) => v.id !== id));
    return { ok: true };
  },

  async 'veil.move'({ id, delta }) {
    const { veils } = await loadState();
    const i = veils.findIndex((v) => v.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= veils.length) return { ok: false };
    const next = [...veils];
    [next[i], next[j]] = [next[j], next[i]];
    await saveVeils(next);
    return { ok: true };
  },

  // ----- stage -----

  // Reset the demo: every veil on, Slack post dismissed, topic hidden, and (if
  // configured) the demo window rebuilt to exactly the demo tabs. Camera untouched.
  async reset() {
    const { topic, settings } = await loadState();
    const { mode } = await loadState();
    await saveLive({
      revealed: [],
      slack: { shown: false, at: 0 },
      topic: { ...topic, shown: false, cued: false },
      segTime: {},
      segCurrent: null,
      liveStart: mode === 'live' ? Date.now() : null,
    });
    const tabs = settings.resetTabs && configuredTabs(settings).length ? await rebuildTabs() : null;
    trackSegment(); // start timing whichever segment is on screen now
    return { ok: true, tabs };
  },

  // ----- slides -----

  async 'slide.next'() {
    return stepSlide(1);
  },

  async 'slide.prev'() {
    return stepSlide(-1);
  },

  // ----- demo tabs -----

  async 'tabs.status'() {
    return { ok: true, ...(await tabsStatus()) };
  },

  async 'tabs.rebuild'() {
    return rebuildTabs();
  },

  async 'tab.next'() {
    return stepTab(1);
  },

  async 'tab.prev'() {
    return stepTab(-1);
  },

  async 'tab.activate'({ index }) {
    const st = await tabsStatus();
    const t = st.tabs[index];
    if (!t) return { ok: false };
    if (t.tabId) await chrome.tabs.update(t.tabId, { active: true });
    else if (st.windowId) await chrome.tabs.create({ windowId: st.windowId, url: t.url, active: true });
    return { ok: true };
  },

  // Snapshot the demo window's current web tabs as the demo tab list.
  async 'tabs.capture'() {
    const win = await demoWindow();
    if (!win) return { ok: false, error: 'No browser window' };
    const tabs = (await chrome.tabs.query({ windowId: win.id })).filter((t) => /^https?:/.test(t.url || ''));
    const list = tabs.map((t) => ({ id: newSegId(), label: (t.title || new URL(t.url).host).slice(0, 40), url: t.url }));
    await handlers['settings.update']({ patch: { tabs: list } });
    return { ok: true, count: list.length };
  },

  async 'mode.set'({ mode }) {
    if (mode !== 'live' && mode !== 'rehearse') return { ok: false, error: 'Bad mode' };
    const { liveStart } = await loadState();
    await saveLive({ mode, ...(mode === 'live' && !liveStart && { liveStart: Date.now() }) });
    return { ok: true, mode };
  },

  async 'mode.toggle'() {
    const { mode } = await loadState();
    return handlers['mode.set']({ mode: mode === 'live' ? 'rehearse' : 'live' });
  },

  async 'picker.start'({ tabId } = {}) {
    const { mode } = await loadState();
    if (mode === 'live') return { ok: false, error: 'Switch to Rehearse mode to pick elements.' };
    if (!tabId) {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      tabId = tab?.id;
    }
    if (!tabId) return { ok: false, error: 'No active tab' };
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'picker.start' });
      return { ok: true };
    } catch {
      return { ok: false, error: 'Demo Director is not running on this page (check the URL, or reload the tab).' };
    }
  },

  // ----- camera -----

  async 'camera.set'({ on }) {
    const { camera } = await loadState();
    await saveLive({ camera: { ...camera, on: !!on, blink: on ? camera.blink : false, showAt: null } });
    return { ok: true, on: !!on };
  },

  async 'camera.toggle'() {
    const { camera } = await loadState();
    return handlers['camera.set']({ on: !camera.on });
  },

  // Blink: visible for N seconds, hidden for N seconds, repeating. Phase is derived
  // from blinkStart, so every tab (and a reload) agrees without a shared timer.
  async 'camera.blink'({ on } = {}) {
    const { camera } = await loadState();
    const blink = on ?? !camera.blink;
    await saveLive({ camera: { ...camera, on: camera.on || blink, blink, blinkStart: Date.now(), showAt: null } });
    return { ok: true, blink };
  },

  async 'camera.size'({ size } = {}) {
    const { camera } = await loadState();
    // A custom (dragged) px size cycles back to S.
    const next = SIZES.includes(size) ? size : SIZES[(SIZES.indexOf(camera.size) + 1) % SIZES.length];
    await saveLive({ camera: { ...camera, size: next } });
    return { ok: true, size: next };
  },

  // Dragged/resized in Rehearse mode: move the live bubble, and if the tab is a
  // segment, save it as that segment's camera spot.
  async 'camera.place'({ pos, size, tabId }) {
    const corner = ['tl', 'tr', 'bl', 'br'].includes(pos?.corner) ? pos.corner : 'tr';
    const clean = { corner, x: Math.max(0, Math.round(pos?.x || 0)), y: Math.max(0, Math.round(pos?.y || 0)) };
    const px = Math.max(80, Math.min(900, Math.round(Number(size) || 240)));
    const { camera, settings, segCurrent } = await loadState();
    await saveLive({ camera: { ...camera, pos: clean, size: px } });
    // The segment you're in owns this tab even after its URL has wandered off.
    const seg = !tabId ? null : segCurrent?.tabId === tabId ? segCurrent : await segmentForTab(tabId);
    if (seg) {
      const tabs = settings.tabs.map((t) => (segId(t) === seg.id ? { ...t, camera: { ...(t.camera || {}), pos: clean, size: px } } : t));
      await handlers['settings.update']({ patch: { tabs } });
    }
    return { ok: true, segment: seg?.label || null };
  },

  'segment.track': trackSegmentNow,

  async 'segment.update'({ id, patch }) {
    const { settings } = await loadState();
    const tabs = settings.tabs.map((t) => (segId(t) === id ? { ...t, ...patch } : t));
    await handlers['settings.update']({ patch: { tabs } });
    return { ok: true };
  },

  // ----- topics (lower-thirds) -----

  async 'topic.show'({ index }) {
    const { settings } = await loadState();
    const n = Math.max(1, Math.min(settings.topics.length, Number(index) || 1));
    const shownAt = Date.now();
    await saveLive({ topic: { index: n, shown: true, shownAt, cued: false } });
    const secs = Math.max(0, Math.min(600, Number(settings.lowerThird.autoHide) || 0));
    if (secs) setTimeout(() => dispatch({ type: 'topic.autohide', shownAt }), secs * 1000);
    return { ok: true, index: n };
  },

  // The topic's time is up: hide it and cue the next one, so the Deck's toggle /
  // next key shows it with one press. Ignored if another topic was shown since.
  async 'topic.autohide'({ shownAt }) {
    const { topic, settings } = await loadState();
    if (!topic.shown || topic.shownAt !== shownAt) return { ok: true, stale: true };
    const last = topic.index >= settings.topics.length;
    await saveLive({ topic: { ...topic, shown: false, index: last ? topic.index : topic.index + 1, cued: !last } });
    return { ok: true };
  },

  async 'topic.hide'() {
    const { topic } = await loadState();
    await saveLive({ topic: { ...topic, shown: false, cued: false } });
    return { ok: true };
  },

  async 'topic.toggle'() {
    const { topic } = await loadState();
    if (topic.shown) return handlers['topic.hide']();
    return handlers['topic.show']({ index: topic.index || 1 });
  },

  async 'topic.next'() {
    const { topic } = await loadState();
    // A cued topic is already the next one.
    return handlers['topic.show']({ index: topic.cued ? topic.index : (topic.index || 0) + 1 });
  },

  async 'topic.prev'() {
    const { topic } = await loadState();
    return handlers['topic.show']({ index: (topic.index || 2) - 1 });
  },

  // ----- Slack notification -----

  async 'slack.show'() {
    await saveLive({ slack: { shown: true, at: Date.now() } });
    return { ok: true };
  },

  async 'slack.hide'() {
    await saveLive({ slack: { shown: false, at: 0 } });
    return { ok: true };
  },

  async 'slack.toggle'() {
    const { slack } = await loadState();
    return handlers[slack.shown ? 'slack.hide' : 'slack.show']();
  },

  // ----- Director console (second screen) -----

  // Focus the console if it's open, otherwise open it where it was last left.
  async 'console.open'() {
    const { consoleWindowId } = await chrome.storage.session.get('consoleWindowId');
    if (consoleWindowId) {
      try {
        await chrome.windows.update(consoleWindowId, { focused: true, drawAttention: false });
        return { ok: true, reused: true };
      } catch {} // closed since
    }
    const { consoleBounds } = await chrome.storage.local.get('consoleBounds');
    const win = await chrome.windows.create({
      url: chrome.runtime.getURL('console.html'),
      type: 'popup',
      focused: true,
      ...(consoleBounds || { width: 760, height: 900 }),
    });
    await chrome.storage.session.set({ consoleWindowId: win.id });
    return { ok: true };
  },

  // ----- settings -----

  // patch is deep-merged into stored overrides, e.g. { camera: { blinkSeconds: 20 } }.
  // topics is replaced as a whole array.
  async 'settings.update'({ patch }) {
    const { settings: stored = {} } = await chrome.storage.local.get('settings');
    const next = merge(stored, patch);
    if (patch?.topics) next.topics = patch.topics;
    if (patch?.tabs) next.tabs = withIds(patch.tabs);
    await chrome.storage.local.set({ settings: next });
    return { ok: true };
  },

  async 'settings.reset'({ section }) {
    const { settings: stored = {} } = await chrome.storage.local.get('settings');
    delete stored[section];
    await chrome.storage.local.set({ settings: stored });
    return { ok: true };
  },

  // ----- backup -----

  async export() {
    const { veils = [], settings = {}, avatar } = await chrome.storage.local.get(['veils', 'settings', 'avatar']);
    const { deviceId, ...camera } = settings.camera || {}; // device ids are per-machine
    return {
      ok: true,
      data: { app: 'demo-director', version: EXPORT_VERSION, veils, settings: { ...settings, camera }, avatar },
    };
  },

  async import({ data }) {
    if (!data || !Array.isArray(data.veils)) return { ok: false, error: 'File has no "veils" list' };
    const veils = [];
    for (const v of data.veils) {
      if (!v || typeof v !== 'object') continue;
      const veil = normaliseVeil(v, veils);
      if (veil.selectors.length) veils.push(veil);
    }
    const patch = { veils };
    if (isObj(data.settings)) {
      const { settings: current = {} } = await chrome.storage.local.get('settings');
      patch.settings = { ...data.settings, camera: { ...data.settings.camera, deviceId: current.camera?.deviceId } };
    }
    if (typeof data.avatar === 'string' && data.avatar.startsWith('data:image/')) patch.avatar = data.avatar;
    await chrome.storage.local.set(patch);
    await saveLive({ revealed: [] });
    return { ok: true, count: veils.length };
  },
};

// Serialise actions so rapid Stream Deck presses never race on read-modify-write.
let queue = Promise.resolve();
export function dispatch(action) {
  const run = queue.then(async () => {
    const handler = handlers[action?.type];
    if (!handler) return { ok: false, error: `Unknown action ${action?.type}` };
    return handler(action);
  });
  queue = run.catch(() => {});
  return run;
}

// ---------- Stream Deck bridge ----------
// The Stream Deck plugin runs a WebSocket server on 127.0.0.1; we're the client.
// Key presses arrive as actions (same as the console's); every state change goes
// back so the keys can show it. The plugin pings every 20s, which also keeps this
// service worker awake; an alarm reconnects if Chrome put us to sleep anyway.

let bridge = null;
let bridgeUp = false;
let bridgePort = 0;
let bridgeRetry = 0;
let bridgeTimer = 0;

function bridgeSlim(s) {
  const t = s.settings.topics[s.topic.index - 1];
  return {
    mode: s.mode,
    veils: s.veils.map((v) => ({ id: v.id, name: v.name, on: s.active.includes(v.id) })),
    camera: { ...s.camera, blinkSeconds: Number(s.settings.camera.blinkSeconds) || 30 },
    topic: { ...s.topic, count: s.settings.topics.length, title: t?.title || '', icon: t?.icon || '' },
    topics: s.settings.topics.map((x) => ({ title: x.title, icon: x.icon })),
    slack: { shown: s.slack.shown, sender: s.settings.slack.sender },
    segments: configuredTabs(s.settings).map((x) => ({ id: segId(x), label: x.label || x.url, minutes: Number(x.minutes) || 0 })),
    segTime: s.segTime,
    segCurrent: s.segCurrent,
    liveStart: s.liveStart,
  };
}

function bridgeSend(msg) {
  if (bridge?.readyState === WebSocket.OPEN) bridge.send(JSON.stringify(msg));
}

function scheduleBridge() {
  clearTimeout(bridgeTimer);
  const delay = Math.min(30000, 1000 * 2 ** bridgeRetry++);
  bridgeTimer = setTimeout(bridgeConnect, delay);
}

async function bridgeConnect() {
  const { settings } = await loadState();
  const cfg = settings.bridge || {};
  const port = Number(cfg.port) || 47821;
  if (cfg.enabled === false) return bridge?.close();
  if (bridge && bridgePort !== port) bridge.close(); // port changed in Settings
  if (bridge && bridge.readyState <= WebSocket.OPEN) return;
  let ws;
  try {
    ws = new WebSocket(`ws://127.0.0.1:${port}`);
  } catch {
    return scheduleBridge();
  }
  bridge = ws;
  bridgePort = port;
  ws.onopen = async () => {
    bridgeRetry = 0;
    bridgeUp = true;
    bridgeSend({ type: 'hello', app: 'demo-director', version: chrome.runtime.getManifest().version });
    broadcast(); // also sends the plugin its first state
  };
  ws.onmessage = async (e) => {
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    if (msg.type === 'ping') return bridgeSend({ type: 'pong' });
    if (msg.type === 'action' && msg.action?.type) {
      const result = await dispatch(msg.action).catch((err) => ({ ok: false, error: String(err) }));
      bridgeSend({ type: 'result', id: msg.id, ok: result?.ok !== false, error: result?.error || null });
    }
  };
  ws.onerror = () => {}; // onclose follows; nothing listening is normal when the Deck app is closed
  ws.onclose = () => {
    if (bridge !== ws) return;
    bridge = null;
    const was = bridgeUp;
    bridgeUp = false;
    if (was) broadcast();
    scheduleBridge();
  };
}

chrome.alarms.create('dd-bridge', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((a) => a.name === 'dd-bridge' && bridgeConnect());

// ---------- outputs: broadcast + badge ----------

async function broadcast() {
  const state = await loadState();
  const msg = { type: 'state', state };
  const tabs = await chrome.tabs.query({ url: await pageMatches() });
  await Promise.all(tabs.map((t) => chrome.tabs.sendMessage(t.id, msg).catch(() => {})));
  chrome.runtime.sendMessage(msg).catch(() => {}); // popup / options, if open
  bridgeSend({ type: 'state', state: bridgeSlim(state) });
  await updateBadge(state);
}

async function updateBadge(state) {
  const live = state.mode === 'live';
  const text = state.veils.length ? String(state.active.length) : '';
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color: live ? '#d92d20' : '#475467' });
  await chrome.action.setBadgeTextColor?.({ color: '#ffffff' });
  const names = state.veils.filter((v) => state.active.includes(v.id)).map((v) => v.name);
  const cam = state.camera.on ? (state.camera.blink ? 'blinking' : 'on') : 'off';
  await chrome.action.setTitle({
    title: [
      `Demo Director — ${live ? 'LIVE' : 'Rehearse'}`,
      names.length ? `Veiled: ${names.join(', ')}` : 'No veils on',
      `Camera: ${cam} (${sizeLabel(state.camera.size)})`,
      state.topic.shown ? `Topic ${state.topic.index}: ${state.settings.topics[state.topic.index - 1]?.title}` : 'Topic: hidden',
    ].join('\n'),
  });
}

const SESSION_KEYS = ['revealed', 'mode', 'camera', 'topic', 'slack', 'segTime', 'segCurrent', 'liveStart'];
chrome.storage.onChanged.addListener((changes, area) => {
  const keys = Object.keys(changes);
  if (area === 'local' && keys.includes('settings')) {
    trackSegment(); // the tab list may have changed
    bridgeConnect(); // Stream Deck port / on-off may have changed
  }
  if ((area === 'local' && keys.some((k) => k === 'veils' || k === 'settings')) || (area === 'session' && keys.some((k) => SESSION_KEYS.includes(k)))) {
    broadcast();
  }
});

// ---------- inputs ----------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'action') return;
  const action = { ...msg.action };
  if ((action.type === 'picker.start' || action.type === 'camera.place') && !action.tabId && sender.tab) action.tabId = sender.tab.id;
  dispatch(action).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e) }));
  return true;
});

const COMMANDS = {
  reset: { type: 'reset' },
  'toggle-mode': { type: 'mode.toggle' },
  'start-picker': { type: 'picker.start' },
  'camera-toggle': { type: 'camera.toggle' },
  'camera-blink': { type: 'camera.blink' },
  'camera-size': { type: 'camera.size' },
  'topic-next': { type: 'topic.next' },
  'topic-prev': { type: 'topic.prev' },
  'topic-toggle': { type: 'topic.toggle' },
  'slack-ping': { type: 'slack.toggle' },
  'open-console': { type: 'console.open' },
  'tab-next': { type: 'tab.next' },
  'slide-next': { type: 'slide.next' },
  'slide-prev': { type: 'slide.prev' },
  'tab-prev': { type: 'tab.prev' },
};

chrome.commands.onCommand.addListener((command, tab) => {
  const veil = /^veil-(\d+)$/.exec(command);
  if (veil) return dispatch({ type: 'veil.toggle', slot: Number(veil[1]) });
  const topic = /^topic-(\d+)$/.exec(command);
  if (topic) return dispatch({ type: 'topic.show', index: Number(topic[1]) });
  const action = COMMANDS[command];
  if (action) dispatch(action.type === 'picker.start' ? { ...action, tabId: tab?.id } : action);
});

// ---------- lifecycle ----------

chrome.runtime.onInstalled.addListener(async () => {
  // Content scripts don't auto-inject into tabs that were already open.
  const files = chrome.runtime.getManifest().content_scripts[0].js;
  const tabs = await chrome.tabs.query({ url: STATIC_MATCHES });
  for (const t of tabs) {
    chrome.scripting.executeScript({ target: { tabId: t.id }, files }).catch(() => {});
  }
  await syncDynamicSites();
  updateBadge(await loadState());
});

chrome.runtime.onStartup.addListener(async () => updateBadge(await loadState()));

bridgeConnect();
