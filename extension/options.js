const send = (action) => chrome.runtime.sendMessage({ type: 'action', action });
const $ = (s) => document.querySelector(s);

// Ask the service worker for state; right after an extension reload the worker
// may still be starting, so retry briefly instead of rendering nothing.
async function getState(tries = 10) {
  for (let i = 0; i < tries; i++) {
    try {
      const s = await chrome.runtime.sendMessage({ type: 'action', action: { type: 'state.get' } });
      if (s && s.camera && s.settings) return s;
    } catch {}
    await new Promise((r) => setTimeout(r, 200 + i * 100));
  }
  return null;
}
const status = (t) => {
  $('#status').textContent = t;
  clearTimeout(status.t);
  status.t = setTimeout(() => ($('#status').textContent = ''), 3000);
};

let editing = false; // don't re-render under the user's cursor

function render(state) {
  renderSettings(state);
  document.querySelectorAll('.mode button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode)));
  if (editing) return;
  const root = $('#veils');
  root.replaceChildren();
  if (!state.veils.length) {
    root.innerHTML = '<p class="note muted">No veils yet.</p>';
    return;
  }
  state.veils.forEach((v, i) => {
    const on = state.active.includes(v.id);
    const card = document.createElement('div');
    card.className = 'veil';
    card.innerHTML = `
      <div class="slot">${i + 1}</div>
      <div class="fields">
        <input type="text" name="name" aria-label="Name">
        <textarea name="sel" rows="${Math.max(2, v.selectors.length)}" spellcheck="false" aria-label="Selectors, one per line"></textarea>
        <div class="textrow">Only if the text
          <select name="tmode" aria-label="Text filter"><option value="">(any text)</option><option value="date">looks like a date</option><option value="starts">starts with</option><option value="contains">contains</option><option value="regex">matches pattern</option></select>
          <input type="text" name="tval" aria-label="Text to match" placeholder="e.g. Dec">
        </div>
        <div class="meta muted">Class on &lt;html&gt;: <code>veil-${v.id}</code></div>
      </div>
      <div class="side">
        <button class="toggle"></button>
        <div class="order"><button data-d="-1" title="Move up">▲</button><button data-d="1" title="Move down">▼</button></div>
        <button class="danger" data-del>Delete</button>
      </div>`;
    const name = card.querySelector('[name=name]');
    const sel = card.querySelector('[name=sel]');
    name.value = v.name;
    sel.value = v.selectors.join('\n');
    const tmode = card.querySelector('[name=tmode]');
    const tval = card.querySelector('[name=tval]');
    tmode.value = v.text?.mode || '';
    tval.value = v.text?.value || '';
    const needsValue = () => !!tmode.value && tmode.value !== 'date';
    tval.hidden = !needsValue();
    const saveText = async () => {
      tval.hidden = !needsValue();
      if (needsValue() && !tval.value.trim()) return tval.focus();
      await send({ type: 'veil.update', id: v.id, text: tmode.value ? { mode: tmode.value, value: tval.value } : null });
      status('Saved');
    };
    tmode.onchange = saveText;
    tval.onchange = saveText;
    for (const x of [tmode, tval]) {
      x.addEventListener('focus', () => (editing = true));
      x.addEventListener('blur', () => (editing = false));
    }
    const toggle = card.querySelector('.toggle');
    toggle.textContent = on ? 'Hidden' : 'Shown';
    toggle.setAttribute('aria-pressed', String(on));
    toggle.onclick = () => send({ type: 'veil.toggle', id: v.id });

    for (const input of [name, sel]) {
      input.addEventListener('focus', () => (editing = true));
      input.addEventListener('blur', async () => {
        editing = false;
        const selectors = sel.value.split('\n').map((s) => s.trim()).filter(Boolean);
        if (name.value.trim() === v.name && selectors.join('\n') === v.selectors.join('\n')) return;
        if (!selectors.length) {
          sel.value = v.selectors.join('\n');
          return status('A veil needs at least one selector.');
        }
        await send({ type: 'veil.update', id: v.id, name: name.value, selectors });
        status('Saved');
      });
    }
    card.querySelectorAll('.order button').forEach((b) => (b.onclick = () => send({ type: 'veil.move', id: v.id, delta: Number(b.dataset.d) })));
    // Two-step delete (no confirm() dialogs).
    const del = card.querySelector('[data-del]');
    del.onclick = () => {
      if (del.dataset.armed) return send({ type: 'veil.delete', id: v.id });
      del.dataset.armed = '1';
      del.textContent = 'Really delete?';
      setTimeout(() => {
        delete del.dataset.armed;
        del.textContent = 'Delete';
      }, 3000);
    };
    root.append(card);
  });
}

document.querySelectorAll('.mode button').forEach((b) => (b.onclick = () => send({ type: 'mode.set', mode: b.dataset.mode })));
$('#reset').onclick = async () => {
  const res = await send({ type: 'reset' });
  status(res.tabs?.ok ? `Demo reset: ${res.tabs.opened} opened, ${res.tabs.closed} closed` : 'Stage reset: veils on, Slack post and topic hidden');
};

$('#export').onclick = async () => {
  const { data } = await send({ type: 'export' });
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: 'demo-director.json' });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$('#import').onclick = () => $('#file').click();
$('#file').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const res = await send({ type: 'import', data: JSON.parse(await file.text()) });
    status(res.ok ? `Imported ${res.count} veil${res.count === 1 ? '' : 's'}` : res.error);
  } catch {
    status('That file is not valid JSON.');
  }
};

