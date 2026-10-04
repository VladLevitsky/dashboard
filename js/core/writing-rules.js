// Pure input rules for the writing editors: markdown block / inline triggers, smart typography,
// autolinks and link URL safety (no DOM, Node-testable). The DOM side (select the trigger text,
// execCommand, Backspace revert, skipping code) lives in js/features/writing/input-rules.js.
//
// Every matcher gets the current block's text from its start up to the caret, INCLUDING the
// character just typed, and returns plain offsets into that string. A space typed at the end of a
// contenteditable line arrives as NBSP, so NBSP counts as a space everywhere.

import { normalizeUrl } from './quick-capture-parse.js';

const LITE_FULL = ['lite', 'full'];
const FULL = ['full'];
const MAX_LOOKBACK = 500;

const isSpace = (ch) => ch !== undefined && /\s/.test(ch);          // \s includes NBSP and \n
const isWordChar = (ch) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);

// True when the character at `index` is escaped: preceded by an odd number of backslashes
// ("\*" is escaped, "\\*" is not).
export function isEscapedAt(text, index) {
  let n = 0;
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i--) n++;
  return n % 2 === 1;
}

// ============================================================
// BLOCK RULES (start of a line)
// ============================================================
// markers: the exact text typed before the trigger key. triggers: which key fires the rule
// ('space' = the just-typed space, 'enter' = Enter pressed, 'char' = any other typed character).

