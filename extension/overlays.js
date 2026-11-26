// Demo Director — on-page overlays: camera bubble, topic lower-third, Slack post.
// Rendered inside the content script's closed Shadow DOM layer. Everything is
// driven by state from the service worker; this file only draws it.

(function (root) {
  const CSS = `
    /* ---------- camera bubble ---------- */
    .cam { position: fixed; border-radius: 50%; overflow: hidden; background: #101828;
      box-shadow: 0 10px 30px rgba(16,24,40,.35), 0 0 0 var(--ring-w, 3px) var(--ring, #fff);
      transition: opacity .45s ease, transform .45s ease, width .3s ease, height .3s ease; }
    .cam iframe { width: 100%; height: 100%; border: 0; display: block; }
    .cam.off { opacity: 0; transform: scale(.85); }
    /* Rehearse: drag to move, handle to resize. Live: untouchable. */
    .cam .grab { position: absolute; inset: 0; border-radius: 50%; cursor: grab; display: none; }
    .cam .size { position: absolute; right: 6%; bottom: 6%; width: 22px; height: 22px; border-radius: 50%;
      background: #f79009; border: 3px solid #fff; cursor: nwse-resize; display: none; box-shadow: 0 2px 6px rgba(0,0,0,.3); }
    .cam.editable { pointer-events: auto; }
    .cam.editable .grab, .cam.editable .size { display: block; }
    .cam.editable:hover { box-shadow: 0 10px 30px rgba(16,24,40,.35), 0 0 0 3px #f79009; }
    .cam.dragging { transition: none; }
    .cam.dragging .grab { cursor: grabbing; }
    .cam .tag { position: absolute; left: 50%; bottom: -30px; translate: -50% 0; white-space: nowrap; padding: 3px 8px; border-radius: 6px;
      background: #101828; color: #fff; font: 600 11px -apple-system, BlinkMacSystemFont, system-ui, sans-serif; display: none; }
    .cam.editable:hover .tag, .cam.dragging .tag { display: block; }
    .cam { overflow: visible; }
    .cam .clip { position: absolute; inset: 0; border-radius: 50%; overflow: hidden; }
    .cam[hidden] { display: none; }

    /* ---------- lower-third ---------- */
    .lt { position: fixed; display: flex; align-items: center; gap: 16px; padding: 14px 26px 14px 14px;
      border-radius: 16px; background: rgba(16,24,40,.92); color: #fff; transform-origin: bottom left;
      box-shadow: 0 12px 32px rgba(16,24,40,.35); max-width: min(820px, calc(100vw - 64px));
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      transition: opacity .3s ease, translate .35s cubic-bezier(.2,.8,.2,1); opacity: 0; translate: -40px 0; }
    .lt.in { opacity: 1; translate: 0 0; }
    .lt .ico { flex: none; width: 52px; height: 52px; border-radius: 12px; display: grid; place-items: center; color: #fff; }
    .lt .txt { display: grid; gap: 2px; min-width: 0; }
    .lt .kicker { font-size: 13px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; opacity: .7; }
    .lt .title { font-size: 26px; font-weight: 700; line-height: 1.15; }
    .lt .accent { position: absolute; left: 0; top: 14px; bottom: 14px; width: 4px; border-radius: 0 4px 4px 0; }

    /* ---------- Slack-style notification ---------- */
    .slack { position: fixed; width: 460px; transform-origin: top right; pointer-events: auto; cursor: pointer;
      display: grid; grid-template-columns: 48px 1fr; gap: 12px; padding: 16px 18px 18px;
      background: #fff; color: #1d1c1d; border-radius: 14px;
      box-shadow: 0 18px 48px rgba(16,24,40,.28), 0 0 0 1px rgba(16,24,40,.06);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      transition: opacity .25s ease, translate .25s ease; opacity: 0; translate: 110% 0; }
    .slack.in { opacity: 1; translate: 0 0; }
    .slack .av { width: 48px; height: 48px; border-radius: 10px; object-fit: cover; background: #4a154b;
      color: #fff; display: grid; place-items: center; font-weight: 700; font-size: 20px; }
    .slack .body { min-width: 0; display: grid; gap: 4px; }
    .slack .where { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #616061; }
    .slack .where svg { width: 15px; height: 15px; }
    .slack .head { display: flex; align-items: baseline; gap: 8px; }
    .slack .name { font-size: 18px; font-weight: 800; }
    .slack .time { font-size: 13px; color: #616061; }
    .slack .text { font-size: 20px; line-height: 1.35; overflow-wrap: anywhere; }

    .no-anim, .no-anim * { transition: none !important; }
  `;

  function create(ui, { send }) {
    const style = document.createElement('style');
    style.textContent = CSS;
    ui.appendChild(style);

    const div = (cls) => {
      const d = document.createElement('div');
      d.className = cls;
      return d;
    };

    let prev = null;
    let state = null;

    // ======================= camera =======================

    const cam = div('cam');
    cam.hidden = true;
    cam.innerHTML = '<div class="clip"></div><div class="grab" title="Drag to place the camera for this tab"></div><div class="size" title="Drag to resize"></div><div class="tag">Drag to place · saved for this tab</div>';
    const clip = cam.querySelector('.clip');
    ui.appendChild(cam);
    let frame = null;
    let blinkTimer = 0;

    function cameraSize(s) {
      if (typeof s.camera.size === 'number') return s.camera.size;
      const sizes = s.settings.camera.sizes;
      return Number(sizes[s.camera.size] || sizes.m) || 240;
    }

    // Where the bubble sits: a corner plus offsets from its two edges.
    function cameraPos(s) {
      return s.camera.pos || { corner: 'tr', x: s.settings.camera.offsetRight, y: s.settings.camera.offsetTop };
    }

    function placeCam(pos, size) {
      const v = pos.corner[0] === 't' ? 'top' : 'bottom';
      const h = pos.corner[1] === 'l' ? 'left' : 'right';
      Object.assign(cam.style, { top: '', bottom: '', left: '', right: '', width: `${size}px`, height: `${size}px` });
      cam.style[v] = `${pos.y}px`;
      cam.style[h] = `${pos.x}px`;
    }

    function renderCamera(s) {
      if (!drag) placeCam(cameraPos(s), cameraSize(s));
      const cc = s.settings.camera;
      cam.style.setProperty('--ring', /^#[0-9a-f]{3,8}$/i.test(cc.ringColor || '') ? cc.ringColor : '#ffffff');
      cam.style.setProperty('--ring-w', `${Math.max(0, Math.min(20, Number(cc.ringWidth ?? 3)))}px`);
      cam.classList.toggle('editable', s.mode !== 'live');
      cam.hidden = !s.camera.on;
      // Only stream in the tab you're actually showing; removing the frame frees the camera.
      const wantStream = s.camera.on && document.visibilityState === 'visible';
      if (wantStream && !frame) {
        frame = document.createElement('iframe');
        frame.allow = 'camera';
        frame.src = chrome.runtime.getURL('camera.html');
        clip.appendChild(frame);
      } else if (!wantStream && frame) {
        frame.remove();
        frame = null;
      }
      clearTimeout(blinkTimer);
      if (s.camera.on && s.camera.blink) blinkTick();
      else cam.classList.remove('off');
    }

    function blinkTick() {
      const ms = Math.max(1, Number(state.settings.camera.blinkSeconds) || 30) * 1000;
      const elapsed = Math.max(0, Date.now() - state.camera.blinkStart);
      cam.classList.toggle('off', Math.floor(elapsed / ms) % 2 === 1);
      blinkTimer = setTimeout(blinkTick, ms - (elapsed % ms) + 20);
    }

    document.addEventListener('visibilitychange', () => state && renderCamera(state));

    // ---- drag / resize (Rehearse only) ----
    let drag = null;
    function startDrag(e, kind) {
      if (state?.mode === 'live') return;
      e.preventDefault();
      e.stopPropagation();
      const r = cam.getBoundingClientRect();
      drag = { kind, x0: e.clientX, y0: e.clientY, left: r.left, top: r.top, size: r.width };
      cam.classList.add('dragging');
      e.target.setPointerCapture(e.pointerId);
    }
    function moveDrag(e) {
      if (!drag) return;
      const dx = e.clientX - drag.x0;
      const dy = e.clientY - drag.y0;
      let { left, top, size } = drag;
      if (drag.kind === 'move') {
        left = Math.min(Math.max(0, left + dx), innerWidth - size);
        top = Math.min(Math.max(0, top + dy), innerHeight - size);
      } else {
        size = Math.max(80, Math.min(900, size + Math.max(dx, dy)));
      }
      Object.assign(cam.style, { right: '', bottom: '', left: `${left}px`, top: `${top}px`, width: `${size}px`, height: `${size}px` });
      drag.cur = { left, top, size };
    }
    function endDrag() {
      if (!drag) return;
      const { left, top, size } = drag.cur || drag;
      drag = null;
      cam.classList.remove('dragging');
      // Snap to the nearest corner so the spot holds at any window size.
      const cx = left + size / 2;
      const cy = top + size / 2;
      const corner = (cy < innerHeight / 2 ? 't' : 'b') + (cx < innerWidth / 2 ? 'l' : 'r');
      const pos = {
        corner,
        x: corner[1] === 'l' ? left : innerWidth - left - size,
        y: corner[0] === 't' ? top : innerHeight - top - size,
      };
      placeCam(pos, size);
      send({ type: 'camera.place', pos, size });
    }
    cam.querySelector('.grab').addEventListener('pointerdown', (e) => startDrag(e, 'move'));
    cam.querySelector('.size').addEventListener('pointerdown', (e) => startDrag(e, 'size'));
    for (const n of [cam.querySelector('.grab'), cam.querySelector('.size')]) {
      n.addEventListener('pointermove', moveDrag);
      n.addEventListener('pointerup', endDrag);
      n.addEventListener('pointercancel', endDrag);
    }

    // ======================= lower-third =======================

    const lt = div('lt');
    lt.innerHTML = '<div class="accent"></div><div class="ico"></div><div class="txt"><div class="kicker"></div><div class="title"></div></div>';
    ui.appendChild(lt);

    function renderTopic(s, animate) {
      const cfg = s.settings.lowerThird;
      const t = s.settings.topics[s.topic.index - 1];
      const show = s.topic.shown && !!t;
      if (t) {
        lt.querySelector('.ico').innerHTML = DDIcons.svg(t.icon, 30);
        lt.querySelector('.ico').style.background = cfg.accent;
        lt.querySelector(".accent").style.background = cfg.accent;
        lt.querySelector('.kicker').textContent = `Step ${s.topic.index}`;
        lt.querySelector('.title').textContent = t.title;
      }
      Object.assign(lt.style, {
        left: `${cfg.offsetLeft}px`,
        bottom: `${cfg.offsetBottom}px`,
        scale: String(cfg.scale || 1),
      });
      withAnimation(lt, animate, () => lt.classList.toggle('in', show));
    }

    // ======================= Slack notification =======================

    const slack = div('slack');
    slack.innerHTML = `
      <div class="avwrap"></div>
      <div class="body">
        <div class="where">${DDIcons.svg('chat', 15)}<span class="chan"></span></div>
        <div class="head"><span class="name"></span><span class="time">now</span></div>
        <div class="text"></div>
      </div>`;
    slack.addEventListener('click', () => send({ type: 'slack.hide' }));
    ui.appendChild(slack);
    let avatarData = null;
    let hideTimer = 0;

    chrome.storage.local.get('avatar').then(({ avatar }) => {
      avatarData = avatar || null;
      if (state) renderAvatar(state.settings.slack);
    });
    chrome.storage.onChanged.addListener((c, area) => {
      if (area === 'local' && c.avatar) {
        avatarData = c.avatar.newValue || null;
        if (state) renderAvatar(state.settings.slack);
      }
    });

    function renderAvatar(cfg) {
      const wrap = slack.querySelector('.avwrap');
      const initials = (cfg.sender || '?').trim().slice(0, 1).toUpperCase();
      const fallback = () => {
        wrap.innerHTML = '<div class="av"></div>';
        wrap.firstChild.textContent = initials;
      };
      const src = avatarData || (cfg.avatar && !/^https?:/.test(cfg.avatar) ? chrome.runtime.getURL(cfg.avatar) : cfg.avatar);
      if (!src) return fallback();
      const img = document.createElement('img');
      img.className = 'av';
      img.alt = '';
      img.onerror = fallback;
      img.src = src;
      wrap.replaceChildren(img);
    }

    function renderSlack(s, animate) {
      const cfg = s.settings.slack;
      slack.querySelector('.chan').textContent = [cfg.channel, cfg.workspace].filter(Boolean).join(' · ');
      slack.querySelector('.name').textContent = cfg.sender;
      slack.querySelector('.text').textContent = cfg.message;
      if (!prev || prev.settings.slack.avatar !== cfg.avatar || prev.settings.slack.sender !== cfg.sender) renderAvatar(cfg);

      // Keep clear of the camera bubble: sit below it when it's on.
      let top = Number(cfg.offsetTop) || 0;
      const cp = cameraPos(s);
      if (s.camera.on && cp.corner === 'tr') top = Math.max(top, cp.y + cameraSize(s) + 16);
      Object.assign(slack.style, { top: `${top}px`, right: `${cfg.offsetRight}px`, scale: String(cfg.scale || 1) });
      withAnimation(slack, animate, () => slack.classList.toggle('in', s.slack.shown));
      slack.style.pointerEvents = s.slack.shown ? 'auto' : 'none';

      clearTimeout(hideTimer);
      const secs = Number(cfg.autoHideSeconds) || 0;
      if (s.slack.shown && secs > 0) {
        const left = s.slack.at + secs * 1000 - Date.now();
        hideTimer = setTimeout(() => document.visibilityState === 'visible' && send({ type: 'slack.hide' }), Math.max(0, left));
      }
      // Chime only on a live show, in the tab being presented — not on reload.
      if (animate && s.slack.shown && !prev?.slack.shown && cfg.sound && document.visibilityState === 'visible') chime();
    }

    // Short original two-note chime, synthesised (no audio file, no borrowed sound).
    let audio;
    function chime() {
      try {
        audio ??= new AudioContext();
        audio.resume();
        const t0 = audio.currentTime + 0.01;
        [
          [880, 0],
          [1318.5, 0.11],
        ].forEach(([f, dt]) => {
          const o = audio.createOscillator();
          const g = audio.createGain();
          o.type = 'sine';
          o.frequency.value = f;
          g.gain.setValueAtTime(0, t0 + dt);
          g.gain.linearRampToValueAtTime(0.18, t0 + dt + 0.012);
          g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.45);
          o.connect(g).connect(audio.destination);
          o.start(t0 + dt);
          o.stop(t0 + dt + 0.5);
        });
      } catch {}
    }

    // ======================= shared =======================

    // First paint (page load / reload) snaps into place; later changes animate.
    function withAnimation(node, animate, fn) {
      if (animate) return fn();
      node.classList.add('no-anim');
      fn();
      node.getBoundingClientRect();
      requestAnimationFrame(() => node.classList.remove('no-anim'));
    }

    return {
      render(next) {
        state = next;
        const animate = !!prev;
        renderCamera(next);
        renderTopic(next, animate);
        renderSlack(next, animate);
        prev = next;
      },
      chime,
    };
  }

  root.DDOverlays = { create };
})(globalThis);
