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

const currentSeg = (s) => s.segCurrent && (s.segments || []).find((x) => x.id === s.segCurrent.id);

// The topics planned for the segment you're in, each with where it stands:
// 'onair' | 'done' (shown in this segment) | 'due' (its time has come) | 'later'.
// left: ms until it's due (null if it has no time).
export function segmentTopics(s, now) {
  const seg = currentSeg(s);
  if (!seg) return null;
  const t = segSpent(s, seg.id, now);
  const done = s.topic.done?.[seg.id] || [];
  return (seg.topics || []).map((x) => {
    const left = x.at == null ? null : x.at * 1000 - t;
    const status = s.topic.shown && s.topic.index === x.n ? 'onair' : done.includes(x.n) ? 'done' : left != null && left <= 0 ? 'due' : 'later';
    return { ...x, left, status };
  });
}

// A planned topic's time has come and nothing is on air.
const topicDue = (s, now) => !s.topic.shown && !!segmentTopics(s, now)?.some((x) => x.status === 'due');
const flash = (now) => (Math.floor(now / 1000) % 2 === 0 ? COLORS.accent : COLORS.idle);

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
    defaults: { mode: 'next', index: 1, slot: 1 },
    ticks: true, // countdowns, and flashing when a planned topic is due
    view(s, settings, now) {
      const { mode = 'next' } = settings;
      if (mode === 'segment') return this.slotFace(s, settings, now);
      const face = this.face(s, settings);
      if ((mode === 'toggle' || mode === 'next') && topicDue(s, now)) return { ...face, bg: flash(now), top: 'SHOW TOPIC' };
      return face;
    },
    // Segment topic N: whichever topic the current segment lists Nth.
    slotFace(s, { slot = 1 }, now) {
      const list = segmentTopics(s, now);
      if (!list) return { icon: 'star', top: `TOPIC ${slot}`, label: 'No segment', dim: true };
      const x = list[slot - 1];
      if (!x) return { icon: 'star', top: `TOPIC ${slot}`, label: '—', sub: 'none here', dim: true };
      const t = s.topics?.[x.n - 1] || {};
      const face = { icon: t.icon || 'star', label: t.title || `Step ${x.n}` };
      if (x.status === 'onair') return { ...face, bg: COLORS.accent, top: 'ON AIR', sub: 'press to hide' };
      if (x.status === 'done') return { ...face, top: 'SHOWN', sub: 'press to re-show', dim: true };
      if (x.status === 'due') return { ...face, bg: flash(now), top: 'SHOW NOW', sub: `planned ${fmtTime(x.at * 1000)}` };
      return { ...face, top: x.left != null ? `IN ${fmtTime(x.left)}` : `TOPIC ${slot}`, sub: x.at != null ? `at ${fmtTime(x.at * 1000)}` : '' };
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
    press(s, { mode = 'next', index = 1, slot = 1 }) {
      if (mode === 'segment') {
        const x = segmentTopics(s, Date.now())?.[slot - 1];
        if (!x) return null;
        return x.status === 'onair' ? { type: 'topic.hide' } : { type: 'topic.show', index: x.n };
      }
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

  // Show clock: a tap starts it (zeroing the segment timers); once running, hold
  // 1s to restart it. Flashes while you're Live and it hasn't been started.
  clock: {
    ticks: true,
    hold: (s) => (s.liveStart ? 1000 : 0),
    view(s, _settings, now, holding) {
      if (holding) return { bg: COLORS.live, icon: 'clock', top: 'HOLD…', label: 'Restart', sub: 'from 0:00' };
      if (!s.liveStart) return { bg: s.mode === 'live' ? flash(now) : COLORS.idle, icon: 'clock', top: 'CLOCK', label: 'Start', sub: 'zeroes timers' };
      return { bg: COLORS.on, icon: 'clock', top: 'SHOW TIME', label: fmtTime(now - s.liveStart), sub: 'hold: restart' };
    },
    press: () => ({ type: 'clock.start' }),
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

  // Hold-to-confirm, so a bumped key can't close the demo mid-show. On a slides
  // segment shared as a single tab, closing it is how you end the screen share.
  closetab: {
    hold: 500,
    view(s, _settings, _now, holding) {
      const segs = s.segments || [];
      const i = segs.findIndex((x) => x.id === s.segCurrent?.id);
      const top = segs[i]?.slides ? 'END SHARE' : 'CLOSE TAB';
      if (holding) return { bg: COLORS.live, icon: 'close', top: 'HOLD…', label: top === 'END SHARE' ? 'End share' : 'Close tab', sub: 'keep holding' };
      const next = i >= 0 ? segs[i + 1] : segs[0];
      return { icon: 'close', top, label: i >= 0 ? segs[i].label : 'This tab', sub: next ? `→ ${next.label}` : 'hold ½s' };
    },
    press: () => ({ type: 'tab.close' }),
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
export const DISCONNECTED = (name) => ({ bg: COLORS.off, icon: { veil: 'eye', camera: 'camera', blink: 'blink', camsize: 'maximize', topic: 'star', slack: 'chat', mode: 'live', reset: 'reset', tab: 'next', closetab: 'close', clock: 'clock', slide: 'slides', console: 'monitor' }[name], top: 'OFFLINE', label: 'Chrome?', sub: 'not connected', dim: true });
