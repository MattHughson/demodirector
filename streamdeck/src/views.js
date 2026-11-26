// What each key looks like and what pressing it does, as plain functions of
// (extension state, key settings, now). No Stream Deck APIs here, so it's testable.
import { COLORS, fmtTime } from './keys.js';

export const UUID = (name) => `com.demodirector.streamdeck.${name}`;

const sizeLabel = (size) => (typeof size === 'number' ? `${size}px` : String(size || 'm').toUpperCase());

function blinkPhase(camera, now) {
  const ms = (Number(camera.blinkSeconds) || 30) * 1000;
  const elapsed = Math.max(0, now - (camera.blinkStart || now));
  const hidden = Math.floor(elapsed / ms) % 2 === 1;
  return { hidden, left: Math.ceil((ms - (elapsed % ms)) / 1000) };
}

function segSpent(s, id, now) {
  const cur = s.segCurrent;
  return (s.segTime?.[id] || 0) + (cur?.id === id ? now - cur.since : 0);
}

// The segment you're in wants a topic: its flash delay has passed and no topic
// has been shown since you arrived.
function topicDue(s, now) {
  const cur = s.segCurrent;
  const seg = cur && (s.segments || []).find((x) => x.id === cur.id);
  if (!seg || seg.topicCue == null || s.topic.shown) return false;
  return now >= cur.since + seg.topicCue * 1000 && (s.topic.shownAt || 0) < cur.since;
}

