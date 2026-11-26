// Demo Director — content script.
// Veils are CSS rules gated by classes on <html>: toggling never touches the
// app's own nodes, so React re-renders can't undo or break it. A
// MutationObserver only re-applies our classes/style if the page resets them.
// All UI we draw lives in one closed Shadow DOM host so page styles can't leak.

(() => {
  if (window.__demoDirector) return;
  window.__demoDirector = true;

  const CLASS_PREFIX = 'veil-';
  let state = { veils: [], active: [], mode: 'rehearse' }; // replaced by the first broadcast
  let applied = new Set(); // veil classes we currently own on <html>

  // ---------- veils ----------

  const styleEl = document.createElement('style');
  styleEl.id = 'demo-director-veils';

  function validSelector(sel) {
    try {
      document.createDocumentFragment().querySelector(sel);
      return true;
    } catch {
      return false;
    }
  }

  // Text filter: { mode: 'starts' | 'contains' | 'regex', value }. Elements are
  // matched on their visible text, whitespace collapsed, case-insensitive.
  const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
  const DATE_RE = new RegExp(
    [
      `\\b${MONTH}\\s+\\d{1,2}\\b`, // Dec 11
      `\\b\\d{1,2}\\s+${MONTH}`, // 11 Dec
      '\\b\\d{4}-\\d{2}-\\d{2}\\b', // 2026-12-11
      '\\b\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?\\b', // 12/11, 12/11/2026
      '\\b(?:today|yesterday|tomorrow)\\b',
      '\\b(?:in\\s+)?\\d+\\s+(?:minute|hour|day|week|month|year)s?(?:\\s+ago)?\\b', // 3 days ago, in 2 weeks
    ].join('|'),
    'i'
  );

  function textMatcher(f) {
    if (f?.mode === 'date') return (t) => DATE_RE.test(t);
    if (!f?.value) return null;
    const v = f.value.trim().toLowerCase();
    if (f.mode === 'regex') {
      try {
        const re = new RegExp(f.value.trim(), 'i');
        return (t) => re.test(t);
      } catch {
        return () => false;
      }
    }
    return f.mode === 'contains' ? (t) => t.toLowerCase().includes(v) : (t) => t.toLowerCase().startsWith(v);
  }

  const textOf = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();

  // Elements a selector list + optional text filter would hide.
  function matchElements(selectors, filter) {
    const sels = selectors.filter(validSelector);
    if (!sels.length) return [];
    let list;
    try {
      list = [...document.querySelectorAll(sels.join(', '))];
    } catch {
      return [];
    }
    const test = textMatcher(filter);
    return test ? list.filter((e) => test(textOf(e))) : list;
  }

  function renderCss() {
    // One rule per selector, so a single bad selector can't void the rest.
    // Text-filtered veils can't be expressed in CSS: their matches get a
    // data-dd-veil marker (see markText) and the rule targets that instead.
    styleEl.textContent = state.veils
      .flatMap((v) =>
        v.text?.mode
          ? [`html.${CLASS_PREFIX}${v.id} [data-dd-veil~="${v.id}"] { display: none !important; }`]
          : v.selectors.filter(validSelector).map((s) => `html.${CLASS_PREFIX}${v.id} :is(${s}) { display: none !important; }`)
      )
      .join('\n');
    markText();
  }

  // Tag (never remove) the page's own elements that a text veil matches. Runs
  // again whenever the app re-renders, before the browser paints.
  const MARK = 'data-dd-veil';
  function markText() {
    const textVeils = state.veils.filter((v) => v.text?.mode);
    const want = new Map(); // element → Set(veil ids)
    for (const v of textVeils) {
      for (const e of matchElements(v.selectors, v.text)) {
        if (!want.has(e)) want.set(e, new Set());
        want.get(e).add(v.id);
      }
    }
    for (const e of document.querySelectorAll(`[${MARK}]`)) if (!want.has(e)) e.removeAttribute(MARK);
    for (const [e, ids] of want) {
      const val = [...ids].sort().join(' ');
      if (e.getAttribute(MARK) !== val) e.setAttribute(MARK, val);
    }
    textWatch(textVeils.length > 0);
  }

  let markQueued = false;
  const textObserver = new MutationObserver(() => {
    if (markQueued) return;
    markQueued = true;
    queueMicrotask(() => {
      markQueued = false;
      markText();
    });
  });
  let textWatching = false;
  function textWatch(on) {
    if (on === textWatching) return;
    textWatching = on;
    if (on) textObserver.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    else textObserver.disconnect();
  }

  function desiredClasses() {
    return new Set(state.active.map((id) => CLASS_PREFIX + id));
  }

  function classesInSync() {
    const cl = document.documentElement.classList;
    const want = desiredClasses();
    for (const c of want) if (!cl.contains(c)) return false;
    for (const c of applied) if (!want.has(c) && cl.contains(c)) return false;
    return true;
  }

  function applyClasses() {
    const cl = document.documentElement.classList;
    const want = desiredClasses();
    for (const c of applied) if (!want.has(c)) cl.remove(c);
    for (const c of want) cl.add(c);
    applied = want;
  }

  function ensureAttached() {
    if (!styleEl.isConnected) (document.head || document.documentElement).appendChild(styleEl);
    if (!host.isConnected) document.documentElement.appendChild(host);
  }

  // Guard, don't fight: only re-apply when the page actually removed our bits.
  const observer = new MutationObserver(() => {
    if (!classesInSync()) applyClasses();
    if (!styleEl.isConnected || !host.isConnected) ensureAttached();
  });

  function watch() {
    observer.disconnect();
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'], childList: true });
    if (document.head) observer.observe(document.head, { childList: true });
  }

  // ---------- shadow UI layer ----------

  const host = document.createElement('demo-director');
  host.style.cssText = 'all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;';
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; }
      .ui { font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; color: #101828; }
      .chip { position: fixed; left: 12px; bottom: 12px; display: flex; align-items: center; gap: 6px;
        padding: 4px 10px; border-radius: 999px; background: rgba(16,24,40,.82); color: #fff;
        font-size: 11px; font-weight: 600; letter-spacing: .02em; pointer-events: auto; cursor: pointer; user-select: none; }
      .chip::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: #fdb022; }
      .hl { position: fixed; border: 2px solid #f79009; background: rgba(247,144,9,.12); border-radius: 3px; pointer-events: none; }
      .match { position: fixed; outline: 2px dashed #f79009; outline-offset: 1px; border-radius: 3px; pointer-events: none; }
      .tip { position: fixed; max-width: min(70vw, 640px); padding: 5px 8px; border-radius: 6px; background: #101828; color: #fff;
        font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; pointer-events: none; overflow-wrap: anywhere; }
      .tip b { color: #fdb022; font-weight: 600; }
      .bar { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); padding: 6px 12px; border-radius: 8px;
        background: #101828; color: #fff; font-size: 12px; pointer-events: none; white-space: nowrap; }
      .bar kbd { font: 11px ui-monospace, Menlo, monospace; background: #344054; padding: 1px 5px; border-radius: 4px; }
      .panel { position: fixed; right: 16px; bottom: 16px; width: min(460px, calc(100vw - 32px)); padding: 14px;
        border-radius: 12px; background: #fff; box-shadow: 0 12px 32px rgba(16,24,40,.22), 0 0 0 1px rgba(16,24,40,.08);
        pointer-events: auto; display: grid; gap: 10px; }
      .panel h2 { margin: 0; font-size: 14px; }
      .panel label { display: grid; gap: 4px; font-size: 12px; font-weight: 600; color: #344054; }
      .panel input[type=text], .panel textarea { font: inherit; font-weight: 400; color: #101828; padding: 6px 8px;
        border: 1px solid #d0d5dd; border-radius: 6px; width: 100%; }
      .panel textarea { font: 12px/1.4 ui-monospace, Menlo, monospace; min-height: 64px; resize: vertical; }
      .radios { display: flex; gap: 14px; font-weight: 400 !important; }
      .radios label { display: flex; align-items: center; gap: 5px; font-weight: 400; }
      .count { font-size: 12px; color: #475467; }
      .textf { display: grid; gap: 6px; }
      .textf .inline { display: flex; align-items: center; gap: 8px; }
      .textf select { font: inherit; font-weight: 400; padding: 4px 6px; border: 1px solid #d0d5dd; border-radius: 6px; color: #101828; background: #fff; }
      .textf .hint { font-size: 12px; color: #475467; overflow-wrap: anywhere; }
      [hidden] { display: none !important; }
      .count.bad { color: #d92d20; }
      .row { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
      .row button { white-space: nowrap; }
      .row [data-act=add] { margin-right: auto; }
      button { font: inherit; font-weight: 600; padding: 6px 12px; border-radius: 6px; border: 1px solid #d0d5dd;
        background: #fff; color: #344054; cursor: pointer; }
      button.primary { background: #f79009; border-color: #f79009; color: #fff; }
      button:disabled { opacity: .5; cursor: default; }
    </style>
    <div class="ui" id="ui"></div>`;
  const ui = shadow.getElementById('ui');
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  const overlays = DDOverlays.create(ui, { send });

  // Rehearse chip: a reminder you're not live (also a quick way into the picker).
  const chip = el('div', 'chip');
  chip.title = 'Demo Director is in Rehearse mode. Click to pick an element to veil.';
  chip.addEventListener('click', () => send({ type: 'picker.start' }));
  ui.appendChild(chip);

  function renderChip() {
    const rehearse = state.mode !== 'live';
    chip.hidden = !rehearse || picker.active;
    chip.style.display = chip.hidden ? 'none' : '';
    const n = state.active.length;
    chip.textContent = `REHEARSE · ${n} veil${n === 1 ? '' : 's'} on`;
  }

  // ---------- picker ----------

  // kept: selector lines from earlier picks of this same veil ("+ Add another").
  const picker = { active: false, phase: 'hover', target: null, stack: [], kept: [], nodes: [], raf: 0 };

  function isOurs(e) {
    return e.composedPath().includes(host);
  }

  function clearOverlay() {
    picker.nodes.forEach((n) => n.remove());
    picker.nodes = [];
  }

  function box(rect, cls) {
    const b = el('div', cls);
    Object.assign(b.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    ui.appendChild(b);
    picker.nodes.push(b);
    return b;
  }

  function drawElements(list, limit = 300) {
    for (const m of list.slice(0, limit)) {
      const r = m.getBoundingClientRect();
      if (r.width || r.height) box(r, 'match');
    }
  }

  function drawMatches(sel, limit = 300) {
    let list = [];
    try {
      list = [...document.querySelectorAll(sel)];
    } catch {}
    drawElements(list, limit);
  }

  function drawHover() {
    clearOverlay();
    const bar = el('div', 'bar');
    bar.innerHTML = 'Pick an element to veil · <kbd>↑</kbd> parent · <kbd>↓</kbd> child · <kbd>Enter</kbd>/click select · <kbd>Esc</kbd> cancel';
    ui.appendChild(bar);
    picker.nodes.push(bar);
    if (picker.kept.length) drawMatches(picker.kept.join(', '));
    const t = picker.target;
    if (!t) return;
    const sel = DDSelector.position(t);
    drawMatches(sel);
    const r = t.getBoundingClientRect();
    box(r, 'hl');
    const tip = el('div', 'tip');
    const n = DDSelector.count(sel, document);
    tip.innerHTML = `<b>${n} match${n === 1 ? '' : 'es'}</b> `;
    tip.append(document.createTextNode(sel));
    tip.style.left = `${Math.max(8, Math.min(r.left, innerWidth - 400))}px`;
    tip.style.top = r.bottom + 40 < innerHeight ? `${r.bottom + 6}px` : `${Math.max(8, r.top - 34)}px`;
    ui.appendChild(tip);
    picker.nodes.push(tip);
  }

  function loop() {
    if (!picker.active) return;
    if (picker.phase === 'hover') drawHover();
    else {
      clearOverlay();
      drawElements(matchElements(formSelectors(), formText()));
    }
    picker.raf = requestAnimationFrame(loop);
  }

  function setTarget(t) {
    if (t && t !== document.documentElement && t !== document.body && t !== host) picker.target = t;
  }

  const onMove = (e) => {
    if (isOurs(e) || picker.phase !== 'hover') return;
    picker.stack = [];
    setTarget(document.elementFromPoint(e.clientX, e.clientY));
  };

  const block = (e) => {
    if (isOurs(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (e.type === 'click' && picker.phase === 'hover' && picker.target) openForm();
  };

  const onKey = (e) => {
    if (!picker.active) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      return stopPicker();
    }
    if (picker.phase !== 'hover' || isOurs(e)) return;
    const t = picker.target;
    if (e.key === 'ArrowUp' && t?.parentElement) {
      picker.stack.push(t);
      setTarget(t.parentElement);
    } else if (e.key === 'ArrowDown') {
      setTarget(picker.stack.pop() || t?.firstElementChild);
    } else if (e.key === 'Enter' && t) {
      openForm();
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const BLOCKED = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu'];

  function startPicker() {
    if (state.mode === 'live' || picker.active) return;
    Object.assign(picker, { active: true, phase: 'hover', target: null, stack: [], kept: [] });
    form.name.value = '';
    addEventListener('mousemove', onMove, true);
    addEventListener('keydown', onKey, true);
    BLOCKED.forEach((t) => addEventListener(t, block, true));
    renderChip();
    loop();
  }

  function stopPicker() {
    if (!picker.active) return;
    picker.active = false;
    cancelAnimationFrame(picker.raf);
    removeEventListener('mousemove', onMove, true);
    removeEventListener('keydown', onKey, true);
    BLOCKED.forEach((t) => removeEventListener(t, block, true));
    clearOverlay();
    form.panel.remove();
    renderChip();
  }

  // Save form
  const form = (() => {
    const panel = el('div', 'panel');
    panel.innerHTML = `
      <h2>New veil</h2>
      <label>Name <input type="text" name="name" placeholder="e.g. dates" autocomplete="off"></label>
      <div class="radios">
        <label title="The same spot in every repeated row/group"><input type="radio" name="scope" value="position" checked> Same spot in each</label>
        <label title="Every element like this one"><input type="radio" name="scope" value="similar"> All like this</label>
        <label><input type="radio" name="scope" value="unique"> Just this one</label>
      </div>
      <label>Selectors (one per line) <textarea name="sel" spellcheck="false"></textarea></label>
      <div class="textf">
        <label class="inline">Only hide if the text
          <select name="tmode"><option value="">(any text)</option><option value="date">looks like a date</option><option value="starts">starts with</option><option value="contains">contains</option><option value="regex">matches pattern</option></select>
        </label>
        <input type="text" name="tval" placeholder="e.g. Dec" autocomplete="off" hidden>
        <div class="hint" hidden></div>
      </div>
      <div class="count"></div>
      <div class="row"><button type="button" data-act="add" title="Pick another element for this same veil">+ Add another</button><button type="button" data-act="back">Back</button><button type="button" data-act="cancel">Cancel</button><button type="button" class="primary" data-act="save">Save veil</button></div>`;
    const q = (s) => panel.querySelector(s);
    return {
      panel,
      name: q('input[name=name]'),
      textarea: q('textarea'),
      tmode: q('select[name=tmode]'),
      tval: q('input[name=tval]'),
      hint: q('.hint'),
      countEl: q('.count'),
      save: q('[data-act=save]'),
      q,
    };
  })();

  const formSelectors = () => form.textarea.value.split('\n').map((s) => s.trim()).filter(Boolean);
  const formText = () => {
    const mode = form.tmode.value;
    if (mode === 'date') return { mode };
    return mode && form.tval.value.trim() ? { mode, value: form.tval.value.trim() } : null;
  };

  function updateCount() {
    const sels = formSelectors();
    const bad = sels.filter((s) => !validSelector(s));
    const n = bad.length ? 0 : matchElements(sels, formText()).length;
    form.countEl.textContent = bad.length
      ? `Invalid selector: ${bad[0]}`
      : `${n} element${n === 1 ? '' : 's'} will be hidden`;
    form.countEl.classList.toggle('bad', !!bad.length || n === 0);
    form.save.disabled = !!bad.length || !sels.length || !form.name.value.trim();
  }

  function fillSelector() {
    const scope = form.q('input[name=scope]:checked').value;
    form.textarea.value = [...picker.kept, DDSelector[scope](picker.target)].join('\n');
    updateCount();
  }

  form.q('.radios').addEventListener('change', fillSelector);
  form.textarea.addEventListener('input', updateCount);
  form.tval.addEventListener('input', updateCount);
  form.tmode.addEventListener('change', () => {
    const on = !!form.tmode.value;
    const needsValue = on && form.tmode.value !== 'date';
    form.tval.hidden = !needsValue;
    form.hint.hidden = !on;
    // Start from the first word of the clicked element's own text.
    if (needsValue && !form.tval.value && picker.target) {
      const w = textOf(picker.target).split(' ')[0] || '';
      form.tval.value = form.tmode.value === 'regex' ? `^${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` : w;
    }
    if (on && picker.target) form.hint.textContent = `You clicked: "${textOf(picker.target).slice(0, 80)}"`;
    updateCount();
    if (needsValue) form.tval.focus();
  });
  form.name.addEventListener('input', updateCount);
  form.panel.addEventListener('keydown', (e) => {
    e.stopPropagation(); // keep the page's own shortcuts out of our inputs
    if (e.key === 'Enter' && e.target === form.name && !form.save.disabled) saveVeil();
    if (e.key === 'Escape') stopPicker();
  });
  form.q('[data-act=cancel]').addEventListener('click', stopPicker);
  const backToHover = () => {
    form.panel.remove();
    picker.phase = 'hover';
  };
  form.q('[data-act=back]').addEventListener('click', backToHover);
  form.q('[data-act=add]').addEventListener('click', () => {
    picker.kept = formSelectors();
    backToHover();
  });
  form.save.addEventListener('click', saveVeil);

  function openForm() {
    picker.phase = 'form';
    form.q('input[value=position]').checked = true;
    if (!picker.kept.length) {
      form.tmode.value = '';
      form.tval.value = '';
      form.tval.hidden = form.hint.hidden = true;
    }
    fillSelector();
    ui.appendChild(form.panel);
    setTimeout(() => form.name.focus(), 0);
  }

  async function saveVeil() {
    const res = await send({ type: 'veil.create', name: form.name.value.trim(), selectors: formSelectors(), text: formText() });
    if (res?.ok) stopPicker();
    else {
      form.countEl.textContent = res?.error || 'Could not save';
      form.countEl.classList.add('bad');
    }
  }

  // ---------- wiring ----------

  function send(action) {
    return chrome.runtime.sendMessage({ type: 'action', action }).catch(() => null);
  }

  function setState(next) {
    if (!next?.veils || !next.camera || !next.settings) return; // worker still starting
    state = next;
    renderCss();
    applyClasses();
    if (state.mode === 'live') stopPicker();
    renderChip();
    overlays.render(state);
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'state') setState(msg.state);
    else if (msg?.type === 'picker.start') startPicker();
  });

  ensureAttached();
  watch();
  if (!document.head) {
    // At document_start <head> may not exist yet; move our style in once it does.
    document.addEventListener('DOMContentLoaded', () => {
      if (styleEl.parentNode !== document.head) document.head.appendChild(styleEl);
      watch();
    }, { once: true });
  }
  // Right after an extension reload the worker may still be starting: retry briefly.
  (async () => {
    for (let i = 0; i < 10 && !state.settings; i++) {
      setState(await send({ type: 'state.get' }));
      if (!state.settings) await new Promise((r) => setTimeout(r, 200 + i * 100));
    }
  })();
})();
