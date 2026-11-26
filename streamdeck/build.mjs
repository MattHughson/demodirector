// Build the Stream Deck plugin: bundle src/ → <plugin>/bin/plugin.js (one file,
// dependencies included, so the Stream Deck app needs nothing else) and draw the
// action/category icons as SVG from the extension's shared icon set.
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const PLUGIN = 'com.demodirector.streamdeck.sdPlugin';

await build({
  entryPoints: ['src/plugin.js'],
  outfile: `${PLUGIN}/bin/plugin.js`,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['bufferutil', 'utf-8-validate'], // optional ws speed-ups, loaded in try/catch
  legalComments: 'none',
  logLevel: 'info',
});

// The bundle is CommonJS; pin that so Node doesn't inherit "type": "module" from
// streamdeck/package.json when the plugin is linked straight from this repo.
writeFileSync(`${PLUGIN}/bin/package.json`, JSON.stringify({ type: 'commonjs' }) + '\n');

// ---- icons ----
createRequire(import.meta.url)('../extension/icons.js');
const P = globalThis.DDIcons.paths;
const glyph = (name, size, color) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${P[name]}</svg>`;
// Default key face (the plugin replaces it with a live one as soon as it runs).
const keyFace = (name) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144"><rect width="144" height="144" fill="#141a25"/><g transform="translate(36 36) scale(3)" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${P[name]}</g></svg>`;
const ICON_FOR = { veil: 'eyeoff', camera: 'camera', blink: 'blink', camsize: 'maximize', topic: 'star', slack: 'chat', mode: 'live', reset: 'reset', tab: 'tabs', slide: 'slides', console: 'monitor' };

mkdirSync(`${PLUGIN}/imgs/actions`, { recursive: true });
mkdirSync(`${PLUGIN}/imgs/plugin`, { recursive: true });
for (const [action, icon] of Object.entries(ICON_FOR)) {
  writeFileSync(`${PLUGIN}/imgs/actions/${action}.svg`, glyph(icon, 20, '#ffffff')); // action list
  writeFileSync(`${PLUGIN}/imgs/actions/${action}-key.svg`, keyFace(icon)); // key default
}
const brand = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect width="256" height="256" rx="48" fill="#f79009"/><g transform="translate(56 56) scale(6)" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${P.live}</g></svg>`;
// The plugin icon must be PNG (imgs/plugin/icon.png + icon@2x.png, committed).
void brand;
writeFileSync(`${PLUGIN}/imgs/plugin/category.svg`, glyph('live', 28, '#ffffff'));
console.log('icons written');