$('#openConsole').onclick = () => send({ type: 'console.open' });
$('#shortcutsBtn').onclick = () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
chrome.commands.getAll().then((cmds) => {
  const t = $('#shortcuts');
  cmds.sort((x, y) => x.description.localeCompare(y.description, undefined, { numeric: true }));
  for (const c of cmds) {
    if (c.name === '_execute_action') continue;
    const tr = t.insertRow();
    tr.insertCell().innerHTML = c.shortcut ? `<kbd>${c.shortcut}</kbd>` : '<span class="muted">not set</span>';
    tr.insertCell().textContent = c.description;
  }
});

chrome.runtime.onMessage.addListener((msg) => msg?.type === 'state' && msg.state?.camera && render(msg.state));
getState().then((s) => s && render(s));

// ======================= settings (camera, topics, lower-third, Slack) =======================

let current = null;
const getPath = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);
const patchFor = (path, value) => path.split('.').reduceRight((acc, k) => ({ [k]: acc }), value);
const fromInput = (i) => (i.type === 'checkbox' ? i.checked : i.type === 'number' ? Number(i.value) : i.value);

function renderSettings(state) {
  current = state;
  const s = state.settings;
  for (const input of document.querySelectorAll('[data-path]')) {
    if (input === document.activeElement) continue; // don't clobber what you're typing
    const v = getPath(s, input.dataset.path);
    if (input.type === 'checkbox') input.checked = !!v;
    else input.value = v ?? '';
  }
  document.documentElement.style.setProperty('--accent', s.lowerThird.accent);
  $('#device').value = s.camera.deviceId || '';
  const pv = document.querySelector('.preview');
  pv.style.setProperty('--ring', s.camera.ringColor || '#ffffff');
  pv.style.setProperty('--ring-w', `${Number(s.camera.ringWidth ?? 3)}px`);
  renderTopics(state);
  renderTabs(state);
  $('#bridgeStatus').textContent = state.bridge?.connected ? '● Connected to the Stream Deck plugin' : '○ Not connected. Is the Stream Deck app running with the Demo Director plugin installed?';
  $('#bridgeStatus').style.color = state.bridge?.connected ? 'var(--on)' : '';
  renderAvatar();
}

