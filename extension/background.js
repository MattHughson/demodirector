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
//   topic:    { index: 0-10, shown }
//   slack:    { shown, at }

const PAGE_MATCHES = ['https://*.app.github.dev/*', 'http://localhost:3333/*'];
const EXPORT_VERSION = 2;
const SIZES = ['s', 'm', 'l'];

const LIVE_DEFAULTS = {
  revealed: [],
  mode: 'rehearse',
  camera: { on: false, blink: false, blinkStart: 0, size: 'm' },
  topic: { index: 0, shown: false },
  slack: { shown: false, at: 0 },
};

const CAMERA_DEFAULTS = {
  deviceId: '',
  mirror: true,
  blinkSeconds: 30,
  sizes: { s: 160, m: 240, l: 360 },
  offsetTop: 24,
  offsetRight: 24,
};

const LOWER_THIRD_DEFAULTS = { offsetLeft: 32, offsetBottom: 48, scale: 1, accent: '#f79009' };

// ---------- defaults (bundled JSON files, editable without touching code) ----------

let defaultsPromise;
function loadDefaults() {
  defaultsPromise ??= Promise.all(
    ['topics.json', 'slack-toast.json'].map((f) => fetch(chrome.runtime.getURL(f)).then((r) => r.json()))
  ).then(([topics, slack]) => ({ camera: CAMERA_DEFAULTS, topics, lowerThird: LOWER_THIRD_DEFAULTS, slack }));
  return defaultsPromise;
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
function merge(base, over) {
  if (!isObj(base) || !isObj(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = merge(base[k], v);
  return out;
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

function normaliseVeil(v, veils) {
  const name = String(v.name || v.id || 'Veil').trim();
  return {
    id: uniqueId(slugify(v.id || name), veils),
    name,
    selectors: cleanSelectors(v.selectors),
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

  async 'veil.create'({ name, selectors }) {
    const { veils } = await loadState();
    const veil = normaliseVeil({ name, selectors }, veils);
    if (!veil.selectors.length) return { ok: false, error: 'A veil needs at least one selector' };
    await saveVeils([...veils, veil]);
    return { ok: true, veil };
  },

  async 'veil.update'({ id, name, selectors }) {
    const { veils } = await loadState();
    const next = veils.map((v) =>
      v.id !== id
        ? v
        : {
            ...v,
            ...(name !== undefined && { name: String(name).trim() || v.name }),
            ...(selectors !== undefined && { selectors: cleanSelectors(selectors) }),
          }
    );
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

  // Reset the stage: every veil on, Slack post dismissed, topic hidden. Camera untouched.
  async reset() {
    const { topic } = await loadState();
    await saveLive({ revealed: [], slack: { shown: false, at: 0 }, topic: { ...topic, shown: false } });
    return { ok: true };
  },

  async 'mode.set'({ mode }) {
    if (mode !== 'live' && mode !== 'rehearse') return { ok: false, error: 'Bad mode' };
    await saveLive({ mode });
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
    await saveLive({ camera: { ...camera, on: !!on, blink: on ? camera.blink : false } });
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
    await saveLive({ camera: { ...camera, on: camera.on || blink, blink, blinkStart: Date.now() } });
    return { ok: true, blink };
  },

  async 'camera.size'({ size } = {}) {
    const { camera } = await loadState();
    const next = SIZES.includes(size) ? size : SIZES[(SIZES.indexOf(camera.size) + 1) % SIZES.length];
    await saveLive({ camera: { ...camera, size: next } });
    return { ok: true, size: next };
  },

  // ----- topics (lower-thirds) -----

  async 'topic.show'({ index }) {
    const { settings } = await loadState();
    const n = Math.max(1, Math.min(settings.topics.length, Number(index) || 1));
    await saveLive({ topic: { index: n, shown: true } });
    return { ok: true, index: n };
  },

  async 'topic.hide'() {
    const { topic } = await loadState();
    await saveLive({ topic: { ...topic, shown: false } });
    return { ok: true };
  },

  async 'topic.toggle'() {
    const { topic } = await loadState();
    if (topic.shown) return handlers['topic.hide']();
    return handlers['topic.show']({ index: topic.index || 1 });
  },

  async 'topic.next'() {
    const { topic } = await loadState();
    return handlers['topic.show']({ index: (topic.index || 0) + 1 });
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

// ---------- outputs: broadcast + badge ----------

async function broadcast() {
  const state = await loadState();
  const msg = { type: 'state', state };
  const tabs = await chrome.tabs.query({ url: PAGE_MATCHES });
  await Promise.all(tabs.map((t) => chrome.tabs.sendMessage(t.id, msg).catch(() => {})));
  chrome.runtime.sendMessage(msg).catch(() => {}); // popup / options, if open
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
      `Camera: ${cam} (${state.camera.size.toUpperCase()})`,
      state.topic.shown ? `Topic ${state.topic.index}: ${state.settings.topics[state.topic.index - 1]?.title}` : 'Topic: hidden',
    ].join('\n'),
  });
}

const SESSION_KEYS = ['revealed', 'mode', 'camera', 'topic', 'slack'];
chrome.storage.onChanged.addListener((changes, area) => {
  const keys = Object.keys(changes);
  if ((area === 'local' && keys.some((k) => k === 'veils' || k === 'settings')) || (area === 'session' && keys.some((k) => SESSION_KEYS.includes(k)))) {
    broadcast();
  }
});

// ---------- inputs ----------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'action') return;
  const action = { ...msg.action };
  if (action.type === 'picker.start' && !action.tabId && sender.tab) action.tabId = sender.tab.id;
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
  const tabs = await chrome.tabs.query({ url: PAGE_MATCHES });
  for (const t of tabs) {
    chrome.scripting.executeScript({ target: { tabId: t.id }, files }).catch(() => {});
  }
  updateBadge(await loadState());
});

chrome.runtime.onStartup.addListener(async () => updateBadge(await loadState()));
