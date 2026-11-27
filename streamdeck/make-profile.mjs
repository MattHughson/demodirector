// Generate "Demo Director.streamDeckProfile": the suggested 15-key MK.2 layout,
// ready to double-click into the Stream Deck app (the plugin must be installed).
// Classic profile format: a zip with <UUID>.sdProfile/manifest.json, where
// "Actions" maps "column,row" → { UUID, Settings, States… }.
import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const DEVICE_MODEL = '20GBA9901'; // Stream Deck MK.2 (15 keys)
const A = (name, label, settings = {}) => ({
  Name: label,
  Settings: settings,
  State: 0,
  States: [{ FFamily: '', FSize: '', FStyle: '', FUnderline: '', Image: '', Title: '', TitleAlignment: '', TitleColor: '', TitleShow: '' }],
  UUID: `com.demodirector.streamdeck.${name}`,
});

// [column, row] → action
const LAYOUT = [
  [0, 0, A('camera', 'Camera')],
  [1, 0, A('blink', 'Blink')],
  [2, 0, A('clock', 'Show clock')],
  [3, 0, A('mode', 'Live / Rehearse')],
  [4, 0, A('reset', 'Reset demo')],
  [0, 1, A('topic', 'Topic', { mode: 'segment', slot: 1 })],
  [1, 1, A('topic', 'Topic', { mode: 'segment', slot: 2 })],
  [2, 1, A('topic', 'Topic', { mode: 'segment', slot: 3 })],
  [3, 1, A('slack', 'Slack post')],
  [4, 1, A('closetab', 'Close tab')],
  [0, 2, A('veil', 'Veil', { slot: 1 })],
  [1, 2, A('veil', 'Veil', { slot: 2 })],
  [2, 2, A('veil', 'Veil', { slot: 3 })],
  [3, 2, A('slide', 'Slide', { dir: 'next' })],
  [4, 2, A('tab', 'Tab', { dir: 'next' })],
];

const manifest = {
  Actions: Object.fromEntries(LAYOUT.map(([c, r, a]) => [`${c},${r}`, a])),
  DeviceModel: DEVICE_MODEL,
  DeviceUUID: '',
  Name: 'Demo Director',
  Version: '1.0',
};

// ---- minimal zip writer (stored, no compression) ----
const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

// DOS date/time for the entries (some unzip tools choke on a zero date).
const now = new Date();
const DOS_TIME = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
const DOS_DATE = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of files) {
    const n = Buffer.from(name);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    locals.push(local, n, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const dir = `${randomUUID().toUpperCase()}.sdProfile`;
const out = 'Demo Director.streamDeckProfile';
writeFileSync(out, zip([{ name: `${dir}/manifest.json`, data: Buffer.from(JSON.stringify(manifest, null, 2)) }]));
console.log(`wrote ${out} (${LAYOUT.length} keys, ${DEVICE_MODEL})`);
