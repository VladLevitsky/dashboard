// Personal Dashboard - Mobile shell: Links (unit F5, W14; entry module)
// The Links tab: Quick Access first, then the cards as an accordion in the
// order a reader meets them on the computer (core/mobile-common.js
// orderCardsForMobile). Everything inside is the real card items
// (createCardItemElement), so they open, copy, show badges and toggle Quick
// Access exactly as on a desktop card; icons get readable labels.
// Rules:
//   - open / collapsed is per browser (dashboard_mobile_links.open), all
//     collapsed at first; model.collapsedCards / collapsedSubtitles are never
//     read or written, toggleCardCollapse is never called
//   - card panes are <section class="card mx-card" data-section-id> (never an
//     id equal to the section id: the grid engine and item creator look cards
//     up by id)
//   - cards are arranged and edited on a larger screen; here a card's ＋ opens
//     the item creator (no separators) and its "Notes n" chip opens its notes
//     in Write
// Provides the services `items` (touch enhancement + item sheet), `search`
// (the Search screen) and `links` (revealCard), and wraps window.openFile
// while mounted (file-sheet.js).

import { model } from '../../state.js';
import { isLoggedIn } from '../../core/auth.js';
import { orderCardsForMobile, cardTitle } from '../../core/mobile-common.js';
import { cardSummary, labelForIcon, fitThumbs, fitParts, linkedRefsSig, localDayKey } from '../../core/mobile-links.js';
import { getQuickAccessItems, reconcileQuickAccessItems, openQuickLinkModal } from '../quick-access.js';
import { openItemCreator } from '../item-creator.js';
import { initCardItems, enhance, openItemSheet, buildCardBody, buildQuickAccess, iconThumb } from './card-items.js?v=2026-10-mobile-1';
import { initSearch, openSearch } from './search-view.js?v=2026-10-mobile-1';
import { initFileSheet, installFileOpener, uninstallFileOpener } from './file-sheet.js?v=2026-10-mobile-1';

const PLUS_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true" focusable="false"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
const CHEVRON_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><polyline points="6 9 12 15 18 9"/></svg>';
const NOTE_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';

let api = null;
const store = { get: () => ({}), set: () => {} };
let els = null;              // { root, qaHead, qaBody, cards }
let qaSig = null;
let reconciled = false;
const cardEls = new Map();   // sectionId -> { el, head, body, headSig, bodySig, keys }
let uid = 0;

// --- Per-browser open state (never the model) -----------------------------------------

function openMap() {
  const v = store.get('open', {});
  return v && typeof v === 'object' ? v : {};
}

function isOpen(sectionId) {
  return openMap()[sectionId] === true;
}

function setOpen(sectionId, on) {
  const map = { ...openMap() };
  if (on) map[sectionId] = true; else delete map[sectionId];
  store.set('open', map);
}

// --- Signatures ---------------------------------------------------------------

function notesCount(sectionId) {
  const notes = model.cardNotes && model.cardNotes[sectionId];
  if (Array.isArray(notes)) return notes.length;
  return typeof notes === 'string' && notes.trim() ? 1 : 0;
}

function themeKey() {
  return `${document.body.dataset.theme || 'light'}|${document.body.dataset.glassTheme || 'classic'}|${model.darkMode ? 1 : 0}|${isLoggedIn() ? 1 : 0}`;
}

// What the open bodies depend on beyond their own card data: Quick Access
// (the glow is baked into each item), how many tasks link each item (the
// indicators; other task changes don't matter), subtask notes, and the day
// (reminder badges count days). With a sectionId, only that card's slice.
function sharedBodySig(sectionId = null) {
  const prefix = sectionId == null ? '' : `${sectionId}:`;
  const subNotes = Object.entries(model.subtaskNotes || {})
    .filter(([k]) => k.startsWith(prefix))
    .map(([k, v]) => [k, Array.isArray(v) ? v.length : 0]);
  return JSON.stringify([model.quickAccessItems || null, linkedRefsSig(model.tasks, sectionId), subNotes, localDayKey(), themeKey()]);
}

function cards() {
  return orderCardsForMobile(model.sections || []);
}

function signature() {
  const list = cards().map(s => [s.id, cardTitle(model, s), model[s.id] || null, model.subtitleColors ? Object.entries(model.subtitleColors).filter(([k]) => k.startsWith(`${s.id}:`)) : null, notesCount(s.id)]);
  return JSON.stringify([list, openMap(), sharedBodySig()]);
}

// --- Quick Access -------------------------------------------------------------------

