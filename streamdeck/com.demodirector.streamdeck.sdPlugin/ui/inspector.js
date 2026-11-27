// Property inspector for Demo Director keys (veil, topic, tab, slide).
// Uses the Stream Deck property-inspector WebSocket protocol directly.
let ws;
let ctx;
let actionUUID;
let settings = {};
const DEFAULTS = { veil: { slot: 1 }, topic: { mode: 'next', index: 1, slot: 1 }, tab: { dir: 'next' }, slide: { dir: 'next' } };
let kind = '';
let opts = { veils: [], topics: [], connected: false };

const $ = (s) => document.querySelector(s);
const send = (event, extra) => ws?.readyState === 1 && ws.send(JSON.stringify({ event, context: ctx, ...extra }));

function fillSelect(sel, items, value) {
  sel.replaceChildren(...items.map(([v, t]) => new Option(t, String(v))));
  sel.value = String(value);
}

function render() {
  const s = { ...(DEFAULTS[kind] || {}), ...settings };
  document.querySelectorAll('[data-for]').forEach((row) => {
    const forMe = row.dataset.for.split(' ').includes(kind);
    const when = row.dataset.when;
    row.hidden = !forMe || (when && s.mode !== when);
  });
  if (kind === 'veil') {
    const veils = opts.veils.length ? opts.veils : [];
    const items = Array.from({ length: Math.max(6, veils.length) }, (_, i) => [i + 1, veils[i] ? `${i + 1} · ${veils[i].name}` : `${i + 1} · (not set yet)`]);
    fillSelect($('#slot'), items, s.slot);
  }
  if (kind === 'topic') {
    $('#mode').value = s.mode;
    const topics = opts.topics.length ? opts.topics : Array.from({ length: 10 }, (_, i) => ({ index: i + 1, title: '' }));
    fillSelect($('#index'), topics.map((t) => [t.index, `${t.index} · ${t.title || 'Step ' + t.index}`]), s.index);
    fillSelect($('#tslot'), [1, 2, 3, 4, 5].map((n) => [n, `Segment topic ${n}`]), s.slot);
  }
  if (kind === 'tab' || kind === 'slide') $('#dir').value = s.dir;
  const note = $('#note');
  note.className = opts.connected ? 'note' : 'note warn';
  note.textContent = opts.connected
    ? kind === 'veil'
      ? 'Veil slots follow the order in the extension’s Settings → Veils.'
      : kind === 'topic' && s.mode === 'segment'
        ? 'Shows the topic you planned in that position for the segment on screen, and lights up when its time comes. Plan them in the extension’s Settings → Segments.'
        : ''
    : 'Chrome extension not connected: names will appear once it is.';
}

document.addEventListener('change', (e) => {
  const key = e.target.dataset?.key;
  if (!key) return;
  const v = e.target.value;
  settings = { ...settings, [key]: /^\d+$/.test(v) ? Number(v) : v };
  send('setSettings', { payload: settings });
  render();
});

// Called by the Stream Deck app when the inspector opens.
window.connectElgatoStreamDeckSocket = (port, uuid, registerEvent, _info, actionInfo) => {
  ctx = uuid;
  const info = JSON.parse(actionInfo);
  actionUUID = info.action;
  kind = actionUUID.split('.').pop();
  settings = info.payload?.settings || {};
  ws = new WebSocket(`ws://127.0.0.1:${port}`);
  ws.onopen = () => {
    ws.send(JSON.stringify({ event: registerEvent, uuid }));
    send('sendToPlugin', { action: actionUUID, payload: { type: 'getOptions' } });
    render();
  };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.event === 'sendToPropertyInspector' && msg.payload?.type === 'options') {
      opts = msg.payload;
      render();
    } else if (msg.event === 'didReceiveSettings') {
      settings = msg.payload?.settings || {};
      render();
    }
  };
};