// Each action: { view(state, settings, now) → keyImage options, press(state, settings) → extension action }
export const ACTIONS = {
  veil: {
    defaults: { slot: 1 },
    view(s, { slot = 1 }) {
      const v = s.veils[slot - 1];
      if (!v) return { icon: 'eye', top: `VEIL ${slot}`, label: 'Not set', sub: 'pick in Rehearse', dim: true };
      return v.on
        ? { bg: COLORS.accent, icon: 'eyeoff', top: 'HIDDEN', label: v.name, sub: `veil ${slot}` }
        : { icon: 'eye', top: 'SHOWN', label: v.name, sub: `veil ${slot}` };
    },
    press: (s, { slot = 1 }) => ({ type: 'veil.toggle', slot: Number(slot) || 1 }),
  },

  camera: {
    ticks: true, // arrival-delay countdown
    view(s, _settings, now) {
      const wait = s.camera.on && s.camera.showAt ? s.camera.showAt - now : 0;
      if (wait > 0) return { bg: COLORS.accent, icon: 'camera', top: `IN ${Math.ceil(wait / 1000)}s`, label: 'Camera', sub: 'starting…' };
      return s.camera.on
        ? { bg: COLORS.on, icon: 'camera', top: 'ON', label: 'Camera', sub: sizeLabel(s.camera.size) }
        : { icon: 'camera', top: 'OFF', label: 'Camera' };
    },
    press: () => ({ type: 'camera.toggle' }),
  },

  blink: {
    ticks: true,
    view(s, _settings, now) {
      if (s.camera.on && s.camera.blink && s.camera.showAt > now) return { bg: COLORS.accent, icon: 'blink', top: 'BLINK', label: `In ${Math.ceil((s.camera.showAt - now) / 1000)}s`, sub: 'after delay' };
      if (!(s.camera.on && s.camera.blink)) return { icon: 'blink', top: 'BLINK', label: 'Blink', sub: `every ${s.camera.blinkSeconds}s` };
      const { hidden, left } = blinkPhase(s.camera, now);
      return { bg: COLORS.accent, icon: 'blink', top: hidden ? 'HIDDEN' : 'VISIBLE', label: hidden ? `Back ${left}s` : `Hides ${left}s`, sub: 'press to stop' };
    },
    press: () => ({ type: 'camera.blink' }),
  },

  camsize: {
    view: (s) => ({ icon: 'maximize', top: 'SIZE', label: sizeLabel(s.camera.size), sub: 'S → M → L' }),
    press: () => ({ type: 'camera.size' }),
  },

  topic: {
    defaults: { mode: 'next', index: 1 },
    ticks: true, // flashes when the segment's topic is due
    view(s, settings, now) {
      const face = this.face(s, settings);
      const { mode = 'next' } = settings;
      if ((mode === 'toggle' || mode === 'next') && topicDue(s, now)) {
        const lit = Math.floor(now / 1000) % 2 === 0;
        return { ...face, bg: lit ? COLORS.accent : COLORS.idle, top: 'SHOW TOPIC' };
      }
      return face;
    },
    face(s, { mode = 'next', index = 1 }) {
      const t = s.topic;
      const titleOf = (n) => s.topics?.[n - 1]?.title || '';
      const iconOf = (n) => s.topics?.[n - 1]?.icon || 'star';
      if (mode === 'next' || mode === 'prev') {
        // After an auto-hide the next topic is already cued at t.index.
        const step = mode === 'next' ? (t.cued ? 0 : 1) : -1;
        const n = Math.max(1, Math.min(t.count || 10, (t.index || (mode === 'next' ? 0 : 2)) + step));
        return { icon: mode, top: mode === 'next' ? 'NEXT TOPIC' : 'PREV TOPIC', label: `Step ${n}`, sub: titleOf(n) };
      }
      if (mode === 'show') {
        const n = Number(index) || 1;
        const onAir = t.shown && t.index === n;
        return { bg: onAir ? COLORS.accent : COLORS.idle, icon: iconOf(n), top: onAir ? 'ON AIR' : `STEP ${n}`, label: titleOf(n) || `Step ${n}`, sub: onAir ? 'press to hide' : '' };
      }
      // toggle: the current topic
      if (!t.index) return { icon: 'star', top: 'TOPIC', label: 'None yet', sub: 'press for step 1' };
      return t.shown
        ? { bg: COLORS.accent, icon: t.icon || 'star', top: 'ON AIR', label: `Step ${t.index}`, sub: t.title }
        : { icon: t.icon || 'star', top: t.cued ? 'UP NEXT' : 'HIDDEN', label: `Step ${t.index}`, sub: t.title };
    },
    press(s, { mode = 'next', index = 1 }) {
      if (mode === 'prev') return { type: 'topic.prev' };
      if (mode === 'toggle') return { type: 'topic.toggle' };
      if (mode === 'show') {
        const n = Number(index) || 1;
        return s.topic.shown && s.topic.index === n ? { type: 'topic.hide' } : { type: 'topic.show', index: n };
      }
      return { type: 'topic.next' };
    },
  },

  slack: {
    view: (s) =>
      s.slack.shown
        ? { bg: COLORS.slack, icon: 'chat', top: 'SHOWING', label: s.slack.sender, sub: 'press to dismiss' }
        : { icon: 'chat', top: 'SLACK', label: s.slack.sender, sub: 'send message' },
    press: () => ({ type: 'slack.toggle' }),
  },

  mode: {
    view: (s) =>
      s.mode === 'live'
        ? { bg: COLORS.live, icon: 'live', top: 'ON AIR', label: 'LIVE', sub: '→ Rehearse' }
        : { icon: 'live', top: 'MODE', label: 'Rehearse', sub: '→ go Live' },
    press: () => ({ type: 'mode.toggle' }),
  },

  // Hold-to-confirm is handled in plugin.js; this is just the face.
  reset: {
    hold: 900,
    view: (s, _settings, _now, holding) =>
      holding ? { bg: COLORS.live, icon: 'reset', top: 'HOLD…', label: 'Reset', sub: 'keep holding' } : { icon: 'reset', top: 'RESET', label: 'Reset demo', sub: 'hold 1s' },
    press: () => ({ type: 'reset' }),
  },

  tab: {
    defaults: { dir: 'next' },
    ticks: true,
    view(s, { dir = 'next' }, now) {
      const segs = s.segments || [];
      if (!segs.length) return { icon: dir, top: dir === 'next' ? 'NEXT TAB' : 'PREV TAB', label: dir === 'next' ? 'Next tab' : 'Prev tab' };
      const i = segs.findIndex((x) => x.id === s.segCurrent?.id);
      const j = i < 0 ? 0 : (i + (dir === 'next' ? 1 : -1) + segs.length) % segs.length;
      const cur = segs[i];
      // Sub line: how the current segment is pacing, so the next-tab key doubles as a timer.
      let sub = '';
      let bg = COLORS.idle;
      if (cur) {
        const spent = segSpent(s, cur.id, now);
        const budget = cur.minutes * 60000;
        sub = budget ? `${fmtTime(spent)} / ${fmtTime(budget)}` : fmtTime(spent);
        if (budget && spent > budget) bg = COLORS.over;
        else if (budget && spent >= 0.8 * budget) bg = COLORS.warn;
      }
      return { bg, icon: dir, top: dir === 'next' ? `→ TAB ${j + 1}` : `← TAB ${j + 1}`, label: segs[j].label, sub };
    },
    press: (s, { dir = 'next' }) => ({ type: dir === 'prev' ? 'tab.prev' : 'tab.next' }),
  },

  slide: {
    defaults: { dir: 'next' },
    view: (s, { dir = 'next' }) => ({ icon: dir, top: 'SLIDES', label: dir === 'next' ? 'Next slide' : 'Prev slide' }),
    press: (s, { dir = 'next' }) => ({ type: dir === 'prev' ? 'slide.prev' : 'slide.next' }),
  },

  console: {
    view: () => ({ icon: 'monitor', top: 'CONSOLE', label: 'Open', sub: 'second screen' }),
    press: () => ({ type: 'console.open' }),
  },
};

// Face shown while the extension isn't connected.
export const DISCONNECTED = (name) => ({ bg: COLORS.off, icon: { veil: 'eye', camera: 'camera', blink: 'blink', camsize: 'maximize', topic: 'star', slack: 'chat', mode: 'live', reset: 'reset', tab: 'next', slide: 'slides', console: 'monitor' }[name], top: 'OFFLINE', label: 'Chrome?', sub: 'not connected', dim: true });