for (const input of document.querySelectorAll('[data-path]')) {
  input.addEventListener('change', () => {
    const v = fromInput(input);
    if (input.type === 'number' && !Number.isFinite(v)) return;
    send({ type: 'settings.update', patch: patchFor(input.dataset.path, v) }).then(() => status('Saved'));
  });
}
document.querySelectorAll('[data-reset]').forEach((b) => {
  b.onclick = () => send({ type: 'settings.reset', section: b.dataset.reset }).then(() => status('Restored defaults'));
});

// ----- topics -----

// Skip a re-render only while you're typing in the list, not after clicking one of its buttons.
const typingIn = (root) => {
  const a = document.activeElement;
  return root.contains(a) && (a.matches('input, textarea, select') || a.isContentEditable);
};

function renderTopics(state) {
  const root = $('#topics');
  if (typingIn(root)) return;
  root.replaceChildren();
  state.settings.topics.forEach((t, i) => {
    const row = document.createElement('div');
    row.className = 'topic';
    const shown = state.topic.shown && state.topic.index === i + 1;
    row.innerHTML = `<span class="n">${i + 1}</span><span class="ico">${DDIcons.svg(t.icon, 22)}</span>
      <select aria-label="Icon">${DDIcons.names.map((n) => `<option>${n}</option>`).join('')}</select>
      <input type="text" aria-label="Title">
      <button>${shown ? 'Hide' : 'Show'}</button>`;
    row.querySelector('select').value = t.icon;
    row.querySelector('input').value = t.title;
    const save = () => {
      const topics = current.settings.topics.map((x, k) =>
        k !== i ? x : { icon: row.querySelector('select').value, title: row.querySelector('input').value.trim() || x.title }
      );
      send({ type: 'settings.update', patch: { topics } }).then(() => status('Saved'));
    };
    row.querySelector('select').onchange = save;
    row.querySelector('input').onchange = save;
    row.querySelector('button').onclick = () => send(shown ? { type: 'topic.hide' } : { type: 'topic.show', index: i + 1 });
    root.append(row);
  });
}
$('#topicHide').onclick = () => send({ type: 'topic.hide' });

// ----- camera -----

let previewFrame = null;
const camStatus = (t) => ($('#camStatus').textContent = t);

async function listDevices() {
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  const sel = $('#device');
  const keep = current?.settings.camera.deviceId || '';
  sel.replaceChildren(new Option('System default', ''));
  devices.forEach((d, i) => sel.append(new Option(d.label || `Camera ${i + 1}`, d.deviceId)));
  sel.value = keep;
  const granted = devices.some((d) => d.label);
  $('#grant').textContent = granted ? 'Camera access granted ✓' : 'Grant camera access';
  $('#grant').classList.toggle('primary', !granted);
  if (!granted) camStatus('Grant access to see camera names.');
  return devices;
}

$('#grant').onclick = async () => {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: true });
    s.getTracks().forEach((t) => t.stop());
    camStatus('');
    await listDevices();
  } catch (e) {
    camStatus(e.name === 'NotAllowedError' ? 'Blocked. Allow camera for this extension in the address bar / chrome://settings/content/camera.' : `Error: ${e.name}`);
  }
};

// The preview is the real camera frame, so it shows the background, mirror and device exactly as on stage.
function stopPreview() {
  previewFrame?.remove();
  previewFrame = null;
  $('#previewBtn').textContent = 'Preview';
}
$('#previewBtn').onclick = () => {
  if (previewFrame) return stopPreview();
  previewFrame = Object.assign(document.createElement('iframe'), { src: chrome.runtime.getURL('camera.html'), allow: 'camera' });
  $('#previewBox').append(previewFrame);
  $('#previewBtn').textContent = 'Stop preview';
  listDevices();
};

$('#device').onchange = async () => {
  await send({ type: 'settings.update', patch: { camera: { deviceId: $('#device').value } } });
  status('Camera saved'); // the preview frame restarts on the new device by itself
};
navigator.mediaDevices.addEventListener('devicechange', listDevices);
listDevices();

// ----- Slack -----

$('#slackShow').onclick = () => send({ type: 'slack.toggle' });

