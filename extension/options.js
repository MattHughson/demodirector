const send = (action) => chrome.runtime.sendMessage({ type: 'action', action });
const $ = (s) => document.querySelector(s);
const status = (t) => {
  $('#status').textContent = t;
  clearTimeout(status.t);
  status.t = setTimeout(() => ($('#status').textContent = ''), 3000);
};

let editing = false; // don't re-render under the user's cursor

function render(state) {
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
  status('All veils on');
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

$('#shortcutsBtn').onclick = () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
chrome.commands.getAll().then((cmds) => {
  const t = $('#shortcuts');
  for (const c of cmds) {
    if (c.name === '_execute_action') continue;
    const tr = t.insertRow();
    tr.insertCell().innerHTML = c.shortcut ? `<kbd>${c.shortcut}</kbd>` : '<span class="muted">not set</span>';
    tr.insertCell().textContent = c.description;
  }
});

chrome.runtime.onMessage.addListener((msg) => msg?.type === 'state' && render(msg.state));
send({ type: 'state.get' }).then(render);
