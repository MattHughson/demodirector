// Demo Director — Stream Deck plugin entry.
// Every key is a thin wrapper: its face comes from views.js (driven by the
// extension's state over the bridge) and a press sends one action back.
import streamDeck, { SingletonAction } from '@elgato/streamdeck';
import { Bridge } from './bridge.js';
import { keyImage } from './keys.js';
import { ACTIONS, DISCONNECTED, UUID } from './views.js';

const log = streamDeck.logger;
const bridge = new Bridge({ logger: log }).start();

class DDAction extends SingletonAction {
  constructor(name) {
    super();
    this.name = name;
    this.def = ACTIONS[name];
    this.manifestId = UUID(name);
    this.settings = new Map(); // action id → settings
    this.faces = new Map(); // action id → last image (skip redundant redraws)
    this.holds = new Map(); // action id → hold timer (reset key)
  }

  settingsFor(a) {
    return { ...(this.def.defaults || {}), ...(this.settings.get(a.id) || {}) };
  }

  async paint(a, { holding = false } = {}) {
    if (!a.isKey?.()) return;
    const s = bridge.connected && bridge.state;
    const face = s ? this.def.view(s, this.settingsFor(a), Date.now(), holding) : DISCONNECTED(this.name);
    const img = keyImage(face);
    if (this.faces.get(a.id) === img) return;
    this.faces.set(a.id, img);
    await a.setImage(img);
  }

  paintAll() {
    for (const a of this.actions) this.paint(a).catch((e) => log.error(e));
  }

  onWillAppear(ev) {
    this.settings.set(ev.action.id, ev.payload.settings || {});
    this.faces.delete(ev.action.id);
    ev.action.setTitle?.('');
    return this.paint(ev.action);
  }

  onWillDisappear(ev) {
    this.faces.delete(ev.action.id);
    clearTimeout(this.holds.get(ev.action.id));
  }

  onDidReceiveSettings(ev) {
    this.settings.set(ev.action.id, ev.payload.settings || {});
    return this.paint(ev.action);
  }

  async fire(a) {
    if (!bridge.connected || !bridge.state) return a.showAlert();
    const res = await bridge.action(this.def.press(bridge.state, this.settingsFor(a)));
    if (!res.ok) {
      log.warn(`${this.name}: ${res.error}`);
      await a.showAlert();
    }
  }

  async onKeyDown(ev) {
    const a = ev.action;
    if (!this.def.hold) return this.fire(a);
    // Hold-to-confirm (Reset closes tabs): fire only after the key is held.
    if (!bridge.connected) return a.showAlert();
    await this.paint(a, { holding: true });
    this.holds.set(
      a.id,
      setTimeout(async () => {
        this.holds.delete(a.id);
        await this.fire(a);
        this.faces.delete(a.id);
        await this.paint(a);
        await a.showOk();
      }, this.def.hold)
    );
  }

  async onKeyUp(ev) {
    const t = this.holds.get(ev.action.id);
    if (t === undefined) return;
    clearTimeout(t); // released too early → cancelled
    this.holds.delete(ev.action.id);
    this.faces.delete(ev.action.id);
    await this.paint(ev.action);
  }

  // Property inspector asks for the extension's veils and topics to fill its menus.
  async onSendToPlugin(ev) {
    if (ev.payload?.type !== 'getOptions') return;
    const s = bridge.state;
    await streamDeck.ui.sendToPropertyInspector({
      type: 'options',
      connected: bridge.connected,
      veils: (s?.veils || []).map((v, i) => ({ slot: i + 1, name: v.name })),
      topics: (s?.topics || []).map((t, i) => ({ index: i + 1, title: t.title })),
    });
  }
}

const actions = Object.keys(ACTIONS).map((name) => new DDAction(name));
for (const a of actions) streamDeck.actions.registerAction(a);

// Repaint on every state change; once a second for keys that show timers.
bridge.on('change', () => actions.forEach((a) => a.paintAll()));
setInterval(() => actions.filter((a) => a.def.ticks).forEach((a) => a.paintAll()), 1000);

streamDeck.connect();