async function renderAvatar() {
  const { avatar } = await chrome.storage.local.get('avatar');
  const cfg = current.settings.slack;
  const view = $('#avatarView');
  const fallback = () => {
    view.innerHTML = '<span class="ph"></span>';
    view.firstChild.textContent = (cfg.sender || '?').slice(0, 1).toUpperCase();
  };
  const src = avatar || (cfg.avatar ? chrome.runtime.getURL(cfg.avatar) : '');
  if (!src) return fallback();
  const img = new Image();
  img.onerror = fallback;
  img.src = src;
  view.replaceChildren(img);
  $('#avatarClear').disabled = !avatar;
}

$('#avatarBtn').onclick = () => $('#avatarFile').click();
$('#avatarClear').onclick = async () => {
  await chrome.storage.local.remove('avatar');
  renderAvatar();
};
$('#avatarFile').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  // Downscale to a crisp 192px square so it stays small in storage.
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const c = Object.assign(document.createElement('canvas'), { width: 192, height: 192 });
  c.getContext('2d').drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, 192, 192);
  await chrome.storage.local.set({ avatar: c.toDataURL('image/png') });
  renderAvatar();
  status('Avatar saved');
};

$('#chime').onclick = () => {
  const a = new AudioContext();
  const t0 = a.currentTime + 0.01;
  [[880, 0], [1318.5, 0.11]].forEach(([f, dt]) => {
    const o = a.createOscillator();
    const g = a.createGain();
    o.frequency.value = f;
    g.gain.setValueAtTime(0, t0 + dt);
    g.gain.linearRampToValueAtTime(0.18, t0 + dt + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.45);
    o.connect(g).connect(a.destination);
    o.start(t0 + dt);
    o.stop(t0 + dt + 0.5);
  });
};

// ----- demo tabs -----

const validUrl = (u) => /^https?:\/\/[^\s]+$/.test(u);

// Chrome permission pattern for a demo tab's site, e.g. https://store.example.com/*
function originPattern(u) {
  try {
    return validUrl(u) ? `${new URL(u).origin}/*` : null;
  } catch {
    return null;
  }
}

// Must run inside a click/change handler (Chrome requires a user gesture).
async function allowSites(urls) {
  const origins = [...new Set(urls.map(originPattern).filter(Boolean))];
  if (!origins.length) return true;
  const missing = [];
  for (const o of origins) if (!(await chrome.permissions.contains({ origins: [o] }))) missing.push(o);
  if (!missing.length) return true;
  try {
    const ok = await chrome.permissions.request({ origins: missing });
    status(ok ? 'Site access granted' : 'Site access not granted: overlays won\'t run there');
    return ok;
  } catch {
    return false;
  }
}

function saveTabs(list) {
  return send({ type: 'settings.update', patch: { tabs: list } }).then(() => status('Saved'));
}

