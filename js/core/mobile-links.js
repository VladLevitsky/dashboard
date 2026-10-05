// Personal Dashboard - Mobile shell: Links and Search rules (pure, Node-testable)
// What the phone's Links tab and Search screen need to know about cards:
//   - normalizeGroups(cardData): a card's sections in render order, tolerant of
//     legacy array groups and missing arrays, WITHOUT mutating the model (the
//     desktop renderer normalises in place; a shell render never saves)
//   - cardSummary(cardData): what a collapsed card header shows (mini icon
//     thumbs, or counts such as "1 reminder · 9 links")
//   - labelForIcon(icon) / iconLabels(icons): readable names for icon tiles
//     (none of the real icons has a title), from the title, a file name, the
//     asset logo name, a host alias table, the tenant or the registrable name
//   - searchAll(query, sources): one accent / case folded, multi-word AND search
//     over tasks, writing, card items, card titles and completed tasks
// No DOM access; never reads an icon ref as a string unless it is one (R2
// refs are objects: { type: 'r2', fileId }).

import { htmlToPlainText } from './markdown.js';
import { orderCardsForMobile, cardTitle } from './mobile-common.js';

const KINDS = ['icons', 'reminders', 'subtasks', 'copyPaste'];
const PLACEHOLDER_URL = 'https://telcobridges.com';   // constants.js: "no link" (constants.js is not Node-safe)

// --- Groups ------------------------------------------------------------------

// The same detection the desktop renderer runs on old array-shaped groups
// (sections.js renderUnifiedCard), but into fresh arrays
function legacyGroup(items) {
  const g = { icons: [], reminders: [], subtasks: [], copyPaste: [] };
  const first = items.find(i => i && typeof i === 'object');
  if (!first) return g;
  const list = items.filter(i => i && typeof i === 'object');
  if (first.type === 'days' || first.type === 'interval' || first.schedule !== undefined || first.mode === 'calendar' || first.mode === 'interval') g.reminders = list;
  else if (first.copyText !== undefined) g.copyPaste = list;
  else if (first.icon !== undefined) g.icons = list;
  else if (first.text !== undefined) g.subtasks = list;
  else if (first.title !== undefined || first.name !== undefined) g.reminders = list;
  return g;
}

// → [{ subtitle, icons, reminders, subtasks, copyPaste, legacy? }] with
// '_default' first, then the stored key order. The item objects are the live
// ones (handlers on card items close over them); the arrays are new.
export function normalizeGroups(cardData) {
  if (!cardData || typeof cardData !== 'object' || Array.isArray(cardData)) return [];
  const keys = Object.keys(cardData);
  const ordered = keys.includes('_default') ? ['_default', ...keys.filter(k => k !== '_default')] : keys;
  return ordered.map(subtitle => {
    const raw = cardData[subtitle];
    if (Array.isArray(raw)) return { subtitle, ...legacyGroup(raw), legacy: true };
    const g = { subtitle };
    KINDS.forEach(kind => {
      const list = raw && typeof raw === 'object' && Array.isArray(raw[kind]) ? raw[kind] : [];
      g[kind] = list.filter(i => i && typeof i === 'object');
    });
    return g;
  });
}

export function groupIsEmpty(g) {
  return !g || KINDS.every(kind => !g[kind] || g[kind].length === 0);
}

// A copy-paste value that is a colour (utils.js isColorCode; utils.js is not Node-safe)
export function isColorCode(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.trim();
  if (/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(t)) return true;
  if (/^rgba?\s*\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*[\d.]+)?\s*\)$/i.test(t)) return true;
  if (/^hsla?\s*\(\s*\d{1,3}\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%\s*(,\s*[\d.]+)?\s*\)$/i.test(t)) return true;
  return false;
}

export function isSwatch(item) {
  return !!item && isColorCode(String(item.copyText || '').trim());
}

const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

