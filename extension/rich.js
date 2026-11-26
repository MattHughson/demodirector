// Demo Director — rich-text talking points.
// A tiny contenteditable editor (bold / italic / underline / highlight / lists)
// plus a whitelist sanitiser. Notes are stored as clean HTML; older plain-text
// notes are converted on the fly. Shared by Settings (editor) and the console (display).

(function (root) {
  const TAGS = { B: 'b', STRONG: 'b', I: 'i', EM: 'i', U: 'u', UL: 'ul', OL: 'ol', LI: 'li', P: 'p', DIV: 'p', BR: 'br', MARK: 'mark' };
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  // Keep only the tags above, with no attributes. Everything else is unwrapped to its text.
  function sanitize(html) {
    const doc = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html');
    const walk = (node) => {
      let out = '';
      for (const n of node.childNodes) {
        // contenteditable types non-breaking spaces at formatting edges; store plain ones.
        if (n.nodeType === 3) out += esc(n.textContent.replace(/\u00a0/g, ' '));
        else if (n.nodeType === 1) {
          const tag = TAGS[n.tagName];
          // Chrome sometimes bolds with <span style="font-weight: bold">.
          const boldSpan = n.tagName === 'SPAN' && /font-weight:\s*(bold|[6-9]00)/.test(n.getAttribute('style') || '');
          const inner = walk(n);
          if (tag === 'br') out += '<br>';
          else if (tag) out += `<${tag}>${inner}</${tag}>`;
          else if (boldSpan) out += `<b>${inner}</b>`;
          else out += inner;
        }
      }
      return out;
    };
    return walk(doc.body)
      .replace(/<p><\/p>/g, '')
      .replace(/(<br>)+$/, '')
      .trim();
  }

  // Stored notes → safe HTML for display (plain text from older versions keeps its line breaks).
  function toHtml(notes) {
    const s = String(notes || '');
    if (!s.trim()) return '';
    if (!/<(b|i|u|ul|ol|li|p|br|mark|div|strong|em)\b/i.test(s)) return esc(s).replace(/\n/g, '<br>');
    // HTML without line-level tags (e.g. older notes with a <b> in them): keep its line breaks.
    return sanitize(/<(p|ul|ol|li|br|div)\b/i.test(s) ? s : s.replace(/\n/g, '<br>'));
  }

  const isEmpty = (html) => !String(html || '').replace(/<[^>]+>/g, '').trim();

  const BUTTONS = [
    ['bold', 'B', 'Bold (⌘B)'],
    ['italic', 'I', 'Italic (⌘I)'],
    ['underline', 'U', 'Underline (⌘U)'],
    ['mark', 'Highlight', 'Highlight'],
    ['insertUnorderedList', '• List', 'Bulleted list (type "- ")'],
    ['insertOrderedList', '1. List', 'Numbered list (type "1. ")'],
    ['removeFormat', 'Clear', 'Clear formatting'],
  ];

  // Build an editor. onSave(html) fires on blur (and shortly after typing stops).
  function editor({ value = '', placeholder = '', onSave }) {
    const wrap = document.createElement('div');
    wrap.className = 'rich';
    const bar = document.createElement('div');
    bar.className = 'rich-bar';
    const area = document.createElement('div');
    area.className = 'rich-area';
    area.contentEditable = 'true';
    area.dataset.placeholder = placeholder;
    area.innerHTML = toHtml(value);
    const sync = () => area.classList.toggle('empty', isEmpty(area.innerHTML));
    sync();

    let last = toHtml(value);
    let timer = 0;
    const save = () => {
      clearTimeout(timer);
      const html = sanitize(area.innerHTML);
      if (html === last) return;
      last = html;
      onSave?.(html);
    };

    for (const [cmd, label, title] of BUTTONS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.title = title;
      b.dataset.cmd = cmd;
      b.addEventListener('mousedown', (e) => e.preventDefault()); // keep the selection
      b.addEventListener('click', () => {
        area.focus();
        if (cmd === 'mark') {
          const text = String(getSelection());
          if (text) document.execCommand('insertHTML', false, `<mark>${esc(text)}</mark>`);
        } else document.execCommand(cmd, false);
        sync();
        save();
      });
      bar.append(b);
    }

    // Markdown-style shortcuts at the start of a line: "- " / "* " → bullets, "1. " → numbers.
    area.addEventListener('input', (e) => {
      sync();
      clearTimeout(timer);
      timer = setTimeout(save, 800);
      if (e.inputType !== 'insertText' || e.data !== ' ') return;
      const sel = getSelection();
      const node = sel.anchorNode;
      if (!node || node.nodeType !== 3 || node.parentElement.closest('li')) return;
      const before = node.textContent.slice(0, sel.anchorOffset);
      const list = /^[-*•]\s$/.test(before) ? 'insertUnorderedList' : /^1[.)]\s$/.test(before) ? 'insertOrderedList' : null;
      if (!list) return;
      // Make the list first (while the caret is still on this line), then drop the "- " marker.
      document.execCommand(list, false);
      const s2 = getSelection();
      const t = s2.anchorNode;
      const m = t?.nodeType === 3 && /^([-*•]|1[.)])\s/.exec(t.textContent);
      if (m) {
        const r = document.createRange();
        r.setStart(t, 0);
        r.setEnd(t, m[0].length);
        s2.removeAllRanges();
        s2.addRange(r);
        document.execCommand('delete', false);
      }
    });
    // New lines become <p>, not <div>.
    area.addEventListener('focus', () => document.execCommand('defaultParagraphSeparator', false, 'p'));
    area.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'u') {
        e.preventDefault();
        document.execCommand('underline', false);
      }
    });
    area.addEventListener('blur', save);
    // Paste as plain text, so formatting from other apps doesn't come along.
    area.addEventListener('paste', (e) => {
      e.preventDefault();
      document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
    });

    wrap.append(bar, area);
    return { el: wrap, area, focus: () => area.focus() };
  }

  root.DDRich = { sanitize, toHtml, isEmpty, editor };
})(globalThis);
