// Key faces drawn as SVG (144×144) so they can show live state.
import '../../extension/icons.js'; // sets globalThis.DDIcons, shared with the extension

const ICONS = globalThis.DDIcons.paths;

export const COLORS = {
  idle: '#141a25',
  on: '#067647', // camera on
  accent: '#b54708', // veil hidden, blink, topic on air
  live: '#d92d20',
  slack: '#6941c6',
  warn: '#b54708',
  over: '#b42318',
  off: '#2b2f38', // not connected
};

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fit = (t, n) => {
  const s = String(t ?? '');
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

export function keyImage({ bg = COLORS.idle, icon, iconColor = '#ffffff', top, label, sub, dim = false } = {}) {
  const fg = dim ? '#8a94a6' : '#ffffff';
  const parts = [`<rect width="144" height="144" fill="${bg}"/>`];
  if (top) parts.push(`<text x="72" y="24" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="15" font-weight="bold" letter-spacing="1.5" fill="${fg}" fill-opacity="0.85">${esc(fit(top, 14))}</text>`);
  if (icon && ICONS[icon]) {
    parts.push(
      `<g transform="translate(48 ${top ? 34 : 26}) scale(2)" fill="none" stroke="${dim ? '#8a94a6' : iconColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[icon]}</g>`
    );
  }
  if (label) parts.push(`<text x="72" y="${sub ? 108 : 118}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="21" font-weight="bold" fill="${fg}">${esc(fit(label, 11))}</text>`);
  if (sub) parts.push(`<text x="72" y="132" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="16" fill="${fg}" fill-opacity="0.8">${esc(fit(sub, 14))}</text>`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">${parts.join('')}</svg>`;
  return `data:image/svg+xml;charset=utf8,${encodeURIComponent(svg)}`;
}

export const fmtTime = (ms) => {
  const t = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