const CORNERS = { tl: '↖ top-left', tr: '↗ top-right', bl: '↙ bottom-left', br: '↘ bottom-right' };
const fmtMin = (m) => (m ? `${Math.floor(m)}:${String(Math.round((m % 1) * 60)).padStart(2, '0')}` : '');
// "2:30", "2.5" or "2" → minutes
function parseMin(v) {
  const t = String(v || '').trim();
  if (!t) return 0;
  const m = /^(\d+):(\d{1,2})$/.exec(t);
  if (m) return Number(m[1]) + Number(m[2]) / 60;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Each demo tab is a segment of the run-of-show: tab + camera preset + talking points + time budget.
function renderTabs(state) {
  const root = $('#tabs');
  if (typingIn(root)) return;
  const list = state.settings.tabs;
  root.replaceChildren();
  if (!list.length) {
    root.innerHTML = '<p class="muted" style="margin:0">No segments yet. Reset will leave your tabs alone until you add some.</p>';
  }
  const total = list.reduce((a, t) => a + (Number(t.minutes) || 0), 0);
  $('#segTotal').textContent = total ? `Planned total: ${fmtMin(total)}` : '';
  list.forEach((t, i) => {
    const card = document.createElement('div');
    card.className = 'seg';
    card.innerHTML = `
      <div class="tabrow"><span class="n">${i + 1}</span>
        <input type="text" name="label" placeholder="Label, e.g. Studio" aria-label="Label">
        <input type="text" name="url" placeholder="https://…" aria-label="URL" spellcheck="false">
        <span class="ops"><button class="primary" data-allow hidden title="Let Demo Director run on this site">Allow</button><button data-d="-1" title="Move up">▲</button><button data-d="1" title="Move down">▼</button><button class="danger" data-x title="Remove">✕</button></span>
      </div>
      <div class="segopts">
        <label>Camera on arrival <select name="cmode">
          <option value="keep">Keep as is</option><option value="on">On</option><option value="blink">On + blink</option><option value="off">Off</option>
        </select></label>
        <label title="Hold the camera hidden for this long after arriving, then fade it in">Camera delay (s) <input type="number" name="cdelay" min="0" max="600" step="0.5" placeholder="0"></label>
        <label>Time budget <input type="text" name="minutes" placeholder="m:ss" inputmode="decimal"></label>
        <span class="campos"></span>
      </div>
      <div class="segtopics"><span>Topics in this segment <em>· Stream Deck keys Topic 1–3 follow this order and light up at the time you give (time into the segment, m:ss)</em></span><div class="list"></div><button data-tadd>+ Add topic</button></div>
      <div class="notes"><span>Talking points</span></div>`;
    const $c = (q) => card.querySelector(q);
    const label = $c('[name=label]');
    const url = $c('[name=url]');
    label.value = t.label || '';
    url.value = t.url || '';
    url.classList.toggle('bad', !!t.url && !validUrl(t.url));
    $c('[name=cmode]').value = t.camera?.mode || 'keep';
    const cdelay = $c('[name=cdelay]');
    cdelay.value = t.camera?.delay || '';
    const delayable = () => ['on', 'blink'].includes($c('[name=cmode]').value);
    cdelay.disabled = !delayable();
    cdelay.onchange = () => update({ camera: { ...(current.settings.tabs[i].camera || {}), delay: Math.max(0, Math.min(600, Number(cdelay.value) || 0)) } });
    $c('[name=minutes]').value = fmtMin(Number(t.minutes) || 0);
    // Planned topics: [{ n, at }], n = topic number, at = seconds into the segment (null = no light-up).
    const planned = Array.isArray(t.topics) ? t.topics : [];
    const saveTopics = (list) => update({ topics: list });
    const tlist = $c('.segtopics .list');
    planned.forEach((p, k) => {
      const row = document.createElement('div');
      row.className = 'stopic';
      row.innerHTML = `<span class="n">${k + 1}</span>
        <select name="tn" aria-label="Topic">${state.settings.topics.map((x, j) => `<option value="${j + 1}"></option>`).join('')}</select>
        <input type="text" name="tat" placeholder="m:ss" inputmode="decimal" aria-label="Around this far into the segment" title="Around this far into the segment, the key lights up. Empty = never lights up.">
        <button data-td="-1" title="Earlier">▲</button><button data-td="1" title="Later">▼</button><button class="danger" data-tx title="Remove">✕</button>`;
      const sel = row.querySelector('select');
      [...sel.options].forEach((o, j) => (o.textContent = `${j + 1} · ${state.settings.topics[j].title}`));
      sel.value = String(p.n);
      const at = row.querySelector('input');
      at.value = Number.isFinite(p.at) ? fmtMin(p.at / 60) || '0:00' : '';
      const edit = (patch) => saveTopics(planned.map((x, j) => (j !== k ? x : { ...x, ...patch })));
      sel.onchange = () => edit({ n: Number(sel.value) });
      at.onchange = () => edit({ at: at.value.trim() ? Math.round(parseMin(at.value) * 60) : null });
      row.querySelectorAll('[data-td]').forEach((b) => {
        b.onclick = () => {
          const next = [...planned];
          const j = k + Number(b.dataset.td);
          if (j < 0 || j >= next.length) return;
          [next[k], next[j]] = [next[j], next[k]];
          saveTopics(next);
        };
      });
      row.querySelector('[data-tx]').onclick = () => saveTopics(planned.filter((_, j) => j !== k));
      tlist.append(row);
    });
    $c('[data-tadd]').onclick = () => {
      // Suggest the next topic number after the last one used anywhere before it, and a time after the last one here.
      const used = list.slice(0, i + 1).flatMap((x) => (x.topics || []).map((y) => y.n));
      const n = Math.min(state.settings.topics.length, (used.length ? Math.max(...used) : 0) + 1);
      const lastAt = planned.at(-1)?.at;
      saveTopics([...planned, { n, at: Number.isFinite(lastAt) ? lastAt + 60 : null }]);
    };
    const notesEd = DDRich.editor({
      value: t.notes || '',
      placeholder: 'What to say and do on this screen. Type "- " for bullets.',
      onSave: (html) => update({ notes: html }),
    });
    $c('.notes').append(notesEd.el);
    const pos = t.camera?.pos;
    const campos = $c('.campos');
    if (pos) {
      campos.innerHTML = '<span class="muted"></span> <button data-clearpos>Reset spot</button>';
      campos.firstChild.textContent = `Camera spot: ${CORNERS[pos.corner]} · ${t.camera.size}px`;
    } else {
      campos.innerHTML = '<span class="muted">Camera spot: default. Drag the bubble on this tab in Rehearse mode to set it.</span>';
    }

    const allow = $c('[data-allow]');
    const pattern = originPattern(t.url || '');
    if (pattern) {
      chrome.permissions.contains({ origins: [pattern] }).then((has) => {
        allow.hidden = has;
        allow.title = `Let Demo Director run on ${pattern.replace('/*', '')}`;
      });
    }
    allow.onclick = async () => {
      if (await allowSites([url.value.trim()])) allow.hidden = true;
    };
    // Keep every other field (id, camera spot, notes…) when one changes.
    const update = (patch) => saveTabs(current.settings.tabs.map((x, k) => (k !== i ? x : { ...x, ...patch })));
    const commitTab = () => {
      url.classList.toggle('bad', !!url.value.trim() && !validUrl(url.value.trim()));
      allowSites([url.value.trim()]); // first, while the gesture is fresh
      update({ label: label.value.trim(), url: url.value.trim() });
    };
    label.onchange = commitTab;
    url.onchange = commitTab;
    $c('[name=cmode]').onchange = (e) => {
      cdelay.disabled = !delayable();
      update({ camera: { ...(current.settings.tabs[i].camera || {}), mode: e.target.value } });
    };
    $c('[name=minutes]').onchange = (e) => update({ minutes: parseMin(e.target.value) });
    const clear = $c('[data-clearpos]');
    if (clear) clear.onclick = () => {
      const { pos: _p, size: _s, ...rest } = current.settings.tabs[i].camera || {};
      update({ camera: rest });
    };
    card.querySelectorAll('[data-d]').forEach((b) => {
      b.onclick = () => {
        const next = [...current.settings.tabs];
        const j = i + Number(b.dataset.d);
        if (j < 0 || j >= next.length) return;
        [next[i], next[j]] = [next[j], next[i]];
        saveTabs(next);
      };
    });
    $c('[data-x]').onclick = () => saveTabs(current.settings.tabs.filter((_, k) => k !== i));
    root.append(card);
  });
}

$('#tabAdd').onclick = async () => {
  await saveTabs([...current.settings.tabs, { label: '', url: '' }]);
  setTimeout(() => [...document.querySelectorAll('#tabs [name=label]')].pop()?.focus(), 100);
};
$('#tabCapture').onclick = async () => {
  const res = await send({ type: 'tabs.capture' });
  if (res.ok) {
    const { settings } = await send({ type: 'state.get' });
    await allowSites(settings.tabs.map((t) => t.url));
  }
  status(res.ok ? `Captured ${res.count} tab${res.count === 1 ? '' : 's'}` : res.error);
};
$('#tabRebuild').onclick = async () => {
  const res = await send({ type: 'tabs.rebuild' });
  status(res.ok ? `Tabs rebuilt: ${res.opened} opened, ${res.closed} closed` : res.error);
};

// ----- Slides & speaker notes -----

const deckStatus = (t, bad) => {
  $('#deckStatus').textContent = t;
  $('#deckStatus').style.color = bad ? 'var(--live)' : '';
};

async function renderDeck() {
  const { deck } = await chrome.storage.local.get('deck');
  if (deck && document.activeElement !== $('#deckUrl')) $('#deckUrl').value = deck.url || '';
  const list = $('#deckSlides');
  list.replaceChildren();
  if (!deck) {
    deckStatus('No deck loaded.');
    $('#deckList').hidden = true;
    return;
  }
  const withNotes = deck.slides.filter((s) => s.notes).length;
  const unmapped = deck.slides.filter((s) => !s.pageId).length;
  deckStatus(
    `Loaded ${deck.slides.length} slides (${withNotes} with notes) · ${new Date(deck.loadedAt).toLocaleString()} · ${deck.source === 'upload' ? 'from uploaded file' : 'from Google'}` +
      (unmapped ? ` · ${unmapped} slide(s) couldn't be matched to Google ids, so notes may not follow on those` : '')
  );
  $('#deckList').hidden = false;
  for (const sl of deck.slides) {
    const li = document.createElement('li');
    li.innerHTML = '<b></b><div class="muted" style="white-space:pre-wrap"></div>';
    li.querySelector('b').textContent = sl.title || '(untitled)';
    li.querySelector('div').textContent = sl.notes || '(no notes)';
    list.append(li);
  }
}

async function saveDeck(slides, source) {
  const url = $('#deckUrl').value.trim();
  const deck = { id: DDDeck.deckIdFrom(url), url, slides, source, loadedAt: Date.now() };
  await chrome.storage.local.set({ deck });
  renderDeck();
  status('Notes loaded');
}

$('#deckLoad').onclick = async () => {
  const id = DDDeck.deckIdFrom($('#deckUrl').value);
  if (!id) return deckStatus('Paste a Google Slides link first (docs.google.com/presentation/d/…).', true);
  if ($('#deckUrl').value.includes('/d/e/')) return deckStatus('That is a "Publish to web" link, which hides the deck id. Paste the editor link (…/d/<id>/edit) instead; it still works with the published tab.', true);
  // Ask for Google access inside the click (Chrome requires a user gesture).
  const ok = await chrome.permissions.request({ origins: DDDeck.GOOGLE_ORIGINS }).catch(() => false);
  if (!ok) return deckStatus('Google access not granted. Use "Upload .pptx instead".', true);
  deckStatus('Downloading deck from Google…');
  try {
    const slides = await DDDeck.parsePptx(await DDDeck.fetchPptx(id));
    await saveDeck(slides, 'google');
  } catch (e) {
    deckStatus(`${e.message}. Try "Upload .pptx instead".`, true);
  }
};
$('#deckUpload').onclick = () => $('#deckFile').click();
$('#deckFile').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (!DDDeck.deckIdFrom($('#deckUrl').value)) deckStatus('Tip: also paste the deck URL so the console knows which tab is the deck.', true);
  try {
    await saveDeck(await DDDeck.parsePptx(await file.arrayBuffer()), 'upload');
  } catch (err) {
    deckStatus(err.message, true);
  }
};
$('#deckUrl').onchange = async () => {
  const { deck } = await chrome.storage.local.get('deck');
  if (deck) await chrome.storage.local.set({ deck: { ...deck, url: $('#deckUrl').value.trim(), id: DDDeck.deckIdFrom($('#deckUrl').value) } });
};
$('#deckClear').onclick = async () => {
  await chrome.storage.local.remove('deck');
  $('#deckUrl').value = '';
  renderDeck();
};
chrome.storage.onChanged.addListener((c, area) => area === 'local' && c.deck && renderDeck());
renderDeck();
