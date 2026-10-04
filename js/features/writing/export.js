// Personal Dashboard - Writing export: Download Markdown (.md), Export PDF
// (print from a hidden iframe), Copy as Markdown, Copy formatted text, the
// Export ▾ menu (FULL toolbars and the read-only views' action rows) and the
// templates (menu + the "Start with a template" hint in empty editors).
//
// One pipeline for every format: the clean stored HTML (cleanEditorHtml) with
// task pills reconciled, plus the editor's getDocMeta() (title, kind, fields,
// meta sections such as subtasks / links / files). Markdown comes from
// markdown.js htmlToMarkdown; PDF and formatted copy start from the allowlist
// sanitizer (sanitizeRichHtml), so nothing stored can script the print frame
// or the clipboard. Images become [image: name] in Markdown and text, and
// print as the live hydrated picture (getBlobUrlForFile) when there is one.

import { htmlToMarkdown, htmlToPlainText, sanitizeRichHtml } from '../../core/markdown.js';
import { templatesFor, renderTemplate, templateVars } from '../../core/writing-templates.js';
import { getBlobUrlForFile, fetchFileBlobUrl } from '../../core/file-service.js';
import { reconcileTaskHighlights } from '../edit-mode.js';

let api = null;

const KIND_BY_ID = { projects: 'Project', meetings: 'Meeting', task: 'Task', subtask: 'Subtask', ideas: 'Idea', notes: 'Note' };
const EXPORT_IDS = ['exportMd', 'exportPdf', 'copyMd', 'copyRich'];
// Note viewer: notes are LITE, so the short list (the viewer has its own Copy note button),
// in the same order as every other Export menu: Download, then Copy
const NOTE_VIEW_IDS = ['exportMd', 'exportPdf', 'copyMd'];
// "Start with a template" hint: editors and their quick picks (first that exist)
const HINT_PICKS = {
  projects: ['project-brief', 'campaign-plan', 'content-brief'],
  meetings: ['meeting-notes', 'one-on-one', 'standup'],
  task: ['task-brief', 'issue-report', 'content-brief']
};

// --- Small helpers ---------------------------------------------------------
function safe(fn, fallback = null) {
  try { return fn(); } catch (err) { console.error('[writing] export', err); return fallback; }
}