// What a collapsed card header says about the card.
// → { icons, reminders, links, snippets, colors, thumbs: [icon], more, text, label, empty }
//   thumbs: up to 4 icons (dividers skipped) for icon cards; text: the counts
//   that are not icons ("7 snippets · 7 colors", "1 reminder · 9 links");
//   label: everything, for screen readers and the header's title
export function cardSummary(cardData, { thumbs: maxThumbs = 4 } = {}) {
  const groups = normalizeGroups(cardData);
  const icons = [];
  let reminders = 0, links = 0, snippets = 0, colors = 0;
  groups.forEach(g => {
    g.icons.forEach(i => { if (!i.isDivider) icons.push(i); });
    reminders += g.reminders.length;
    links += g.subtasks.length;
    g.copyPaste.forEach(c => { if (isSwatch(c)) colors++; else snippets++; });
  });
  const parts = [];
  if (reminders) parts.push(plural(reminders, 'reminder'));
  if (links) parts.push(plural(links, 'link'));
  if (snippets) parts.push(plural(snippets, 'snippet'));
  if (colors) parts.push(plural(colors, 'color'));
  const thumbs = icons.slice(0, maxThumbs);
  const empty = icons.length === 0 && parts.length === 0;
  const label = [icons.length ? plural(icons.length, 'icon') : null, ...parts].filter(Boolean).join(' · ') || 'Empty';
  return {
    icons: icons.length, reminders, links, snippets, colors,
    thumbs, more: icons.length - thumbs.length,
    text: parts.join(' · ') || (icons.length ? '' : 'Empty'),
    parts: parts.length ? parts : (icons.length ? [] : ['Empty']),
    label, empty,
  };
}

// How many whole summary pieces fit in a collapsed header (nothing is ever
// shown cut in half). Thumbs: the most k of `count` thumbs (each thumbW wide)
// that fit with a "+N" (N = more + the folded thumbs, moreW wide) after them;
// 0 when not even one fits. Text parts: the leading parts that fit.
export function fitThumbs({ count = 0, more = 0, thumbW = 20, moreW = 0, gap = 4, avail = 0 } = {}) {
  for (let k = count; k > 0; k--) {
    const tail = (count - k + more) > 0 ? gap + moreW : 0;
    if (k * thumbW + (k - 1) * gap + tail <= avail + 0.5) return k;
  }
  return 0;
}

export function fitParts(widths = [], { gap = 0, avail = 0 } = {}) {
  let used = 0;
  for (let j = 0; j < widths.length; j++) {
    used += (j ? gap : 0) + (Number(widths[j]) || 0);
    if (used > avail + 0.5) return j;
  }
  return widths.length;
}

// What a card's item indicators show about tasks: how many tasks link each
// item (task ids, order and unrelated tasks don't matter). With a sectionId,
// only that card's items. Same reading as tasks.js getLinkedItems.
export function linkedRefsSig(tasks, sectionId = null) {
  const counts = new Map();
  (Array.isArray(tasks) ? tasks : []).forEach(t => {
    if (!t || typeof t !== 'object') return;
    const refs = Array.isArray(t.linkedItems) && t.linkedItems.length ? t.linkedItems : (t.linkedItem ? [t.linkedItem] : []);
    refs.forEach(r => {
      if (!r || typeof r !== 'object') return;
      if (sectionId != null && r.sectionId !== sectionId) return;
      const k = `${r.type}:${r.sectionId}:${r.key}`;
      counts.set(k, (counts.get(k) || 0) + 1);
    });
  });
  return [...counts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([k, n]) => `${k}=${n}`).join(',');
}

// The local calendar day (YYYY-MM-DD), never via toISOString
export function localDayKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// --- Icon labels -----------------------------------------------------------------

const GENERIC_ASSET = /^(content[ _]creation|daily[ _]tools?|icon|logo|image)[ _-]?\d*$/i;