function renderQuickAccess() {
  const qa = getQuickAccessItems(model);
  const total = qa.icons.length + qa.reminders.length + qa.subtasks.length + qa.copyPaste.length + qa.quickLinks.length;
  const sig = JSON.stringify([model.quickAccessItems || null, sharedBodySig(), total]);
  if (sig === qaSig) return;
  qaSig = sig;
  els.qaCount.textContent = total ? String(total) : '';
  const body = els.qaBody;
  body.replaceChildren();
  if (total === 0) {
    const p = document.createElement('p');
    p.className = 'mx-qa-empty';
    p.textContent = 'Hold any icon or item on a card for a moment to add it here. Hold it again to take it out.';
    body.appendChild(p);
    return;
  }
  buildQuickAccess(body, qa);
}

// --- Card panes ---------------------------------------------------------------------

function createCardPane(section) {
  const el = document.createElement('section');
  el.className = 'card mx-card';
  el.dataset.sectionId = section.id;
  const head = document.createElement('div');
  head.className = 'mx-card-head';
  el.appendChild(head);
  const entry = { el, head, body: null, headSig: null, bodySig: null, keys: null, bodyId: `mx-card-body-${++uid}` };
  cardEls.set(section.id, entry);
  return el;
}

function paintCard(section) {
  const entry = cardEls.get(section.id);
  if (!entry) return;
  const id = section.id;
  const open = isOpen(id);
  const title = cardTitle(model, section);
  const sum = cardSummary(model[id]);
  const notes = notesCount(id);
  const headSig = JSON.stringify([title, sum.label, sum.thumbs.map(i => [i.icon, i.invertDark || false]), notes, open, themeKey()]);
  if (headSig !== entry.headSig) {
    entry.headSig = headSig;
    paintHead(entry, section, { title, sum, notes, open });
  }
  entry.el.classList.toggle('is-open', open);
  if (!open) {
    if (entry.body) { entry.body.remove(); entry.body = null; entry.bodySig = null; }
    return;
  }
  const colors = model.subtitleColors ? Object.entries(model.subtitleColors).filter(([k]) => k.startsWith(`${id}:`)) : null;
  const bodySig = JSON.stringify([model[id] || null, colors, sharedBodySig(id)]);
  if (bodySig === entry.bodySig && entry.body) return;
  entry.bodySig = bodySig;
  const body = document.createElement('div');
  body.className = 'mx-card-body';
  body.id = entry.bodyId;
  const keys = buildCardBody(body, id, model);
  if (entry.body) entry.body.replaceWith(body); else entry.el.appendChild(body);
  // A new item (item creator, another device) glows once
  if (entry.keys) {
    const before = new Set(entry.keys);
    keys.filter(k => !before.has(k)).forEach(k => {
      const [subtitle, key] = [k.slice(0, k.lastIndexOf('|')), k.slice(k.lastIndexOf('|') + 1)];
      const node = [...body.querySelectorAll('[data-key]')].find(n => n.dataset.key === key && n.dataset.subtitle === subtitle);
      if (node) {
        node.classList.add('ic-just-added');
        setTimeout(() => node.classList.remove('ic-just-added'), 2600);
      }
    });
  }
  entry.keys = keys;
  entry.body = body;
}

function paintHead(entry, section, { title, sum, notes, open }) {
  const id = section.id;
  const head = entry.head;
  head.replaceChildren();
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'mx-card-toggle';
  toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  toggle.setAttribute('aria-controls', entry.bodyId);
  toggle.setAttribute('aria-label', `${title}, ${sum.label}`);
  const t = document.createElement('span');
  t.className = 'mx-card-title';
  t.textContent = title;
  const summary = document.createElement('span');
  summary.className = 'mx-card-sum';
  summary.setAttribute('aria-hidden', 'true');
  if (sum.thumbs.length) {
    sum.thumbs.forEach(icon => {
      const thumb = iconThumb(icon, 20);
      const img = thumb.querySelector('img');
      if (img) img.addEventListener('load', () => fitSummary(summary, summary.getBoundingClientRect().width));
      summary.appendChild(thumb);
    });
    const more = document.createElement('span');
    more.className = 'mx-card-more';
    summary.appendChild(more);
  } else {
    // One span per count, so a narrow header drops whole counts
    sum.parts.forEach((part, i) => {
      const text = document.createElement('span');
      text.className = 'mx-card-count';
      text.textContent = i ? `· ${part}` : part;
      summary.appendChild(text);
    });
  }
  summary._mxSum = { thumbs: sum.thumbs.length, more: sum.more };
  toggle.append(t, summary);
  toggle.addEventListener('click', () => toggleCard(id));
  head.appendChild(toggle);

  if (notes > 0) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'mx-chip mx-notes-chip';
    chip.innerHTML = NOTE_SVG;
    const label = document.createElement('span');
    label.className = 'mx-chip-label';
    label.textContent = `Notes ${notes}`;
    chip.appendChild(label);
    chip.setAttribute('aria-label', `${notes} note${notes === 1 ? '' : 's'} on ${title}`);
    chip.addEventListener('click', (e) => {
      // The notepad's document click-outside listener must not see this tap
      e.stopPropagation();
      showNotes(id);
    });
    head.appendChild(chip);
  }

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'mx-icon-btn mx-card-add';
  add.innerHTML = PLUS_SVG;
  add.setAttribute('aria-label', `Add to ${title}`);
  add.addEventListener('click', (e) => {
    e.stopPropagation();
    addItem(id);
  });
  head.appendChild(add);

  const chev = document.createElement('span');
  chev.className = 'mx-card-chev';
  chev.innerHTML = CHEVRON_SVG;
  chev.setAttribute('aria-hidden', 'true');
  head.appendChild(chev);
  watchSummary(summary);
}

