// Personal Dashboard - Writing: links
// Ctrl+K link editor (Text + Link fields, Enter applies, Esc cancels, Remove
// and Open when editing), the link card (hover, plain click or caret moved in
// with the keyboard: Open, Edit, Copy, Remove), autolink on Space / Enter
// (pref autolink; Backspace right after gives the text back) and pasting a URL
// over selected text. Every change is one execCommand step, so Ctrl+Z undoes it.
//
// Command `link` (api.runCommand('link', ctx, arg)):
//   arg.href | arg.url (+ arg.text)  link the selection straight away (no editor)
//   arg.link + arg.action 'remove'   remove that link (context menu)
//   arg.link + arg.focus 'text'|'url' edit that link (context menu, card)
//   anything else                    opens the link editor at the selection

import { matchAutolink, normalizeLinkUrl } from '../../core/writing-rules.js';
import { isPlainPasteArmed, replaceInline } from './paste.js';

let api = null;
let dom = null;
let ui = null;

const ZWSP = String.fromCharCode(0x200B);
const INVISIBLE = new RegExp('[' + ZWSP + String.fromCharCode(0xFEFF) + ']', 'g');
const NAV_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);
const HOVER_DELAY = 450;   // ms over a link before its card shows
const HIDE_DELAY = 280;    // grace to move from the link onto the card

// --- Small helpers -----------------------------------------------------------
const cleanText = (s) => String(s ?? '').replace(INVISIBLE, '');