// host (+ optional path prefix) → label. '*.' = any subdomain; '*/' = any host
const HOST_ALIASES = [
  ['mail.google.com', 'Gmail'],
  ['tagmanager.google.com', 'Tag Manager'],
  ['ads.google.com', 'Google Ads'],
  ['analytics.google.com', 'Analytics'],
  ['search.google.com', 'Search Console'],
  ['lookerstudio.google.com', 'Looker Studio'],
  ['drive.google.com', 'Drive'],
  ['docs.google.com/spreadsheets', 'Sheets'],
  ['docs.google.com/document', 'Docs'],
  ['docs.google.com/presentation', 'Slides'],
  ['studio.youtube.com', 'YT Studio'],
  ['*.atlassian.net/jira', 'Jira'],
  ['*.atlassian.net/wiki', 'Confluence'],
  ['*.lightning.force.com', 'Salesforce'],
  ['*.my.salesforce.com', 'Salesforce'],
  ['*/wp-admin', 'WordPress'],
  ['claude.ai', 'Claude'],
  ['chatgpt.com', 'ChatGPT'],
  ['vault.bitwarden.com', 'Bitwarden'],
  ['aws.amazon.com', 'AWS'],
  ['adsmanager.facebook.com', 'Ads Manager'],
  ['business.facebook.com', 'Meta Business'],
  ['ads.x.com', 'X Ads'],
  ['x.com', 'X'],
  ['ads.tiktok.com', 'TikTok Ads'],
  ['tiktok.com', 'TikTok'],
  ['clip.opus.pro', 'Opus Clip'],
  ['canva.com', 'Canva'],
  ['midjourney.com', 'Midjourney'],
  ['linkedin.com/campaignmanager', 'LinkedIn Ads'],
  ['linkedin.com', 'LinkedIn'],
].map(([pattern, label]) => {
  const slash = pattern.indexOf('/');
  const host = slash < 0 ? pattern : pattern.slice(0, slash);
  const path = slash < 0 ? '' : pattern.slice(slash);
  return { pattern, label, host, path };
}).sort((a, b) => b.pattern.length - a.pattern.length);   // longest first

const TENANT_SUFFIXES = ['.my.site.com', '.zendesk.com', '.atlassian.net'];
const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gov', 'ac', 'edu']);