export const BLOCK_RULES = [
  { id: 'heading1', command: 'heading1', markers: ['#'], triggers: ['space'], tiers: LITE_FULL },
  { id: 'heading2', command: 'heading2', markers: ['##'], triggers: ['space'], tiers: LITE_FULL },
  { id: 'heading3', command: 'heading3', markers: ['###'], triggers: ['space'], tiers: LITE_FULL },
  { id: 'bulletList', command: 'bulletList', markers: ['-', '*'], triggers: ['space'], tiers: LITE_FULL },
  { id: 'numberedList', command: 'numberedList', markers: ['1.'], triggers: ['space'], tiers: LITE_FULL },
  { id: 'checklist', command: 'checklist', markers: ['[]', '[ ]'], triggers: ['space'], tiers: LITE_FULL },
  { id: 'checkedItem', command: 'checklist', markers: ['[x]', '[X]'], attrs: { checked: true }, triggers: ['space'], tiers: LITE_FULL },
  { id: 'quote', command: 'quote', markers: ['>'], triggers: ['space'], tiers: LITE_FULL },
  // fires on the third dash itself (the line must be otherwise empty)
  { id: 'divider', command: 'divider', markers: ['---'], triggers: ['char'], tiers: LITE_FULL },
  // ``` or ```js, then Space or Enter → { lang } ('' when none)
  { id: 'codeBlock', command: 'codeBlock', pattern: /^```([A-Za-z0-9_+#.-]{0,20})$/, triggers: ['space', 'enter'], tiers: FULL },
  { id: 'callout', command: 'callout', markers: ['!!'], attrs: { kind: 'note' }, triggers: ['space'], tiers: FULL },
  { id: 'calloutDecision', command: 'calloutDecision', markers: ['<>'], triggers: ['space'], tiers: FULL },
  { id: 'toggle', command: 'toggle', markers: ['+'], triggers: ['space'], tiers: FULL },
];

function blockRuleAttrs(rule, body) {
  if (rule.pattern) {
    const m = rule.pattern.exec(body);
    return m ? { lang: (m[1] || '').toLowerCase() } : null;
  }
  if (!rule.markers.includes(body)) return null;
  return rule.attrs ? { ...rule.attrs } : {};
}

// What the start of a line turns into.
// textBeforeCaret: the block's text up to the caret (with the just-typed character).
// opts: { tier: 'lite'|'full', trigger: 'space'|'enter'|'char', textAfterCaret? (divider only: it
// fires only when nothing follows the caret; omitted = assume nothing does) }.
// → null | { command, deleteLength, attrs? } (deleteLength = chars before the caret to delete)
//   | { escape: true, index } when "\" precedes the marker (drop the backslash at `index`, keep the text).
// Leading zero-width spaces (caret anchors) are ignored but included in deleteLength.
export function matchBlockTrigger(textBeforeCaret, { tier = 'full', trigger = 'space', textAfterCaret = '' } = {}) {
  const text = String(textBeforeCaret ?? '');
  const lead = /^[​﻿]*/.exec(text)[0].length;
  let body = text.slice(lead).replace(/ /g, ' ');
  if (trigger === 'space') {
    if (!body.endsWith(' ')) return null;
    body = body.slice(0, -1);
  }
  let escaped = false;
  if (body[0] === '\\') { escaped = true; body = body.slice(1); }
  for (const rule of BLOCK_RULES) {
    if (!rule.tiers.includes(tier) || !rule.triggers.includes(trigger)) continue;
    const attrs = blockRuleAttrs(rule, body);
    if (!attrs) continue;
    if (rule.id === 'divider' && String(textAfterCaret ?? '').replace(/[\s​﻿]/g, '')) return null;
    if (escaped) return { escape: true, index: lead };
    const result = { command: rule.command, deleteLength: text.length };
    if (Object.keys(attrs).length) result.attrs = attrs;
    return result;
  }
  return null;
}

// ============================================================
// INLINE RULES (on the closing delimiter)
// ============================================================

// delimiter character → closing run length → command
const DELIMITERS = {
  '*': { 1: 'italic', 2: 'bold' },
  '_': { 1: 'italic', 2: 'bold' },
  '~': { 2: 'strike' },
  '=': { 2: 'highlight' },
  '`': { 1: 'inlineCode' },
};

// The word before `pos` already looks like a URL ("https://x.com/_a_", "[t](_a_").
function looksLikeUrlBefore(text, pos) {
  let t = pos;
  while (t > 0 && !isSpace(text[t - 1])) t--;
  const prefix = text.slice(t, pos);
  return /[a-z][a-z0-9+.-]*:\/\//i.test(prefix) || /^www\./i.test(prefix)
    || /^[\w-]+(?:\.[\w-]+)+\//.test(prefix) || prefix.includes('](');
}

// An unclosed `code span is open at `pos` (odd number of unescaped backticks on the line before it).
function insideCodeSpan(text, from, pos) {
  let count = 0;
  for (let i = from; i < pos; i++) if (text[i] === '`' && !isEscapedAt(text, i)) count++;
  return count % 2 === 1;
}

function matchDelimited(text, ch) {
  const end = text.length;
  let n = 0;
  while (n < end && text[end - 1 - n] === ch) n++;
  const command = DELIMITERS[ch][n];
  if (!command) return null;
  const closeStart = end - n;
  if (closeStart === 0 || isSpace(text[closeStart - 1])) return null;     // no space just inside
  if (isEscapedAt(text, closeStart)) return null;
  // the opener is the nearest run of the same character on this line (within the lookback)
  const limit = Math.max(0, end - MAX_LOOKBACK);
  let i = closeStart - 1;
  while (i >= limit && text[i] !== ch && text[i] !== '\n') i--;
  if (i < limit || text[i] !== ch) return null;
  const runEnd = i + 1;
  let runStart = i;
  while (runStart > 0 && text[runStart - 1] === ch) runStart--;
  if (runStart < limit) return null;
  const runLength = runEnd - runStart;
  // "***x*" / "***x**": the innermost star(s) of a triple open, the rest closes on the next keys
  const triple = (ch === '*' || ch === '_') && runLength === 3;
  if (runLength !== n && !triple) return null;                             // "**x*" waits for "**"
  if (isEscapedAt(text, runStart)) return null;
  if (isWordChar(text[runStart - 1])) return null;                         // not 2*3*4, not snake_case
  if (isSpace(text[runEnd])) return null;                                  // not "2 * 3 * 4"
  const lineStart = text.lastIndexOf('\n', runStart) + 1;
  if (ch !== '`' && insideCodeSpan(text, Math.max(limit, lineStart), runStart)) return null;
  if (looksLikeUrlBefore(text, runStart)) return null;
  return { command, start: runEnd - n, end, innerStart: runEnd, innerEnd: closeStart };
}

const MD_LINK_RE = /\[([^[\]\n]{1,300})\]\(([^()\s]{1,2048})\)$/;

function matchMarkdownLink(text) {
  const base = Math.max(0, text.length - MAX_LOOKBACK);
  const m = MD_LINK_RE.exec(text.slice(base));
  if (!m) return null;
  const start = base + m.index;
  const label = m[1];
  const labelEnd = start + 1 + label.length;                               // index of "]"
  if (isEscapedAt(text, start) || isEscapedAt(text, labelEnd)) return null;
  if (text[start - 1] === '!' && !isEscapedAt(text, start - 1)) return null; // ![image](url)
  if (isSpace(label[0]) || isSpace(label[label.length - 1])) return null;
  const href = normalizeLinkUrl(m[2]);
  if (!href) return null;
  return { command: 'link', start, end: text.length, innerStart: start + 1, innerEnd: labelEnd, href };
}

// Inline markdown, checked on the just-typed closing delimiter:
// **x** __x__ bold · *x* _x_ italic · ~~x~~ strike · `x` inline code · ==x== highlight · [text](url) link.
// → null | { command: 'bold'|'italic'|'strike'|'inlineCode'|'highlight'|'link', start, end, innerStart,
//   innerEnd, href? } with offsets into textBeforeCaret (end = caret; [start, innerStart) is the opening
//   delimiter, [innerEnd, end) the closing one). Openers must start a word (line start, space or
//   punctuation before them), nothing may touch the inside with a space, the inner text is non-empty,
//   the lookback is 500 characters, and escaped delimiters ("\*") never match. Links need a safe URL.
export function matchInlineTrigger(textBeforeCaret) {
  const text = String(textBeforeCaret ?? '');
  const last = text[text.length - 1];
  if (last === ')') return matchMarkdownLink(text);
  if (DELIMITERS[last]) return matchDelimited(text, last);
  return null;
}

// ============================================================
// SMART TYPOGRAPHY
// ============================================================
// Checked in this order (longest first). "<-" then ">" gives "←>", which becomes "↔"; likewise
// "<=" then ">" gives "≤>", which becomes "⇔", so the typed result is the same as "<->" / "<=>".

export const TYPOGRAPHY_RULES = [
  { from: '<->', to: '↔' },
  { from: '←>', to: '↔' },
  { from: '<=>', to: '⇔' },
  { from: '≤>', to: '⇔' },
  { from: '->', to: '→' },
  { from: '<-', to: '←' },
  { from: '=>', to: '⇒' },
  { from: '!=', to: '≠' },
  { from: '<=', to: '≤' },
  { from: '>=', to: '≥' },
  { from: '+-', to: '±' },
  { from: '(c)', to: '©' },
  { from: '(C)', to: '©' },
  { from: ' -- ', to: ' — ', spaced: true },   // fires on the second space; the typed spaces are kept
];

const URL_WORD_RE = /[a-z][a-z0-9+.-]*:\/\/|^www\.|^mailto:|^[\w-]+(?:\.[\w-]+)+[/:?#]/i;

// The match at `start` sits inside a URL-looking word or an open HTML-ish tag ("<div class=a").
function inUrlOrTag(text, start) {
  let t = start;
  while (t > 0 && !isSpace(text[t - 1])) t--;
  if (URL_WORD_RE.test(text.slice(t, start))) return true;
  return /<[A-Za-z/!?][^<>]*$/.test(text.slice(Math.max(0, start - MAX_LOOKBACK), start));
}

// Smart punctuation for the text just typed. → null | { replace, length } (replace the last `length`
// characters with `replace`). Never fires inside a URL-looking word or an open HTML-ish tag, nor when
// the sequence is escaped with "\". "(c)" is left alone right after an "(a) (b)" enumeration.
// Code contexts are the caller's job.
export function matchTypography(textBeforeCaret) {
  const text = String(textBeforeCaret ?? '');
  for (const rule of TYPOGRAPHY_RULES) {
    if (rule.spaced) {
      const m = /[  ]--[  ]$/.exec(text);
      if (!m) continue;
      if (inUrlOrTag(text, m.index + 1)) return null;
      return { replace: `${m[0][0]}—${m[0][3]}`, length: 4 };
    }
    if (!text.endsWith(rule.from)) continue;
    const start = text.length - rule.from.length;
    if (isEscapedAt(text, start)) return null;
    if (rule.to === '©' && /\(b\)/i.test(text.slice(Math.max(0, start - 80), start))) return null;
    if (inUrlOrTag(text, start)) return null;
    return { replace: rule.to, length: rule.from.length };
  }
  return null;
}

// ============================================================
// LINKS: safety, normalization, autolink
// ============================================================

// Only http(s) links with a host, mailto: links and in-page "#anchors" are safe. Rejects
// javascript:, data:, vbscript:, file:, relative paths and protocol-relative "//host".
export function isSafeUrl(href) {
  if (typeof href !== 'string') return false;
  const v = href.trim();
  if (!v || /[\u0000-\u001f\u007f]/.test(v)) return false;   // browsers drop these inside schemes
  if (v[0] === '#') return v.length > 1;
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(v);
  if (!m) return false;
  const scheme = m[1].toLowerCase();
  if (scheme === 'mailto') return v.length > 7;
  if (scheme !== 'http' && scheme !== 'https') return false;
  try { return !!new URL(v).hostname; } catch { return false; }
}

const EMAIL_RE = /^[^\s@/:?#()<>[\]]+@[^\s@/:?#()<>[\]]+\.[a-z]{2,}$/i;

// What a typed link turns into: "telcobridges.com" → "https://telcobridges.com",
// "marc@x.com" → "mailto:marc@x.com". http(s) follows normalizeUrl from quick-capture-parse.js
// (text kept as typed, https:// added, host needs a dot or localhost). null when unsafe or not a link.
export function normalizeLinkUrl(raw) {
  const v = String(raw ?? '').trim();
  if (!v || /[\s\u0000-\u001f\u007f]/.test(v)) return null;
  if (v[0] === '#') return v.length > 1 ? v : null;
  if (/^mailto:/i.test(v)) return isSafeUrl(v) ? v : null;
  if (EMAIL_RE.test(v)) return `mailto:${v}`;
  if (v.startsWith('//')) return normalizeUrl(`https:${v}`);
  // "example.com:8080/x" would otherwise read as a URL scheme named "example.com" (same for localhost)
  if (/^(?:localhost|[a-z0-9-]+(?:\.[a-z0-9-]+)+):\d+(?:[/?#]|$)/i.test(v)) return normalizeUrl(`https://${v}`);
  const url = normalizeUrl(v);
  return url && isSafeUrl(url) ? url : null;
}

// TLDs a bare "domain.tld" may end with. With a path ("domain.tld/x") any two-letter country code
// works too, except ones that are mostly file extensions.
const GENERIC_TLDS = new Set(('com net org edu gov mil int info biz name pro app dev io ai co me tv '
  + 'cloud tech site online store shop blog news page link live xyz art design agency studio media '
  + 'digital network email space world today global group company team work zone club life one top '
  + 'wiki social video music games fun ltd inc llc so ly gg fm to im eu').split(' '));
const COUNTRY_TLDS = new Set(('ca us uk de fr es it nl be ch at se no dk fi ie pt au nz jp cn in br mx '
  + 'ru za sg hk kr tw il ae ar cl cz gr hu ro sk tr ua vn id my ph th').split(' '));
const FILE_EXT_TLDS = new Set('js ts md py sh rs cs pl pm ps db rb mk'.split(' '));

function knownTld(tld, withPath) {
  const t = tld.toLowerCase();
  if (GENERIC_TLDS.has(t) || COUNTRY_TLDS.has(t)) return true;
  return withPath && /^[a-z]{2}$/.test(t) && !FILE_EXT_TLDS.has(t);
}

const BARE_DOMAIN_RE = /^((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+)([a-z]{2,24})(:\d{2,5})?([/?#]\S*)?$/i;

function autolinkHref(raw) {
  if (!raw || (raw.includes('@') && !/^[a-z][a-z0-9+.-]*:\/\//i.test(raw))) return null;   // emails stay text
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    if (!/^https?:\/\//i.test(raw)) return null;
    const url = normalizeUrl(raw);
    if (!url) return null;
    try {
      const host = new URL(url).hostname;
      return host === 'localhost' || /\.[a-z]{2,}$/i.test(host) || /^\d+(?:\.\d+){3}$/.test(host) ? url : null;
    } catch { return null; }
  }
  if (/^www\./i.test(raw)) {
    const m = BARE_DOMAIN_RE.exec(raw);
    return m && /^[a-z]{2,24}$/i.test(m[2]) ? normalizeUrl(`https://${raw}`) : null;
  }
  const m = BARE_DOMAIN_RE.exec(raw);
  if (!m || !knownTld(m[2], !!(m[3] || m[4]))) return null;
  return normalizeUrl(`https://${raw}`);   // explicit scheme: "shop.fr:8080" is not a scheme
}

const AUTOLINK_LEAD = '([<"\'“‘*~';
const AUTOLINK_TRAIL = '.,;:!?\'"’”>*~';

// A URL just finished with Space (trigger 'space', the default: the text ends with the typed space)
// or Enter (trigger 'enter': the text ends with the URL). Recognizes https?://…, www.… and bare
// domain.tld/path with a known-looking TLD. Trailing .,;:!? quotes and unbalanced ) ] are left out
// of the link. → null | { url (normalized href), start, end } (offsets of the linked text).
// Emails and escaped words ("\www.x.com") are not linked. Already-linked text is the caller's job.
export function matchAutolink(textBeforeCaret, { trigger = 'space' } = {}) {
  const text = String(textBeforeCaret ?? '');
  let end = text.length;
  if (trigger !== 'enter') {
    if (!end || !isSpace(text[end - 1])) return null;
    end -= 1;
  }
  let start = end;
  while (start > 0 && !isSpace(text[start - 1]) && end - start < 2048) start--;
  if (start > 0 && !isSpace(text[start - 1])) return null;                 // word too long
  while (start < end && AUTOLINK_LEAD.includes(text[start])) start++;
  while (end > start) {
    const c = text[end - 1];
    if (AUTOLINK_TRAIL.includes(c)) { end--; continue; }
    if (c === ')' || c === ']') {
      const word = text.slice(start, end);
      const open = c === ')' ? '(' : '[';
      if (word.split(c).length > word.split(open).length) { end--; continue; }
    }
    break;
  }
  if (end <= start || isEscapedAt(text, start)) return null;
  const url = autolinkHref(text.slice(start, end));
  return url ? { url, start, end } : null;
}

// ============================================================
// COMMANDS REFERENCE ROWS (help.js "Markdown & typing" tab)
// ============================================================
// syntax: what you type (the primary form); variants: every accepted form; trigger: what fires it
// ('space' | 'enter' | 'char' | 'close' = the closing delimiter); command: registry id when there is one.
// section / pattern / alt mirror the row shape of MARKDOWN_HELP in writing-commands.js, so one
// renderer can show either list.

const HELP_SECTIONS = {
  block: 'Start a line with', inline: 'Around text', typography: 'Smart typography', escape: 'Escapes', undo: 'Escapes',
};

const HELP_ROWS = [
  // Block rules: at the start of a line
  { id: 'md-h1', kind: 'block', syntax: '# ', variants: ['# '], result: 'Heading 1', command: 'heading1', trigger: 'space', tiers: LITE_FULL },
  { id: 'md-h2', kind: 'block', syntax: '## ', variants: ['## '], result: 'Heading 2', command: 'heading2', trigger: 'space', tiers: LITE_FULL },
  { id: 'md-h3', kind: 'block', syntax: '### ', variants: ['### '], result: 'Heading 3', command: 'heading3', trigger: 'space', tiers: LITE_FULL },
  { id: 'md-bullet', kind: 'block', syntax: '- ', variants: ['- ', '* '], result: 'Bulleted list', command: 'bulletList', trigger: 'space', tiers: LITE_FULL },
  { id: 'md-numbered', kind: 'block', syntax: '1. ', variants: ['1. '], result: 'Numbered list', command: 'numberedList', trigger: 'space', tiers: LITE_FULL },
  { id: 'md-checklist', kind: 'block', syntax: '[] ', variants: ['[] ', '[ ] ', '- [ ] '], result: 'Checklist', hint: 'Also turns a bulleted item into a checklist item', command: 'checklist', trigger: 'space', tiers: LITE_FULL },
  { id: 'md-checked', kind: 'block', syntax: '[x] ', variants: ['[x] ', '[X] '], result: 'Checked checklist item', command: 'checklist', trigger: 'space', tiers: LITE_FULL },
  { id: 'md-quote', kind: 'block', syntax: '> ', variants: ['> '], result: 'Quote', command: 'quote', trigger: 'space', tiers: LITE_FULL },
  { id: 'md-divider', kind: 'block', syntax: '---', variants: ['---'], result: 'Divider', hint: 'On an empty line, as you type the third dash', command: 'divider', trigger: 'char', tiers: LITE_FULL },
  { id: 'md-code', kind: 'block', syntax: '```', variants: ['``` ', '```js '], result: 'Code block', hint: 'Then Space or Enter. Add a language right after: ```js', command: 'codeBlock', trigger: 'space', tiers: FULL },
  { id: 'md-callout', kind: 'block', syntax: '!! ', variants: ['!! '], result: 'Note callout', command: 'callout', trigger: 'space', tiers: FULL },
  { id: 'md-decision', kind: 'block', syntax: '<> ', variants: ['<> '], result: 'Decision callout', command: 'calloutDecision', trigger: 'space', tiers: FULL },
  { id: 'md-toggle', kind: 'block', syntax: '+ ', variants: ['+ '], result: 'Toggle section', command: 'toggle', trigger: 'space', tiers: FULL },
  // Inline rules: on the closing delimiter
  { id: 'md-bold', kind: 'inline', syntax: '**text**', variants: ['**text**', '__text__'], result: 'Bold', command: 'bold', trigger: 'close', tiers: LITE_FULL },
  { id: 'md-italic', kind: 'inline', syntax: '*text*', variants: ['*text*', '_text_'], result: 'Italic', hint: 'Not inside words, so snake_case and 2*3*4 stay as typed', command: 'italic', trigger: 'close', tiers: LITE_FULL },
  { id: 'md-strike', kind: 'inline', syntax: '~~text~~', variants: ['~~text~~'], result: 'Strikethrough', command: 'strike', trigger: 'close', tiers: LITE_FULL },
  { id: 'md-inline-code', kind: 'inline', syntax: '`text`', variants: ['`text`'], result: 'Inline code', command: 'inlineCode', trigger: 'close', tiers: LITE_FULL },
  { id: 'md-highlight', kind: 'inline', syntax: '==text==', variants: ['==text=='], result: 'Highlight (current color)', command: 'highlight', trigger: 'close', tiers: LITE_FULL },
  { id: 'md-link', kind: 'inline', syntax: '[text](url)', variants: ['[text](url)'], result: 'Link', hint: 'https:// is added for you. Only web and email links', command: 'link', trigger: 'close', tiers: LITE_FULL },
  { id: 'md-autolink', kind: 'inline', syntax: 'https://… ', variants: ['https://… ', 'www.… ', 'domain.com/… '], result: 'Link (autolink)', section: 'Links', hint: 'A web address becomes a link when you type Space or Enter after it. Can be turned off in Preferences', command: 'link', trigger: 'space', tiers: LITE_FULL },
  // Smart typography
  { id: 'ty-right-arrow', kind: 'typography', syntax: '->', variants: ['->'], result: '→', hint: 'Smart typography can be turned off in Preferences', tiers: LITE_FULL },
  { id: 'ty-left-arrow', kind: 'typography', syntax: '<-', variants: ['<-'], result: '←', tiers: LITE_FULL },
  { id: 'ty-both-arrow', kind: 'typography', syntax: '<->', variants: ['<->'], result: '↔', tiers: LITE_FULL },
  { id: 'ty-implies', kind: 'typography', syntax: '=>', variants: ['=>'], result: '⇒', tiers: LITE_FULL },
  { id: 'ty-iff', kind: 'typography', syntax: '<=>', variants: ['<=>'], result: '⇔', tiers: LITE_FULL },
  { id: 'ty-not-equal', kind: 'typography', syntax: '!=', variants: ['!='], result: '≠', tiers: LITE_FULL },
  { id: 'ty-less-equal', kind: 'typography', syntax: '<=', variants: ['<='], result: '≤', tiers: LITE_FULL },
  { id: 'ty-greater-equal', kind: 'typography', syntax: '>=', variants: ['>='], result: '≥', tiers: LITE_FULL },
  { id: 'ty-plus-minus', kind: 'typography', syntax: '+-', variants: ['+-'], result: '±', tiers: LITE_FULL },
  { id: 'ty-copyright', kind: 'typography', syntax: '(c)', variants: ['(c)', '(C)'], result: '©', tiers: LITE_FULL },
  { id: 'ty-em-dash', kind: 'typography', syntax: ' -- ', variants: [' -- '], result: ' — ', hint: 'Two dashes between spaces become an em dash', tiers: LITE_FULL },
  // Escape and undo
  { id: 'md-escape', kind: 'escape', syntax: '\\#', variants: ['\\#', '\\- ', '\\*text*', '\\->'], result: 'Keeps a marker as typed', hint: '\\ before a marker keeps it literal', tiers: LITE_FULL },
  { id: 'md-undo', kind: 'undo', syntax: 'Backspace', variants: ['Backspace'], result: 'Restores what you typed', hint: 'Backspace (or undo) right after a conversion restores what you typed', tiers: LITE_FULL },
];

export const MARKDOWN_RULES_HELP = HELP_ROWS.map(row => ({
  section: HELP_SECTIONS[row.kind],
  ...row,
  pattern: row.syntax,
  alt: (row.variants || []).filter(v => v !== row.syntax),
}));