// --- Collapsed header summary: whole pieces only ---------------------------------------
// The summary gets whatever width the title leaves. A thumb, a "+N" or a count
// is shown whole or not at all: folded thumbs go into the "+N", counts that
// don't fit drop out, and a summary too narrow for one piece is left empty.
// Re-fitted when its width changes (rotation, a new title); writes only when
// the fit changes.
const GAP = 4;
let sumObserver = null;

function watchSummary(summary) {
  if (typeof ResizeObserver !== 'function') { fitSummary(summary, summary.clientWidth); return; }
  if (!sumObserver) {
    sumObserver = new ResizeObserver(entries => entries.forEach(e => {
      if (e.target.isConnected) fitSummary(e.target, e.contentRect.width);
      else sumObserver.unobserve(e.target);
    }));
  }
  sumObserver.observe(summary);
}

function fitSummary(summary, avail) {
  const info = summary._mxSum;
  // Not on screen (another tab): fitted when it shows, as its width changes then
  if (!info || !summary.getClientRects().length) return;
  const kids = [...summary.children];
  let fit;
  if (info.thumbs) {
    const more = kids[kids.length - 1];
    if (info.moreW == null) {
      // Widest "+N" it can need (every thumb folded), measured once
      more.textContent = `+${info.thumbs + info.more}`;
      info.moreW = more.getBoundingClientRect().width;
    }
    // A picture that has nothing to show yet (an R2 image while signed out
    // or still loading) folds into the "+N" too; its load re-fits
    const thumbs = kids.slice(0, info.thumbs);
    const ready = thumbs.filter(el => {
      const img = el.querySelector('img');
      return !img || !!img.getAttribute('src');
    });
    const k = fitThumbs({ count: ready.length, more: info.more + (info.thumbs - ready.length), thumbW: 20, moreW: info.moreW, gap: GAP, avail });
    const n = info.thumbs - k + info.more;
    fit = `${k}|${n}|${ready.length}`;
    if (fit === info.fit) return;
    const shown = new Set(ready.slice(0, k));
    thumbs.forEach(el => { el.hidden = !shown.has(el); });
    more.hidden = k === 0 || n === 0;
    more.textContent = n > 0 ? `+${n}` : '';
  } else {
    if (!info.widths) info.widths = kids.map(el => el.getBoundingClientRect().width);
    const j = fitParts(info.widths, { gap: GAP, avail });
    fit = String(j);
    if (fit === info.fit) return;
    kids.forEach((el, i) => { el.hidden = i >= j; });
  }
  info.fit = fit;
}

