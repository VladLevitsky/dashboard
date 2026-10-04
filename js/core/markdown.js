// Markdown and rich-text helpers for the writing features (pure: no DOM, runs in Node).
// A small tolerant HTML parser, HTML -> Markdown (export), Markdown -> canonical dashboard HTML
// (paste / import), an allowlist sanitizer, plain text + stats and a "looks like Markdown" check.
// Canonical HTML is described in Reference/writing/SPEC.md section 3.

/* ============================== tables ============================== */

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param',
  'source', 'track', 'wbr', 'keygen', 'basefont', 'frame']);
// Content of these is dropped by the parser (never text, never markup we keep)
const DROP_CONTENT_TAGS = new Set(['script', 'style', 'template', 'iframe', 'object', 'noscript', 'title',
  'textarea', 'xmp', 'noembed', 'noframes', 'svg', 'math', 'select']);
const BLOCK_TAGS = new Set(['address', 'article', 'aside', 'blockquote', 'body', 'caption', 'center', 'dd',
  'details', 'dialog', 'dir', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2',
  'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'html', 'legend', 'li', 'main', 'menu', 'nav', 'ol', 'p', 'pre',
  'section', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul']);
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
// Start tags that implicitly close an open <p>
const P_CLOSERS = new Set(['address', 'article', 'aside', 'blockquote', 'center', 'details', 'dialog', 'dir', 'div',
  'dl', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup',
  'hr', 'main', 'menu', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul', 'li', 'dd', 'dt']);
const P_SCOPE_STOPS = new Set(['table', 'td', 'th', 'caption', 'button', 'html', 'marquee', 'applet']);
const LI_STOPS = new Set(['ul', 'ol', 'menu', 'table', 'td', 'th', 'tr', 'tbody', 'thead', 'tfoot', 'caption',
  'blockquote', 'section', 'article', 'aside', 'nav', 'header', 'footer', 'main', 'figure', 'details', 'dl',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'form', 'fieldset', 'body', 'html']);
const STRUCTURAL = new Set(['ul', 'ol', 'menu', 'dl', 'table', 'thead', 'tbody', 'tfoot', 'tr']);

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ',
  thinsp: ' ', zwnj: '‌', zwj: '‍', lrm: '‎', rlm: '‏', shy: '­',
  ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', sbquo: '‚',
  ldquo: '“', rdquo: '”', bdquo: '„', laquo: '«', raquo: '»', lsaquo: '‹',
  rsaquo: '›', bull: '•', middot: '·', prime: '′', Prime: '″', dagger: '†',
  Dagger: '‡', permil: '‰', copy: '©', reg: '®', trade: '™', deg: '°',
  plusmn: '±', times: '×', divide: '÷', minus: '−', ne: '≠', le: '≤',
  ge: '≥', asymp: '≈', infin: '∞', frac12: '½', frac14: '¼', frac34: '¾',
  sup1: '¹', sup2: '²', sup3: '³', micro: 'µ', para: '¶', sect: '§',
  cent: '¢', pound: '£', yen: '¥', euro: '€', curren: '¤', larr: '←',
  rarr: '→', uarr: '↑', darr: '↓', harr: '↔', lArr: '⇐', rArr: '⇒',
  uArr: '⇑', dArr: '⇓', hArr: '⇔', iexcl: '¡', iquest: '¿', brvbar: '¦',
  uml: '¨', macr: '¯', acute: '´', cedil: '¸', ordf: 'ª', ordm: 'º',
  not: '¬', check: '✓', hearts: '♥', star: '☆', starf: '★',
  Agrave: 'À', Aacute: 'Á', Acirc: 'Â', Atilde: 'Ã', Auml: 'Ä', Aring: 'Å',
  AElig: 'Æ', Ccedil: 'Ç', Egrave: 'È', Eacute: 'É', Ecirc: 'Ê', Euml: 'Ë',
  Igrave: 'Ì', Iacute: 'Í', Icirc: 'Î', Iuml: 'Ï', Ntilde: 'Ñ', Ograve: 'Ò',
  Oacute: 'Ó', Ocirc: 'Ô', Otilde: 'Õ', Ouml: 'Ö', Oslash: 'Ø', Ugrave: 'Ù',
  Uacute: 'Ú', Ucirc: 'Û', Uuml: 'Ü', Yacute: 'Ý', szlig: 'ß', agrave: 'à',
  aacute: 'á', acirc: 'â', atilde: 'ã', auml: 'ä', aring: 'å', aelig: 'æ',
  ccedil: 'ç', egrave: 'è', eacute: 'é', ecirc: 'ê', euml: 'ë', igrave: 'ì',
  iacute: 'í', icirc: 'î', iuml: 'ï', ntilde: 'ñ', ograve: 'ò', oacute: 'ó',
  ocirc: 'ô', otilde: 'õ', ouml: 'ö', oslash: 'ø', ugrave: 'ù', uacute: 'ú',
  ucirc: 'û', uuml: 'ü', yacute: 'ý', yuml: 'ÿ', OElig: 'Œ', oelig: 'œ',
  tab: '\t', newline: '\n', excl: '!', num: '#', dollar: '$', percnt: '%', lpar: '(', rpar: ')', ast: '*',
  plus: '+', comma: ',', period: '.', colon: ':', semi: ';', equals: '=', quest: '?', commat: '@',
  lsqb: '[', rsqb: ']', lbrack: '[', rbrack: ']', lcub: '{', rcub: '}', verbar: '|', vert: '|', bsol: '\\',
  sol: '/', grave: '`', Hat: '^', lowbar: '_'
};
// Decoded even without the trailing semicolon (legacy HTML)
const LEGACY_ENTITIES = new Set(['amp', 'lt', 'gt', 'quot', 'nbsp', 'copy', 'reg']);
// &#128;-&#159; mean Windows-1252 characters (Word pastes)
const CP1252 = { 0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†',
  0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8A: 'Š', 0x8B: '‹', 0x8C: 'Œ', 0x8E: 'Ž',
  0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—',
  0x98: '˜', 0x99: '™', 0x9A: 'š', 0x9B: '›', 0x9C: 'œ', 0x9E: 'ž', 0x9F: 'Ÿ' };
const ENTITY_RE = /&(?:#[xX]([0-9a-fA-F]{1,6});?|#([0-9]{1,7});?|([a-zA-Z][a-zA-Z0-9]{1,31});?)/g;

/* ============================== small helpers ============================== */

const BR = '';    // writer: <br> placeholder while building Markdown
const HARD = '';  // reader: hard line break placeholder
const PRIVATE_RE = /[]/g;
const ASCII_PUNCT_RE = /[!-\/:-@\[-`{-~]/;
const isWs = (c) => c === undefined || c === '' || c === HARD || /\s/.test(c);
const isPunct = (c) => !!c && /[\p{P}\p{S}]/u.test(c);
const isAlnum = (c) => !!c && /[\p{L}\p{N}]/u.test(c);
const countChar = (s, ch) => { let n = 0; for (const c of s) if (c === ch) n++; return n; };
const el = (tag, attrs = {}, children = []) => ({ type: 'element', tag, attrs, children });
const txt = (text) => ({ type: 'text', text });
const isEl = (n, tag) => !!n && n.type === 'element' && (!tag || n.tag === tag);
const isBlockNode = (n) => !!n && n.type === 'element' && BLOCK_TAGS.has(n.tag);
const classesOf = (n) => (n && n.attrs && n.attrs.class ? String(n.attrs.class).split(/\s+/).filter(Boolean) : []);
const hasClass = (n, c) => classesOf(n).includes(c);
const isEphemeral = (n) => n.type === 'element' &&
  ('data-wr-ephemeral' in n.attrs || hasClass(n, 'editor-img-resize-handle'));
const collapseWs = (s) => s.replace(/[ \t\n\r\f\v]+/g, ' ');

// Concatenated text of a node (no ephemeral UI)
function textOf(n) {
  if (!n) return '';
  if (n.type === 'text') return n.text;
  if (isEphemeral(n)) return '';
  if (n.tag === 'br') return '\n';
  let s = '';
  for (const c of n.children) s += textOf(c);
  return s;
}

// Text of a <pre>: <br> and block children become newlines
function preText(n) {
  let s = '';
  const walk = (nodes) => {
    for (const c of nodes) {
      if (c.type === 'text') { s += c.text; continue; }
      if (isEphemeral(c)) continue;
      if (c.tag === 'br') { s += '\n'; continue; }
      const blk = BLOCK_TAGS.has(c.tag);
      if (blk && s && !s.endsWith('\n')) s += '\n';
      walk(c.children);
      if (blk && s && !s.endsWith('\n')) s += '\n';
    }
  };
  walk(n.children);
  return s;
}

// Read one property out of an inline style string (lowercased value, '' when absent)
function styleProp(style, prop) {
  if (!style) return '';
  const re = new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([^;]+)', 'i');
  const m = re.exec(String(style));
  return m ? m[1].trim().toLowerCase() : '';
}
const isNormalWeight = (style) => /^(normal|lighter|[1-4]00)\b/.test(styleProp(style, 'font-weight'));

// Formatting implied by an inline style: subset of ['b','i','s','u']
function styleMarks(style, inLink) {
  if (!style) return [];
  const marks = [];
  if (/^(bold|bolder|[6-9]00)\b/.test(styleProp(style, 'font-weight'))) marks.push('b');
  if (/^(italic|oblique)\b/.test(styleProp(style, 'font-style'))) marks.push('i');
  const deco = styleProp(style, 'text-decoration') + ' ' + styleProp(style, 'text-decoration-line');
  if (deco.includes('line-through')) marks.push('s');
  if (!inLink && deco.includes('underline')) marks.push('u');
  return marks;
}

// Push an inline wrapper (b, i, a, ...) down into block children: <b><div>x</div></b> -> <div><b>x</b></div>
function distribute(tag, attrs, kids) {
  const out = [];
  let run = [];
  const flush = () => { if (run.length) { out.push(el(tag, attrs, run)); run = []; } };
  for (const c of kids) {
    if (isBlockNode(c)) { flush(); out.push(pushInto(c, tag, attrs)); } else run.push(c);
  }
  flush();
  return out;
}
function pushInto(block, tag, attrs) {
  if (block.tag === 'pre' || block.tag === 'hr') return block;
  if (STRUCTURAL.has(block.tag)) {
    return { ...block, children: block.children.map(c => (isBlockNode(c) ? pushInto(c, tag, attrs) : c)) };
  }
  return { ...block, children: distribute(tag, attrs, block.children) };
}
function wrapInline(tag, attrs, kids) {
  if (!kids.length) return kids;
  return kids.some(isBlockNode) ? distribute(tag, attrs, kids) : [el(tag, attrs, kids)];
}

const MERGEABLE = new Set(['b', 'i', 'u', 's', 'code', 'mark', 'a']);
const sameAttrs = (a, b) => JSON.stringify(a.attrs) === JSON.stringify(b.attrs);
// Merge adjacent text nodes and adjacent identical inline tags (<b>a</b><b>b</b> -> <b>ab</b>)
function mergeAdjacent(list, same = sameAttrs) {
  const out = [];
  for (const n of list) {
    const prev = out[out.length - 1];
    if (prev && n.type === 'text' && prev.type === 'text') { out[out.length - 1] = txt(prev.text + n.text); continue; }
    if (prev && n.type === 'element' && prev.type === 'element' && n.tag === prev.tag && MERGEABLE.has(n.tag) &&
        same(prev, n)) {
      out[out.length - 1] = { ...prev, children: mergeAdjacent([...prev.children, ...n.children], same) };
      continue;
    }
    out.push(n);
  }
  return out;
}

/* ============================== entities, escaping, URLs ============================== */

function codePointText(cp) {
  if (!cp || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) return '�';
  if (cp >= 0x80 && cp <= 0x9F && CP1252[cp]) return CP1252[cp];
  return String.fromCodePoint(cp);
}

// Decode HTML character references (named, decimal, hex). Unknown names stay literal.
export function decodeEntities(str) {
  const s = String(str ?? '');
  if (s.indexOf('&') < 0) return s;
  return s.replace(ENTITY_RE, (m, hex, dec, name, offset) => {
    if (hex || dec) return codePointText(parseInt(hex || dec, hex ? 16 : 10));
    if (!m.endsWith(';')) {
      if (!LEGACY_ENTITIES.has(name)) return m;
      const next = s[offset + m.length];
      if (next && /[A-Za-z0-9=]/.test(next)) return m;
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name] : m;
  });
}

// Escape text for safe use in HTML (text or attribute)
export function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// Browser-style serialization escapes
const escText = (s) => s.replace(/[&<> ]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', ' ': '&nbsp;' }[c]));
const escAttr = (s) => String(s).replace(/[&<>" ]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', ' ': '&nbsp;' }[c]));

// Trim the way browsers do before resolving a URL (C0/space at the ends, tabs/newlines anywhere)
function cleanUrl(url) {
  return String(url ?? '').replace(/[\t\n\r]/g, '').replace(/^[\u0000- ]+|[\u0000- ]+$/g, '');
}

// True for links the dashboard may open: http(s)://..., mailto:..., or an in-page #fragment
export function isSafeUrl(url) {
  const u = cleanUrl(url);
  if (!u) return false;
  if (u[0] === '#') return true;
  return /^https?:\/\/[^\s]/i.test(u) || /^mailto:[^\s]/i.test(u);
}
const isExternalUrl = (u) => /^https?:\/\/[^\s]/i.test(u) || /^mailto:[^\s]/i.test(u);

/* ============================== HTML parser ============================== */

const TAG_OPEN_RE = /<([a-zA-Z][^\s\/>\u0000]*)/y;
const END_TAG_RE = /<\/([a-zA-Z][^\s\/>\u0000]*)[^>]*>/y;
const ATTR_NAME_RE = /[^\s"'>\/=\u0000]+/y;
const UNQUOTED_RE = /[^\s>]*/y;
const WS_RE = /[\s]*/y;
const MAX_DEPTH = 200;  // element nesting cap (keeps every recursive walk far from the stack limit)

// Parse HTML into [{type:'element', tag, attrs, children} | {type:'text', text}]. Tolerant like a
// browser for the cases that matter here: void tags, implied ends (p, li, td, tr), unclosed tags
// closed at the parent's end, stray end tags ignored; comments, doctype and script/style/... dropped.
export function parseHtml(html) {
  const src = String(html ?? '').replace(/\r\n?/g, '\n');
  const root = el('#root');
  const stack = [root];
  const top = () => stack[stack.length - 1];
  const addText = (raw) => {
    if (!raw) return;
    const t = decodeEntities(raw);
    const kids = top().children;
    const last = kids[kids.length - 1];
    if (last && last.type === 'text') last.text += t; else kids.push(txt(t));
  };
  const findOpen = (names, stops) => {
    for (let k = stack.length - 1; k > 0; k--) {
      const t = stack[k].tag;
      if (names.includes(t)) return k;
      if (stops && stops.has(t)) return -1;
    }
    return -1;
  };
  const closeTo = (k) => { if (k > 0) stack.length = k; };
  const openTag = (tag, attrs, selfClose) => {
    if (P_CLOSERS.has(tag)) closeTo(findOpen(['p'], P_SCOPE_STOPS));
    if (tag === 'li') closeTo(findOpen(['li'], LI_STOPS));
    else if (tag === 'dt' || tag === 'dd') closeTo(findOpen(['dt', 'dd'], new Set(['dl', 'table'])));
    else if (tag === 'tr') closeTo(findOpen(['tr'], new Set(['table', 'tbody', 'thead', 'tfoot'])));
    else if (tag === 'td' || tag === 'th') closeTo(findOpen(['td', 'th'], new Set(['tr', 'table'])));
    else if (tag === 'thead' || tag === 'tbody' || tag === 'tfoot') closeTo(findOpen(['thead', 'tbody', 'tfoot'], new Set(['table'])));
    else if (HEADINGS.has(tag) && HEADINGS.has(top().tag)) stack.pop();
    else if (tag === 'a') closeTo(findOpen(['a'], null));
    const node = el(tag, attrs);
    top().children.push(node);
    // Past MAX_DEPTH new elements stay empty and their content flattens into the parent (like Chrome)
    if (!selfClose && !VOID_TAGS.has(tag) && stack.length < MAX_DEPTH) stack.push(node);
  };
  const closeTag = (tag) => {
    if (tag === 'br') { openTag('br', {}, true); return; }
    for (let k = stack.length - 1; k > 0; k--) if (stack[k].tag === tag) { stack.length = k; return; }
  };

  const n = src.length;
  let i = 0;
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) { addText(src.slice(i)); break; }
    if (lt > i) addText(src.slice(i, lt));
    i = lt;
    const c1 = src[i + 1];
    if (src.startsWith('<!--', i)) { const e = src.indexOf('-->', i + 4); i = e < 0 ? n : e + 3; continue; }
    if (c1 === '!' || c1 === '?') { const e = src.indexOf('>', i); i = e < 0 ? n : e + 1; continue; }
    if (c1 === '/') {
      END_TAG_RE.lastIndex = i;
      const m = END_TAG_RE.exec(src);
      if (m) { closeTag(m[1].toLowerCase()); i += m[0].length; continue; }
      if (src[i + 2] === '>') { i += 3; continue; }
      addText('<'); i++; continue;
    }
    TAG_OPEN_RE.lastIndex = i;
    const sm = TAG_OPEN_RE.exec(src);
    if (!sm) { addText('<'); i++; continue; }
    const tag = sm[1].toLowerCase();
    let j = i + sm[0].length;
    const attrs = {};
    let selfClose = false;
    while (j < n) {
      WS_RE.lastIndex = j; WS_RE.exec(src); j = WS_RE.lastIndex;
      if (src[j] === '>') { j++; break; }
      if (src.startsWith('/>', j)) { selfClose = true; j += 2; break; }
      if (src[j] === '/' || src[j] === '=' || src[j] === '"' || src[j] === "'") { j++; continue; }
      ATTR_NAME_RE.lastIndex = j;
      const am = ATTR_NAME_RE.exec(src);
      if (!am) { j++; continue; }
      const name = am[0].toLowerCase();
      j += am[0].length;
      WS_RE.lastIndex = j; WS_RE.exec(src);
      let value = '';
      if (src[WS_RE.lastIndex] === '=') {
        j = WS_RE.lastIndex + 1;
        WS_RE.lastIndex = j; WS_RE.exec(src); j = WS_RE.lastIndex;
        const q = src[j];
        if (q === '"' || q === "'") {
          const e = src.indexOf(q, j + 1);
          value = src.slice(j + 1, e < 0 ? n : e);
          j = e < 0 ? n : e + 1;
        } else {
          UNQUOTED_RE.lastIndex = j;
          const um = UNQUOTED_RE.exec(src);
          value = um[0];
          j += um[0].length;
        }
      }
      if (!(name in attrs)) attrs[name] = decodeEntities(value);
    }
    if (j > n) j = n;
    if (DROP_CONTENT_TAGS.has(tag)) {
      if (selfClose) { i = j; continue; }
      const re = new RegExp('</' + tag + '(?=[\\s/>])', 'ig');
      re.lastIndex = j;
      const m = re.exec(src);
      if (!m) { i = n; continue; }
      const e = src.indexOf('>', m.index);
      i = e < 0 ? n : e + 1;
      continue;
    }
    openTag(tag, attrs, selfClose);
    // Like browsers: a newline right after <pre> is not content
    if ((tag === 'pre' || tag === 'listing') && src[j] === '\n') j++;
    i = j;
  }
  return root.children;
}

// Serialize parsed nodes back to compact HTML (text and attributes escaped, void tags unclosed)
export function serializeHtml(nodes) {
  let s = '';
  for (const n of nodes || []) {
    if (n.type === 'text') { s += escText(n.text); continue; }
    if (n.type !== 'element' || n.tag === '#root') { if (n.children) s += serializeHtml(n.children); continue; }
    s += '<' + n.tag;
    for (const [k, v] of Object.entries(n.attrs || {})) s += ' ' + k + '="' + escAttr(v ?? '') + '"';
    s += '>';
    if (VOID_TAGS.has(n.tag)) continue;
    s += serializeHtml(n.children) + '</' + n.tag + '>';
  }
  return s;
}

/* ============================== HTML -> Markdown ============================== */

const MD_ALIASES = { strong: 'b', em: 'i', strike: 's', del: 's', ins: 'u', kbd: 'code', tt: 'code', samp: 'code' };
const MD_INLINE_KEEP = new Set(['b', 'i', 'u', 's', 'code', 'mark', 'a', 'img', 'br']);
const INLINE_MARKS = new Set(['b', 'i', 'u', 's', 'mark', 'a']);
const CHIP_CLASSES = ['project-task-highlight', 'wr-date', 'wr-ref'];
const ALERT_OF = { note: 'NOTE', tip: 'TIP', decision: 'IMPORTANT', warning: 'WARNING', caution: 'CAUTION' };
const mdSame = (a, b) => (a.tag === 'a' ? a.attrs.href === b.attrs.href : true);
const mdText = (s) => s.replace(/[​﻿]/g, '').replace(/ /g, ' ').replace(PRIVATE_RE, '');

// Pre-clean a parsed tree for Markdown: drop UI, unwrap Google Docs' normal-weight <b>, turn styled
// spans into b/i/s/u, unwrap plain wrappers, push marks into blocks, merge adjacent identical marks.
function mdNormalize(nodes, inLink) {
  const out = [];
  for (const n of nodes) {
    if (n.type === 'text') { const t = mdText(n.text); if (t) out.push(txt(t)); continue; }
    if (isEphemeral(n)) continue;
    const tag = MD_ALIASES[n.tag] || n.tag;
    const cls = classesOf(n);
    if (tag === 'pre' || tag === 'code' || CHIP_CLASSES.some(c => cls.includes(c))) { out.push({ ...n, tag }); continue; }
    let kids = mdNormalize(n.children, inLink || tag === 'a');
    if (cls.includes('editor-img-resize-wrap')) { out.push(...kids); continue; }
    if (tag === 'b' && isNormalWeight(n.attrs.style)) { out.push(...kids); continue; }
    if (tag === 'span' || tag === 'font') {
      const marks = styleMarks(n.attrs.style, inLink);
      for (let k = marks.length - 1; k >= 0; k--) kids = wrapInline(marks[k], {}, kids);
      out.push(...kids);
      continue;
    }
    if (!BLOCK_TAGS.has(tag) && !MD_INLINE_KEEP.has(tag)) { out.push(...kids); continue; }
    if (INLINE_MARKS.has(tag) && kids.some(isBlockNode)) { out.push(...distribute(tag, n.attrs, kids)); continue; }
    out.push({ ...n, tag, children: kids });
  }
  return mergeAdjacent(out, mdSame);
}

// Escape Markdown syntax in a text run, only where it would change meaning
const LINKISH_RE = /\[[^\]\n]*\]\(/y;
const ENTITYISH_RE = /&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]+);/iy;
function escapeRun(ch, run, prev, next, s) {
  const lit = ch.repeat(run);
  if (isWs(prev) && isWs(next)) return lit;
  const esc = ('\\' + ch).repeat(run);
  if (ch === '_') return isAlnum(prev) && isAlnum(next) ? lit : esc;
  if (ch === '*') {
    if (isAlnum(prev) && isAlnum(next)) return countChar(s, '*') > run ? esc : lit;
    return esc;
  }
  if (ch === '~') return run === 2 || (run === 1 && countChar(s, '~') > 1) ? '\\' + lit : lit;
  if (ch === '=') return run === 2 ? '\\==' : lit;
  return lit;
}
function escapeMdText(s, ctx) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    switch (ch) {
      case '\\': {
        const nx = s[i + 1];
        out += nx === undefined || ASCII_PUNCT_RE.test(nx) ? '\\\\' : '\\';
        break;
      }
      case '`': out += '\\`'; break;
      case '*': case '_': case '~': case '=': {
        let j = i;
        while (s[j] === ch) j++;
        out += escapeRun(ch, j - i, s[i - 1], s[j], s);
        i = j - 1;
        break;
      }
      case '[': LINKISH_RE.lastIndex = i; out += ctx.inLink || LINKISH_RE.test(s) ? '\\[' : '['; break;
      case ']': out += ctx.inLink ? '\\]' : ']'; break;
      case '<': out += /[A-Za-z\/!?]/.test(s[i + 1] || '') ? '\\<' : '<'; break;
      case '&': ENTITYISH_RE.lastIndex = i; out += ENTITYISH_RE.test(s) ? '\\&' : '&'; break;
      case '|': out += ctx.inTable ? '\\|' : '|'; break;
      default: out += ch;
    }
  }
  return out;
}

// Escape block syntax at the start of a paragraph line
function escapeLineStart(l, listItem) {
  if (/^(#{1,6}|[-+*])(?=\s|$)/.test(l) || l[0] === '>') return '\\' + l;
  if (/^\d{1,9}[.)](?=\s|$)/.test(l)) return l.replace(/^(\d+)/, '$1\\');
  if (/^([-*_])(?:\s*\1){2,}\s*$/.test(l) || /^=+\s*$/.test(l) || /^(~~~|```)/.test(l)) return '\\' + l;
  if (/^\[[^\]]*\]:/.test(l)) return '\\' + l;
  if (listItem && /^\[[ xX]\](?=\s|$)/.test(l)) return '\\' + l;
  return l;
}

// Wrap inline Markdown in delimiters; spaces move outside, never across a line break
function wrapMd(open, close, kids, ctx) {
  const inner = inlineMd(kids, ctx);
  return inner.split(/((?:\s*)+\s*)/).map((seg, k) => {
    if (k % 2) return seg;
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(seg);
    return m[2] ? m[1] + open + m[2] + close + m[3] : seg;
  }).join('');
}

function codeSpanMd(raw, ctx) {
  let t = mdText(raw).replace(/\n/g, ' ');
  if (!t) return '';
  if (ctx.inTable) t = t.replace(/\|/g, '\\|');
  let max = 0;
  for (const m of t.matchAll(/`+/g)) max = Math.max(max, m[0].length);
  const fence = '`'.repeat(max + 1);
  const pad = t[0] === '`' || t[t.length - 1] === '`' || (t[0] === ' ' && t[t.length - 1] === ' ' && t.trim()) ? ' ' : '';
  return fence + pad + t + pad + fence;
}

function mdDest(href, ctx) {
  let d = href.replace(/ /g, '%20').replace(/</g, '%3C').replace(/>/g, '%3E');
  if (ctx.inTable) d = d.replace(/\|/g, '%7C');
  let depth = 0, ok = true;
  for (const c of d) { if (c === '(') depth++; else if (c === ')' && --depth < 0) ok = false; }
  if (!ok || depth) d = d.replace(/\(/g, '%28').replace(/\)/g, '%29');
  return d;
}

function linkMd(n, ctx) {
  const href = cleanUrl(n.attrs.href);
  if (ctx.inLink || !isExternalUrl(href)) return inlineMd(n.children, ctx);
  const inner = inlineMd(n.children, { ...ctx, inLink: true }).replace(/ * */g, ' ');
  const m = /^( *)([\s\S]*?)( *)$/.exec(inner);
  const plain = collapseWs(mdText(textOf(n))).trim();
  const autolink = !m[2] || plain === href || 'mailto:' + plain === href;
  if (autolink && !/[\s<>]/.test(href) && !(ctx.inTable && href.includes('|'))) return m[1] + '<' + href + '>' + m[3];
  const label = m[2] || escapeMdText(href, { ...ctx, inLink: true });
  return m[1] + '[' + label + '](' + mdDest(href, ctx) + ')' + m[3];
}

function imageMd(n, ctx) {
  const idx = ++ctx.state.images;
  const id = n.attrs['data-r2-file-id'] || null;
  const alt = collapseWs(n.attrs.alt || '').trim();
  let name = '';
  if (typeof ctx.opts.imageName === 'function') {
    try { name = ctx.opts.imageName(id, idx, alt) || ''; } catch { name = ''; }
  }
  name = collapseWs(String(name)).trim() || alt || `image ${idx}`;
  name = name.replace(/[\[\]\\]/g, '\\$&');
  if (ctx.inTable) name = name.replace(/\|/g, '\\|');
  return '[image: ' + name + ']';
}

function inlineMd(nodes, ctx) {
  let s = '';
  for (const n of nodes) {
    const piece = inlineNodeMd(n, ctx);
    s += s.endsWith(' ') && piece.startsWith(' ') ? piece.slice(1) : piece;
  }
  return s;
}
function inlineNodeMd(n, ctx) {
  if (n.type === 'text') return escapeMdText(collapseWs(n.text), ctx);
  const cls = classesOf(n);
  if (cls.includes('wr-ref')) { const t = collapseWs(mdText(textOf(n))).trim(); return t ? '[[' + t + ']]' : ''; }
  if (cls.includes('project-task-highlight') || cls.includes('wr-date')) {
    return escapeMdText(collapseWs(mdText(textOf(n))), ctx);
  }
  switch (n.tag) {
    case 'br': return ctx.inTable ? ' ' : BR;
    case 'img': return imageMd(n, ctx);
    case 'b': return ctx.bold ? inlineMd(n.children, ctx) : wrapMd('**', '**', n.children, { ...ctx, bold: true });
    case 'i': return ctx.italic ? inlineMd(n.children, ctx) : wrapMd('*', '*', n.children, { ...ctx, italic: true });
    case 's': return ctx.strike ? inlineMd(n.children, ctx) : wrapMd('~~', '~~', n.children, { ...ctx, strike: true });
    case 'u': return ctx.under ? inlineMd(n.children, ctx) : wrapMd('<u>', '</u>', n.children, { ...ctx, under: true });
    case 'mark': return ctx.mark ? inlineMd(n.children, ctx) : wrapMd('==', '==', n.children, { ...ctx, mark: true });
    case 'code': return codeSpanMd(textOf(n), ctx);
    case 'a': return linkMd(n, ctx);
    default: return inlineMd(n.children, ctx);
  }
}

// Inline run -> paragraphs (2+ <br> split paragraphs, one <br> = backslash hard break)
function paragraphsMd(nodes, ctx) {
  const raw = inlineMd(nodes, ctx);
  const out = [];
  for (const chunk of raw.split(/ *(?: *){2,}/)) {
    const para = chunk.replace(/^[ ]+|[ ]+$/g, '');
    if (!para) continue;
    out.push(para.split(/ * */).map(l => escapeLineStart(l, ctx.listItem)).join('\\\n'));
  }
  return out;
}

const joinBlocks = (blocks) => blocks.map(b => b.md).join('\n\n');
const prefixLines = (s, p) => s.split('\n').map(l => (l ? p + ' ' + l : p)).join('\n');
const indentLines = (s, w) => s.split('\n').map(l => (l ? ' '.repeat(w) + l : l)).join('\n');

// Children -> [{ md, kind }] where kind is 'p' | 'list' | 'h' | 'hr' | 'block'
function blocksMd(nodes, ctx) {
  const out = [];
  let run = [];
  const flush = () => {
    if (!run.length) return;
    for (const md of paragraphsMd(run, ctx)) out.push({ md, kind: 'p' });
    run = [];
  };
  for (const n of nodes) {
    if (isBlockNode(n)) { flush(); for (const b of blockMd(n, ctx)) if (b.md) out.push(b); } else run.push(n);
  }
  flush();
  return out;
}

function blockMd(n, ctx) {
  const tag = n.tag;
  const cls = classesOf(n);
  const plainCtx = { ...ctx, listItem: false };
  if (cls.includes('wr-callout')) return [{ md: calloutMd(n, plainCtx), kind: 'block' }];
  if (cls.includes('wr-toggle') || tag === 'details') return [{ md: toggleMd(n, plainCtx), kind: 'block' }];
  if (HEADINGS.has(tag)) return [{ md: headingMd(n, ctx), kind: 'h' }];
  switch (tag) {
    case 'ul': case 'ol': return [{ md: listMd(n, ctx), kind: 'list' }];
    case 'li': return [{ md: listMd(el('ul', {}, [n]), ctx), kind: 'list' }];
    case 'blockquote': {
      const inner = joinBlocks(blocksMd(n.children, plainCtx));
      return [{ md: inner ? prefixLines(inner, '>') : '', kind: 'block' }];
    }
    case 'pre': return [{ md: codeBlockMd(n), kind: 'block' }];
    case 'table': case 'thead': case 'tbody': case 'tfoot': case 'tr': return [{ md: tableMd(n, plainCtx), kind: 'block' }];
    case 'hr': return [{ md: '---', kind: 'hr' }];
    default: return blocksMd(n.children, ctx);
  }
}

function headingMd(n, ctx) {
  const level = Math.min(6, Math.max(1, Number(n.tag[1]) + (Number(ctx.opts.headingOffset) || 0)));
  let t = inlineMd(n.children, { ...ctx, listItem: false }).replace(/ * */g, ' ').trim();
  if (!t) return '';
  t = /^#+$/.test(t) ? '\\' + t : t.replace(/(\s)(#+)$/, '$1\\$2');
  return '#'.repeat(level) + ' ' + t;
}

function listMd(n, ctx) {
  const ordered = n.tag === 'ol';
  const check = !ordered && hasClass(n, 'checklist');
  const start = parseInt(n.attrs.start, 10);
  let num = ordered && Number.isFinite(start) && start >= 0 ? start : 1;
  const items = [];
  let stray = [];
  const addItem = (li) => {
    const body = itemBodyMd(li.children, ctx);
    if (!body.trim()) return;
    const marker = ordered ? `${num++}. ` : '- ';
    const task = check ? (hasClass(li, 'checked') ? '[x] ' : '[ ] ') : '';
    const lines = body.split('\n');
    let md = lines[0] ? marker + task + lines[0] : (marker + task).trimEnd();
    for (const l of lines.slice(1)) md += '\n' + (l ? ' '.repeat(marker.length) + l : '');
    items.push({ md, width: marker.length });
  };
  const flushStray = () => { if (stray.length) { addItem(el('li', {}, stray)); stray = []; } };
  for (const c of n.children) {
    if (isEl(c, 'ul') || isEl(c, 'ol')) {
      // Chrome nests lists as siblings of <li>: indent under the previous item
      flushStray();
      const sub = listMd(c, ctx);
      if (!sub) continue;
      const last = items[items.length - 1];
      if (last) last.md += '\n' + indentLines(sub, last.width); else items.push({ md: sub, width: 0 });
    } else if (isEl(c, 'li')) { flushStray(); addItem(c); } else if (c.type === 'element' || c.text.trim()) stray.push(c);
  }
  flushStray();
  return items.map(i => i.md).join('\n');
}

// List item body: lines joined by hard breaks, nested lists right below, other blocks after a blank line
function itemBodyMd(kids, ctx) {
  const blocks = blocksMd(kids, { ...ctx, listItem: true });
  let s = '';
  blocks.forEach((b, k) => {
    if (!k) { s = b.kind === 'list' ? '\n' + b.md : b.md; return; }
    const prev = blocks[k - 1].kind;
    if (b.kind === 'p' && prev === 'p') s += '\\\n' + b.md;
    else if (b.kind === 'list' && prev === 'p') s += '\n' + b.md;
    else s += '\n\n' + b.md;
  });
  return s;
}

function langOf(n) {
  const code = n.children.find(c => isEl(c, 'code'));
  const fromClass = (x) => (x && (/(?:^|\s)(?:language|lang)-([\w+#.-]+)/.exec(x.attrs.class || '') || [])[1]) || '';
  const lang = n.attrs['data-lang'] || fromClass(n) || (code && (code.attrs['data-lang'] || fromClass(code))) || '';
  return /^[\w+#.-]{1,30}$/.test(lang) ? lang : '';
}

function codeBlockMd(n) {
  const text = preText(n).replace(/[​﻿]/g, '').replace(/ /g, ' ').replace(PRIVATE_RE, '').replace(/\n$/, '');
  let max = 0;
  for (const m of text.matchAll(/`+/g)) max = Math.max(max, m[0].length);
  const fence = '`'.repeat(Math.max(3, max + 1));
  return fence + langOf(n) + '\n' + text + '\n' + fence;
}

function tableMd(n, ctx) {
  const rows = [];
  const collect = (node) => {
    for (const c of node.children) {
      if (isEl(c, 'tr')) rows.push(c);
      else if (isEl(c, 'thead') || isEl(c, 'tbody') || isEl(c, 'tfoot')) collect(c);
    }
  };
  if (n.tag === 'tr') rows.push(n); else collect(n);
  const cellCtx = { ...ctx, inTable: true };
  const grid = rows.map(r => r.children.filter(c => isEl(c, 'td') || isEl(c, 'th'))
    .map(c => blocksMd(c.children, cellCtx).map(b => b.md.replace(/\s*\n\s*/g, ' ')).join(' ').trim()))
    .filter(r => r.length);
  if (!grid.length) return '';
  const cols = Math.max(...grid.map(r => r.length));
  const line = (cells) => '| ' + Array.from({ length: cols }, (_, k) => cells[k] || '').join(' | ') + ' |';
  return [line(grid[0]), '| ' + Array(cols).fill('---').join(' | ') + ' |', ...grid.slice(1).map(line)].join('\n');
}

function calloutMd(n, ctx) {
  const kind = String(n.attrs['data-kind'] || 'note').toLowerCase();
  const blocks = blocksMd(n.children, ctx);
  if (kind === 'decision') {
    if (blocks[0] && blocks[0].kind === 'p') blocks[0] = { ...blocks[0], md: '**Decision:** ' + blocks[0].md };
    else blocks.unshift({ md: '**Decision:**', kind: 'p' });
  }
  const body = joinBlocks(blocks);
  return prefixLines('[!' + (ALERT_OF[kind] || 'NOTE') + ']' + (body ? '\n' + body : ''), '>');
}

function toggleMd(n, ctx) {
  let title = null;
  const body = [];
  for (const c of n.children) {
    if (!title && c.type === 'element' && (hasClass(c, 'wr-toggle-title') || c.tag === 'summary')) title = c;
    else if (c.type === 'element' && hasClass(c, 'wr-toggle-body')) body.push(...c.children);
    else body.push(c);
  }
  const t = collapseWs(mdText(textOf(title))).trim().replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const md = joinBlocks(blocksMd(body, ctx));
  return `<details><summary>${t}</summary>\n\n` + (md ? md + '\n\n' : '') + '</details>';
}

// Convert dashboard rich-text HTML to GitHub-flavored Markdown (spec sections 3 and 7.7).
// opts.imageName(fileId|null, index (1-based), alt) => name for the '[image: NAME]' placeholder;
// opts.headingOffset shifts heading levels (1 turns h1 into '##').
export function htmlToMarkdown(html, opts = {}) {
  const nodes = mdNormalize(parseHtml(html), false);
  const ctx = { opts: opts || {}, state: { images: 0 }, listItem: false, inTable: false, inLink: false };
  return joinBlocks(blocksMd(nodes, ctx)).trim();
}

/* ============================== Markdown -> HTML ============================== */

const MARK_OPEN = '<mark class="text-highlight" data-highlight-color="yellow">';
const INLINE_OPEN = { b: '<b>', i: '<i>', s: '<s>', u: '<u>', mark: MARK_OPEN };
const INLINE_CLOSE = { b: '</b>', i: '</i>', s: '</s>', u: '</u>', mark: '</mark>' };
const TAG_TOKENS = { u: 'u', mark: 'mark', s: 's', del: 's' };
const AUTOLINK_RE = /<((?:https?|mailto):[^\s<>]*)>/iy;
const EMAIL_AUTOLINK_RE = /<([A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+)>/y;
const INLINE_TAG_RE = /<(\/?)(u|mark|s|del)>/iy;
const BR_TAG_RE = /<br\s*\/?>/iy;
const BARE_URL_RE = /https?:\/\/[^\s<>]+/iy;
const MD_ENTITY_RE = /&(?:#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z][a-zA-Z0-9]{1,31});/y;
const unescapeMd = (s) => s.replace(/\\([!-\/:-@\[-`{-~])/g, '$1');

function linkHtml(url, inner) {
  const u = /^www\./i.test(url) ? 'https://' + url : url;
  if (!isSafeUrl(u)) return inner;
  const href = cleanUrl(u);
  return href[0] === '#'
    ? `<a href="${escAttr(href)}">${inner}</a>`
    : `<a href="${escAttr(href)}" target="_blank" rel="noopener noreferrer">${inner}</a>`;
}

// [text](dest "title") starting at src[i] === '['
function parseLinkAt(src, i) {
  let depth = 0, k = i;
  for (; k < src.length; k++) {
    const c = src[k];
    if (c === '\\') { k++; continue; }
    if (c === '`') {
      let j = k;
      while (src[j] === '`') j++;
      const close = src.indexOf(src.slice(k, j), j);
      k = close >= 0 ? close + (j - k) - 1 : j - 1;
      continue;
    }
    if (c === '[') depth++;
    else if (c === ']' && --depth === 0) break;
  }
  if (k >= src.length || src[k + 1] !== '(') return null;
  const text = src.slice(i + 1, k);
  let j = k + 2;
  while (src[j] === ' ') j++;
  let url = '';
  if (src[j] === '<') {
    const e = src.indexOf('>', j);
    if (e < 0) return null;
    url = src.slice(j + 1, e);
    if (/[<\n]/.test(url)) return null;
    j = e + 1;
  } else {
    let pd = 0;
    const s0 = j;
    for (; j < src.length; j++) {
      const c = src[j];
      if (c === '\\' && j + 1 < src.length) { j++; continue; }
      if (c === ' ' || c === HARD || c === '\n') break;
      if (c === '(') pd++;
      else if (c === ')') { if (!pd) break; pd--; }
    }
    url = src.slice(s0, j);
  }
  while (src[j] === ' ') j++;
  if (src[j] === '"' || src[j] === "'" || (src[j] === '(' && j > k + 2)) {
    const close = src[j] === '(' ? ')' : src[j];
    const e = src.indexOf(close, j + 1);
    if (e < 0) return null;
    j = e + 1;
    while (src[j] === ' ') j++;
  }
  if (src[j] !== ')') return null;
  return { text, url: decodeEntities(unescapeMd(url)), end: j + 1 };
}

// CommonMark-style delimiter matching (simplified): pairs * / _ runs, ~~, == and <u>/<mark>/<s> tokens
function processEmphasis(nodes) {
  let i = 0;
  while (i < nodes.length) {
    const c = nodes[i];
    if (c.t !== 'delim' || !c.canClose || !c.count) { i++; continue; }
    let o = -1;
    for (let j = i - 1; j >= 0; j--) {
      const d = nodes[j];
      if (d.t !== 'delim' || d.ch !== c.ch || !d.canOpen || !d.count) continue;
      if (c.ch === '*' || c.ch === '_') {
        if ((d.canClose || c.canOpen) && (d.orig + c.orig) % 3 === 0 && !(d.orig % 3 === 0 && c.orig % 3 === 0)) continue;
      }
      o = j;
      break;
    }
    if (o < 0) { i++; continue; }
    const d = nodes[o];
    let tag, use;
    if (c.ch === '*' || c.ch === '_') { use = d.count >= 2 && c.count >= 2 ? 2 : 1; tag = use === 2 ? 'b' : 'i'; }
    else { use = c.count; tag = c.ch === '~' ? 's' : c.ch === '=' ? 'mark' : c.ch.slice(1, -1); }
    d.count -= use;
    c.count -= use;
    const inner = nodes.slice(o + 1, i);
    nodes.splice(o + 1, i - o - 1, { t: 'el', tag, children: inner });
    i = o + 2;
  }
  return nodes;
}

function renderInlineNodes(nodes) {
  let s = '';
  for (const n of nodes) {
    if (n.t === 'text') s += escText(n.v);
    else if (n.t === 'html') s += n.v;
    else if (n.t === 'delim') s += n.count ? escText(n.raw || n.ch.repeat(n.count)) : '';
    else s += INLINE_OPEN[n.tag] + renderInlineNodes(n.children) + INLINE_CLOSE[n.tag];
  }
  return s;
}

// Inline Markdown -> HTML (everything that is not recognized syntax is escaped text)
function parseInline(src, opts = {}) {
  const nodes = [];
  let text = '';
  const flush = () => { if (text) { nodes.push({ t: 'text', v: text }); text = ''; } };
  const html = (v) => { flush(); nodes.push({ t: 'html', v }); };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\') {
      const nx = src[i + 1];
      if (nx && ASCII_PUNCT_RE.test(nx)) { text += nx; i += 2; } else { text += '\\'; i++; }
      continue;
    }
    if (ch === HARD) { html('<br>'); i++; continue; }
    if (ch === '&') {
      MD_ENTITY_RE.lastIndex = i;
      const m = MD_ENTITY_RE.exec(src);
      if (m) { text += decodeEntities(m[0]); i += m[0].length; continue; }
      text += '&'; i++;
      continue;
    }
    if (ch === '`') {
      let j = i;
      while (src[j] === '`') j++;
      const run = j - i;
      let k = j, found = -1;
      while ((k = src.indexOf('`', k)) >= 0) {
        let e = k;
        while (src[e] === '`') e++;
        if (e - k === run) { found = k; break; }
        k = e;
      }
      if (found >= 0) {
        let code = src.slice(j, found).replace(/[\n]/g, ' ');
        if (code.length > 1 && code[0] === ' ' && code[code.length - 1] === ' ' && code.trim()) code = code.slice(1, -1);
        html('<code>' + escText(code) + '</code>');
        i = found + run;
      } else { text += src.slice(i, j); i = j; }
      continue;
    }
    if (ch === '!' && src[i + 1] === '[') {
      const lk = parseLinkAt(src, i + 1);
      if (lk) { flush(); nodes.push({ t: 'text', v: '[image: ' + (unescapeMd(lk.text).trim() || 'image') + ']' }); i = lk.end; continue; }
    }
    if (ch === '[' && src[i + 1] === '[') {
      const e = src.indexOf(']]', i + 2);
      if (e > i + 2 && !/[\n\[]/.test(src.slice(i + 2, e))) {
        flush(); nodes.push({ t: 'text', v: unescapeMd(src.slice(i + 2, e)) }); i = e + 2; continue;
      }
    }
    if (ch === '[' && !opts.noLinks) {
      const lk = parseLinkAt(src, i);
      if (lk) { html(linkHtml(lk.url, parseInline(lk.text, { noLinks: true }))); i = lk.end; continue; }
    }
    if (ch === '<') {
      let m;
      if (!opts.noLinks) {
        AUTOLINK_RE.lastIndex = i;
        if ((m = AUTOLINK_RE.exec(src))) { html(linkHtml(m[1], escText(m[1]))); i += m[0].length; continue; }
        EMAIL_AUTOLINK_RE.lastIndex = i;
        if ((m = EMAIL_AUTOLINK_RE.exec(src))) { html(linkHtml('mailto:' + m[1], escText(m[1]))); i += m[0].length; continue; }
      }
      BR_TAG_RE.lastIndex = i;
      if ((m = BR_TAG_RE.exec(src))) { html('<br>'); i += m[0].length; continue; }
      INLINE_TAG_RE.lastIndex = i;
      if ((m = INLINE_TAG_RE.exec(src))) {
        flush();
        nodes.push({ t: 'delim', ch: '<' + TAG_TOKENS[m[2].toLowerCase()] + '>', count: 1, orig: 1, raw: m[0], canOpen: !m[1], canClose: !!m[1] });
        i += m[0].length;
        continue;
      }
      text += '<'; i++;
      continue;
    }
    if ((ch === 'h' || ch === 'H') && !opts.noLinks && !isAlnum(src[i - 1])) {
      BARE_URL_RE.lastIndex = i;
      const m = BARE_URL_RE.exec(src);
      if (m) {
        let url = m[0];
        for (;;) {
          const last = url[url.length - 1];
          if (/[.,:;!?'"*_~]/.test(last)) url = url.slice(0, -1);
          else if (last === ')' && countChar(url, '(') < countChar(url, ')')) url = url.slice(0, -1);
          else break;
        }
        if (url.length > url.indexOf('//') + 2) { html(linkHtml(url, escText(url))); i += url.length; continue; }
      }
    }
    if (ch === '*' || ch === '_' || ch === '~' || ch === '=') {
      let j = i;
      while (src[j] === ch) j++;
      const count = j - i;
      if ((ch === '~' || ch === '=') && count !== 2) { text += src.slice(i, j); i = j; continue; }
      const prev = i > 0 ? src[i - 1] : ' ';
      const next = j < src.length ? src[j] : ' ';
      const lf = !isWs(next) && (!isPunct(next) || isWs(prev) || isPunct(prev));
      const rf = !isWs(prev) && (!isPunct(prev) || isWs(next) || isPunct(next));
      let canOpen = lf, canClose = rf;
      if (ch === '_') { canOpen = lf && (!rf || isPunct(prev)); canClose = rf && (!lf || isPunct(next)); }
      flush();
      nodes.push({ t: 'delim', ch, count, orig: count, canOpen, canClose });
      i = j;
      continue;
    }
    text += ch;
    i++;
  }
  flush();
  return renderInlineNodes(processEmphasis(nodes));
}

/* ---------- block structure ---------- */

const FENCE_RE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const ATX_RE = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const HR_RE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE_RE = /^ {0,3}> ?(.*)$/;
const TABLE_DELIM_RE = /^ {0,3}\|?(?:[ \t]*:?-+:?[ \t]*\|)*[ \t]*:?-+:?[ \t]*\|?[ \t]*$/;
const DETAILS_OPEN_RE = /^ {0,3}<details(\s+open(?:=(?:"[^"]*"|'[^']*'|\S*))?)?\s*>\s*(.*)$/i;
const DETAILS_CLOSE_RE = /^\s*<\/details>\s*$/i;
const SUMMARY_RE = /^\s*<summary>(.*?)<\/summary>\s*$/i;
const TASK_RE = /^\[([ xX])\](?:[ \t]+|$)/;
const ALERT_KINDS = {
  note: 'note', info: 'note', abstract: 'note', summary: 'note', tldr: 'note', todo: 'note', question: 'note',
  help: 'note', faq: 'note', example: 'note', quote: 'note', cite: 'note',
  tip: 'tip', hint: 'tip', success: 'tip', check: 'tip', done: 'tip',
  important: 'decision', decision: 'decision',
  warning: 'warning', attention: 'warning',
  caution: 'caution', danger: 'caution', error: 'caution', bug: 'caution', failure: 'caution', fail: 'caution', missing: 'caution'
};
const indentOf = (l) => l.length - l.replace(/^ +/, '').length;
const isBlank = (l) => !l.trim();

function isFence(l) {
  const m = FENCE_RE.exec(l);
  return !!m && !(m[2][0] === '`' && m[3].includes('`'));
}
function listMarker(l) {
  const m = /^( *)(?:([-*+])|(\d{1,9})([.)]))( +|$)(.*)$/.exec(l);
  if (!m || HR_RE.test(l)) return null;
  const indent = m[1].length;
  const markerLen = m[2] ? 1 : m[3].length + 1;
  let spaces = m[5].length;
  let rest = m[6];
  if (!rest) spaces = 1;
  else if (spaces > 4) { rest = ' '.repeat(spaces - 1) + rest; spaces = 1; }
  return { indent, ordered: !m[2], rest, contentIndent: indent + markerLen + spaces };
}
function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  for (let k = 0; k < s.length; k++) {
    if (s[k] === '\\' && s[k + 1] === '|') { cur += '\\|'; k++; continue; }
    if (s[k] === '|') { cells.push(cur); cur = ''; continue; }
    cur += s[k];
  }
  cells.push(cur);
  return cells.map(c => c.trim());
}
function isTableStart(lines, i) {
  const a = lines[i], b = lines[i + 1];
  if (b === undefined || !a.includes('|') || !b.includes('|') || !TABLE_DELIM_RE.test(b)) return false;
  return splitRow(a).length === splitRow(b).length;
}
function isBlockStart(lines, i, inParagraph) {
  const l = lines[i];
  if (isFence(l) || ATX_RE.test(l) || HR_RE.test(l) || /^ {0,3}>/.test(l) || DETAILS_OPEN_RE.test(l)) return true;
  const lm = listMarker(l);
  if (lm && (lm.rest.trim() || !inParagraph)) return true;
  return isTableStart(lines, i);
}

// Paragraph lines -> div lines; a backslash or 2+ trailing spaces join the next line with <br>
function paragraphParts(lines) {
  const parts = [];
  let cur = '';
  lines.forEach((raw, k) => {
    let l = raw.replace(/^[ \t]+/, '');
    let hard = false;
    if (k < lines.length - 1) {
      if (/(?:^|[^\\])(?:\\\\)*\\$/.test(l)) { hard = true; l = l.slice(0, -1); } else if (/ {2,}$/.test(l)) hard = true;
    }
    l = l.replace(/[ \t]+$/, '');
    if (hard) cur += l + HARD;
    else { parts.push(parseInline(cur + l)); cur = ''; }
  });
  if (cur) parts.push(parseInline(cur));
  return parts.map(p => p || '<br>');
}

const blocksToHtml = (blocks) => blocks.map(b => (b.kind === 'p' ? b.parts.map(p => `<div>${p}</div>`).join('') : b.html)).join('');
function liInner(blocks) {
  let s = '';
  blocks.forEach((b, k) => {
    if (b.kind === 'p') s += (k && blocks[k - 1].kind === 'p' ? '<br>' : '') + b.parts.join('<br>');
    else s += b.html;
  });
  return s;
}

function parseList(lines, start) {
  const first = listMarker(lines[start]);
  const items = [];
  let i = start;
  while (i < lines.length) {
    const m = listMarker(lines[i]);
    if (!m || m.ordered !== first.ordered) break;
    let contentIndent = m.contentIndent;
    const body = [m.rest];
    let fenceOpen = isFence(m.rest);
    i++;
    while (i < lines.length) {
      const c = lines[i];
      if (isBlank(c)) {
        let k = i + 1;
        while (k < lines.length && isBlank(lines[k])) k++;
        if (k < lines.length && indentOf(lines[k]) >= contentIndent) { while (i < k) { body.push(''); i++; } continue; }
        break;
      }
      const ind = indentOf(c);
      if (ind >= contentIndent) {
        const line = c.slice(contentIndent);
        if (isFence(line)) fenceOpen = !fenceOpen;
        body.push(line); i++;
        continue;
      }
      const cm = listMarker(c);
      if (cm && ind >= m.indent + 2 && !fenceOpen) { contentIndent = ind; body.push(c.slice(ind)); i++; continue; }
      if (cm) break;
      if (!fenceOpen && !isBlank(body[body.length - 1]) && !isBlockStart(lines, i, true)) { body.push(c.trim()); i++; continue; }
      break;
    }
    items.push(body);
    let k = i;
    while (k < lines.length && isBlank(lines[k])) k++;
    if (k > i) {
      const nm = k < lines.length ? listMarker(lines[k]) : null;
      if (nm && nm.ordered === first.ordered && nm.indent < first.indent + 2) i = k; else break;
    }
  }
  const check = !first.ordered && TASK_RE.test(items[0][0]);
  const tag = first.ordered ? 'ol' : 'ul';
  let html = check ? '<ul class="checklist">' : `<${tag}>`;
  for (const body of items) {
    let cls = '';
    if (check) {
      const tm = TASK_RE.exec(body[0]);
      if (tm) { if (tm[1] !== ' ') cls = ' class="checked"'; body[0] = body[0].slice(tm[0].length); }
    }
    html += `<li${cls}>${liInner(mdBlocks(body)) || '<br>'}</li>`;
  }
  return { html: html + `</${tag}>`, next: i };
}

function parseQuote(lines, start) {
  const inner = [];
  let i = start;
  while (i < lines.length) {
    const qm = QUOTE_RE.exec(lines[i]);
    if (qm) { inner.push(qm[1]); i++; continue; }
    if (!isBlank(lines[i]) && inner.length && !isBlank(inner[inner.length - 1]) && !isBlockStart(lines, i, true)) {
      inner.push(lines[i]); i++;
      continue;
    }
    break;
  }
  const am = /^ {0,3}\[!([A-Za-z]+)\][+-]?[ \t]*(.*)$/.exec(inner[0] || '');
  const kind = am && ALERT_KINDS[am[1].toLowerCase()];
  if (kind) {
    const rest = inner.slice(1);
    if (am[2].trim()) rest.unshift(am[2]);
    if (kind === 'decision') {
      const k = rest.findIndex(l => !isBlank(l));
      if (k >= 0 && /^ {0,3}\*\*Decision:\*\*/.test(rest[k])) {
        rest[k] = rest[k].replace(/^ {0,3}\*\*Decision:\*\*[ \t]*/, '');
        if (isBlank(rest[k])) rest.splice(k, 1);
      }
    }
    return { html: `<div class="wr-callout" data-kind="${kind}">${blocksToHtml(mdBlocks(rest)) || '<div><br></div>'}</div>`, next: i };
  }
  return { html: `<blockquote>${blocksToHtml(mdBlocks(inner)) || '<div><br></div>'}</blockquote>`, next: i };
}

function parseDetails(lines, start, m) {
  let i = start + 1;
  let title = '';
  const sm = SUMMARY_RE.exec(m[2] || '');
  if (sm) title = sm[1];
  else if ((m[2] || '').trim()) return null;
  else if (i < lines.length && SUMMARY_RE.test(lines[i])) { title = SUMMARY_RE.exec(lines[i])[1]; i++; }
  const body = [];
  let depth = 1;
  for (; i < lines.length; i++) {
    if (DETAILS_OPEN_RE.test(lines[i])) depth++;
    else if (DETAILS_CLOSE_RE.test(lines[i]) && --depth === 0) { i++; break; }
    body.push(lines[i]);
  }
  const t = escText(decodeEntities(title.trim()));
  const bodyHtml = blocksToHtml(mdBlocks(body)) || '<div><br></div>';
  return {
    html: `<div class="wr-toggle" data-open="true"><div class="wr-toggle-title">${t || '<br>'}</div><div class="wr-toggle-body">${bodyHtml}</div></div>`,
    next: i
  };
}

function parseTable(lines, start) {
  const header = splitRow(lines[start]);
  const cols = header.length;
  const cell = (c) => parseInline(c.replace(/\\\|/g, '|')) || '<br>';
  let html = '<table class="wr-table"><tbody><tr>' + header.map(c => `<th>${cell(c)}</th>`).join('') + '</tr>';
  let i = start + 2;
  while (i < lines.length && !isBlank(lines[i]) && lines[i].includes('|') && !isFence(lines[i]) && !/^ {0,3}>/.test(lines[i])) {
    const row = splitRow(lines[i]);
    html += '<tr>' + Array.from({ length: cols }, (_, k) => `<td>${cell(row[k] ?? '')}</td>`).join('') + '</tr>';
    i++;
  }
  return { html: html + '</tbody></table>', next: i };
}

// Lines -> [{ kind:'p', parts:[inlineHtml] } | { kind, html }]
let mdDepth = 0;
const MAX_MD_DEPTH = 48;  // nested quotes/lists/toggles deeper than this are read as plain lines
function mdBlocks(lines) {
  if (mdDepth >= MAX_MD_DEPTH) {
    const text = lines.filter(l => !isBlank(l));
    return text.length ? [{ kind: 'p', parts: text.map(l => parseInline(l.trim())) }] : [];
  }
  mdDepth++;
  try { return mdBlocksInner(lines); } finally { mdDepth--; }
}
function mdBlocksInner(lines) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (isBlank(l)) { i++; continue; }
    let m;
    if ((m = FENCE_RE.exec(l)) && isFence(l)) {
      const fence = m[2], ind = m[1].length;
      const lang = (m[3].trim().split(/\s+/)[0] || '').replace(/[^\w+#.-]/g, '').slice(0, 30);
      const body = [];
      i++;
      while (i < lines.length) {
        const cm = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(lines[i]);
        if (cm && cm[1][0] === fence[0] && cm[1].length >= fence.length) { i++; break; }
        body.push(lines[i].replace(new RegExp('^ {0,' + ind + '}'), ''));
        i++;
      }
      out.push({ kind: 'code', html: `<pre class="wr-code"${lang ? ` data-lang="${escAttr(lang)}"` : ''}><code>${escText(body.join('\n'))}</code></pre>` });
      continue;
    }
    if ((m = DETAILS_OPEN_RE.exec(l))) {
      const r = parseDetails(lines, i, m);
      if (r) { out.push({ kind: 'toggle', html: r.html }); i = r.next; continue; }
    }
    if ((m = ATX_RE.exec(l))) {
      const content = (m[2] || '').replace(/(?:^|[ \t]+)#+[ \t]*$/, '').trim();
      const level = Math.min(3, m[1].length);
      if (content) out.push({ kind: 'h', html: `<h${level}>${parseInline(content)}</h${level}>` });
      i++;
      continue;
    }
    if (HR_RE.test(l)) { out.push({ kind: 'hr', html: '<hr>' }); i++; continue; }
    if (/^ {0,3}>/.test(l)) { const r = parseQuote(lines, i); out.push({ kind: 'quote', html: r.html }); i = r.next; continue; }
    if (isTableStart(lines, i)) { const r = parseTable(lines, i); out.push({ kind: 'table', html: r.html }); i = r.next; continue; }
    if (listMarker(l)) { const r = parseList(lines, i); out.push({ kind: 'list', html: r.html }); i = r.next; continue; }
    const para = [l];
    i++;
    while (i < lines.length && !isBlank(lines[i]) && !isBlockStart(lines, i, true)) { para.push(lines[i]); i++; }
    out.push({ kind: 'p', parts: paragraphParts(para) });
  }
  return out;
}

// Convert Markdown (GFM subset) to canonical dashboard HTML: div lines, nested ul/ol, ul.checklist,
// pre.wr-code, table.wr-table, blockquote, GitHub alerts -> .wr-callout, <details> -> .wr-toggle,
// h1-h3, b/i/s/code/mark/u, safe links only. All other raw HTML is escaped, never passed through.
export function markdownToHtml(md) {
  const src = String(md ?? '').replace(/\r\n?/g, '\n').replace(PRIVATE_RE, '').replace(/\u0000/g, '�');
  const lines = src.split('\n').map(l => l.replace(/^[ \t]+/, w => w.replace(/\t/g, '    ')));
  return blocksToHtml(mdBlocks(lines));
}

/* ============================== sanitizer (allowlist) ============================== */

const SAN_DROP = new Set(['head', 'meta', 'link', 'base', 'input', 'button', 'select', 'option', 'optgroup',
  'textarea', 'canvas', 'video', 'audio', 'source', 'track', 'embed', 'object', 'iframe', 'frame', 'frameset',
  'map', 'area', 'param', 'script', 'style', 'template', 'noscript', 'svg', 'math', 'col', 'colgroup', 'caption',
  'wbr', 'datalist', 'output', 'progress', 'meter', 'title']);
// Classes saved content may carry: the dashboard's own, plus the writing blocks and chips. Never the
// writing UI's classes (wr-pop, wr-help, wr-focus...): pasted, they would turn into overlays in the doc
const SAN_CLASSES = new Set(['checklist', 'checked', 'text-highlight', 'project-task-highlight',
  'wr-callout', 'wr-toggle', 'wr-toggle-title', 'wr-toggle-body', 'wr-code', 'wr-table', 'wr-date', 'wr-ref']);
const SAN_DATA = new Set(['data-highlight-color', 'data-task-id', 'data-kind', 'data-open', 'data-lang',
  'data-date', 'data-ref-type', 'data-ref-id', 'data-r2-file-id']);
const HIGHLIGHT_COLORS = new Set(['yellow', 'green', 'blue', 'pink', 'purple']);
const CALLOUT_KINDS = new Set(['note', 'tip', 'decision', 'warning', 'caution']);
const TASK_STYLE_PROPS = ['background-color', 'border-bottom', 'border-bottom-color', 'color', 'cursor'];
const SAN_WS = /[ \t\n\r\f]+/g;
const isPlainDiv = (n) => isEl(n, 'div') && !Object.keys(n.attrs).length;

function cleanDataValue(k, v) {
  const s = String(v ?? '').slice(0, 300);
  switch (k) {
    case 'data-highlight-color': case 'data-kind': return /^[a-z-]{1,20}$/.test(s) ? s : null;
    case 'data-open': return s === 'true' || s === 'false' ? s : null;
    case 'data-lang': return /^[\w+#.-]{1,30}$/.test(s) ? s : null;
    case 'data-date': return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
    case 'data-ref-type': return /^(project|meeting|idea)$/.test(s) ? s : null;
    default: return s;
  }
}
function sanAttrs(n) {
  const out = {};
  const cls = [...new Set(classesOf(n).filter(c => SAN_CLASSES.has(c)))];
  if (cls.length) out.class = cls.join(' ');
  for (const [k, v] of Object.entries(n.attrs)) {
    if (!SAN_DATA.has(k)) continue;
    const val = cleanDataValue(k, v);
    if (val !== null) out[k] = val;
  }
  return out;
}
// Keep only allowed properties with harmless values (task pill colors)
function filterStyle(style, props) {
  const parts = [];
  for (const prop of props) {
    const v = styleProp(style, prop);
    if (v && !/url\(|expression|javascript|[\\<>@]/i.test(v)) parts.push(`${prop}: ${v};`);
  }
  return parts.join(' ');
}
// Real content: visible text, an image/line break/rule or a chip
function hasContent(kids) {
  return kids.some(k => (k.type === 'text' ? /\S/.test(k.text) : (['img', 'br', 'hr'].includes(k.tag) ||
    CHIP_CLASSES.some(c => hasClass(k, c)) || hasContent(k.children))));
}

// Tidy a sanitized child list: flatten plain divs that only wrap blocks, merge neighbors, and trim
// whitespace that touches block boundaries (the note viewer is white-space: pre-wrap)
function sanFinish(kids, parent, keepWs) {
  let list = [];
  for (const k of kids) {
    if (isPlainDiv(k) && k.children.length && k.children.every(isBlockNode)) list.push(...k.children);
    else list.push(k);
  }
  list = mergeAdjacent(list);
  if (parent !== '#root' && !BLOCK_TAGS.has(parent)) return list;
  const out = [];
  list.forEach((c, k) => {
    const prev = list[k - 1], next = list[k + 1];
    if (isEl(c, 'br') && prev && isBlockNode(prev) && (!next || isBlockNode(next))) {
      // Blank-line spacer between blocks (Google Docs): canonical empty line, or nothing at the end
      if (next) out.push(el('div', {}, [el('br')]));
      return;
    }
    if (c.type !== 'text' || keepWs) { out.push(c); return; }
    let t = c.text;
    if (!prev || isBlockNode(prev) || isEl(prev, 'br')) t = t.replace(/^[ \t\n\r\f]+/, '');
    if (!next || isBlockNode(next) || isEl(next, 'br')) t = t.replace(/[ \t\n\r\f]+$/, '');
    if (t) out.push(txt(t));
  });
  return out;
}

function sanKids(nodes, ctx) {
  const out = [];
  for (const c of nodes) {
    if (c.type === 'text') out.push(txt(ctx.keepWs ? c.text : c.text.replace(SAN_WS, ' ')));
    else out.push(...sanElement(c, ctx));
  }
  return sanFinish(out, ctx.parent, ctx.keepWs);
}

function sanTable(n, ctx) {
  const rows = [];
  const collect = (node) => {
    for (const c of node.children) {
      if (c.type !== 'element' || SAN_DROP.has(c.tag)) continue;
      if (c.tag === 'tr') rows.push(c); else if (c.tag !== 'table' && c.tag !== 'td' && c.tag !== 'th') collect(c);
    }
  };
  if (n.tag === 'tr') rows.push(n); else collect(n);
  const outRows = [];
  for (const r of rows) {
    const cells = [];
    for (const c of r.children) {
      if (!isEl(c, 'td') && !isEl(c, 'th')) continue;
      let kids = sanKids(c.children, { ...ctx, parent: c.tag });
      if (kids.length === 1 && isPlainDiv(kids[0])) kids = kids[0].children;
      cells.push(el(c.tag, {}, kids.length ? kids : [el('br')]));
    }
    if (cells.length) outRows.push(el('tr', {}, cells));
  }
  return outRows.length ? [el('table', { class: 'wr-table' }, [el('tbody', {}, outRows)])] : [];
}

function sanElement(n, ctx) {
  const tag = n.tag, a = n.attrs, cls = classesOf(n);
  if (isEphemeral(n) || SAN_DROP.has(tag)) return [];
  const kids = (parent, extra) => sanKids(n.children, { ...ctx, ...extra, parent });
  const inline = (t, attrs = {}, extra) => {
    const k = kids(t, extra);
    return hasContent(k) ? wrapInline(t, attrs, k) : k;
  };
  const block = (t, attrs = {}) => { const k = kids(t); return k.length ? [el(t, attrs, k)] : []; };

  if (tag === 'html' || tag === 'body' || cls.includes('editor-img-resize-wrap')) return kids(ctx.parent);
  const chip = CHIP_CLASSES.find(c => cls.includes(c));
  if (chip) {
    const text = textOf(n).replace(SAN_WS, ' ');
    if (!text.trim()) return [];
    const attrs = sanAttrs(n);
    attrs.contenteditable = 'false';
    if (chip === 'project-task-highlight') { const st = filterStyle(a.style, TASK_STYLE_PROPS); if (st) attrs.style = st; }
    return [el('span', attrs, [txt(text)])];
  }
  switch (tag) {
    case 'b': case 'strong': return isNormalWeight(a.style) ? kids(ctx.parent) : inline('b');
    case 'i': case 'em': case 'cite': case 'dfn': case 'var': return inline('i');
    case 'u': case 'ins': return inline('u');
    case 's': case 'strike': case 'del': return inline('s');
    case 'mark': {
      const c = a['data-highlight-color'];
      return inline('mark', { class: 'text-highlight', 'data-highlight-color': HIGHLIGHT_COLORS.has(c) ? c : 'yellow' });
    }
    case 'code': case 'kbd': case 'samp': case 'tt': {
      const t = textOf(n).replace(SAN_WS, ' ');
      return t ? [el('code', {}, [txt(t)])] : [];
    }
    case 'pre': {
      const lang = langOf(n);
      const t = preText(n);
      return [el('pre', lang ? { class: 'wr-code', 'data-lang': lang } : { class: 'wr-code' }, [el('code', {}, t ? [txt(t)] : [])])];
    }
    case 'a': {
      const href = cleanUrl(a.href);
      if (!a.href || !isSafeUrl(href)) return kids(ctx.parent, { inLink: ctx.inLink });
      return inline('a', href[0] === '#' ? { href } : { href, target: '_blank', rel: 'noopener noreferrer' }, { inLink: true });
    }
    case 'img': {
      const id = a['data-r2-file-id'];
      const src = cleanUrl(a.src);
      const okSrc = /^(https?:\/\/|blob:|data:image\/)/i.test(src);
      if (!id && !okSrc) return [];
      const attrs = {};
      if (id) attrs['data-r2-file-id'] = cleanDataValue('data-r2-file-id', id);
      attrs.alt = a.alt || '';
      if (!id) attrs.src = src;
      const w = styleProp(a.style, 'width') || (/^\d+$/.test(a.width || '') ? a.width + 'px' : '');
      if (/^\d+(\.\d+)?(px|%|em|rem)$/.test(w)) attrs.style = `width: ${w};`;
      return [el('img', attrs)];
    }
    case 'br': return cls.includes('Apple-interchange-newline') ? [] : [el('br')];
    case 'hr': return [el('hr')];
    case 'ul': case 'ol': {
      const out = [];
      let run = [];
      const flush = () => { if (hasContent(run)) out.push(el('li', {}, run)); run = []; };
      for (const k of kids(tag)) {
        if (isEl(k, 'li') || isEl(k, 'ul') || isEl(k, 'ol')) { flush(); out.push(k); } else run.push(k);
      }
      flush();
      return out.length ? [el(tag, tag === 'ul' && cls.includes('checklist') ? { class: 'checklist' } : {}, out)] : [];
    }
    case 'li': {
      if (ctx.parent !== 'ul' && ctx.parent !== 'ol') return block('div');
      let k = kids('li');
      if (k.length === 1 && isPlainDiv(k[0])) k = k[0].children;
      return k.length ? [el('li', cls.includes('checked') ? { class: 'checked' } : {}, k)] : [];
    }
    case 'blockquote': return block('blockquote');
    case 'h1': case 'h2': case 'h3': return block(tag);
    case 'h4': case 'h5': case 'h6': return block('h3');
    case 'table': case 'thead': case 'tbody': case 'tfoot': case 'tr': return sanTable(n, ctx);
    case 'details': {
      const summary = n.children.find(c => isEl(c, 'summary'));
      const title = summary ? sanKids(summary.children, { ...ctx, parent: 'div' }) : [];
      let body = sanKids(n.children.filter(c => c !== summary), { ...ctx, parent: 'div' });
      if (body.length && !body.some(isBlockNode)) body = [el('div', {}, body)];
      return [el('div', { class: 'wr-toggle', 'data-open': 'open' in a ? 'true' : 'false' }, [
        el('div', { class: 'wr-toggle-title' }, title.length ? title : [el('br')]),
        el('div', { class: 'wr-toggle-body' }, body.length ? body : [el('div', {}, [el('br')])])
      ])];
    }
    case 'span': case 'font': {
      const marks = styleMarks(a.style, ctx.inLink);
      const attrs = sanAttrs(n);
      let k = kids(ctx.parent === '#root' || BLOCK_TAGS.has(ctx.parent) ? 'span' : ctx.parent);
      for (let m = marks.length - 1; m >= 0; m--) if (hasContent(k)) k = wrapInline(marks[m], {}, k);
      return attrs.class && hasContent(k) ? [el('span', attrs, k)] : k;
    }
    case 'div': case 'p': {
      const attrs = tag === 'div' ? sanAttrs(n) : {};
      const c = (attrs.class || '').split(' ');
      for (const k of Object.keys(attrs)) if (k !== 'class' && k !== 'data-kind' && k !== 'data-open') delete attrs[k];
      if (c.includes('wr-callout')) attrs['data-kind'] = CALLOUT_KINDS.has(attrs['data-kind']) ? attrs['data-kind'] : 'note';
      else delete attrs['data-kind'];
      if (c.includes('wr-toggle')) attrs['data-open'] = attrs['data-open'] === 'false' ? 'false' : 'true';
      else delete attrs['data-open'];
      return block('div', attrs);
    }
    default:
      return BLOCK_TAGS.has(tag) ? block('div') : kids(ctx.parent);
  }
}

// Allowlist sanitizer for pasted / imported / untrusted HTML (spec 7.4). Output is canonical compact
// dashboard HTML: allowed tags only (p->div, strong->b, em->i, strike/del->s, h4-h6->h3), known content
// classes (SAN_CLASSES), known data-* attributes, safe links (target/rel added), images with an R2 id or a
// safe src, tables as table.wr-table>tbody, code as pre.wr-code>code. Never on* or javascript:.
// opts.keepWhitespace keeps text whitespace as it is (stored notes are shown white-space: pre-wrap, so
// their newlines and indents are content); a paste collapses it the way a browser would.
export function sanitizeRichHtml(html, opts = {}) {
  return serializeHtml(sanKids(parseHtml(html), { parent: '#root', inLink: false, keepWs: !!opts.keepWhitespace }));
}

// Start tags as the browser's tokenizer reads them (innerHTML of a div: the data state). Comments,
// doctypes and bogus comments are skipped, end tags are stepped over, a quoted value may hold '>' or
// '<', and a quote inside an attribute name or an unquoted value is literal, like the spec's tag
// states. Text between tags is never markup, so code, prose or escaped HTML in a note can't pass for
// an attribute. Calls visit(tag, attrs, source) for each start tag (lowercase tag; attrs = [[lowercase
// name, raw value or null]]; source = the tag's own text, '<' to '>') and returns true as soon as
// visit does. Elements whose content the tokenizer
// reads another way (script, style, textarea, title, plaintext, svg, math...) always count as risky,
// so the scan never has to follow what is inside them. An unterminated last tag (the browser drops
// it) is still visited.
const RAW_CONTENT_TAGS = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes',
  'noscript', 'plaintext', 'svg', 'math']);
const isTagWs = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\f' || c === '\r';
const isAsciiAlpha = (c) => !!c && /^[a-zA-Z]$/.test(c);
export function htmlHasRiskyStartTag(html, visit) {
  const src = String(html ?? '');
  const n = src.length;
  let i = 0;
  for (;;) {
    i = src.indexOf('<', i);
    if (i < 0) return false;
    const c = src[i + 1];
    if (c === '!' && src.startsWith('<!--', i)) {
      // Comment: <!--> and <!---> end at once, otherwise at the first --> or --!> (or the end)
      if (src[i + 4] === '>') { i += 5; continue; }
      if (src.startsWith('->', i + 4)) { i += 6; continue; }
      const a = src.indexOf('-->', i + 4), b = src.indexOf('--!>', i + 4);
      if (a < 0 && b < 0) return false;
      i = a >= 0 && (b < 0 || a < b) ? a + 3 : b + 4;
      continue;
    }
    const endTag = c === '/' && isAsciiAlpha(src[i + 2]);
    if (c === '/' && src[i + 2] === '>') { i += 3; continue; }
    if (c === '!' || c === '?' || (c === '/' && !endTag)) {
      // Doctype, CDATA (bogus outside svg/math), <?...>, </3...>: a bogus comment up to the first '>'
      const e = src.indexOf('>', i + 2);
      if (e < 0) return false;
      i = e + 1;
      continue;
    }
    if (!endTag && !isAsciiAlpha(c)) { i++; continue; }  // a literal '<'
    let j = i + (endTag ? 2 : 1);
    const nameStart = j;
    while (j < n && !isTagWs(src[j]) && src[j] !== '/' && src[j] !== '>') j++;
    const tag = src.slice(nameStart, j).toLowerCase();
    const attrs = [];
    while (j < n) {
      const ch = src[j];
      if (isTagWs(ch) || ch === '/') { j++; continue; }  // a '/' that doesn't close the tag is ignored
      if (ch === '>') { j++; break; }
      // Attribute name: its first character may be '='; quotes and '<' are part of it
      const a = j++;
      while (j < n && !isTagWs(src[j]) && src[j] !== '/' && src[j] !== '>' && src[j] !== '=') j++;
      const name = src.slice(a, j).toLowerCase();
      while (j < n && isTagWs(src[j])) j++;
      let value = null;
      if (src[j] === '=') {
        j++;
        while (j < n && isTagWs(src[j])) j++;
        const q = src[j];
        if (q === '"' || q === "'") {
          const e = src.indexOf(q, j + 1);
          value = src.slice(j + 1, e < 0 ? n : e);
          j = e < 0 ? n : e + 1;
        } else if (q === '>') {
          value = '';  // missing value: the '>' closes the tag
        } else {
          const b = j;
          while (j < n && !isTagWs(src[j]) && src[j] !== '>') j++;
          value = src.slice(b, j);
        }
      }
      attrs.push([name, value]);
    }
    if (!endTag && (RAW_CONTENT_TAGS.has(tag) || visit(tag, attrs, src.slice(i, j)))) return true;
    i = j;
  }
}

// Stored rich text (backup import, cloud profile, localStorage) is shown with innerHTML, so markup that
// could run script or cover the page goes through the sanitizer first: active tags, on* handlers, script
// or HTML URLs (also entity-encoded or split by tabs / newlines), positioning styles and the writing
// UI's classes. Attributes are read only inside start tags, tokenized like the browser does
// (htmlHasRiskyStartTag), so text that merely looks like markup ('const onLoad =' in a plain-text
// note, an escaped '&lt;a onclick=') never triggers. To err on the side of cleaning, active tags are
// also looked for in the raw string, and anything that reads like a handler anywhere inside a start
// tag counts too (<img/src=x/onerror=...> is only a src for the browser, but it's no content anyone
// wrote). Everything else is returned untouched, so canonical and
// legacy content stays byte-identical, and a cleaned field keeps its text whitespace (legacy
// plain-text notes are shown white-space: pre-wrap: their newlines and indents are content).
const STORED_TAG_RE = /<\/?(?:script|iframe|frame|frameset|object|embed|applet|portal|style|svg|math|link|meta|base|form)(?![\w-])/i;
// Inside a start tag's text: a handler-like name after whitespace, '/' or a quote
const STORED_HANDLER_RE = /[\s\/"']on[a-z]+\s*=/i;
// Attributes whose value is checked (an xlink: style prefix is ignored)
const STORED_ATTR_RE = /^(?:[\w-]+:)?(class|style|href|src|srcset|action|formaction|data|background|poster|ping|cite|codebase)$/;
const STORED_CSS_RE = /(?:^|;)position:(?!(?:relative|static)(?:;|!|$))|\\|expression\(|(?:^|;)behavior:|binding:/;
const STORED_URL_RE = /(?:java|vb|live)script:|data:text\/html/i;
// Character references as the browser reads them (&Tab;, &NewLine; and zero-padded numbers too)
const decodeAttr = (s) => decodeEntities(s.replace(/&(?:tab|newline);/gi, ' ').replace(/&#(x?)0+(?=[0-9a-f])/gi, '&#$1'));
function riskyStoredAttr([attr, raw]) {
  if (attr.startsWith('on')) return true;  // an event handler, with or without a value
  const m = raw == null ? null : STORED_ATTR_RE.exec(attr);
  if (!m) return false;
  const value = decodeAttr(raw);
  if (m[1] === 'class') return value.split(/\s+/).some(c => c.startsWith('wr-') && !SAN_CLASSES.has(c));
  if (m[1] === 'style') {
    const css = value.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, '').toLowerCase();
    return STORED_CSS_RE.test(css) || STORED_URL_RE.test(css);
  }
  // URL parsers drop tabs and newlines anywhere (and controls / spaces at the ends)
  return STORED_URL_RE.test(value.replace(/[\x00-\x20\x7f-\x9f]+/g, ''));
}
function storedHtmlNeedsSanitizing(html) {
  return STORED_TAG_RE.test(html) ||
    htmlHasRiskyStartTag(html, (tag, attrs, source) => STORED_HANDLER_RE.test(source) || attrs.some(riskyStoredAttr));
}
export function sanitizeStoredHtml(html) {
  if (typeof html !== 'string' || !html) return html;
  return storedHtmlNeedsSanitizing(html) ? sanitizeRichHtml(html, { keepWhitespace: true }) : html;
}

/* ============================== plain text, stats, detection ============================== */

// Plain text with block-aware newlines (search, stats, previews). Lists/tables keep one item per line;
// table cells are tab-separated; closed toggles are included. opts.markers adds '- ', '1. ', '[ ] '.
export function htmlToPlainText(html, opts = {}) {
  const lines = [''];
  let pre = 0;
  const last = () => lines[lines.length - 1];
  const setLast = (s) => { lines[lines.length - 1] = s; };
  const newline = () => { if (!pre) setLast(last().replace(/ +$/, '')); lines.push(''); };
  const breakLine = () => { if (last().trim()) newline(); else setLast(''); };
  const add = (t) => {
    if (!t) return;
    t = t.replace(/[​﻿]/g, '').replace(/ /g, ' ');
    if (pre) { t.split('\n').forEach((p, k) => { if (k) lines.push(''); setLast(last() + p); }); return; }
    t = collapseWs(t);
    if (!last() || last().endsWith(' ')) t = t.replace(/^ +/, '');
    setLast(last() + t);
  };
  const walk = (nodes, list) => {
    for (const n of nodes) {
      if (n.type === 'text') { add(n.text); continue; }
      if (isEphemeral(n)) continue;
      const tag = n.tag;
      if (tag === 'br') { if (pre) add('\n'); else newline(); continue; }
      if (tag === 'img') { if (opts.markers) add('[image' + (n.attrs.alt ? ': ' + n.attrs.alt : '') + ']'); continue; }
      if (tag === 'table') {
        breakLine();
        const rows = [];
        const collect = (x) => { for (const c of x.children) { if (isEl(c, 'tr')) rows.push(c); else if (c.type === 'element' && c.tag !== 'table') collect(c); } };
        collect(n);
        for (const r of rows) {
          const cells = r.children.filter(c => isEl(c, 'td') || isEl(c, 'th'))
            .map(c => htmlToPlainText(serializeHtml(c.children), opts).replace(/\s*\n\s*/g, ' '));
          setLast(cells.join('\t'));
          lines.push('');
        }
        continue;
      }
      if (tag === 'pre') { breakLine(); pre++; walk(n.children, list); pre--; breakLine(); continue; }
      if (tag === 'ul' || tag === 'ol') {
        breakLine();
        walk(n.children, { ordered: tag === 'ol', check: hasClass(n, 'checklist'), num: 1, depth: list ? list.depth + 1 : 0 });
        breakLine();
        continue;
      }
      if (tag === 'li') {
        breakLine();
        if (opts.markers && list) {
          const mark = list.check ? (hasClass(n, 'checked') ? '[x] ' : '[ ] ') : list.ordered ? `${list.num++}. ` : '- ';
          setLast('  '.repeat(list.depth) + mark);
        }
        walk(n.children, list);
        breakLine();
        continue;
      }
      if (BLOCK_TAGS.has(tag)) { breakLine(); walk(n.children, list); breakLine(); continue; }
      walk(n.children, list);
    }
  };
  walk(parseHtml(html), null);
  return lines.map(l => l.replace(/[ ]+$/, '')).join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\s+$/g, '');
}

const CJK_RE = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/g;
// Word / character counts and reading time (230 wpm, at least 1 minute when there are words).
// Each CJK character counts as a word.
export function textStats(text) {
  const s = String(text ?? '').replace(/[​﻿]/g, '');
  const cjk = s.match(CJK_RE) || [];
  const words = s.replace(CJK_RE, ' ').split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length + cjk.length;
  return {
    words,
    chars: [...s.replace(/[\r\n]/g, '')].length,
    charsNoSpaces: [...s.replace(/\s/g, '')].length,
    readingMinutes: words ? Math.max(1, Math.ceil(words / 230)) : 0
  };
}

// Heuristic for pasted plain text: 2+ distinct Markdown patterns, or a fenced block / table alone
export function looksLikeMarkdown(text) {
  const s = String(text ?? '').replace(/\r\n?/g, '\n');
  if (!s.trim()) return false;
  const lines = s.split('\n');
  if (lines.filter(l => /^\s{0,3}(```|~~~)/.test(l)).length >= 2) return true;
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].includes('|') && lines[i + 1].includes('|') && lines[i + 1].includes('-') && TABLE_DELIM_RE.test(lines[i + 1])) return true;
  }
  const kinds = new Set();
  for (const l of lines) {
    if (/^\s{0,3}#{1,6}\s+\S/.test(l)) kinds.add('heading');
    if (/^\s*[-*+]\s+\[[ xX]\]\s/.test(l)) kinds.add('task');
    if (/^\s*[-*+]\s+\S/.test(l)) kinds.add('bullet');
    if (/^\s*\d{1,9}[.)]\s+\S/.test(l)) kinds.add('ordered');
    if (/^\s{0,3}>\s/.test(l)) kinds.add('quote');
    if (/^\s{0,3}```/.test(l)) kinds.add('fence');
  }
  if (/\*\*[^*\s](?:[^*\n]*[^*\s])?\*\*/.test(s)) kinds.add('bold');
  if (/\[[^\]\n]+\]\((?:https?:\/\/|mailto:)[^)\s]+\)/.test(s)) kinds.add('link');
  if (/~~[^~\s](?:[^~\n]*[^~\s])?~~/.test(s)) kinds.add('strike');
  if (/(^|[^`])`[^`\n]+`(?!`)/.test(s)) kinds.add('code');
  if (/==[^=\s](?:[^=\n]*[^=\s])?==/.test(s)) kinds.add('highlight');
  return kinds.size >= 2;
}
