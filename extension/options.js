const send = (action) => chrome.runtime.sendMessage({ type: 'action', action });
const $ = (s) => document.querySelector(s);
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
  await send({ type: 'reset' });
  status('Stage reset: veils on, Slack post and topic hidden');
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

chrome.runtime.onMessage.addListener((msg) => msg?.type === 'state' && render(msg.state));
send({ type: 'state.get' }).then(render);

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
  $('#preview').classList.toggle('mirror', s.camera.mirror !== false);
  renderTopics(state);
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

function renderTopics(state) {
  const root = $('#topics');
  if (root.contains(document.activeElement)) return;
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

let previewStream = null;
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

async function stopPreview() {
  previewStream?.getTracks().forEach((t) => t.stop());
  previewStream = null;
  $('#preview').srcObject = null;
  $('#previewBtn').textContent = 'Preview';
}

$('#previewBtn').onclick = async () => {
  if (previewStream) return stopPreview();
  try {
    const id = $('#device').value;
    previewStream = await navigator.mediaDevices.getUserMedia({ video: id ? { deviceId: { exact: id } } : true });
    $('#preview').srcObject = previewStream;
    $('#previewBtn').textContent = 'Stop preview';
    listDevices();
  } catch (e) {
    camStatus(`Preview failed: ${e.name}`);
  }
};

$('#device').onchange = async () => {
  await send({ type: 'settings.update', patch: { camera: { deviceId: $('#device').value } } });
  status('Camera saved');
  if (previewStream) {
    await stopPreview();
    $('#previewBtn').click();
  }
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