function toggleCard(sectionId) {
  const on = !isOpen(sectionId);
  setOpen(sectionId, on);
  renderNow();
  const entry = cardEls.get(sectionId);
  if (on && entry && entry.body) {
    api.animate(entry.body, [{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 220 });
    // Keep the opened card's header in view
    const r = entry.el.getBoundingClientRect();
    const top = topChrome();
    if (r.top < top) window.scrollBy({ top: r.top - top - 8, behavior: api.reduceMotion() ? 'auto' : 'smooth' });
  }
}

function showNotes(sectionId) {
  const writer = api.service('writer');
  if (writer && typeof writer.showNotesFor === 'function') {
    writer.showNotesFor(sectionId);
    return;
  }
  if (window.openNotepad) window.openNotepad(sectionId);
}

const CREATOR_GUARD_MS = 450;
let creatorOpenedAt = 0;

function addItem(sectionId) {
  // Open the card so the new item shows (and glows) where it lands
  if (!isOpen(sectionId)) { setOpen(sectionId, true); renderNow(); }
  openItemCreator({ sectionId });
  creatorOpenedAt = performance.now();
  guardCreatorBackdrop();
}

// The creator is a bottom sheet: its backdrop now covers the ＋ that opened
// it, so the second tap of a quick double tap would close it at once. Backdrop
// clicks are ignored for a moment after opening.
function guardCreatorBackdrop() {
  const overlay = document.querySelector('.ic-overlay');
  if (!overlay || overlay._mxGuard) return;
  overlay._mxGuard = true;
  overlay.addEventListener('click', (e) => {
    if (performance.now() - creatorOpenedAt >= CREATOR_GUARD_MS) return;
    if (!(e.target && e.target.closest && e.target.closest('.ic-backdrop'))) return;
    e.stopPropagation();
    e.preventDefault();
  }, true);
}

function topChrome() {
  const bar = document.getElementById('mx-topbar');
  return bar ? bar.getBoundingClientRect().bottom : 0;
}

// --- Screen -------------------------------------------------------------------------

function mount(host) {
  host.classList.add('mx-links-screen');
  const root = document.createElement('div');
  root.className = 'mx-links';

  const qa = document.createElement('section');
  qa.className = 'mx-qa';
  qa.setAttribute('aria-labelledby', 'mx-qa-title');
  const qaHead = document.createElement('header');
  qaHead.className = 'mx-section-head';
  const h = document.createElement('h2');
  h.className = 'mx-caption';
  h.id = 'mx-qa-title';
  h.append('Quick Access ');
  const count = document.createElement('span');
  count.className = 'mx-caption-count';
  h.appendChild(count);
  const addLink = document.createElement('button');
  addLink.type = 'button';
  addLink.className = 'mx-btn mx-btn-quiet mx-qa-add';
  addLink.innerHTML = `${PLUS_SVG}<span>Link</span>`;
  addLink.setAttribute('aria-label', 'Add a quick link');
  addLink.addEventListener('click', (e) => { e.stopPropagation(); openQuickLinkModal(); });
  qaHead.append(h, addLink);
  const qaBody = document.createElement('div');
  qaBody.className = 'mx-qa-body';
  qa.append(qaHead, qaBody);

  const list = document.createElement('div');
  list.className = 'mx-cards';

  const foot = document.createElement('p');
  foot.className = 'mx-links-foot';
  foot.textContent = 'Cards are arranged and edited on a larger screen.';

  root.append(qa, list, foot);
  host.appendChild(root);
  els = { root, qaBody, qaCount: count, cards: list };
  enhance(root);
}

function render() {
  if (!els) return;
  renderQuickAccess();
  const sections = cards();
  api.patchList(els.cards, sections, {
    key: (s) => s.id,
    sig: () => '',
    create: (s) => createCardPane(s),
  });
  const live = new Set(sections.map(s => s.id));
  [...cardEls.keys()].forEach(id => { if (!live.has(id)) cardEls.delete(id); });
  sections.forEach(paintCard);
}

function renderNow() {
  render();
}

// Open a card, switch to Links if needed, and bring the card into view
function revealCard(sectionId) {
  if (!(model.sections || []).some(s => s.id === sectionId)) return;
  setOpen(sectionId, true);
  if (api.getTab() !== 'links') {
    api.navigate('links', { reveal: { sectionId } });
    return;
  }
  revealIn({ sectionId });
}

function revealIn(target) {
  if (!target || !target.sectionId) return;
  setOpen(target.sectionId, true);
  renderNow();
  const entry = cardEls.get(target.sectionId);
  if (!entry) return;
  const scroll = () => {
    if (!entry.el.isConnected) return;
    const r = entry.el.getBoundingClientRect();
    window.scrollTo({ top: Math.max(0, window.scrollY + r.top - topChrome() - 10), behavior: 'auto' });
  };
  scroll();
  // The layer that led here (Search) trims its history entry with
  // history.go(-1), and the browser restores that entry's scroll position
  // when the traversal lands: scroll again once it has
  const again = () => requestAnimationFrame(scroll);
  window.addEventListener('popstate', again, { once: true });
  setTimeout(() => window.removeEventListener('popstate', again), 800);
  again();
  api.animate(entry.head, [{ opacity: 0.55 }, { opacity: 1 }], { duration: 420 });
}

export default {
  init(shellApi) {
    api = shellApi;
    const s = api.store('links');
    store.get = s.get;
    store.set = s.set;
    initCardItems(api);
    initSearch(api);
    initFileSheet(api);

    api.registerScreen({
      id: 'links',
      title: 'Links',
      icon: 'links',
      mount,
      signature,
      render,
      reveal: revealIn,
      show() {
        // Once per session, as the Today view does on open: drop Quick Access
        // entries whose item was deleted (may save; the shell absorbs it)
        if (!reconciled) {
          reconciled = true;
          try { reconcileQuickAccessItems(model); } catch (err) { console.error('[mobile] Quick Access reconcile failed', err); }
        }
      },
    });

    api.provide('items', { enhance, openItemSheet, labelForIcon });
    api.provide('search', { open: (query) => openSearch(query) });
    api.provide('links', { revealCard });

    api.on('mount', installFileOpener);
    api.on('unmount', uninstallFileOpener);
    if (api.isMounted && api.isMounted()) installFileOpener();
  },
};
