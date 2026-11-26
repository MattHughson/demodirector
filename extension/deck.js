// Demo Director — Google Slides speaker notes.
// Reads a deck exported as .pptx (fetched with your Google login, or uploaded),
// pulls out each slide's Google page id, title and speaker notes, and works out
// which slide a Slides tab is on from its URL. Runs in extension pages
// (Settings, console), which have DOMParser and DecompressionStream.

(function (root) {
  // ---------- minimal ZIP reader (stored + deflate), enough for .pptx ----------

  async function openZip(buf) {
    const u8 = new Uint8Array(buf);
    const dv = new DataView(buf);
    if (u8[0] !== 0x50 || u8[1] !== 0x4b) throw new Error('Not a .pptx file (did Google return a sign-in page?)');
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error('Corrupt .pptx (no zip directory)');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const entries = new Map();
    const dec = new TextDecoder();
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const size = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commentLen = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
      entries.set(name, { method, size, local });
      p += 46 + nameLen + extraLen + commentLen;
    }
    async function bytes(name) {
      const e = entries.get(name);
      if (!e) return null;
      const start = e.local + 30 + dv.getUint16(e.local + 26, true) + dv.getUint16(e.local + 28, true);
      const raw = u8.subarray(start, start + e.size);
      if (e.method === 0) return raw;
      if (e.method !== 8) throw new Error(`Unsupported zip method ${e.method}`);
      const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    return {
      has: (name) => entries.has(name),
      text: async (name) => {
        const b = await bytes(name);
        return b ? dec.decode(b) : null;
      },
    };
  }

  // ---------- pptx → slides ----------

  const resolve = (base, rel) => {
    const parts = base.split('/').slice(0, -1);
    for (const seg of rel.split('/')) {
      if (seg === '..') parts.pop();
      else if (seg !== '.') parts.push(seg);
    }
    return parts.join('/');
  };

  const byLocal = (node, name) => [...node.getElementsByTagNameNS('*', name)];

  function relsOf(doc) {
    return byLocal(doc, 'Relationship').map((r) => ({
      id: r.getAttribute('Id'),
      type: r.getAttribute('Type') || '',
      target: r.getAttribute('Target'),
    }));
  }

  // Text of a shape: paragraphs joined by newlines.
  function shapeText(sp) {
    return byLocal(sp, 'p')
      .filter((p) => p.namespaceURI?.includes('drawingml'))
      .map((p) => byLocal(p, 't').map((t) => t.textContent).join(''))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  const phType = (sp) => byLocal(sp, 'ph')[0]?.getAttribute('type') || (byLocal(sp, 'ph').length ? 'body' : null);

  // Google names exported shapes "Google Shape;<n>;<pageId>" (notes: "<pageId>:notes").
  function googlePageId(doc) {
    for (const c of byLocal(doc, 'cNvPr')) {
      const m = /^Google Shape;\d+;(.+?)(?::notes)?$/.exec(c.getAttribute('name') || '');
      if (m) return m[1];
    }
    return null;
  }

  async function parsePptx(buf) {
    const zip = await openZip(buf);
    const xml = async (path) => {
      const t = await zip.text(path);
      return t ? new DOMParser().parseFromString(t, 'application/xml') : null;
    };
    const pres = await xml('ppt/presentation.xml');
    const presRels = await xml('ppt/_rels/presentation.xml.rels');
    if (!pres || !presRels) throw new Error('Not a presentation .pptx');
    const relMap = Object.fromEntries(relsOf(presRels).map((r) => [r.id, r.target]));
    const order = byLocal(pres, 'sldId').map((e) => e.getAttribute('r:id') || [...e.attributes].find((a) => a.localName === 'id' && a.prefix)?.value);

    const slides = [];
    for (const rid of order) {
      const slidePath = resolve('ppt/presentation.xml', relMap[rid] || '');
      const slide = await xml(slidePath);
      if (!slide) continue;
      const relPath = slidePath.replace(/slides\/(slide\d+\.xml)$/, 'slides/_rels/$1.rels');
      const relDoc = await xml(relPath);
      const rels = relDoc ? relsOf(relDoc) : [];
      const notesRel = rels.find((r) => r.type.endsWith('/notesSlide'));
      const notes = notesRel ? await xml(resolve(slidePath, notesRel.target)) : null;

      const shapes = byLocal(slide, 'sp');
      const titleSp = shapes.find((sp) => ['title', 'ctrTitle'].includes(phType(sp)));
      const firstText = shapes.map(shapeText).find(Boolean) || '';
      const noteText = notes
        ? byLocal(notes, 'sp')
            .filter((sp) => phType(sp) === 'body')
            .map(shapeText)
            .filter(Boolean)
            .join('\n\n')
        : '';
      slides.push({
        pageId: (notes && googlePageId(notes)) || googlePageId(slide),
        title: ((titleSp && shapeText(titleSp)) || firstText).split('\n')[0].slice(0, 120),
        notes: noteText,
      });
    }
    return slides;
  }

  // ---------- URLs ----------

  // Any Slides URL (edit, present, pub, embed) → deck id.
  function deckIdFrom(url) {
    return /docs\.google\.com\/presentation\/d\/(?:e\/)?([\w-]{20,})/.exec(url || '')?.[1] || null;
  }

  // Which slide a Slides URL points at: { pageId } from "slide=id.<pageId>",
  // or { index } (0-based) from "#slide=<n>". null if the URL doesn't say.
  // The hash wins over the query string: it's what changes as you navigate.
  function slideFrom(url) {
    const str = url || '';
    const hashAt = str.indexOf('#');
    const parts = hashAt >= 0 ? [str.slice(hashAt), str.slice(0, hashAt)] : [str];
    for (const part of parts) {
      const id = /[#?&]slide=id\.([^&#]+)/.exec(part);
      if (id) return { pageId: decodeURIComponent(id[1]) };
      const n = /[#?&]slide=(\d+)\b/.exec(part);
      if (n) return { index: Number(n[1]) - 1 };
    }
    return null;
  }

  function indexOf(deck, where) {
    if (!deck || !where) return -1;
    if (where.pageId) return deck.slides.findIndex((s) => s.pageId === where.pageId);
    return where.index >= 0 && where.index < deck.slides.length ? where.index : -1;
  }

  // Fetch the deck as .pptx using the browser's Google session.
  async function fetchPptx(deckId) {
    const res = await fetch(`https://docs.google.com/presentation/d/${deckId}/export/pptx`, { credentials: 'include' });
    if (!res.ok) throw new Error(`Google returned ${res.status}${res.status === 401 || res.status === 403 ? ' (no access: are you signed in with the right account?)' : ''}`);
    return res.arrayBuffer();
  }

  // Slide image for previews (null if Google won't give us one).
  async function fetchThumb(deckId, pageId) {
    try {
      const res = await fetch(`https://docs.google.com/presentation/d/${deckId}/export/png?pageid=${encodeURIComponent(pageId)}`, { credentials: 'include' });
      if (!res.ok || !(res.headers.get('content-type') || '').startsWith('image/')) return null;
      return URL.createObjectURL(await res.blob());
    } catch {
      return null;
    }
  }

  const GOOGLE_ORIGINS = ['https://docs.google.com/*', 'https://*.googleusercontent.com/*'];

  root.DDDeck = { openZip, parsePptx, deckIdFrom, slideFrom, indexOf, fetchPptx, fetchThumb, GOOGLE_ORIGINS };
})(globalThis);