function svg(body, size = 16) {
  return `<svg class="wr-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}
const ICON = {
  open: '<path d="M14 4h6v6"/><line x1="20" y1="4" x2="11" y2="13"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
  edit: '<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3z"/><line x1="14.5" y1="7.5" x2="17.5" y2="10.5"/>',
  unlink: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/><line x1="3.5" y1="3.5" x2="20.5" y2="20.5"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><polyline points="3.5 6.5 12 13 20.5 6.5"/>'
};

function esc(text) { return dom.escapeHtml(text); }

function linkHtml(url, inner) {
  const extra = url.startsWith('#') ? '' : ' target="_blank" rel="noopener noreferrer"';
  return `<a href="${esc(url)}"${extra}>${inner}</a>`;
}

function setCanonicalAttrs(a, url) {
  if (!a || url.startsWith('#')) return;
  if (a.getAttribute('target') !== '_blank') a.setAttribute('target', '_blank');
  if (a.getAttribute('rel') !== 'noopener noreferrer') a.setAttribute('rel', 'noopener noreferrer');
}

function linkOf(node, editor) {
  return node ? dom.closestIn(node, 'a[href]', editor) : null;
}

// The link the selection sits in: the caret, a selection inside one link, or
// a selection of exactly the link element
function linkAt(ctx) {
  if (!ctx || !ctx.editor || !ctx.range) return null;
  const r = ctx.range;
  if (!r.collapsed && r.startContainer === r.endContainer && r.endOffset - r.startOffset === 1) {
    const only = r.startContainer.childNodes && r.startContainer.childNodes[r.startOffset];
    if (only && only.nodeName === 'A' && only.hasAttribute('href')) return only;
  }
  const a = linkOf(ctx.node || dom.anchorNode(r), ctx.editor);
  if (!a) return null;
  if (!r.collapsed && !a.contains(r.endContainer)) return null;
  return a;
}

function selectRange(range) {
  const sel = window.getSelection();
  if (!sel || !range) return;
  sel.removeAllRanges();
  sel.addRange(range);
}

function focusEditor(editor) {
  if (document.activeElement === editor || editor.contains(document.activeElement)) return;
  try { editor.focus({ preventScroll: true }); } catch { editor.focus(); }
}

function sameLine(range, editor) {
  return dom.blockOf(range.startContainer, editor) === dom.blockOf(range.endContainer, editor);
}

// Short label for a URL: no scheme, no www., no trailing slash
function displayUrl(href) {
  const h = String(href || '');
  if (/^mailto:/i.test(h)) return h.slice(7);
  return h.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '');
}

// Text a URL the user typed should show: what they typed, minus mailto:
function labelFor(raw, url) {
  const typed = cleanText(raw).trim();
  if (typed) return /^mailto:/i.test(typed) ? typed.slice(7) : typed;
  return displayUrl(url);
}

// A pasted / selected word that is clearly a link: explicit scheme, www.…,
// or domain.tld/… (the autolink rules); bare words and emails stay text
function urlFromText(text) {
  const t = cleanText(text).trim();
  if (!t || /\s/.test(t) || t.length > 2048) return null;
  if (/^(https?:\/\/|mailto:)/i.test(t)) return normalizeLinkUrl(t);
  const m = matchAutolink(t + ' ');
  return m && m.start === 0 && m.end === t.length ? m.url : null;
}

function modClickLabel() {
  return api.registry.isMac ? '⌘+click' : 'Ctrl+click';
}

async function copyText(text, editor) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall back */ }
  // Fallback: a hidden textarea (then put the caret back)
  const saved = editor ? dom.getSelectionRange(editor)?.cloneRange() : null;
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.dataset.wrUi = '';
  ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  if (saved && editor) dom.restoreRange(saved, editor);
  return ok;
}

// --- Applying links (undo-safe) -------------------------------------------------
// Grow a range over links it only partly covers, so the new link replaces them
function growOverLinks(range, editor) {
  const r = range.cloneRange();
  const s = linkOf(r.startContainer, editor);
  if (s) r.setStartBefore(s);
  const e = linkOf(r.endContainer, editor);
  if (e) r.setEndAfter(e);
  return r;
}

// New link at a range: a caret inserts linked text; a one-line selection is
// wrapped (its formatting kept) or replaced by new text; a selection over
// several lines uses the native createLink (one link per line).
// opts: { text (label typed in the editor), textChanged, raw (URL as typed) }
function insertLink(editor, range, url, opts = {}) {
  focusEditor(editor);
  let r = range && editor.contains(range.startContainer) && editor.contains(range.endContainer) ? range : null;
  if (!r) {
    dom.placeCaretAtEnd(editor);
    r = dom.getSelectionRange(editor);
    if (!r) return false;
  }
  const label = opts.text != null ? cleanText(opts.text).trim() : '';
  if (r.collapsed) {
    return replaceInline(editor, r, linkHtml(url, esc(label || labelFor(opts.raw, url))));
  }
  r = dom.trimRangeEnd(r, editor);
  if (!sameLine(r, editor)) {
    selectRange(r);
    const ok = dom.exec('createLink', url);
    // createLink writes only href: add the canonical target / rel
    editor.querySelectorAll('a[href]').forEach(a => { if (a.getAttribute('href') === url) setCanonicalAttrs(a, url); });
    const sel = window.getSelection();
    if (sel && sel.rangeCount) sel.collapseToEnd();
    api.notifyChange(editor);
    return ok;
  }
  if (opts.textChanged && label) {
    return replaceInline(editor, growOverLinks(r, editor), linkHtml(url, esc(label)));
  }
  const whole = growOverLinks(dom.expandToWholeInlines(r, editor), editor);
  const holder = document.createElement('div');
  holder.appendChild(whole.cloneContents());
  holder.querySelectorAll('a').forEach(a => a.replaceWith(...a.childNodes));
  if (!cleanText(holder.textContent).trim() && !holder.querySelector('img, [contenteditable="false"]')) {
    return replaceInline(editor, whole, linkHtml(url, esc(labelFor(opts.raw, url))));
  }
  return replaceInline(editor, whole, linkHtml(url, holder.innerHTML));
}

// Change an existing link's address and/or text (its formatting is kept while
// the text is unchanged)
function updateLink(editor, a, url, newText) {
  if (!a || !a.isConnected) return false;
  focusEditor(editor);
  const typed = newText != null ? cleanText(newText) : null;
  const textChanged = typed != null && typed.trim() !== '' && typed !== cleanText(a.textContent);
  if (!textChanged && a.getAttribute('href') === url) {
    caretAfter(a);
    return true;
  }
  const r = document.createRange();
  r.selectNode(a);
  return replaceInline(editor, r, linkHtml(url, textChanged ? esc(typed) : a.innerHTML));
}

function caretAfter(node) {
  const r = document.createRange();
  r.setStartAfter(node);
  r.collapse(true);
  selectRange(r);
}

// Remove a link, keeping its text (and formatting); the caret ends after it
function removeLink(editor, a) {
  if (!a || !a.isConnected || !editor.contains(a)) return false;
  closeCard();
  focusEditor(editor);
  dom.selectNode(a);
  dom.exec('unlink');
  if (a.isConnected && editor.contains(a) && a.hasAttribute('href')) {
    // unlink refused (rare): unwrap by hand
    if (dom.unwrapInline(a) === 'manual') api.notifyChange(editor);
  }
  const sel = window.getSelection();
  if (sel && sel.rangeCount && editor.contains(sel.anchorNode)) sel.collapseToEnd();
  return true;
}

// --- Link editor (Ctrl+K) ------------------------------------------------------
let linkEditor = null; // { pop, editor }
let uid = 0;

function closeLinkEditor(reason = 'api') {
  if (linkEditor) linkEditor.pop.close(reason);
}

function openLinkEditor(editor, opts = {}) {
  closeCard();
  closeLinkEditor();
  const link = opts.link && opts.link.isConnected && editor.contains(opts.link) ? opts.link : null;
  if (link && !dom.getSelectionRange(editor)) {
    // From the hover card with the caret elsewhere: Esc comes back to the link
    focusEditor(editor);
    const walker = document.createTreeWalker(link, NodeFilter.SHOW_TEXT);
    let last = null;
    for (let t = walker.nextNode(); t; t = walker.nextNode()) last = t;
    if (last) dom.placeCaret(last, last.data.length); else dom.placeCaretAtEnd(link);
  }
  const live = dom.getSelectionRange(editor);
  const range = link ? null : (opts.range || live);
  if (!link && !range) return false;
  const saved = range ? range.cloneRange() : null;

  // What the Text field can change: a link's text, or a one-line text selection
  let text = '';
  let textEditable = true;
  if (link) {
    text = cleanText(link.textContent);
  } else if (saved && !saved.collapsed) {
    const r = dom.trimRangeEnd(saved, editor);
    const holder = document.createElement('div');
    holder.appendChild(r.cloneContents());
    if (!sameLine(r, editor) || holder.querySelector('img, br, hr, table, [contenteditable="false"]')) textEditable = false;
    text = cleanText(r.toString());
  }
  // A selected web address or email fills the Link field
  const email = /^[^\s@/:]+@[^\s@/:]+\.[a-z]{2,}$/i.test(text.trim()) ? 'mailto:' + text.trim() : '';
  const prefill = link ? (link.getAttribute('href') || '') : (urlFromText(text) || email);

  const n = ++uid;
  const root = document.createElement('div');
  root.className = 'wr-link-editor';
  root.innerHTML = `
    <div class="wr-link-row wr-link-row-text"${textEditable ? '' : ' hidden'}>
      <span class="wr-link-row-icon">${ui.icon('text', 15)}</span>
      <input id="wr-link-text-${n}" class="wr-link-input wr-link-text" type="text" placeholder="Text to show" aria-label="Text to show" autocomplete="off" spellcheck="false">
    </div>
    <div class="wr-link-row wr-link-row-url">
      <span class="wr-link-row-icon">${ui.icon('link', 15)}</span>
      <input id="wr-link-url-${n}" class="wr-link-input wr-link-url" type="url" inputmode="url" placeholder="Paste or type a link" aria-label="Link address" aria-describedby="wr-link-err-${n}" autocomplete="off" spellcheck="false">
    </div>
    <div id="wr-link-err-${n}" class="wr-link-error" role="alert" hidden></div>
    <div class="wr-link-actions">
      ${link ? '<button type="button" class="wr-link-btn wr-link-remove">Remove link</button>' : `<span class="wr-link-hint">${ui.kbdHtml(['Enter'])} to add · ${ui.kbdHtml(['Esc'])} to cancel</span>`}
      <span class="wr-link-spacer"></span>
      ${link ? `<button type="button" class="wr-link-btn wr-link-icon-btn wr-link-open" title="Open in a new tab" aria-label="Open link in a new tab">${svg(ICON.open, 16)}</button>` : ''}
      <button type="button" class="wr-link-btn wr-link-apply">${link ? 'Save' : 'Add link'}</button>
    </div>`;
  root.addEventListener('mousedown', (e) => {
    // Buttons act on click without taking focus from the inputs
    if (e.target.closest('button')) e.preventDefault();
  });
  const textInput = root.querySelector('.wr-link-text');
  const urlInput = root.querySelector('.wr-link-url');
  const urlRow = root.querySelector('.wr-link-row-url');
  const errorEl = root.querySelector('.wr-link-error');
  textInput.value = text;
  urlInput.value = prefill;

  const focusTarget = opts.focus === 'text' && textEditable ? textInput : urlInput;
  const pop = ui.openPopover({
    anchor: link || undefined,
    content: root,
    editor,
    className: 'wr-link-pop',
    placement: 'bottom-start',
    role: 'dialog',
    onClose: () => { if (linkEditor && linkEditor.pop === pop) linkEditor = null; }
  });
  pop.el.setAttribute('aria-label', link ? 'Edit link' : 'Add link');
  linkEditor = { pop, editor };
  // Focus right away (not on the next frame): keys typed straight after
  // Ctrl+K must land in the field, never over the selected text
  try { focusTarget.focus({ preventScroll: true }); } catch { focusTarget.focus(); }
  focusTarget.select();

  const showError = (msg) => {
    errorEl.textContent = msg;
    errorEl.hidden = false;
    urlRow.classList.add('is-invalid');
    urlInput.setAttribute('aria-invalid', 'true');
    root.classList.remove('is-shaking');
    void root.offsetWidth; // restart the animation
    root.classList.add('is-shaking');
    urlInput.focus();
    pop.reposition();
  };
  urlInput.addEventListener('input', () => {
    if (errorEl.hidden) return;
    errorEl.hidden = true;
    urlRow.classList.remove('is-invalid');
    urlInput.removeAttribute('aria-invalid');
  });
  root.addEventListener('animationend', () => root.classList.remove('is-shaking'));

  const apply = () => {
    const raw = urlInput.value.trim();
    if (!raw) {
      if (link) { pop.close('apply'); removeLink(editor, link); return; }
      showError('Paste or type a link first');
      return;
    }
    const url = normalizeLinkUrl(raw);
    if (!url) {
      showError('Use a web address (https://…) or an email address');
      return;
    }
    const typed = textEditable ? textInput.value : null;
    pop.close('apply'); // puts the selection back in the editor
    if (!editor.isConnected) return;
    if (link) {
      updateLink(editor, link, url, typed);
    } else {
      insertLink(editor, saved, url, { text: typed, textChanged: typed != null && cleanText(typed) !== text, raw });
    }
    api.notifyChange(editor);
  };

  root.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && e.target.tagName === 'INPUT') {
      e.preventDefault();
      apply();
      return;
    }
    if (e.key === 'Tab') {
      // Keep Tab inside the popover
      const items = [...root.querySelectorAll('input, button')].filter(el => !el.closest('[hidden]') && !el.disabled);
      if (!items.length) return;
      const i = items.indexOf(document.activeElement);
      const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i === items.length - 1 ? 0 : i + 1);
      e.preventDefault();
      items[next].focus();
    }
  });
  root.querySelector('.wr-link-apply').addEventListener('click', apply);
  const removeBtn = root.querySelector('.wr-link-remove');
  if (removeBtn) removeBtn.addEventListener('click', () => { pop.close('apply'); removeLink(editor, link); api.notifyChange(editor); });
  const openBtn = root.querySelector('.wr-link-open');
  if (openBtn) {
    openBtn.addEventListener('click', () => {
      const url = normalizeLinkUrl(urlInput.value.trim()) || link.getAttribute('href');
      if (!dom.openSafe(url)) api.toast('That link can’t be opened');
    });
  }
  return true;
}

// --- Link card -------------------------------------------------------------------
let card = null; // { pop, link, editor, mode: 'hover' | 'click' | 'caret', check, onScroll }
let hoverTimer = 0;
let hideTimer = 0;
let hoveredLink = null;
let escapedLink = null; // its card was closed with Esc: no hover card until the pointer leaves it
let navKeyAt = 0;
let caretLink = null; // the link the caret was in at the last selection change

const canHover = () => !!(window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches);

function closeCard() {
  clearTimeout(hideTimer);
  if (!card) return;
  const c = card;
  card = null;
  c.pop.close('api');
}

// Is the link still visible inside its scrolling ancestors?
function linkVisible(link, editor) {
  const lr = link.getBoundingClientRect();
  if (!lr.width && !lr.height) return false;
  for (let el = editor; el && el !== document.body; el = el.parentElement) {
    const oy = getComputedStyle(el).overflowY;
    if (oy === 'visible') continue;
    const r = el.getBoundingClientRect();
    if (lr.bottom < r.top || lr.top > r.bottom) return false;
  }
  return true;
}

function cardButton(act, icon, label, title) {
  return `<button type="button" class="wr-link-card-btn" data-act="${act}" aria-label="${esc(label)}" title="${esc(title)}">${icon}</button>`;
}

function showCard(link, editor, mode) {
  if (!link || !link.isConnected || !editor || !editor.isConnected) return;
  if (card && card.link === link) {
    if (mode !== 'hover') card.mode = mode;
    clearTimeout(hideTimer);
    card.pop.reposition();
    return;
  }
  if (linkEditor) return;
  if (mode === 'hover' && link === escapedLink) return;
  // Another writing popup (slash menu, picker...) owns the keys: stay out of its way
  const top = ui.topPopup();
  if (top && (!card || top.el !== card.pop.el)) return;
  closeCard();
  escapedLink = null;
  const href = link.getAttribute('href') || '';
  const safe = dom.safeUrl(href);
  const mail = /^mailto:/i.test(href);
  const editKeys = api.registry.keyHint ? api.registry.keyHint('link', api.registry.isMac) : '';
  const body = document.createElement('div');
  body.className = 'wr-link-card-body';
  body.innerHTML = `
    <span class="wr-link-card-icon">${mail ? svg(ICON.mail, 14) : ui.icon('link', 14)}</span>
    <span class="wr-link-card-url${safe && !href.startsWith('#') ? '' : ' is-inert'}${safe ? '' : ' is-unsafe'}"></span>
    <span class="wr-link-card-sep" aria-hidden="true"></span>
    ${cardButton('open', svg(ICON.open, 15), 'Open link in a new tab', `Open in a new tab (${modClickLabel()})`)}
    ${cardButton('edit', svg(ICON.edit, 15), 'Edit link', editKeys ? `Edit link (${editKeys})` : 'Edit link')}
    ${cardButton('copy', ui.icon('copy', 15), 'Copy link address', 'Copy link')}
    ${cardButton('remove', svg(ICON.unlink, 15), 'Remove link', 'Remove link (keeps the text)')}`;
  const urlEl = body.querySelector('.wr-link-card-url');
  urlEl.textContent = safe ? displayUrl(href) : `Blocked link: ${href}`;
  urlEl.title = !safe ? 'Only web and email links can be opened'
    : href.startsWith('#') ? href : `${href}\n${modClickLabel()} the link to open it`;
  const openBtn = body.querySelector('[data-act="open"]');
  if (!safe || href.startsWith('#')) openBtn.disabled = true;

  const entry = { pop: null, link, editor, mode, check: 0, onScroll: null };
  const pop = ui.openPopover({
    anchor: link,
    content: body,
    className: 'wr-link-card',
    placement: 'bottom-start',
    restoreSelection: false,
    role: 'toolbar',
    onClose: (reason) => {
      clearInterval(entry.check);
      if (entry.onScroll) document.removeEventListener('scroll', entry.onScroll, true);
      if (card === entry) card = null;
      if (reason === 'escape') escapedLink = link;
    }
  });
  pop.el.setAttribute('aria-label', 'Link');
  entry.pop = pop;
  card = entry;

  body.addEventListener('mousedown', (e) => e.preventDefault()); // the editor keeps its caret
  body.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (urlEl.contains(e.target)) { if (safe && !href.startsWith('#')) { dom.openSafe(href); closeCard(); } return; }
    if (!btn || btn.disabled) return;
    const act = btn.dataset.act;
    if (act === 'open') {
      if (!dom.openSafe(href)) api.toast('That link can’t be opened');
      closeCard();
    } else if (act === 'edit') {
      closeCard();
      openLinkEditor(editor, { link, focus: 'url' });
    } else if (act === 'copy') {
      copyText(href, editor).then(ok => api.toast(ok ? 'Link copied' : 'Couldn’t copy the link'));
      closeCard();
    } else if (act === 'remove') {
      removeLink(editor, link);
      api.notifyChange(editor);
    }
  });
  pop.el.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  pop.el.addEventListener('mouseleave', (e) => {
    if (card !== entry || entry.mode !== 'hover') return;
    if (e.relatedTarget && link.contains(e.relatedTarget)) return;
    scheduleHide();
  });
  // Gone with its editor (modal closed, meeting rebuilt) or scrolled away
  entry.check = setInterval(() => {
    if (!link.isConnected || !editor.isConnected || !editor.getClientRects().length) closeCard();
  }, 400);
  entry.onScroll = (e) => {
    if (e.target && e.target.nodeType === 1 && pop.el.contains(e.target)) return;
    if (!linkVisible(link, editor)) closeCard();
  };
  document.addEventListener('scroll', entry.onScroll, true);
}

function scheduleHide() {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (card && card.mode === 'hover') closeCard();
  }, HIDE_DELAY);
}

// Per-editor pointer listeners (hover card) and focus loss
function onAttach(editor) {
  editor.addEventListener('mouseover', (e) => {
    const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || !editor.contains(a)) return;
    if (hoveredLink === a) return;
    hoveredLink = a;
    clearTimeout(hideTimer);
    clearTimeout(hoverTimer);
    if (card && card.link === a) return;
    if (!canHover() || e.buttons) return;
    hoverTimer = setTimeout(() => {
      if (hoveredLink !== a || !a.isConnected) return;
      if (!window.getSelection().isCollapsed && editor.contains(window.getSelection().anchorNode)) return; // selecting
      showCard(a, editor, 'hover');
    }, HOVER_DELAY);
  });
  editor.addEventListener('mouseout', (e) => {
    const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || (e.relatedTarget && a.contains(e.relatedTarget))) return;
    if (hoveredLink === a) hoveredLink = null;
    if (escapedLink === a) escapedLink = null;
    clearTimeout(hoverTimer);
    if (card && card.link === a && card.mode === 'hover' && !(e.relatedTarget && card.pop.el.contains(e.relatedTarget))) scheduleHide();
  });
  editor.addEventListener('focusout', (e) => {
    if (!card || card.editor !== editor || card.mode === 'hover') return;
    const to = e.relatedTarget;
    if (to && (editor.contains(to) || card.pop.el.contains(to))) return;
    closeCard();
  });
}

// --- Hooks -----------------------------------------------------------------------
let lastAuto = null; // { editor, link, block, caret }: autolink Backspace can revert

function onClick(e, ctx) {
  if (ctx.view || !ctx.editor) return false;
  lastAuto = null;
  if (!ctx.link) return false;
  // Plain click on a link: the caret goes in (core) and the card shows
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed) return true;
  showCard(ctx.link, ctx.editor, 'click');
  return true;
}

function caretAt(ctx, la) {
  const r = ctx.range;
  if (!r || !r.collapsed || ctx.editor !== la.editor || !la.block.isConnected || !la.block.contains(r.startContainer)) return false;
  const off = dom.rangeToOffsets(r, la.block);
  return !!off && off.start === la.caret;
}

function onKeydown(e, ctx) {
  // Backspace right after an autolink gives the plain text back
  if (lastAuto) {
    const la = lastAuto;
    if (e.key === 'Backspace' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      lastAuto = null;
      if (la.link && la.link.isConnected && caretAt(ctx, la)) {
        dom.selectNode(la.link);
        dom.exec('unlink');
        const back = dom.offsetsToRange(la.block, { start: la.caret, end: la.caret }, { caretAfter: true });
        if (back) selectRange(back);
        return true;
      }
    } else if (!['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) {
      lastAuto = null;
    }
  }
  if (NAV_KEYS.has(e.key) && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) navKeyAt = Date.now();
  return false;
}

// A URL finished with Enter becomes a link; the line still breaks. Runs ahead
// of every other keydown hook (blocks.js takes Enter in table cells and toggle
// titles) and never consumes the key; an open list (slash, @, [[, emoji, the
// legacy @ task list) owns Enter instead.
function onEnterKey(e, ctx) {
  if (e.key !== 'Enter' || e.ctrlKey || e.metaKey || e.altKey || !ctx.editor || !api.prefs.get('autolink')) return false;
  const top = ui.topPopup();
  if (top && (!card || top.el !== card.pop.el)) return false;
  if (ctx.editor._taskMention && [...document.querySelectorAll('.task-mention-dropdown')].some(d => d.style.display !== 'none' && !d.hidden && d.getClientRects().length)) return false;
  // Later hooks see the selection after the change
  if (autolinkAtCaret(ctx, 'enter')) Object.assign(ctx, api.context(ctx.editor));
  return false;
}

// Never consumes: later modules (typewriter scrolling...) still see the input
function onInput(e, ctx) {
  if (card && card.editor === ctx.editor) closeCard();
  lastAuto = null;
  if (e.inputType !== 'insertText' || !e.data || !/^\s$/.test(e.data)) return false;
  if (api.prefs.get('autolink')) autolinkAtCaret(ctx, 'space');
  return false;
}

function onSelection(evt, ctx) {
  if (lastAuto && !caretAt(ctx, lastAuto)) lastAuto = null;
  const editor = ctx.editor;
  if (!editor) return false;
  const r = ctx.range;
  const a = r && r.collapsed ? linkOf(ctx.node, editor) : null;
  const entered = !!a && a !== caretLink;
  caretLink = a;
  if (card && card.mode !== 'hover' && card.link !== a) closeCard();
  // Caret moved into a link with the keyboard: show its card (Ctrl+K edits).
  // Only on the way in, so a card closed with Esc stays closed
  if (entered && Date.now() - navKeyAt < 700 && (!card || card.link !== a)) showCard(a, editor, 'caret');
  return false;
}

// Wrap the URL just before the caret (trigger 'space': it ends with the typed
// space; 'enter': it ends at the caret) in a link, keeping the caret
function autolinkAtCaret(ctx, trigger) {
  const { editor, range } = ctx;
  if (!editor || !range || !range.collapsed) return false;
  const node = ctx.node || dom.anchorNode(range);
  if (dom.closestIn(node, 'pre, code, a, [contenteditable="false"]', editor)) return false;
  const block = dom.blockOf(range.startContainer, editor) || editor;
  const before = dom.textBeforeCaret(range, editor, 4096);
  const m = matchAutolink(before, { trigger });
  if (!m) return false;
  const caret = dom.rangeToOffsets(range, block);
  if (!caret) return false;
  const base = caret.start - before.length;
  const urlRange = dom.offsetsToRange(block, { start: base + m.start, end: base + m.end });
  if (!urlRange) return false;
  // Never over existing links, code, pills or chips
  const blocked = [...block.querySelectorAll('a, code, [contenteditable="false"]')].some(el => {
    try { return urlRange.intersectsNode(el); } catch { return false; }
  });
  if (blocked) return false;
  selectRange(urlRange);
  if (!dom.exec('createLink', m.url)) {
    const back = dom.offsetsToRange(block, { start: caret.start, end: caret.start }, { caretAfter: true });
    if (back) selectRange(back);
    return false;
  }
  const sel = dom.getSelectionRange(editor);
  let link = sel ? linkOf(dom.anchorNode(sel), editor) : null;
  if (!link) link = [...block.querySelectorAll('a[href]')].find(a => a.getAttribute('href') === m.url && !a.hasAttribute('target')) || null;
  setCanonicalAttrs(link, m.url);
  const back = trigger === 'space'
    ? dom.offsetsToRange(block, { start: caret.start, end: caret.start }, { caretAfter: true })
    : caretAtOffsetEnd(block, caret.start);
  if (back) selectRange(back);
  if (trigger === 'space' && link) lastAuto = { editor, link, block, caret: caret.start };
  return true;
}

// Collapsed range at a text offset, leaning back (stays at the end of the
// link instead of jumping past it)
function caretAtOffsetEnd(root, off) {
  if (off <= 0) return dom.offsetsToRange(root, { start: 0, end: 0 });
  const r = dom.offsetsToRange(root, { start: off - 1, end: off });
  if (r) r.collapse(false);
  return r;
}

// Paste a URL: over a selection it links the selection (or re-points the link
// it sits in); at a caret it pastes a link (pref autolink, http(s)/www only)
function onPaste(e, ctx) {
  const data = e.clipboardData;
  const editor = ctx.editor;
  if (!data || !editor || !ctx.range || isPlainPasteArmed()) return false;
  const text = (data.getData('text/plain') || '').trim();
  if (!text || /\s/.test(text) || text.length > 2048) return false;
  if (dom.closestIn(ctx.node, 'pre, code, [contenteditable="false"]', editor)) return false;
  const url = urlFromText(text);
  if (!url) return false;
  closeCard();
  const range = ctx.range;
  if (!range.collapsed) {
    const existing = linkAt(ctx);
    if (existing) updateLink(editor, existing, url, null);
    else insertLink(editor, range, url, { raw: text });
    api.notifyChange(editor);
    return true;
  }
  if (!api.prefs.get('autolink') || linkOf(ctx.node, editor) || !/^(https?:\/\/|www\.)/i.test(text)) return false;
  replaceInline(editor, range, linkHtml(url, esc(text)));
  api.notifyChange(editor);
  return true;
}

// --- Install -----------------------------------------------------------------------
export function install(a) {
  api = a;
  dom = a.dom;
  ui = a.ui;
  api.registerCommand('link', {
    run(ctx, arg = {}) {
      const editor = ctx.editor;
      if (!editor) return false;
      const target = arg.link && editor.contains(arg.link) ? arg.link : null;
      if (target && arg.action === 'remove') { removeLink(editor, target); api.notifyChange(editor); return true; }
      const href = arg.href || arg.url;
      if (href) {
        // Straight away (input rules' [text](url), other modules)
        const url = normalizeLinkUrl(String(href));
        if (!url) { api.toast('Links must be web (https://…) or email addresses'); return true; }
        const existing = target || linkAt(ctx);
        if (existing) updateLink(editor, existing, url, arg.text ?? null);
        else insertLink(editor, ctx.range, url, { text: arg.text ?? null, textChanged: arg.text != null, raw: String(href) });
        api.notifyChange(editor);
        return true;
      }
      if (!ctx.range && !target) return false;
      return openLinkEditor(editor, { link: target || linkAt(ctx), range: ctx.range, focus: arg.focus });
    },
    isActive: (ctx) => !!linkAt(ctx)
  });
  api.hooks.click.push(onClick);
  api.hooks.keydown.unshift(onEnterKey);
  api.hooks.keydown.push(onKeydown);
  api.hooks.input.push(onInput);
  api.hooks.selection.push(onSelection);
  api.hooks.paste.push(onPaste);
  api.onAttach(onAttach);
}
