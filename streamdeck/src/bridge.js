// Demo Director ↔ Stream Deck bridge (plugin side).
// A WebSocket server on 127.0.0.1 that the Chrome extension connects to. Only
// chrome-extension:// origins are accepted, so web pages can't drive the demo.
import { EventEmitter } from 'node:events';
import { WebSocketServer } from 'ws';

export const DEFAULT_PORT = Number(process.env.DD_PORT) || 47821;
const PING_MS = 20000; // also keeps the extension's service worker awake

export class Bridge extends EventEmitter {
  constructor({ port = DEFAULT_PORT, logger = console } = {}) {
    super();
    this.port = port;
    this.logger = logger;
    this.client = null;
    this.state = null; // last state the extension sent
    this.pending = new Map(); // action id → resolve
    this.nextId = 1;
  }

  get connected() {
    return !!this.client && this.client.readyState === 1;
  }

  start() {
    this.wss = new WebSocketServer({
      host: '127.0.0.1',
      port: this.port,
      verifyClient: ({ origin }) => typeof origin === 'string' && origin.startsWith('chrome-extension://'),
    });
    this.wss.on('listening', () => this.logger.info(`Demo Director bridge listening on 127.0.0.1:${this.port}`));
    this.wss.on('error', (e) => {
      // A previous plugin process can hold the port briefly during a restart: retry.
      this.logger.error(`Bridge error: ${e.message}${e.code === 'EADDRINUSE' ? ' (retrying in 3s)' : ''}`);
      if (e.code === 'EADDRINUSE') {
        this.wss.close();
        clearInterval(this.pinger);
        setTimeout(() => this.start(), 3000);
      }
    });
    this.wss.on('connection', (ws) => {
      if (this.client && this.client !== ws) this.client.close(1000, 'replaced'); // newest extension wins
      this.client = ws;
      this.logger.info('Extension connected');
      this.emit('change');
      ws.on('message', (data) => this.#onMessage(data));
      ws.on('close', () => {
        if (this.client !== ws) return;
        this.client = null;
        this.logger.info('Extension disconnected');
        for (const resolve of this.pending.values()) resolve({ ok: false, error: 'disconnected' });
        this.pending.clear();
        this.emit('change');
      });
    });
    clearInterval(this.pinger);
    this.pinger = setInterval(() => this.#send({ type: 'ping' }), PING_MS);
    return this;
  }

  stop() {
    clearInterval(this.pinger);
    this.wss?.close();
  }

  #send(msg) {
    if (!this.connected) return false;
    this.client.send(JSON.stringify(msg));
    return true;
  }

  #onMessage(data) {
    let msg;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    if (msg.type === 'state') {
      this.state = msg.state;
      this.emit('change');
    } else if (msg.type === 'result') {
      this.pending.get(msg.id)?.({ ok: msg.ok, error: msg.error });
      this.pending.delete(msg.id);
    } else if (msg.type === 'hello') {
      this.logger.info(`Extension says hello (v${msg.version})`);
    }
  }

  // Send an action to the extension; resolves with { ok, error }.
  action(action, timeoutMs = 4000) {
    const id = this.nextId++;
    if (!this.#send({ type: 'action', id, action })) return Promise.resolve({ ok: false, error: 'not connected' });
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      setTimeout(() => {
        if (this.pending.delete(id)) resolve({ ok: false, error: 'timeout' });
      }, timeoutMs);
    });
  }
}
