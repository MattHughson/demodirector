// Demo Director — service worker.
// Single source of truth and command bus. Every input (hotkeys, popup, options,
// content-script picker, and later the Stream Deck bridge and console) calls
// dispatch(action); state changes are broadcast to all pages.
//
// Storage:
//   chrome.storage.local   → definitions: { veils: [{ id, name, selectors[] }] }
//   chrome.storage.session → live stage: { revealed: [veilId], mode: 'rehearse'|'live' }
// A veil is "on" (element hidden) unless its id is in `revealed`, so a fresh
// browser session and a reset both start fully veiled.

const PAGE_MATCHES = ['https://*.app.github.dev/*', 'http://localhost:3333/*'];
const LIVE_DEFAULTS = { revealed: [], mode: 'rehearse' };
const EXPORT_VERSION = 1;

// ---------- state ----------

async function loadState() {
  const [{ veils = [] }, live] = await Promise.all([
    chrome.storage.local.get('veils'),
    chrome.storage.session.get(LIVE_DEFAULTS),
  ]);
  const ids = new Set(veils.map((v) => v.id));
  const revealed = live.revealed.filter((id) => ids.has(id));
  const active = veils.filter((v) => !revealed.includes(v.id)).map((v) => v.id);
  return { veils, revealed, active, mode: live.mode };
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

  // Reset the stage: every veil on. (Later phases also dismiss the Slack post and topic.)
  async reset() {
    await saveLive({ revealed: [] });
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

  async export() {
    const { veils } = await loadState();
    return { ok: true, data: { app: 'demo-director', version: EXPORT_VERSION, veils } };
  },

  async import({ data }) {
    if (!data || !Array.isArray(data.veils)) return { ok: false, error: 'File has no "veils" list' };
    const veils = [];
    for (const v of data.veils) {
      if (!v || typeof v !== 'object') continue;
      const veil = normaliseVeil(v, veils);
      if (veil.selectors.length) veils.push(veil);
    }
    await saveVeils(veils);
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
  await chrome.action.setTitle({
    title: `Demo Director — ${live ? 'LIVE' : 'Rehearse'}\n${
      names.length ? `Veiled: ${names.join(', ')}` : 'No veils on'
    }`,
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if ((area === 'local' && changes.veils) || (area === 'session' && (changes.revealed || changes.mode))) {
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
};

chrome.commands.onCommand.addListener((command, tab) => {
  const slot = /^veil-(\d+)$/.exec(command);
  if (slot) return dispatch({ type: 'veil.toggle', slot: Number(slot[1]) });
  const action = COMMANDS[command];
  if (action) dispatch(action.type === 'picker.start' ? { ...action, tabId: tab?.id } : action);
});

// ---------- lifecycle ----------

chrome.runtime.onInstalled.addListener(async () => {
  // Content scripts don't auto-inject into tabs that were already open.
  const tabs = await chrome.tabs.query({ url: PAGE_MATCHES });
  for (const t of tabs) {
    chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['selector.js', 'content.js'] }).catch(() => {});
  }
  updateBadge(await loadState());
});

chrome.runtime.onStartup.addListener(async () => updateBadge(await loadState()));