function esc(text) {
  return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function oneLine(text) {
  return String(text ?? '').replace(/[\u200B\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
}

function pad2(n) { return String(n).padStart(2, '0'); }

// Local day key (never toISOString: that is the UTC day)
function dayKey(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }

function shortDate(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Field values: a YYYY-MM-DD day reads as "Fri, Oct 9, 2026"
function fieldValue(value) {
  const v = oneLine(value);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return v;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

const SVG_ATTRS = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"';
function svg(body, size = 16) {
  return `<svg class="wr-icon" ${SVG_ATTRS} width="${size}" height="${size}">${body}</svg>`;
}

// Template icon names (writing-templates.js) -> minimal stroke icons
const TEMPLATE_ICONS = {
  meeting: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12z"/><line x1="8.5" y1="10.5" x2="15.5" y2="10.5"/><line x1="8.5" y1="14" x2="13" y2="14"/>',
  people: '<circle cx="9" cy="8" r="3.2"/><path d="M3 19.5c0-3.2 2.7-5.5 6-5.5s6 2.3 6 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M16.5 14.1c2.6.2 4.5 2.2 4.5 4.9"/>',
  brief: '<rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7"/><line x1="3" y1="12.5" x2="21" y2="12.5"/>',
  retro: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><polyline points="4 3.5 4 8 8.5 8"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><polyline points="20 20.5 20 16 15.5 16"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  standup: '<path d="M17 18a5 5 0 0 0-10 0"/><line x1="12" y1="3" x2="12" y2="9"/><line x1="4.2" y1="10.2" x2="5.6" y2="11.6"/><line x1="2" y1="18" x2="4" y2="18"/><line x1="20" y1="18" x2="22" y2="18"/><line x1="18.4" y1="11.6" x2="19.8" y2="10.2"/><line x1="2" y1="21.5" x2="22" y2="21.5"/><polyline points="9 6 12 3 15 6"/>',
  content: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><polyline points="14 3 14 8 19 8"/><line x1="8.5" y1="13" x2="15.5" y2="13"/><line x1="8.5" y1="16.5" x2="13" y2="16.5"/>',
  campaign: '<path d="M3 10.5v3a1.5 1.5 0 0 0 1.5 1.5H7l6 4V5L7 9H4.5A1.5 1.5 0 0 0 3 10.5z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a8.5 8.5 0 0 1 0 12"/>',
  bug: '<rect x="7" y="7.5" width="10" height="13" rx="5"/><path d="M9 7.5a3 3 0 0 1 6 0"/><line x1="12" y1="12" x2="12" y2="20.5"/><line x1="3.5" y1="13" x2="7" y2="13"/><line x1="17" y1="13" x2="20.5" y2="13"/><path d="M4 8.5l3 1.5"/><path d="M20 8.5l-3 1.5"/><path d="M4 19l3-2"/><path d="M20 19l-3-2"/>'
};
const TEMPLATE_UI_ICONS = { decision: 'decision', calendar: 'date', idea: 'tip' };

function templateIcon(name, size = 16) {
  if (TEMPLATE_ICONS[name]) return svg(TEMPLATE_ICONS[name], size);
  return api.ui.icon(TEMPLATE_UI_ICONS[name] || 'template', size);
}

// --- Sources: an attached editor or a read-only view ----------------------
function editorSource(editor) {
  const st = editor && api.stateOf(editor);
  return st ? { el: editor, opts: st.opts || {}, id: st.opts.id, view: false } : null;
}

function viewSource(viewEl) {
  const vs = viewEl && viewEl._wrView;
  return vs ? { el: viewEl, opts: vs.opts || {}, id: vs.opts.id, view: true } : null;
}

function sourceFromCtx(ctx) {
  if (!ctx) return null;
  if (ctx.view && ctx.viewEl) return viewSource(ctx.viewEl);
  return ctx.editor ? editorSource(ctx.editor) : null;
}

// Views show "No description" inside the content when the field is empty
function isPlaceholderOnly(root) {
  const els = root.children;
  if (els.length !== 1 || els[0].tagName !== 'SPAN') return false;
  return /^no description$/i.test(oneLine(root.textContent));
}

// The note viewer / notepad render white-space: pre-wrap, and older notes
// hold pasted plain text with real newlines: keep them as line breaks
function keepLineBreaks(root) {
  const doc = root.ownerDocument || document;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.data.includes('\n') && !(n.parentElement && n.parentElement.closest('pre'))) nodes.push(n);
  }
  const isBlock = (node) => node && node.nodeType === 1 && /^(DIV|P|H[1-6]|UL|OL|LI|BLOCKQUOTE|PRE|TABLE|HR)$/.test(node.tagName);
  nodes.forEach(n => {
    // Pretty-print whitespace between blocks is not a line
    if (!n.data.trim() && (isBlock(n.previousSibling) || !n.previousSibling) && (isBlock(n.nextSibling) || !n.nextSibling)) { n.remove(); return; }
    const parts = n.data.replace(/\r\n?/g, '\n').split('\n');
    const frag = doc.createDocumentFragment();
    parts.forEach((part, i) => {
      if (i) frag.appendChild(doc.createElement('br'));
      if (part) frag.appendChild(doc.createTextNode(part));
    });
    n.replaceWith(frag);
  });
}

function preWrap(el) {
  if (!el || !el.isConnected) return false;
  const ws = getComputedStyle(el).whiteSpace || '';
  return ws.startsWith('pre') || ws === 'break-spaces';
}

// Clean, reconciled HTML of the source (or of a selection inside it)
function contentHtml(src, range) {
  const tpl = document.createElement('template');
  if (range) {
    const holder = document.createElement('template');
    holder.content.appendChild(range.cloneContents());
    tpl.innerHTML = api.dom.cleanEditorHtml(holder.innerHTML);
  } else {
    tpl.innerHTML = api.dom.cleanEditorHtml(src.el);
  }
  const root = tpl.content;
  if (src.view && isPlaceholderOnly(root)) return '';
  safe(() => reconcileTaskHighlights(root));
  if (preWrap(src.el)) keepLineBreaks(root);
  return tpl.innerHTML;
}

// Everything an export needs: title, kind, meta line, fields, body, sections
function collectDoc(src, range) {
  const opts = src.opts || {};
  const meta = safe(() => (opts.getDocMeta ? opts.getDocMeta() : null)) || {};
  const title = oneLine(meta.title) || oneLine(safe(() => (opts.getTitle ? opts.getTitle() : ''))) || 'Untitled';
  const kind = oneLine(meta.kind) || KIND_BY_ID[src.id] || 'Note';
  const subtitle = oneLine(meta.subtitle);
  const now = new Date();
  const metaParts = [kind];
  if (subtitle && subtitle !== title && subtitle !== kind) metaParts.push(subtitle);
  metaParts.push('Exported ' + shortDate(now));
  // A field already said by the meta line ("Subtask note · Card") is left out
  const said = new Set(subtitle ? subtitle.split(' · ') : []);
  const fields = (Array.isArray(meta.fields) ? meta.fields : [])
    .filter(f => f && oneLine(f.label) && oneLine(f.value) && !said.has(oneLine(f.value)))
    .map(f => ({ label: oneLine(f.label), value: fieldValue(f.value) }));
  const sections = (Array.isArray(meta.sections) ? meta.sections : [])
    .filter(s => s && oneLine(s.title) && ((Array.isArray(s.checklist) && s.checklist.length) || (Array.isArray(s.items) && s.items.length)));
  const html = contentHtml(src, range);
  return {
    id: src.id,
    title,
    kind,
    metaLine: metaParts.join(' · '),
    fields,
    sections,
    html,
    bodyEmpty: api.dom.isEffectivelyEmpty(html),
    now
  };
}

// "Title (https://…)" / a bare URL -> a link; anything else stays text
function itemHtml(text) {
  const t = oneLine(text);
  const m = /^(.*\S)\s+\(((?:https?:\/\/|mailto:)[^\s()]+)\)$/.exec(t);
  const url = m ? api.dom.safeUrl(m[2]) : (/^(?:https?:\/\/|mailto:)\S+$/.test(t) ? api.dom.safeUrl(t) : null);
  if (url && !url.startsWith('#')) return `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(m ? m[1] : t)}</a>`;
  return esc(t);
}

// Meta sections (subtasks, links, files) as canonical HTML
function sectionsHtml(doc) {
  return doc.sections.map(s => {
    let list;
    if (Array.isArray(s.checklist) && s.checklist.length) {
      list = `<ul class="checklist">${s.checklist.map(c => `<li${c && c.done ? ' class="checked"' : ''}>${esc(oneLine(c && c.text))}</li>`).join('')}</ul>`;
    } else {
      list = `<ul>${s.items.map(i => `<li>${itemHtml(i)}</li>`).join('')}</ul>`;
    }
    return `<h2>${esc(oneLine(s.title))}</h2>${list}`;
  }).join('');
}

function fieldsHtml(doc) {
  return doc.fields.map(f => `<b>${esc(f.label)}:</b> ${esc(f.value)}`).join(' · ');
}

function nothingToExport(doc) {
  return doc.bodyEmpty && !doc.sections.length;
}

// Placeholder name for an image: its alt text, else "image N"
function imageName(fileId, index, alt) {
  return oneLine(alt) || `image ${index}`;
}

// --- Markdown ------------------------------------------------------------------
function toMarkdown(doc, { header = true } = {}) {
  const parts = [];
  if (header) {
    parts.push(htmlToMarkdown(`<h1>${esc(doc.title)}</h1>`));
    parts.push(htmlToMarkdown(`<div><i>${esc(doc.metaLine)}</i></div>`));
    if (doc.fields.length) parts.push(htmlToMarkdown(`<div>${fieldsHtml(doc)}</div>`));
  }
  // Under the "# Title" header, body headings step down one level when it has an h1
  const offset = header && /<h1[\s>]/i.test(doc.html) ? 1 : 0;
  const body = doc.bodyEmpty ? '' : htmlToMarkdown(doc.html, { imageName, headingOffset: offset });
  if (body) parts.push(body);
  if (header && doc.sections.length) parts.push(htmlToMarkdown(sectionsHtml(doc)));
  return parts.filter(Boolean).join('\n\n') + '\n';
}

// "<Kind> - <title> <YYYY-MM-DD>": no \/:*?"<>| or control characters,
// no reserved Windows names, at most 120 characters with the extension
export function exportFileName(kind, title, date = new Date(), ext = '') {
  const clean = (s) => String(s ?? '').replace(/[\\/:*?"<>|\u0000-\u001F\u007F]/g, '-').replace(/\s+/g, ' ').trim();
  const head = clean(kind) || 'Document';
  const tail = ` ${dayKey(date)}${ext}`;
  let name = clean(title).replace(/^[.\s-]+/, '') || 'Untitled';
  const room = 120 - head.length - 3 - tail.length;
  if (name.length > room) name = name.slice(0, Math.max(1, room - 1)).replace(/[\s.-]+$/, '') + '…';
  let base = `${head} - ${name}`.replace(/[.\s]+$/, '');
  if (/^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\.|$)/i.test(base)) base = '_' + base;
  return base + tail;
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  a.hidden = true;
  a.dataset.wrUi = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking at once can cancel the download in some browsers
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportMarkdownFile(src) {
  const doc = collectDoc(src);
  if (nothingToExport(doc)) { api.toast('Nothing to export yet'); return true; }
  const name = exportFileName(doc.kind, doc.title, doc.now, '.md');
  downloadBlob(new Blob([toMarkdown(doc)], { type: 'text/markdown;charset=utf-8' }), name);
  api.toast('Markdown downloaded');
  return true;
}

// --- Clipboard -------------------------------------------------------------------
// One-off copy event that sets every type (old browsers, blocked permission)
function execCopy(map) {
  let done = false;
  const onCopy = (e) => {
    if (!e.clipboardData) return;
    Object.entries(map).forEach(([type, value]) => e.clipboardData.setData(type, value));
    e.preventDefault();
    e.stopImmediatePropagation();
    done = true;
  };
  document.addEventListener('copy', onCopy, true);
  try { document.execCommand('copy'); } catch { /* not allowed */ } finally {
    document.removeEventListener('copy', onCopy, true);
  }
  return done;
}

// The write is started synchronously inside the click (Safari / Firefox need
// the user gesture; the content is ready before any await)
function writeClipboard(map, message) {
  const done = (ok) => api.toast(ok ? message : 'Couldn’t copy: your browser blocked the clipboard');
  const clip = navigator.clipboard;
  let attempt = null;
  try {
    if (map['text/html'] && clip && clip.write && typeof ClipboardItem === 'function') {
      const item = new ClipboardItem({
        'text/html': new Blob([map['text/html']], { type: 'text/html' }),
        'text/plain': new Blob([map['text/plain'] || ''], { type: 'text/plain' })
      });
      attempt = clip.write([item]);
    } else if (!map['text/html'] && clip && clip.writeText) {
      attempt = clip.writeText(map['text/plain'] || '');
    }
  } catch { attempt = null; }
  if (!attempt) { done(execCopy(map)); return; }
  attempt.then(() => done(true), () => done(execCopy(map)));
}

function selectionRange(ctx) {
  const range = ctx && ctx.editor ? api.dom.getSelectionRange(ctx.editor) : null;
  return range && !range.collapsed && range.toString().trim() ? range : null;
}

function copyMarkdown(src, range) {
  const doc = collectDoc(src, range);
  if (range ? doc.bodyEmpty : nothingToExport(doc)) { api.toast('Nothing to copy yet'); return true; }
  const md = range ? htmlToMarkdown(doc.html, { imageName }) + '\n' : toMarkdown(doc);
  writeClipboard({ 'text/plain': md }, range ? 'Selection copied as Markdown' : 'Copied as Markdown');
  return true;
}

// --- Shared HTML transforms (print + formatted copy) --------------------------------
const CALLOUT_LABELS = { note: 'Note', tip: 'Tip', decision: 'Decision', warning: 'Warning', caution: 'Caution' };
const CALLOUT_COLORS = {
  note: ['#2563eb', 'rgba(59, 130, 246, 0.08)'],
  tip: ['#15803d', 'rgba(34, 197, 94, 0.09)'],
  decision: ['#7c3aed', 'rgba(139, 92, 246, 0.09)'],
  warning: ['#b45309', 'rgba(245, 158, 11, 0.11)'],
  caution: ['#dc2626', 'rgba(239, 68, 68, 0.08)']
};
const HL_COLORS = { yellow: '#fde68a', green: '#bbf7d0', blue: '#bfdbfe', pink: '#fbcfe8', purple: '#ddd6fe' };

function parse(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  return tpl;
}

// Each <img> -> fn(img, name) with "image N" numbering like the Markdown
function eachImage(root, fn) {
  let n = 0;
  root.querySelectorAll('img').forEach(img => { n++; fn(img, imageName(null, n, img.getAttribute('alt'))); });
}

// --- PDF (print) -----------------------------------------------------------------------
const PRINT_CSS = `
@page { margin: 16mm 18mm; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html { background: #fff; }
body { margin: 0; color: #1f2328; background: #fff; font: 10.5pt/1.6 Inter, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; overflow-wrap: anywhere; }
.doc-head { margin: 0 0 18px; padding: 0 0 12px; border-bottom: 1px solid #e5e7eb; }
.doc-kind { font-size: 8pt; font-weight: 600; letter-spacing: .09em; text-transform: uppercase; color: #6b7280; }
.doc-title { margin: 3px 0 4px; font-size: 21pt; line-height: 1.2; font-weight: 700; letter-spacing: -.01em; }
.doc-meta { font-size: 9pt; color: #6b7280; }
.doc-fields { display: flex; flex-wrap: wrap; gap: 3px 18px; margin: 8px 0 0; padding: 0; font-size: 9pt; }
.doc-fields div { display: flex; gap: 5px; }
.doc-fields dt { color: #6b7280; }
.doc-fields dd { margin: 0; font-weight: 500; }
.doc-body > :first-child { margin-top: 0; }
h1, h2, h3 { line-height: 1.3; margin: 1.1em 0 .35em; break-after: avoid; page-break-after: avoid; }
h1 { font-size: 16pt; } h2 { font-size: 13.5pt; } h3 { font-size: 11.5pt; }
p, div { orphans: 3; widows: 3; }
li, pre, table, tr, img, blockquote, .wr-callout, .wr-toggle-title, .img-ph { break-inside: avoid; page-break-inside: avoid; }
ul, ol { margin: .3em 0; padding-left: 1.5em; }
ul { list-style: disc; } ul ul { list-style: circle; } ol { list-style: decimal; } ol ol { list-style: lower-alpha; }
li { margin: 2px 0; }
ul.checklist { list-style: none; padding-left: 4px; }
ul.checklist > li { position: relative; padding-left: 24px; list-style: none; }
ul.checklist > li::before { content: ''; position: absolute; left: 1px; top: .3em; width: 13px; height: 13px; border-radius: 50%; border: 1.6px solid #9ca3af; }
ul.checklist > li.checked { color: #15803d; text-decoration: line-through; text-decoration-color: rgba(21, 128, 61, .6); }
ul.checklist > li.checked::before { border-color: #22c55e; background: #22c55e url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='20 6 9 17 4 12'/%3E%3C/svg%3E") center / 9px no-repeat; }
blockquote { margin: .6em 0; padding: 2px 0 2px 12px; border-left: 3px solid #cbd5e1; color: #4b5563; }
hr { border: none; border-top: 1px solid #e5e7eb; margin: 14px 0; }
a { color: #2563eb; text-decoration: underline; text-underline-offset: 2px; }
s, strike, del { text-decoration: line-through; opacity: .8; }
code, pre { font-family: ui-monospace, 'Cascadia Code', Menlo, Consolas, monospace; font-variant-ligatures: none; font-feature-settings: 'liga' 0, 'calt' 0; letter-spacing: normal; }
code { font-size: .88em; padding: .05em .35em; border-radius: 4px; background: #f3f4f6; border: 1px solid #e5e7eb; }
pre { margin: .6em 0; padding: 10px 12px; border-radius: 6px; background: #f6f8fa; border: 1px solid #e5e7eb; white-space: pre-wrap; font-size: 9pt; line-height: 1.5; }
pre code { padding: 0; border: none; background: none; font-size: inherit; }
pre[data-lang]::before { content: attr(data-lang); display: block; margin-bottom: 4px; font: 600 7pt/1.4 Inter, system-ui, sans-serif; letter-spacing: .06em; text-transform: uppercase; color: #6b7280; }
table { border-collapse: collapse; margin: .6em 0; max-width: 100%; }
td, th { border: 1px solid #d0d7de; padding: 4px 8px; text-align: left; vertical-align: top; }
th { background: #f3f4f6; font-weight: 600; }
mark { color: inherit; border-radius: 2px; padding: 0 1px; background: #fde68a; }
mark[data-highlight-color="green"] { background: #bbf7d0 !important; }
mark[data-highlight-color="blue"] { background: #bfdbfe !important; }
mark[data-highlight-color="pink"] { background: #fbcfe8 !important; }
mark[data-highlight-color="purple"] { background: #ddd6fe !important; }
mark[data-highlight-color="yellow"] { background: #fde68a !important; }
.project-task-highlight { padding: 0 2px; border-radius: 3px; }
.wr-date, .wr-ref { padding: 0 5px; border-radius: 4px; background: #eef1f5; border: 1px solid #dde2e9; white-space: nowrap; font-size: .94em; }
.wr-ref { font-weight: 500; }
.wr-callout { margin: .7em 0; padding: 8px 12px 8px 14px; border-radius: 8px; border-left: 3px solid var(--c); background: var(--t); }
.wr-callout::before { content: var(--l); display: block; margin-bottom: 2px; font-size: 7.5pt; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: var(--c); }
${Object.entries(CALLOUT_COLORS).map(([k, [c, t]]) => `.wr-callout[data-kind="${k}"] { --c: ${c}; --t: ${t}; --l: '${CALLOUT_LABELS[k]}'; }`).join('\n')}
.wr-callout:not([data-kind]) { --c: #2563eb; --t: rgba(59, 130, 246, .08); --l: 'Note'; }
.wr-toggle { margin: .5em 0; }
.wr-toggle-title { font-weight: 600; }
.wr-toggle-title::before { content: '▾'; display: inline-block; width: 1.1em; color: #6b7280; font-weight: 400; }
.wr-toggle-body { display: block !important; padding-left: 1.1em; }
img { max-width: 100%; height: auto; border-radius: 4px; }
.img-ph { display: inline-block; margin: 4px 0; padding: 10px 14px; border: 1px dashed #9ca3af; border-radius: 6px; color: #6b7280; font-size: 9pt; }
.doc-sections { margin-top: 22px; padding-top: 6px; border-top: 1px solid #e5e7eb; }
`;

// Body for the print frame: images get the live picture (or a dashed
// placeholder), toggles print open, chips lose contenteditable
function printBody(html) {
  const tpl = parse(sanitizeRichHtml(html));
  const root = tpl.content;
  root.querySelectorAll('[contenteditable]').forEach(el => el.removeAttribute('contenteditable'));
  root.querySelectorAll('.wr-toggle').forEach(el => el.setAttribute('data-open', 'true'));
  eachImage(root, (img, name) => {
    const id = img.getAttribute('data-r2-file-id');
    const src = id ? getBlobUrlForFile(id) : img.getAttribute('src');
    if (src && /^(blob:|data:image\/|https?:\/\/)/i.test(src)) {
      img.setAttribute('src', src);
      img.removeAttribute('data-r2-file-id');
      if (!img.getAttribute('alt')) img.setAttribute('alt', name);
      return;
    }
    const ph = document.createElement('span');
    ph.className = 'img-ph';
    ph.textContent = `image: ${name}`;
    img.replaceWith(ph);
  });
  return tpl.innerHTML;
}

// The page's own web-font stylesheet (Inter): the same URL, so it comes from
// the cache; without one the print falls back to the system UI font
function fontLinks() {
  return [...document.querySelectorAll('link[rel="stylesheet"][href^="https://fonts.googleapis.com/"]')]
    .map(l => `<link rel="stylesheet" href="${esc(l.href)}">`).join('');
}

function printDocument(doc, title) {
  const fields = doc.fields.length
    ? `<dl class="doc-fields">${doc.fields.map(f => `<div><dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd></div>`).join('')}</dl>`
    : '';
  const meta = doc.metaLine.split(' · ').slice(1).join(' · ');
  const body = doc.bodyEmpty ? '' : `<main class="doc-body">${printBody(doc.html)}</main>`;
  const sections = doc.sections.length ? `<section class="doc-sections">${printBody(sectionsHtml(doc))}</section>` : '';
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    + `<title>${esc(title)}</title>`
    + fontLinks()
    + `<style>${PRINT_CSS}</style></head><body>`
    + `<header class="doc-head"><div class="doc-kind">${esc(doc.kind)}</div><h1 class="doc-title">${esc(doc.title)}</h1>`
    + `<div class="doc-meta">${esc(meta)}</div>${fields}</header>${body}${sections}</body></html>`;
}

function withTimeout(promise, ms) {
  return Promise.race([Promise.resolve(promise).catch(() => {}), new Promise(r => setTimeout(r, ms))]);
}

// R2 pictures not on screen yet (still loading): fetch them first, briefly.
// Signed out, fetchFileBlobUrl answers null at once (placeholders print)
async function prefetchImages(doc) {
  const ids = new Set();
  parse(doc.html + sectionsHtml(doc)).content.querySelectorAll('img[data-r2-file-id]').forEach(img => {
    const id = img.getAttribute('data-r2-file-id');
    if (id && !getBlobUrlForFile(id)) ids.add(id);
  });
  if (!ids.size) return;
  await withTimeout(Promise.all([...ids].map(id => fetchFileBlobUrl(id).catch(() => null))), 3000);
}

let printing = null; // { phase: 'preparing' | 'printed', cleanup }

async function printPdf(src) {
  if (printing && printing.phase === 'preparing') return true;
  // A frame whose dialog closed without an afterprint goes now, not after the fallback
  if (printing) printing.cleanup();
  const doc = collectDoc(src);
  if (nothingToExport(doc)) { api.toast('Nothing to export yet'); return true; }
  const name = exportFileName(doc.kind, doc.title, doc.now);
  const frame = document.createElement('iframe');
  // Same origin (blob: images load) but no scripts; allow-modals lets print() run
  frame.setAttribute('sandbox', 'allow-same-origin allow-modals');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.className = 'wr-print-frame';
  frame.dataset.wrUi = '';
  frame.title = name;
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;';
  const state = { phase: 'preparing', done: false, prevTitle: document.title, title: name, fallback: 0, cleanup: null };
  const prevFocus = document.activeElement;
  const cleanup = () => {
    if (state.done) return;
    state.done = true;
    clearTimeout(state.fallback);
    if (document.title === state.title) document.title = state.prevTitle;
    const hadFocus = document.activeElement === frame;
    frame.remove();
    if (printing === state) printing = null;
    // A browser that focused the frame for its dialog: focus goes back (editor caret, menu button)
    if (hadFocus && prevFocus && prevFocus !== document.body && prevFocus.isConnected) {
      try { prevFocus.focus({ preventScroll: true }); } catch { /* ignore */ }
    }
  };
  state.cleanup = cleanup;
  printing = state;
  try {
    await prefetchImages(doc);
    if (state.done) return true;
    const loaded = new Promise(resolve => frame.addEventListener('load', resolve, { once: true }));
    frame.srcdoc = printDocument(doc, name);
    document.body.appendChild(frame);
    await withTimeout(loaded, 5000);
    const win = frame.contentWindow;
    const fdoc = frame.contentDocument;
    if (!win || !fdoc) throw new Error('print frame unavailable');
    const images = [...fdoc.images].map(img => (img.complete ? null : img.decode ? img.decode() : null));
    await withTimeout(Promise.all([fdoc.fonts ? fdoc.fonts.ready : null, ...images].map(p => Promise.resolve(p).catch(() => {}))), 2500);
    // One more task so the frame lays out its pictures before the dialog snapshots it
    await new Promise(r => setTimeout(r, 40));
    if (state.done) return true;
    win.addEventListener('afterprint', () => setTimeout(cleanup, 0), { once: true });
    // Browsers without a reliable afterprint (Safari) still end print media
    const media = win.matchMedia ? win.matchMedia('print') : null;
    if (media && media.addEventListener) {
      let seen = false;
      media.addEventListener('change', (e) => {
        if (e.matches) seen = true;
        else if (seen) setTimeout(cleanup, 0);
      });
    }
    document.title = name;
    api.toast('Choose “Save as PDF” as the printer', 4000);
    // No win.focus(): print() prints the frame anyway, and where print() does
    // not block, focus would leave the editor until the frame goes
    state.phase = 'printed';
    win.print();
    // print() blocks on desktop browsers (afterprint has run by now); elsewhere wait for it
    state.fallback = setTimeout(cleanup, 60000);
  } catch (err) {
    console.error('[writing] PDF export failed', err);
    api.toast('Couldn’t open the print dialog');
    cleanup();
  }
  return true;
}

// --- Copy formatted text (inline styles: Gmail / Outlook drop <style>) ---------------
const MONO = "ui-monospace, 'Cascadia Code', Menlo, Consolas, monospace";
// No programming ligatures: code pastes as the characters that were typed
const NO_LIGATURES = "font-variant-ligatures:none;font-feature-settings:'liga' 0, 'calt' 0";
const RICH_STYLE = {
  H1: 'font-size:22px;font-weight:700;line-height:1.3;margin:16px 0 6px',
  H2: 'font-size:18px;font-weight:700;line-height:1.3;margin:14px 0 6px',
  H3: 'font-size:15px;font-weight:700;line-height:1.3;margin:12px 0 4px',
  H4: 'font-size:14px;font-weight:700;line-height:1.3;margin:10px 0 4px',
  H5: 'font-size:13px;font-weight:700;line-height:1.3;margin:10px 0 4px',
  H6: 'font-size:13px;font-weight:600;line-height:1.3;margin:10px 0 4px;color:#4b5563',
  BLOCKQUOTE: 'margin:8px 0;padding:2px 0 2px 12px;border-left:3px solid #cbd5e1;color:#4b5563',
  PRE: `margin:8px 0;padding:10px 12px;background:#f6f8fa;border:1px solid #e5e7eb;border-radius:6px;font-family:${MONO};${NO_LIGATURES};font-size:13px;line-height:1.5;white-space:pre-wrap`,
  CODE: `font-family:${MONO};${NO_LIGATURES};font-size:0.9em;background:#f3f4f6;border:1px solid #e5e7eb;border-radius:4px;padding:0 4px`,
  TABLE: 'border-collapse:collapse;margin:8px 0',
  TD: 'border:1px solid #d0d7de;padding:4px 8px;text-align:left;vertical-align:top',
  TH: 'border:1px solid #d0d7de;padding:4px 8px;text-align:left;vertical-align:top;background:#f3f4f6;font-weight:600',
  HR: 'border:none;border-top:1px solid #d0d7de;margin:12px 0',
  A: 'color:#2563eb;text-decoration:underline',
  UL: 'margin:4px 0;padding-left:24px',
  OL: 'margin:4px 0;padding-left:24px'
};

// Under the doc title (an h1) the body's headings step down one level
function shiftHeadings(root) {
  root.querySelectorAll('h1, h2, h3, h4, h5').forEach(h => {
    const next = document.createElement('h' + (Number(h.tagName[1]) + 1));
    next.append(...h.childNodes);
    h.replaceWith(next);
  });
}

function richBody(html, { shift = false } = {}) {
  const tpl = parse(sanitizeRichHtml(html));
  const root = tpl.content;
  if (shift) shiftHeadings(root);
  const make = (tag, style, text) => {
    const el = document.createElement(tag);
    if (style) el.setAttribute('style', style);
    if (text != null) el.textContent = text;
    return el;
  };
  eachImage(root, (img, name) => img.replaceWith(make('span', 'color:#6b7280;font-style:italic', `[image: ${name}]`)));
  root.querySelectorAll('ul.checklist > li').forEach(li => {
    const done = li.classList.contains('checked');
    li.setAttribute('style', 'list-style:none');
    li.insertBefore(document.createTextNode(done ? '☑ ' : '☐ '), li.firstChild);
    if (done) {
      const s = make('s', 'color:#6b7280');
      [...li.childNodes].slice(1).forEach(n => { if (!(n.nodeType === 1 && /^(UL|OL)$/.test(n.tagName))) s.appendChild(n); });
      li.insertBefore(s, li.childNodes[1] || null);
    }
  });
  root.querySelectorAll('ul.checklist').forEach(ul => ul.setAttribute('style', 'margin:4px 0;padding-left:4px;list-style:none'));
  root.querySelectorAll('mark').forEach(m => {
    m.setAttribute('style', `background-color:${HL_COLORS[m.getAttribute('data-highlight-color')] || HL_COLORS.yellow};color:inherit`);
  });
  root.querySelectorAll('.project-task-highlight').forEach(span => {
    span.setAttribute('style', `${span.getAttribute('style') || ''};padding:0 2px;border-radius:3px`.replace(/^;/, ''));
  });
  root.querySelectorAll('.wr-date, .wr-ref').forEach(span => span.setAttribute('style', 'background-color:#eef1f5;border-radius:4px;padding:0 4px'));
  root.querySelectorAll('.wr-callout').forEach(box => {
    const kind = CALLOUT_COLORS[box.getAttribute('data-kind')] ? box.getAttribute('data-kind') : 'note';
    const [c, t] = CALLOUT_COLORS[kind];
    box.setAttribute('style', `margin:8px 0;padding:8px 12px;border-left:3px solid ${c};background-color:${t};border-radius:6px`);
    box.insertBefore(make('div', `font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:${c}`, CALLOUT_LABELS[kind]), box.firstChild);
  });
  root.querySelectorAll('.wr-toggle').forEach(box => {
    box.setAttribute('style', 'margin:6px 0');
    const title = box.querySelector(':scope > .wr-toggle-title');
    if (title) { title.setAttribute('style', 'font-weight:600'); title.insertBefore(document.createTextNode('▸ '), title.firstChild); }
    const body = box.querySelector(':scope > .wr-toggle-body');
    if (body) body.setAttribute('style', 'padding-left:16px');
  });
  root.querySelectorAll('*').forEach(el => {
    if (el.tagName === 'CODE' && el.parentElement && el.parentElement.tagName === 'PRE') return;
    const style = RICH_STYLE[el.tagName];
    if (style && !el.hasAttribute('style')) el.setAttribute('style', style);
  });
  root.querySelectorAll('*').forEach(el => {
    [...el.attributes].forEach(a => {
      if (a.name === 'class' || a.name === 'contenteditable' || a.name.startsWith('data-')) el.removeAttribute(a.name);
    });
  });
  return tpl.innerHTML;
}

function plainSections(doc) {
  return doc.sections.map(s => {
    const lines = Array.isArray(s.checklist) && s.checklist.length
      ? s.checklist.map(c => `${c && c.done ? '[x]' : '[ ]'} ${oneLine(c && c.text)}`)
      : s.items.map(i => `- ${oneLine(i)}`);
    return `${oneLine(s.title)}\n${lines.join('\n')}`;
  }).join('\n\n');
}

function copyFormatted(src, range) {
  const doc = collectDoc(src, range);
  if (range ? doc.bodyEmpty : nothingToExport(doc)) { api.toast('Nothing to copy yet'); return true; }
  const parts = [];
  const text = [];
  if (!range) {
    parts.push(`<h1 style="${RICH_STYLE.H1};margin-top:0">${esc(doc.title)}</h1>`);
    parts.push(`<div style="color:#6b7280;font-size:12px;margin:0 0 4px">${esc(doc.metaLine)}</div>`);
    if (doc.fields.length) parts.push(`<div style="font-size:13px;margin:0 0 10px">${fieldsHtml(doc)}</div>`);
    text.push(doc.title, doc.metaLine);
    if (doc.fields.length) text.push(doc.fields.map(f => `${f.label}: ${f.value}`).join(' · '));
    text.push('');
  }
  if (!doc.bodyEmpty) {
    parts.push(richBody(doc.html, { shift: !range && /<h1[\s>]/i.test(doc.html) }));
    text.push(htmlToPlainText(doc.html, { markers: true }));
  }
  if (!range && doc.sections.length) {
    parts.push(richBody(sectionsHtml(doc)));
    text.push('', plainSections(doc));
  }
  const html = `<meta charset="utf-8"><div style="font-family:Inter, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif;font-size:14px;line-height:1.55;color:#1f2328">${parts.join('')}</div>`;
  writeClipboard({ 'text/html': html, 'text/plain': text.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n' },
    range ? 'Selection copied as formatted text' : 'Copied as formatted text');
  return true;
}

// --- Export menu -----------------------------------------------------------------------
const ITEM_INFO = {
  exportMd: { label: 'Download Markdown (.md)', icon: 'download', group: 'Download', description: 'For Obsidian, GitHub, Notion…' },
  exportPdf: { label: 'Export PDF / print', icon: 'pdf', group: 'Download', description: 'Pick “Save as PDF” in the print dialog' },
  copyMd: { label: 'Copy as Markdown', selLabel: 'Copy selection as Markdown', icon: 'copy', group: 'Copy' },
  copyRich: { label: 'Copy formatted text', selLabel: 'Copy selection as formatted text', icon: 'copyRich', group: 'Copy', description: 'Paste into email, Docs or Word' }
};

function runAction(id, src, range) {
  if (!src) return false;
  switch (id) {
    case 'exportMd': return exportMarkdownFile(src);
    case 'exportPdf': printPdf(src); return true;
    case 'copyMd': return copyMarkdown(src, range);
    case 'copyRich': return copyFormatted(src, range);
    default: return false;
  }
}

let menu = null; // { handle, anchor }

function closeMenu() {
  if (menu && menu.handle.isOpen()) menu.handle.close('api');
  menu = null;
}

// Re-clicking the same anchor closes it (toolbar / view button behave like toggles)
function openToggleMenu(anchor, build) {
  const same = menu && menu.handle.isOpen() && menu.anchor === anchor;
  closeMenu();
  if (same) return null;
  const opts = build();
  if (!opts || !opts.items.length) return null;
  const entry = { anchor, handle: null };
  entry.handle = api.ui.openMenu({
    anchor,
    keyboard: true,
    ...opts,
    onClose: () => { if (menu === entry) menu = null; }
  });
  menu = entry;
  return entry.handle;
}

function menuAnchor(ctx, arg) {
  const a = arg && arg.anchor;
  if (a && a.nodeType === 1 && a.isConnected) return a;
  return ctx.editor ? api.dom.caretRect(api.dom.getSelectionRange(ctx.editor), ctx.editor) : null;
}

function exportMenuItems(ids, { selection, hasKeys, run }) {
  return ids.map(id => {
    const info = ITEM_INFO[id];
    const item = { id, label: selection && info.selLabel ? info.selLabel : info.label, icon: info.icon, group: info.group, description: info.description, run: () => run(id) };
    if (id === 'exportPdf' && hasKeys) item.kbd = api.registry.formatKeys('Mod+P', api.registry.isMac);
    return item;
  });
}

function openEditorExportMenu(ctx, arg) {
  const editor = ctx.editor;
  if (!editor) return false;
  const anchor = menuAnchor(ctx, arg);
  const selection = !!selectionRange(ctx);
  openToggleMenu(anchor, () => ({
    className: 'wr-export-menu',
    // The toolbar button sits at the right end: the menu lines up with its right edge
    placement: anchor && anchor.nodeType === 1 ? 'bottom-end' : 'bottom-start',
    items: exportMenuItems(EXPORT_IDS.filter(id => api.hasCommand(id)), {
      selection,
      hasKeys: true,
      run: (id) => {
        api.ensureSelection(editor);
        api.runCommand(id, api.context(editor), { source: 'menu', anchor: arg && arg.anchor });
      }
    })
  }));
  return true;
}

// --- Read-only views: an Export ▾ button in the actions row ---------------------------------
const viewButtons = new WeakMap(); // button -> view element

function viewHostClass(host) {
  if (host.classList.contains('meetings-view-actions')) return 'meetings-view-icon-btn';
  if (host.classList.contains('ideas-view-actions')) return 'ideas-view-icon-btn';
  return '';
}

function makeViewButton(host, viewEl, id) {
  const btn = document.createElement('button');
  btn.type = 'button';
  const hostClass = viewHostClass(host);
  btn.className = 'wr-view-export' + (hostClass ? ' ' + hostClass : '') + (host.id === 'task-desc-view-actions' ? ' wr-view-export-labeled' : '');
  btn.dataset.wrUi = '';
  btn.title = 'Export: Markdown, PDF, copy';
  btn.setAttribute('aria-label', 'Export');
  btn.setAttribute('aria-haspopup', 'menu');
  btn.innerHTML = api.ui.icon('export', 16) + (host.id === 'task-desc-view-actions' ? '<span class="wr-view-export-text">Export</span>' : '') + api.ui.icon('chevronDown', 11, 'wr-tb-caret');
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const target = viewButtons.get(btn);
    const src = target && target.isConnected ? viewSource(target) : null;
    if (!src) return;
    const ids = src.id === 'notes' ? NOTE_VIEW_IDS : EXPORT_IDS;
    // Open toward the inside of the row: right-hand buttons align the menu's right edge
    const row = (btn.parentElement.parentElement || btn.parentElement).getBoundingClientRect();
    const r = btn.getBoundingClientRect();
    openToggleMenu(btn, () => ({
      className: 'wr-export-menu wr-view-export-menu',
      placement: r.left + r.width / 2 > row.left + row.width / 2 ? 'bottom-end' : 'bottom-start',
      items: exportMenuItems(ids, { selection: false, hasKeys: false, run: (cmd) => runAction(cmd, viewSource(target) || src, null) })
    }));
  });
  viewButtons.set(btn, viewEl);
  // After Edit / Copy / Pin, before Delete and Close
  const before = host.querySelector(':scope > [id$="-delete"], :scope > [class*="icon-danger"], :scope > [id$="-close"]');
  if (before) host.insertBefore(btn, before); else host.appendChild(btn);
  return btn;
}

function onViewAttach(viewEl, ctx) {
  const opts = (ctx && ctx.opts) || {};
  const host = opts.actionsHost;
  if (!host || host.nodeType !== 1) return;
  let btn = host.querySelector(':scope > .wr-view-export');
  if (!btn) btn = makeViewButton(host, viewEl, opts.id);
  viewButtons.set(btn, viewEl);
}

// --- Templates -----------------------------------------------------------------------------
function templateTitle(editor) {
  const st = api.stateOf(editor);
  const title = st && st.opts.getTitle ? safe(() => st.opts.getTitle(), '') : '';
  return oneLine(title);
}

// A line with nothing in it (only <br> / spaces)
function isBlankBlock(node) {
  if (!node) return false;
  if (node.nodeType === 3) return !node.data.replace(/[\s\u00A0\u200B\uFEFF]/g, '');
  if (node.nodeType !== 1 || node.tagName !== 'DIV' || node.className) return false;
  if (node.textContent.replace(/[\s\u00A0\u200B\uFEFF]/g, '')) return false;
  return !node.querySelector('img, hr, table, pre, [contenteditable="false"], .wr-callout, .wr-toggle');
}

function editorIsEmpty(editor) {
  if (editor.childNodes.length > 3) return false;
  if (editor.textContent.replace(/[\s\u00A0\u200B\uFEFF]/g, '')) return false;
  return !editor.querySelector('img, hr, table, pre, li, .wr-callout, .wr-toggle, .wr-date, .wr-ref, .project-task-highlight');
}

// The caret goes to the first line to fill in (an empty line or list item)
function caretToFirstBlank(editor, before) {
  const fresh = [...editor.childNodes].filter(n => !before.has(n));
  for (const top of fresh) {
    const candidates = top.nodeType === 1 ? [top, ...top.querySelectorAll('div, li')] : [];
    const blank = candidates.find(el => /^(DIV|LI)$/.test(el.tagName) && !el.querySelector('div, li, ul, ol, table') &&
      !el.textContent.replace(/[\s\u00A0\u200B\uFEFF]/g, '') && !el.closest('.wr-table'));
    if (blank) {
      api.dom.placeCaretAtStart(blank);
      blank.scrollIntoView({ block: 'nearest' });
      return;
    }
  }
}

// Undo-safe: one insertHTML. An empty editor or an empty line is replaced by
// the template; otherwise it goes after the block the caret is in
function insertTemplate(editor, template, savedRange) {
  if (!editor || !editor.isConnected) return;
  const html = renderTemplate(template, templateVars({ now: new Date(), title: templateTitle(editor) }));
  if (!html) return;
  if (savedRange && editor.contains(savedRange.startContainer)) api.dom.restoreRange(savedRange, editor);
  else api.ensureSelection(editor);
  const range = document.createRange();
  const current = api.dom.getSelectionRange(editor);
  if (editorIsEmpty(editor) || !current) {
    range.selectNodeContents(editor);
  } else {
    const top = api.dom.topBlockOf(current.startContainer, editor);
    if (!top) range.selectNodeContents(editor);
    else if (isBlankBlock(top)) range.selectNode(top);
    else { range.setStartAfter(top); range.collapse(true); }
  }
  const before = new Set(editor.childNodes);
  api.dom.restoreRange(range, editor);
  api.dom.insertHTML(html);
  caretToFirstBlank(editor, before);
  api.notifyChange(editor);
  updateHint(editor);
}

function templateItems(list, run) {
  return list.map(t => ({ id: t.id, label: t.name, description: t.description, iconHtml: templateIcon(t.icon), run: () => run(t) }));
}

function openTemplateMenu(editor, anchor, savedRange) {
  const st = api.stateOf(editor);
  const list = st ? templatesFor(st.opts.id) : [];
  if (!list.length) return false;
  openToggleMenu(anchor, () => ({
    className: 'wr-template-menu',
    title: 'Templates',
    footer: 'Inserted at the caret · Ctrl+Z undoes it'.replace('Ctrl+Z', api.registry.isMac ? '⌘Z' : 'Ctrl+Z'),
    items: templateItems(list, (t) => insertTemplate(editor, t, savedRange))
  }));
  return true;
}

function templateAvailable(ctx) {
  return !!(ctx && ctx.editor && ctx.tier === 'full' && ctx.features && ctx.features.templates && templatesFor(ctx.id).length);
}

// --- "Start with a template" hint (empty projects / meetings / task) ---------------------------
const hints = new Map(); // editor -> { el, chips }
const hintObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(entries => {
  entries.forEach(entry => {
    const editor = entry.target;
    if (!editor.isConnected) { dropHint(editor); return; }
    updateHint(editor); // also shows / hides it as the editor gets wide or narrow enough
  });
}) : null;

// The hint needs about this much text width (its button alone is ~175px). In a narrower editor
// (meetings on a phone) it would spill out and sit where you tap to start typing, so it stays
// hidden there; templates are still in Insert and /template
const HINT_MIN_WIDTH = 200;

function hintWanted(editor) {
  const st = api.stateOf(editor);
  return !!(st && st.opts.tier === 'full' && HINT_PICKS[st.opts.id] && st.features && st.features.templates && templatesFor(st.opts.id).length);
}

function hintFits(editor) {
  const cs = getComputedStyle(editor);
  return editor.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0) >= HINT_MIN_WIDTH;
}

function dropHint(editor) {
  const h = hints.get(editor);
  if (!h) return;
  if (hintObserver) hintObserver.unobserve(editor);
  h.el.remove();
  hints.delete(editor);
}

function pruneHints() {
  hints.forEach((h, editor) => { if (!editor.isConnected) dropHint(editor); });
}

function buildHint(editor) {
  const st = api.stateOf(editor);
  const list = templatesFor(st.opts.id);
  // A zero-height anchor right after the editor holds the absolute row, so
  // the row scrolls (and clips) with the editor inside scrolling dialogs
  const anchor = document.createElement('div');
  anchor.className = 'wr-tpl-hint-anchor';
  anchor.dataset.wrUi = '';
  anchor.hidden = true;
  const el = document.createElement('div');
  el.className = 'wr-tpl-hint';
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', 'Start with a template');
  anchor.appendChild(el);
  const start = document.createElement('button');
  start.type = 'button';
  start.className = 'wr-tpl-start';
  start.setAttribute('aria-haspopup', 'menu');
  start.innerHTML = `${api.ui.icon('template', 14)}<span>Start with a template</span>${api.ui.icon('chevronDown', 11, 'wr-tb-caret')}`;
  start.addEventListener('mousedown', e => e.preventDefault());
  start.addEventListener('click', (e) => {
    e.preventDefault();
    openTemplateMenu(editor, start, null);
  });
  el.appendChild(start);
  const picks = (HINT_PICKS[st.opts.id] || []).map(id => list.find(t => t.id === id)).filter(Boolean).slice(0, 3);
  const chips = picks.map(t => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'wr-tpl-chip';
    chip.title = t.description;
    chip.innerHTML = `${templateIcon(t.icon, 13)}<span>${esc(t.name)}</span>`;
    chip.addEventListener('mousedown', e => e.preventDefault());
    chip.addEventListener('click', (e) => {
      e.preventDefault();
      closeMenu();
      insertTemplate(editor, t, null);
    });
    el.appendChild(chip);
    return chip;
  });
  return { el: anchor, box: el, chips };
}

// Overlay under the placeholder line, inside the editor's box (absolute, so
// typing the first character never shifts the layout)
function positionHint(editor) {
  const h = hints.get(editor);
  if (!h || h.el.hidden) return;
  const er = editor.getBoundingClientRect();
  if (!er.width || !er.height) return;
  if (h.el.previousElementSibling !== editor) editor.after(h.el);
  const cs = getComputedStyle(editor);
  const padL = parseFloat(cs.paddingLeft) || 0, padR = parseFloat(cs.paddingRight) || 0, padT = parseFloat(cs.paddingTop) || 0;
  const bl = parseFloat(cs.borderLeftWidth) || 0, bt = parseFloat(cs.borderTopWidth) || 0;
  const line = parseFloat(cs.lineHeight) || (parseFloat(cs.fontSize) || 14) * 1.5;
  const box = h.box;
  const setStyle = (prop, value) => { if (box.style[prop] !== value) box.style[prop] = value; };
  setStyle('maxWidth', Math.round(Math.max(120, er.width - padL - padR - 2 * bl)) + 'px');
  // Where left/top 0 lands (the anchor's box), then offset to the editor's
  // text box. Styles are only written when they change (glass-glow observes style)
  const cur = box.getBoundingClientRect();
  const originLeft = cur.left - (parseFloat(box.style.left) || 0);
  const originTop = cur.top - (parseFloat(box.style.top) || 0);
  setStyle('left', Math.round(er.left + bl + padL - originLeft) + 'px');
  setStyle('top', Math.round(er.top + bt + padT + line + 8 - originTop) + 'px');
  // Chips that would wrap onto a second row are left out
  h.chips.forEach(c => { c.hidden = false; });
  const firstTop = box.firstElementChild ? box.firstElementChild.offsetTop : 0;
  h.chips.forEach(c => { if (c.offsetTop > firstTop + 4) c.hidden = true; });
}

function updateHint(editor) {
  if (!editor || !editor.isConnected) return;
  if (!hintWanted(editor)) { dropHint(editor); return; }
  let h = hints.get(editor);
  const empty = editorIsEmpty(editor);
  if (!h) {
    if (!empty) return;
    h = buildHint(editor);
    hints.set(editor, h);
    editor.after(h.el);
    if (hintObserver) hintObserver.observe(editor);
  }
  const show = empty && hintFits(editor);
  if (h.el.hidden !== !show) h.el.hidden = !show;
  if (show) positionHint(editor);
}

function onWindowResize() {
  hints.forEach((h, editor) => updateHint(editor));
}

// --- Install ---------------------------------------------------------------------------------
export function install(writingApi) {
  api = writingApi;

  const editorCommand = (id) => ({
    run(ctx) {
      const src = sourceFromCtx(ctx);
      if (!src) return false;
      return runAction(id, src, id === 'copyMd' || id === 'copyRich' ? selectionRange(ctx) : null);
    },
    isAvailable: (ctx) => !!(ctx && (ctx.view || (ctx.editor && ctx.features && ctx.features.export)))
  });
  EXPORT_IDS.forEach(id => api.registerCommand(id, editorCommand(id)));

  api.registerCommand('exportMenu', {
    run: (ctx, arg) => openEditorExportMenu(ctx, arg),
    isAvailable: (ctx) => !!(ctx && ctx.editor && ctx.features && ctx.features.export)
  });

  // arg.templateId inserts that template straight away (no menu)
  api.registerCommand('template', {
    run(ctx, arg) {
      const saved = ctx.range ? ctx.range.cloneRange() : null;
      const direct = arg && arg.templateId ? templatesFor(ctx.id).find(t => t.id === arg.templateId) : null;
      if (direct) { closeMenu(); insertTemplate(ctx.editor, direct, saved); return true; }
      // From the Insert menu the anchor is its + button: anchor to where it
      // is (a rect), so clicking + again closes this menu and reopens Insert
      let anchor = menuAnchor(ctx, arg);
      if (anchor && anchor.nodeType === 1) anchor = anchor.getBoundingClientRect();
      return openTemplateMenu(ctx.editor, anchor, saved);
    },
    isAvailable: templateAvailable
  });

  api.onViewAttach(onViewAttach);

  api.onAttach((editor) => { pruneHints(); updateHint(editor); });
  api.hooks.load.push((editor) => { updateHint(editor); });
  api.hooks.change.push((editor) => {
    const h = hints.get(editor);
    // Cheap while there is content: only an empty editor can need the hint
    if (h || editorIsEmpty(editor)) updateHint(editor);
  });
  window.addEventListener('resize', onWindowResize);
}