const capitalise = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// → { host (lowercase, no www., no port), path (lowercase), ipv4, rawHost } | null
export function parseUrl(url) {
  if (typeof url !== 'string') return null;
  const raw = url.trim();
  if (!raw) return null;
  // host:port without a scheme (example.com:8080/x, localhost:3000) is a
  // host, not a URI scheme like mailto: or tel:
  const hostPort = /^(?:localhost|(?:[a-z0-9-]+\.)+[a-z0-9-]+):\d+(?:[/?#]|$)/i.test(raw);
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw
    : (!hostPort && /^[a-z][a-z0-9+.-]*:/i.test(raw) ? null : `https://${raw}`);
  if (!withScheme) return null;
  const m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?([^/?#:]+)(?::\d+)?([^?#]*)/i.exec(withScheme);
  if (!m) return null;
  const rawHost = m[1].toLowerCase();
  const host = rawHost.replace(/^www\./, '');
  const path = (m[2] || '').toLowerCase();
  return { host, path, rawHost, ipv4: /^\d{1,3}(\.\d{1,3}){3}$/.test(host) };
}

function hostMatches(host, pattern) {
  if (pattern === '*') return true;
  if (pattern.startsWith('*.')) return host.endsWith(pattern.slice(1));
  return host === pattern || host.endsWith('.' + pattern);
}

function pathMatches(path, prefix) {
  if (!prefix) return true;
  return path === prefix || path.startsWith(prefix + '/');
}

function aliasFor(parsed) {
  if (!parsed || parsed.ipv4) return null;
  const hit = HOST_ALIASES.find(a => hostMatches(parsed.host, a.host) && pathMatches(parsed.path, a.path));
  return hit ? hit.label : null;
}

function tenantFor(host) {
  const suffix = TENANT_SUFFIXES.find(s => host.endsWith(s) && host.length > s.length);
  if (!suffix) return null;
  const labels = host.slice(0, -suffix.length).split('.');
  return capitalise(labels[labels.length - 1]);
}

function registrableName(host) {
  const labels = host.split('.').filter(Boolean);
  if (labels.length === 0) return null;
  if (labels.length === 1) return capitalise(labels[0]);
  let i = labels.length - 2;                                  // drop the TLD
  if (labels.length >= 3 && labels[labels.length - 1].length === 2 && SECOND_LEVEL.has(labels[i])) i--;   // a.co.uk
  return capitalise(labels[i]);
}

function assetLogoName(ref) {
  let src = null;
  if (typeof ref === 'string') src = ref;
  else if (ref && typeof ref === 'object' && ref.type === 'asset' && typeof ref.src === 'string') src = ref.src;
  if (!src) return null;
  const m = /^(?:\.\/)?assets\/logos\/([^/]+)\.[a-z0-9]+$/i.exec(src.trim());
  if (!m) return null;
  let name = m[1];
  try { name = decodeURIComponent(name); } catch { /* keep as written */ }
  if (GENERIC_ASSET.test(name)) return null;
  return name.replace(/_/g, ' ').replace(/\s+/g, ' ').trim() || null;
}

function stripExtension(name) {
  const s = String(name || '').trim();
  const dot = s.lastIndexOf('.');
  return dot > 0 ? s.slice(0, dot) : s;
}

// The readable name of one icon tile. First match wins.
export function labelForIcon(icon) {
  if (!icon || typeof icon !== 'object') return 'Link';
  if (icon.isDivider) return '';
  if (typeof icon.title === 'string' && icon.title.trim()) return icon.title.trim();
  if (icon.linkType === 'file' && icon.fileName) {
    const name = stripExtension(icon.fileName);
    if (name) return name;
  }
  const logo = assetLogoName(icon.icon);
  if (logo) return logo;
  const parsed = parseUrl(icon.url);
  if (parsed && icon.url !== PLACEHOLDER_URL) {
    const alias = aliasFor(parsed);
    if (alias) return alias;
    const tenant = tenantFor(parsed.host);
    if (tenant) return tenant;
    if (parsed.ipv4) return parsed.host;
    const reg = registrableName(parsed.host);
    if (reg) return reg;
  }
  return 'Link';
}

// The host an icon points at ('' when none): searched with the label
export function iconHost(icon) {
  if (!icon || icon.isDivider || icon.url === PLACEHOLDER_URL) return '';
  const parsed = parseUrl(icon.url);
  return parsed ? parsed.host : '';
}

function firstPathSegment(url) {
  const parsed = parseUrl(url);
  if (!parsed) return '';
  return parsed.path.split('/').filter(Boolean)[0] || '';
}

// Labels for the icons of one card, aligned with `icons` (dividers → '').
// Duplicates are told apart: ' · <first path segment>' when that segment is
// different for each of them, else ' 2', ' 3' after the first.
export function iconLabels(icons) {
  const list = Array.isArray(icons) ? icons : [];
  const labels = list.map(i => labelForIcon(i));
  const groups = new Map();
  labels.forEach((label, i) => {
    if (!label) return;
    const k = label.toLowerCase();
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(i);
  });
  // Disambiguated labels never collide with another label in the card
  const taken = new Set(labels.filter(Boolean).map(l => l.toLowerCase()));
  groups.forEach(idx => {
    if (idx.length < 2) return;
    const segs = idx.map(i => firstPathSegment(list[i] && list[i].url));
    if (segs.every(Boolean) && new Set(segs).size === segs.length) {
      const named = idx.map((i, n) => `${labels[i]} · ${segs[n]}`);
      if (!named.some(l => taken.has(l.toLowerCase()))) {
        idx.forEach((i, n) => { labels[i] = named[n]; taken.add(named[n].toLowerCase()); });
        return;
      }
    }
    let n = 2;
    idx.slice(1).forEach(i => {
      let label;
      do { label = `${labels[i]} ${n++}`; } while (taken.has(label.toLowerCase()));
      labels[i] = label;
      taken.add(label.toLowerCase());
    });
  });
  return labels;
}

// --- Search ------------------------------------------------------------------

// Lowercase without accents (é → e), with a map back to the original indices
export function foldText(text) {
  return foldWithMap(text).folded;
}

function foldWithMap(text) {
  const s = text == null ? '' : String(text);
  let folded = '';
  const map = [];
  for (let i = 0; i < s.length; i++) {
    const code = s.codePointAt(i);
    const ch = String.fromCodePoint(code);
    const f = ch.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    for (let k = 0; k < f.length; k++) { folded += f[k]; map.push(i); }
    if (code > 0xffff) i++;
  }
  return { folded, map };
}

export function searchTerms(query) {
  return foldText(query).split(/\s+/).map(t => t.trim()).filter(Boolean);
}

const matchesAll = (hay, terms) => terms.every(t => hay.includes(t));

// A ~len-character window of `text` around the first term it contains
export function snippetAround(text, terms, len = 90) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const { folded, map } = foldWithMap(s);
  let at = -1;
  for (const t of terms || []) {
    const i = folded.indexOf(t);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (s.length <= len) return s;
  const pos = at >= 0 ? map[at] : 0;
  let start = Math.max(0, pos - Math.floor(len / 3));
  let end = Math.min(s.length, start + len);
  start = Math.max(0, end - len);
  if (start > 0) { const sp = s.indexOf(' ', start); if (sp > 0 && sp < pos) start = sp + 1; }
  if (end < s.length) { const sp = s.lastIndexOf(' ', end); if (sp > pos) end = sp; }
  return `${start > 0 ? '…' : ''}${s.slice(start, end).trim()}${end < s.length ? '…' : ''}`;
}

const plainCache = new Map();
function plainOf(html) {
  if (!html || typeof html !== 'string') return '';
  if (!/<[a-z!/]/i.test(html)) return html;
  let v = plainCache.get(html);
  if (v === undefined) {
    try { v = htmlToPlainText(html); } catch { v = ''; }
    if (plainCache.size > 400) plainCache.clear();
    plainCache.set(html, v);
  }
  return v;
}

function taskHaystack(task) {
  const subs = Array.isArray(task.subtasks) ? task.subtasks.map(s => (s && s.title) || '').join(' ') : '';
  return foldText(`${task.title || ''} ${subs} ${plainOf(task.description)}`);
}

// Title hits first, then the rest, each in the given order
function rankByTitle(list, titleOf, terms) {
  const hit = [], rest = [];
  list.forEach(x => (matchesAll(foldText(titleOf(x)), terms) ? hit : rest).push(x));
  return [...hit, ...rest];
}

// sources: { tasks, completed, docs, cards (sections), data (the model) }
// → { terms, tasks: [task], writing: [{ doc, snippet }], links: [{ type, item,
//     sectionId, subtitle, label, caption }], cards: [{ section, sectionId,
//     title }], completed: [task], total }
export function searchAll(query, { tasks = [], completed = [], docs = [], cards = [], data = {} } = {}) {
  const terms = searchTerms(query);
  const out = { terms, tasks: [], writing: [], links: [], cards: [], completed: [], total: 0 };
  if (terms.length === 0) return out;

  const openTasks = (Array.isArray(tasks) ? tasks : []).filter(t => t && typeof t === 'object');
  out.tasks = rankByTitle(openTasks.filter(t => matchesAll(taskHaystack(t), terms)), t => t.title, terms);

  const docList = (Array.isArray(docs) ? docs : []).filter(d => d && typeof d === 'object');
  out.writing = rankByTitle(
    docList.filter(d => matchesAll(foldText(`${d.title || ''} ${d.text || ''}`), terms)),
    d => d.title, terms,
  ).map(doc => ({ doc, snippet: snippetAround(doc.text || '', terms) }));

  const sections = orderCardsForMobile(Array.isArray(cards) ? cards : []);
  sections.forEach(section => {
    const title = cardTitle(data, section);
    if (matchesAll(foldText(title), terms)) out.cards.push({ section, sectionId: section.id, title });
    const groups = normalizeGroups(data && data[section.id]);
    const allIcons = groups.flatMap(g => g.icons);
    const labels = iconLabels(allIcons);
    const labelOf = new Map(allIcons.map((icon, i) => [icon, labels[i]]));
    groups.forEach(g => {
      const caption = g.subtitle && g.subtitle !== '_default' ? `${title} › ${g.subtitle}` : title;
      const push = (type, item, label, hay) => {
        if (matchesAll(foldText(hay), terms)) out.links.push({ type, item, sectionId: section.id, subtitle: g.subtitle, label, caption });
      };
      g.icons.forEach(icon => {
        if (icon.isDivider) return;
        const label = labelOf.get(icon) || labelForIcon(icon);
        push('icon', icon, label, `${label} ${iconHost(icon)}`);
      });
      g.reminders.forEach(r => push('reminder', r, r.title || r.name || 'Untitled', `${r.title || r.name || ''}`));
      g.subtasks.forEach(s => push('subtask', s, s.text || '', s.text || ''));
      g.copyPaste.forEach(c => push('copyPaste', c, c.text || c.copyText || '', c.text || c.copyText || ''));
    });
  });

  const done = (Array.isArray(completed) ? completed : []).filter(t => t && typeof t === 'object')
    .filter(t => matchesAll(taskHaystack(t), terms));
  out.completed = done
    .map((t, i) => ({ t, i, at: Number(t.completedAt) || Date.parse(t.completedAt) || 0 }))
    .sort((a, b) => (b.at - a.at) || (a.i - b.i))
    .map(x => x.t);

  out.total = out.tasks.length + out.writing.length + out.links.length + out.cards.length + out.completed.length;
  return out;
}
