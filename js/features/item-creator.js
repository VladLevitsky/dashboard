// Personal Dashboard - Item Creator
// One "create first, then save" window for card items, used from the "+" on a
// card's title bar (view mode) and from the "+" tiles inside the Card Edit
// Modal (edit mode). Nothing is added until Save: no blank placeholder items.
//   - Tabs: Icon · Subtask · Reminder · Copy-paste · Separator
//   - Name and link are shared fields, so switching tabs keeps what was typed
//   - Files (link files, icon images) upload only on Save
//   - View mode: saved straight to the profile and pushed to the cloud;
//     edit mode: added to the working copy (Confirm keeps it, Cancel drops it)
// Separator: picking the tab enters placement mode on the card. Every gap
// between two icons gets a faint marker; the glowing drop light
// (drop-light.js) follows the pointer to the nearest gap and a click drops the
// separator there. Esc / Cancel returns to the window with nothing changed.

import { editState, currentData } from '../state.js';
import { showToast, generateKey } from '../utils.js';
import { PLACEHOLDER_URL, icons } from '../constants.js';
import { markDirtyAndSave } from './edit-mode.js';
import { openMediaLibrary } from './media-library.js';
import { setImageFromRef, uploadFile, classifyImageRef } from '../core/file-service.js';
import { isLoggedIn } from '../core/auth.js';
import { normalizeUrl, toDateKey, fromDateKey } from '../core/quick-capture-parse.js';
import { showActionToast } from './quick-capture.js';
import { showDropLight, hideDropLight } from './drop-light.js';
import { resolveIconMedia } from '../components/sections.js';

const TYPES = ['icon', 'subtask', 'reminder', 'copyPaste'];
const TYPE_LABELS = { icon: 'Icon', subtask: 'Subtask', reminder: 'Reminder', copyPaste: 'Copy-paste', separator: 'Separator' };
const DIVIDER_SRC = () => icons.Content_creation_divider || 'assets/icons/Content_creation_divider.svg';

const svg = (body, extra = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"${extra}>${body}</svg>`;
const TAB_ICONS = {
  icon: svg('<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="2"/><path d="m21 15-5-5L5 21"/>'),
  subtask: svg('<rect x="1.5" y="6" width="21" height="12" rx="3"/><circle cx="6.5" cy="12" r="2"/><line x1="11" y1="12" x2="18.5" y2="12"/>'),
  reminder: svg('<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/>'),
  copyPaste: svg('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
  separator: svg('<line x1="12" y1="3" x2="12" y2="21"/><rect x="2.5" y="8" width="6" height="8" rx="1.5"/><rect x="15.5" y="8" width="6" height="8" rx="1.5"/>')
};
const CLOSE_SVG = svg('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>', ' stroke-width="2"');
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

let root = null;
const els = {};
let ctx = null;            // { sectionId, subtitle, cardEl, editing }
let activeType = 'icon';
let lastType = 'icon';
const lastTypeByCard = new Map();
const lastSubtitleByCard = new Map();
let form = null;           // values that aren't plain inputs: { media, emoji, file, link, track }
let attempted = false;     // tried to save: missing fields turn red
let busy = false;
let lastFocus = null;
let placing = null;        // separator placement session

// ============================================================
// OPEN / CLOSE
// ============================================================

export function openItemCreator({ sectionId, subtitle = null, cardEl = null } = {}) {
  if (placing || busy) return;
  const data = currentData();
  const section = (data.sections || []).find(s => s.id === sectionId);
  if (!section) return;
  ensureDom();

  ctx = { sectionId, subtitle, cardEl: cardEl || findCardEl(sectionId), editing: editState.enabled };
  if (root.hidden) lastFocus = document.activeElement;
  resetForm();
  els.cardName.textContent = (data.sectionTitles && data.sectionTitles[sectionId]) || section.title || 'card';
  fillSections(data, sectionId, subtitle);
  setType(defaultTypeFor(data, sectionId, els.section.value));

  root.hidden = false;
  requestAnimationFrame(() => root.classList.add('open'));
  focusFirstField();
}

export function closeItemCreator() {
  if (!root || root.hidden || busy) return;
  closeEmoji();
  root.classList.remove('open');
  root.hidden = true;
  ctx = null;
  const back = lastFocus;
  lastFocus = null;
  if (back && back !== document.body && document.contains(back) && typeof back.focus === 'function') {
    back.focus({ preventScroll: true });
  }
}

export function isItemCreatorOpen() {
  return !!(root && !root.hidden) || !!placing;
}

// The card element the user is looking at: the modal's copy while editing,
// otherwise the one on the dashboard (both carry the same id)
function findCardEl(sectionId) {
  const modalCard = document.querySelector('#card-edit-body > section.card');
  if (editState.enabled && modalCard && modalCard.id === sectionId) return modalCard;
  return [...document.querySelectorAll('.app-main > section.card')].find(c => c.id === sectionId) || null;
}

// ============================================================
// DOM
// ============================================================

function ensureDom() {
  if (root) return;
  root = document.createElement('div');
  root.className = 'ic-overlay';
  root.hidden = true;
  const tabs = [...TYPES, 'separator'].map(t => `
    <button type="button" class="ic-tab" role="tab" data-type="${t}" aria-selected="false">
      ${TAB_ICONS[t]}<span>${TYPE_LABELS[t]}</span>
    </button>`).join('');
  root.innerHTML = `
    <div class="ic-backdrop"></div>
    <div class="ic-dialog" role="dialog" aria-modal="true" aria-labelledby="ic-title">
      <div class="ic-header">
        <h4 id="ic-title">Add to <span class="ic-card-name"></span></h4>
        <button type="button" class="ic-close" title="Close" aria-label="Close">${CLOSE_SVG}</button>
      </div>
      <div class="ic-tabs" role="tablist" aria-label="Item type">${tabs}</div>
      <div class="ic-body">
        <label class="ic-field ic-section-row" hidden>
          <span class="ic-label">Section</span>
          <select class="ic-input ic-section"></select>
        </label>

        <div class="ic-field" data-for="icon">
          <span class="ic-label">Image</span>
          <div class="ic-image-row">
            <div class="ic-image-preview" aria-hidden="true"></div>
            <button type="button" class="ic-btn" data-act="library">Choose image…</button>
            <button type="button" class="ic-btn" data-act="emoji" aria-expanded="false">Emoji</button>
          </div>
          <div class="ic-emoji emoji-picker-container" hidden></div>
        </div>

        <label class="ic-field" data-for="icon subtask reminder copyPaste">
          <span class="ic-label-row"><span class="ic-label ic-name-label">Name</span><span class="ic-optional ic-name-optional">optional</span></span>
          <input type="text" class="ic-input" data-f="name" autocomplete="off" spellcheck="true" />
        </label>

        <div class="ic-field" data-for="icon subtask reminder">
          <div class="ic-label-row">
            <span class="ic-label">Link</span><span class="ic-optional ic-link-optional">optional</span>
            <div class="ic-seg ic-seg-sm" role="radiogroup" aria-label="Link type">
              <button type="button" role="radio" data-link="url" aria-checked="true">Web link</button>
              <button type="button" role="radio" data-link="file" aria-checked="false">File</button>
            </div>
          </div>
          <input type="text" class="ic-input" data-f="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="example.com or https://…" />
          <div class="ic-file-row" hidden>
            <button type="button" class="ic-btn" data-act="file">Choose file…</button>
            <span class="ic-file-name">No file chosen</span>
            <input type="file" class="ic-file-input" hidden />
          </div>
          <p class="ic-note ic-file-signin" hidden>Sign in to attach files.</p>
        </div>

        <label class="ic-field" data-for="copyPaste">
          <span class="ic-label">Text to copy</span>
          <textarea class="ic-input ic-textarea" data-f="copyText" rows="4" placeholder="Anything you paste often: a signature, an address, a color code…"></textarea>
        </label>

        <div class="ic-field" data-for="reminder">
          <div class="ic-label-row">
            <span class="ic-label">Track by</span>
            <div class="ic-seg ic-seg-sm" role="radiogroup" aria-label="Track by">
              <button type="button" role="radio" data-track="date" aria-checked="true">Date</button>
              <button type="button" role="radio" data-track="counter" aria-checked="false">Counter</button>
            </div>
          </div>
          <div class="ic-track" data-track-pane="date">
            <div class="ic-grid2">
              <label class="ic-sub"><span>Date</span><input type="date" class="ic-input" data-f="date" /></label>
              <label class="ic-sub"><span>Repeats</span>
                <select class="ic-input" data-f="repeat">
                  <option value="none">Doesn't repeat</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </label>
            </div>
            <label class="ic-sub" data-show="weekly" hidden><span>How often</span>
              <select class="ic-input" data-f="weeks">
                <option value="1">Every week</option>
                <option value="2">Every 2 weeks</option>
                <option value="3">Every 3 weeks</option>
              </select>
            </label>
            <label class="ic-sub" data-show="monthly" hidden><span>Which day</span>
              <select class="ic-input" data-f="monthly">
                <option value="sameDay"></option>
                <option value="firstWeekday"></option>
              </select>
            </label>
          </div>
          <div class="ic-track" data-track-pane="counter" hidden>
            <div class="ic-grid2">
              <label class="ic-sub"><span>Target</span><input type="number" class="ic-input" data-f="target" inputmode="decimal" placeholder="e.g. 500" /></label>
              <label class="ic-sub"><span>Current</span><input type="number" class="ic-input" data-f="current" inputmode="decimal" placeholder="0" /></label>
              <label class="ic-sub"><span>Type</span>
                <select class="ic-input" data-f="ctype">
                  <option value="limit">Limit (stay under it)</option>
                  <option value="goal">Goal (reach it)</option>
                </select>
              </label>
              <label class="ic-sub"><span>Unit</span>
                <select class="ic-input" data-f="unit">
                  <option value="none">None</option>
                  <option value="dollar">$</option>
                  <option value="percent">%</option>
                </select>
              </label>
            </div>
          </div>
        </div>

        <label class="ic-check" data-for="icon" data-dark-only>
          <input type="checkbox" data-f="invert" />
          <span>Invert colors in dark mode</span>
        </label>

        <div class="ic-field ic-sep-note" data-for="separator">
          <p>Separators go between two icons. Add at least two icons to this card first, then come back here.</p>
        </div>
      </div>
      <div class="ic-footer">
        <span class="ic-missing" aria-live="polite"></span>
        <button type="button" class="ic-btn ic-cancel">Cancel</button>
        <button type="button" class="ic-btn ic-save">Add</button>
      </div>
    </div>`;
  document.body.appendChild(root);

  const q = (sel) => root.querySelector(sel);
  Object.assign(els, {
    dialog: q('.ic-dialog'),
    cardName: q('.ic-card-name'),
    tabs: [...root.querySelectorAll('.ic-tab')],
    sectionRow: q('.ic-section-row'),
    section: q('.ic-section'),
    preview: q('.ic-image-preview'),
    emojiBtn: q('[data-act="emoji"]'),
    emojiBox: q('.ic-emoji'),
    nameLabel: q('.ic-name-label'),
    nameOptional: q('.ic-name-optional'),
    name: q('[data-f="name"]'),
    linkOptional: q('.ic-link-optional'),
    linkBtns: [...root.querySelectorAll('[data-link]')],
    url: q('[data-f="url"]'),
    fileRow: q('.ic-file-row'),
    fileName: q('.ic-file-name'),
    fileInput: q('.ic-file-input'),
    fileSignin: q('.ic-file-signin'),
    copyText: q('[data-f="copyText"]'),
    trackBtns: [...root.querySelectorAll('[data-track]')],
    trackPanes: [...root.querySelectorAll('[data-track-pane]')],
    date: q('[data-f="date"]'),
    repeat: q('[data-f="repeat"]'),
    weeks: q('[data-f="weeks"]'),
    monthly: q('[data-f="monthly"]'),
    weeklyRow: q('[data-show="weekly"]'),
    monthlyRow: q('[data-show="monthly"]'),
    target: q('[data-f="target"]'),
    current: q('[data-f="current"]'),
    ctype: q('[data-f="ctype"]'),
    unit: q('[data-f="unit"]'),
    invert: q('[data-f="invert"]'),
    missing: q('.ic-missing'),
    cancel: q('.ic-cancel'),
    save: q('.ic-save')
  });

  q('.ic-backdrop').addEventListener('click', closeItemCreator);
  q('.ic-close').addEventListener('click', closeItemCreator);
  els.cancel.addEventListener('click', closeItemCreator);
  els.save.addEventListener('click', save);

  els.tabs.forEach(tab => tab.addEventListener('click', () => onTab(tab.dataset.type)));
  els.section.addEventListener('change', () => {
    if (ctx) lastSubtitleByCard.set(ctx.sectionId, els.section.value);
  });

  q('[data-act="library"]').addEventListener('click', () => {
    closeEmoji();
    openMediaLibrary((chosen) => {
      form.media = chosen;
      form.emoji = null;
      renderPreview();
      update();
    });
  });
  els.emojiBtn.addEventListener('click', toggleEmoji);

  els.linkBtns.forEach(btn => btn.addEventListener('click', () => setLinkKind(btn.dataset.link)));
  q('[data-act="file"]').addEventListener('click', () => els.fileInput.click());
  els.fileInput.addEventListener('change', () => {
    const file = els.fileInput.files && els.fileInput.files[0];
    if (file) {
      form.file = file;
      els.fileName.textContent = file.name;
      update();
    }
  });

  els.trackBtns.forEach(btn => btn.addEventListener('click', () => setTrack(btn.dataset.track)));
  els.repeat.addEventListener('change', updateRepeatRows);
  els.date.addEventListener('change', () => { updateMonthlyLabels(); update(); });

  root.addEventListener('input', () => {
    // Only a real change: removing an absent class still fires a mutation record (glass light re-samples the dialog)
    if (els.dialog.classList.contains('ic-shake')) els.dialog.classList.remove('ic-shake');
    update();
  });
  root.addEventListener('change', update);

  // Keys inside the window never reach the page's shortcuts (N, /, the
  // Card Edit Modal's Esc)
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (!els.emojiBox.hidden) closeEmoji();
      else closeItemCreator();
    } else if (e.key === 'Enter' && !e.isComposing && !e.shiftKey) {
      const t = e.target;
      const isTextArea = t.tagName === 'TEXTAREA';
      const isField = t.tagName === 'INPUT' && t.type !== 'checkbox' && t.type !== 'file';
      if ((isField && !isTextArea) || ((e.ctrlKey || e.metaKey) && isTextArea)) {
        e.preventDefault();
        save();
      }
    } else if (e.key === 'Tab') {
      trapFocus(e);
    } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && e.target.classList.contains('ic-tab')) {
      e.preventDefault();
      const list = els.tabs.filter(t => !t.disabled);
      const i = list.indexOf(e.target);
      const next = list[(i + (e.key === 'ArrowRight' ? 1 : list.length - 1)) % list.length];
      next.focus();
    }
    e.stopPropagation();
  });
}

function trapFocus(e) {
  // The emoji picker keeps its own tab order (inside its shadow root)
  if (els.emojiBox.contains(document.activeElement)) return;
  const list = [...els.dialog.querySelectorAll('button, input, select, textarea, [tabindex]')]
    .filter(el => !el.disabled && el.type !== 'file' && el.offsetParent !== null && el.tabIndex !== -1);
  if (!list.length) return;
  const first = list[0];
  const last = list[list.length - 1];
  const active = document.activeElement;
  if (e.shiftKey && (active === first || !list.includes(active))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || !list.includes(active))) {
    e.preventDefault();
    first.focus();
  }
}

// ============================================================
// FORM STATE
// ============================================================

function resetForm() {
  form = { media: null, emoji: null, file: null, link: 'url', track: 'date' };
  attempted = false;
  busy = false;
  els.dialog.classList.remove('ic-shake');
  els.name.value = '';
  els.url.value = '';
  els.copyText.value = '';
  els.fileInput.value = '';
  els.fileName.textContent = 'No file chosen';
  els.date.value = toDateKey(new Date());
  els.repeat.value = 'none';
  els.weeks.value = '1';
  els.monthly.value = 'sameDay';
  els.target.value = '';
  els.current.value = '';
  els.ctype.value = 'limit';
  els.unit.value = 'none';
  els.invert.checked = false;
  els.save.textContent = 'Add';
  closeEmoji();
  renderPreview();
  setLinkKind('url');
  setTrack('date');
  updateRepeatRows();
}

function fillSections(data, sectionId, preferred) {
  if (!data[sectionId] || typeof data[sectionId] !== 'object') {
    data[sectionId] = { _default: { icons: [], reminders: [], subtasks: [], copyPaste: [] } };
  }
  const cardData = data[sectionId];
  const keys = Object.keys(cardData).sort((a, b) => (a === '_default' ? -1 : b === '_default' ? 1 : 0));
  els.section.innerHTML = '';
  keys.forEach(key => {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = key === '_default' ? 'Top of the card (no section)' : key;
    els.section.appendChild(opt);
  });

  const hasItems = (key) => {
    const g = cardData[key];
    return g && ['icons', 'reminders', 'subtasks', 'copyPaste'].some(t => Array.isArray(g[t]) && g[t].length);
  };
  const remembered = lastSubtitleByCard.get(sectionId);
  let pick = keys[0];
  if (preferred && keys.includes(preferred)) pick = preferred;
  else if (remembered && keys.includes(remembered)) pick = remembered;
  else if (keys.includes('_default') && (hasItems('_default') || keys.length === 1)) pick = '_default';
  else pick = keys.find(k => k !== '_default') || keys[0];
  els.section.value = pick;
  els.sectionRow.hidden = keys.length < 2;
}

// The type used last on this card; otherwise the kind of item the section
// (or the whole card) holds most of; otherwise the type used last anywhere
function defaultTypeFor(data, sectionId, subtitle) {
  if (lastTypeByCard.has(sectionId)) return lastTypeByCard.get(sectionId);
  const count = (groups) => {
    const n = { icon: 0, subtask: 0, reminder: 0, copyPaste: 0 };
    groups.forEach(g => {
      if (!g || typeof g !== 'object' || Array.isArray(g)) return;
      n.icon += (g.icons || []).filter(i => !i.isDivider).length;
      n.subtask += (g.subtasks || []).length;
      n.reminder += (g.reminders || []).length;
      n.copyPaste += (g.copyPaste || []).length;
    });
    const best = TYPES.reduce((a, t) => (n[t] > n[a] ? t : a), 'icon');
    return n[best] > 0 ? best : null;
  };
  const cardData = data[sectionId] || {};
  return count([cardData[subtitle]]) || count(Object.values(cardData)) || lastType;
}

function onTab(type) {
  if (type === 'separator') {
    startSeparatorFromDialog();
    return;
  }
  setType(type);
  focusFirstField();
}

function setType(type) {
  activeType = type;
  if (type !== 'separator') {
    lastType = type;
    if (ctx) lastTypeByCard.set(ctx.sectionId, type);
  }
  els.tabs.forEach(tab => {
    const on = tab.dataset.type === type;
    tab.setAttribute('aria-selected', on ? 'true' : 'false');
    tab.tabIndex = on ? 0 : -1;
  });
  const dark = document.body.dataset.theme === 'dark';
  root.querySelectorAll('[data-for]').forEach(el => {
    const show = el.dataset.for.split(' ').includes(type) && (!('darkOnly' in el.dataset) || dark);
    el.hidden = !show;
  });
  if (type !== 'icon') closeEmoji();

  // Name and link wording per type
  const names = {
    icon: ['Name', true, 'Shown when you hover the icon'],
    subtask: ['Text', false, 'e.g. Weekly report'],
    reminder: ['Name', false, 'e.g. Renew the domain'],
    copyPaste: ['Label', true, 'Shown on the pill (defaults to the text)']
  };
  const [label, optional, placeholder] = names[type] || names.subtask;
  els.nameLabel.textContent = label;
  els.nameOptional.hidden = !optional;
  els.name.placeholder = placeholder;
  els.linkOptional.hidden = type === 'icon';

  els.save.hidden = type === 'separator';
  attempted = false;
  update();
}

function focusFirstField() {
  const run = () => {
    if (!root || root.hidden) return;
    const target = activeType === 'icon'
      ? root.querySelector('[data-act="library"]')
      : activeType === 'separator' ? els.cancel : els.name;
    if (target) target.focus();
  };
  // The mobile shell: still inside the tap, or iOS raises no keyboard
  if (document.documentElement.dataset.shell === 'mobile') run();
  else requestAnimationFrame(run);
}

function setLinkKind(kind) {
  if (kind === 'file' && !isLoggedIn()) {
    els.fileSignin.hidden = false;
    kind = 'url';
  } else {
    els.fileSignin.hidden = true;
  }
  form.link = kind;
  els.linkBtns.forEach(btn => btn.setAttribute('aria-checked', btn.dataset.link === kind ? 'true' : 'false'));
  els.url.hidden = kind !== 'url';
  els.fileRow.hidden = kind !== 'file';
  update();
}

function setTrack(track) {
  form.track = track;
  els.trackBtns.forEach(btn => btn.setAttribute('aria-checked', btn.dataset.track === track ? 'true' : 'false'));
  els.trackPanes.forEach(pane => { pane.hidden = pane.dataset.trackPane !== track; });
  update();
}

function updateRepeatRows() {
  els.weeklyRow.hidden = els.repeat.value !== 'weekly';
  els.monthlyRow.hidden = els.repeat.value !== 'monthly';
  updateMonthlyLabels();
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function updateMonthlyLabels() {
  const date = fromDateKey(els.date.value);
  const sameDay = els.monthly.querySelector('option[value="sameDay"]');
  const firstWeekday = els.monthly.querySelector('option[value="firstWeekday"]');
  if (!date) {
    sameDay.textContent = 'Same date each month';
    firstWeekday.textContent = 'Same weekday, first of the month';
    return;
  }
  sameDay.textContent = `The ${ordinal(date.getDate())} of each month`;
  firstWeekday.textContent = `The first ${WEEKDAYS[date.getDay()]} of each month`;
}

function renderPreview() {
  const box = els.preview;
  box.textContent = '';
  box.classList.toggle('has-image', !!(form && (form.media || form.emoji)));
  if (form && form.emoji) {
    const span = document.createElement('span');
    span.className = 'ic-preview-emoji';
    span.textContent = form.emoji;
    box.appendChild(span);
  } else if (form && form.media) {
    const img = document.createElement('img');
    img.alt = '';
    setImageFromRef(img, form.media.src);
    box.appendChild(img);
  } else {
    box.innerHTML = svg('<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="2"/><path d="m21 15-5-5L5 21"/>');
  }
}

// The emoji picker web component is created on first use
function toggleEmoji() {
  if (!els.emojiBox.hidden) {
    closeEmoji();
    return;
  }
  if (!els.emojiBox.firstChild) {
    const picker = document.createElement('emoji-picker');
    picker.addEventListener('emoji-click', (event) => {
      form.emoji = event.detail.unicode;
      form.media = null;
      renderPreview();
      closeEmoji();
      update();
      els.emojiBtn.focus();
    });
    els.emojiBox.appendChild(picker);
  }
  els.emojiBox.hidden = false;
  els.emojiBtn.setAttribute('aria-expanded', 'true');
}

function closeEmoji() {
  if (!els.emojiBox) return;
  els.emojiBox.hidden = true;
  els.emojiBtn.setAttribute('aria-expanded', 'false');
}

// ============================================================
// VALIDATION
// ============================================================

function readNumber(input) {
  const raw = input.value.trim();
  if (raw === '') return null;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : NaN;
}

// → { ok, problems: [{ text, field }] }
function validate() {
  const problems = [];
  const type = activeType;
  const name = els.name.value.trim();
  const urlRaw = els.url.value.trim();
  const needsLink = type === 'icon' || type === 'subtask' || type === 'reminder';

  if (type === 'icon' && !form.media && !form.emoji) {
    problems.push({ text: 'Choose an image or an emoji', field: root.querySelector('[data-act="library"]') });
  }
  if ((type === 'subtask' || type === 'reminder') && !name) {
    problems.push({ text: type === 'subtask' ? 'Add the text' : 'Add a name', field: els.name });
  }
  if (needsLink) {
    if (form.link === 'file') {
      if (!form.file) problems.push({ text: 'Choose a file', field: root.querySelector('[data-act="file"]') });
    } else if (urlRaw) {
      if (!normalizeUrl(urlRaw)) problems.push({ text: 'That link doesn\'t look right', field: els.url });
    } else if (type === 'icon') {
      problems.push({ text: 'Add a link', field: els.url });
    }
  }
  if (type === 'reminder') {
    if (form.track === 'date') {
      if (!fromDateKey(els.date.value)) problems.push({ text: 'Pick a date', field: els.date });
    } else {
      const target = readNumber(els.target);
      const current = readNumber(els.current);
      if (target === null || Number.isNaN(target)) problems.push({ text: 'Enter a target number', field: els.target });
      if (Number.isNaN(current)) problems.push({ text: 'The current number isn\'t a number', field: els.current });
    }
  }
  if (type === 'copyPaste' && !els.copyText.value.trim()) {
    problems.push({ text: 'Add the text to copy', field: els.copyText });
  }
  return { ok: problems.length === 0, problems };
}

function update() {
  if (!root || !form) return;
  if (activeType === 'separator') {
    els.missing.textContent = '';
    return;
  }
  const { ok, problems } = validate();
  // Runs on every keystroke: re-setting the same value would still wake the glass light observers
  const ariaDisabled = ok ? 'false' : 'true';
  if (els.save.getAttribute('aria-disabled') !== ariaDisabled) els.save.setAttribute('aria-disabled', ariaDisabled);
  // Left as is: .ic-missing is aria-live, and re-inserting the same text can re-announce it
  els.missing.textContent = ok ? '' : problems[0].text;
  els.missing.classList.toggle('is-error', attempted && !ok);
}

// ============================================================
// SAVE
// ============================================================

async function save() {
  if (busy || !ctx || activeType === 'separator') return;
  const { ok, problems } = validate();
  if (!ok) {
    attempted = true;
    update();
    els.dialog.classList.remove('ic-shake');
    void els.dialog.offsetWidth; // restart the shake
    els.dialog.classList.add('ic-shake');
    if (problems[0].field) problems[0].field.focus();
    return;
  }

  busy = true;
  els.save.textContent = 'Adding…';
  els.save.setAttribute('aria-disabled', 'true');
  const type = activeType;
  const { sectionId, editing } = ctx;
  const subtitle = els.section.value || '_default';
  const uploaded = [];   // R2 files created by this save (deleted again if it fails)

  try {
    // Link first: a failed file upload stops the save before anything else is uploaded
    let link = { url: PLACEHOLDER_URL };
    if (type === 'icon' || type === 'subtask' || type === 'reminder') {
      if (form.link === 'file' && form.file) {
        const result = await uploadFile(form.file, form.file.name);
        if (!result.ok || !result.fileId) {
          showToast('File upload failed: ' + (result.error || 'Unknown error'));
          return;
        }
        uploaded.push(result.fileId);
        link = { url: PLACEHOLDER_URL, linkType: 'file', fileId: result.fileId, fileName: form.file.name };
      } else if (els.url.value.trim()) {
        link = { url: normalizeUrl(els.url.value.trim()) };
      }
    }

    let iconRef = null;
    if (type === 'icon') {
      iconRef = form.emoji || await resolveIconMedia(form.media);
      const ref = classifyImageRef(iconRef);
      if (ref.type === 'r2') uploaded.push(ref.value);
    }

    // Edit mode could have been left while files uploaded: never write into
    // a working copy that no longer exists
    if (editing !== editState.enabled) {
      if (uploaded.length && window.cleanupOrphanedR2Files) window.cleanupOrphanedR2Files(uploaded);
      showToast('Nothing was added: edit mode changed while saving');
      return;
    }

    const data = currentData();
    const cardData = data[sectionId];
    if (!cardData) {
      if (uploaded.length && window.cleanupOrphanedR2Files) window.cleanupOrphanedR2Files(uploaded);
      showToast('That card no longer exists');
      return;
    }
    if (!cardData[subtitle] || typeof cardData[subtitle] !== 'object' || Array.isArray(cardData[subtitle])) {
      cardData[subtitle] = { icons: [], reminders: [], subtasks: [], copyPaste: [] };
    }
    const group = cardData[subtitle];
    const collectionName = { icon: 'icons', subtask: 'subtasks', reminder: 'reminders', copyPaste: 'copyPaste' }[type];
    if (!Array.isArray(group[collectionName])) group[collectionName] = [];
    const collection = group[collectionName];

    const item = buildItem(type, collection, link, iconRef);
    collection.push(item);
    lastSubtitleByCard.set(sectionId, subtitle);

    busy = false;
    closeItemCreator();
    commit();

    const fileIds = uploaded.slice();
    afterAdd({
      sectionId, subtitle, key: item.key, message: `${TYPE_LABELS[type]} added`,
      undo: () => {
        const coll = currentData()[sectionId]?.[subtitle]?.[collectionName];
        const idx = Array.isArray(coll) ? coll.findIndex(i => i.key === item.key) : -1;
        if (idx === -1) return false;
        coll.splice(idx, 1);
        if (fileIds.length && window.cleanupOrphanedR2Files) window.cleanupOrphanedR2Files(fileIds);
        return true;
      }
    });
  } catch (err) {
    console.error('[Item creator] Save failed:', err);
    if (uploaded.length && window.cleanupOrphanedR2Files) window.cleanupOrphanedR2Files(uploaded);
    showToast('Couldn\'t add the item. Please try again');
  } finally {
    if (busy) {
      busy = false;
      els.save.textContent = 'Add';
      update();
    }
  }
}

function buildItem(type, collection, link, iconRef) {
  const name = els.name.value.trim();
  const fileFields = link.linkType === 'file'
    ? { linkType: 'file', fileId: link.fileId, fileName: link.fileName }
    : {};

  if (type === 'icon') {
    const item = { key: generateKey('icon', collection), icon: iconRef, url: link.url, title: name, ...fileFields };
    if (els.invert.checked && document.body.dataset.theme === 'dark') item.invertDark = true;
    return item;
  }

  if (type === 'subtask') {
    return { key: generateKey('subtask', collection), text: name, url: link.url, links: null, ...fileFields };
  }

  if (type === 'reminder') {
    const base = { key: generateKey('reminder', collection), title: name, url: link.url, links: null, breakdown: null, ...fileFields };
    if (form.track === 'counter') {
      const target = Math.round(readNumber(els.target));
      const current = Math.round(readNumber(els.current) || 0);
      return { ...base, type: 'interval', schedule: null, interval: target, currentNumber: current, intervalType: els.ctype.value, intervalUnit: els.unit.value };
    }
    // Same schedule shapes as the calendar popover (reminders.js)
    const date = fromDateKey(els.date.value);
    let schedule;
    if (els.repeat.value === 'weekly') {
      schedule = { type: 'weekday', weekday: date.getDay(), weekInterval: parseInt(els.weeks.value, 10) || 1 };
    } else if (els.repeat.value === 'monthly') {
      schedule = els.monthly.value === 'firstWeekday'
        ? { type: 'monthlyWeekday', weekday: date.getDay(), weekOfMonth: 1 }
        : { type: 'monthly', dayOfMonth: date.getDate() };
    } else {
      schedule = { type: 'once', date };
    }
    const reminder = { ...base, type: 'days', schedule };
    if (schedule.type === 'once') reminder.scheduleSetAt = new Date().toISOString();
    return reminder;
  }

  // Copy-paste: the label defaults to the first line of the text
  const copyText = els.copyText.value;
  const firstLine = copyText.trim().split('\n')[0];
  const label = name || (firstLine.length > 40 ? firstLine.slice(0, 39) + '…' : firstLine);
  return { key: generateKey('copy', collection), text: label, copyText };
}

// Write the change: edit mode keeps it in the working copy (Confirm saves it);
// view mode saves to the profile right away and pushes it to the cloud
// quietly (a failed push stays dirty and retries on the sync timer)
function commit() {
  markDirtyAndSave();
  if (!editState.enabled && window.cloudSave) {
    Promise.resolve(window.cloudSave()).catch(() => {});
  }
  if (window.renderAllSections) window.renderAllSections();
}

// Toast with Undo + a short glow on the new item
function afterAdd({ sectionId, subtitle, key, message, undo }) {
  const mode = editState.enabled;
  showActionToast(message, [{
    label: 'Undo',
    run: () => {
      if (editState.enabled !== mode) {
        showToast(mode ? 'Edit mode is closed. Nothing to undo' : 'Finish editing first');
        return;
      }
      if (undo()) {
        commit();
        showToast('Removed');
      }
    }
  }]);
  requestAnimationFrame(() => {
    const card = findCardEl(sectionId);
    if (!card) return;
    const group = [...card.querySelectorAll('.unified-content-group')].find(g => (g.dataset.subtitle || '_default') === subtitle);
    const el = group && [...group.querySelectorAll('[data-key]')].find(n => n.dataset.key === key);
    if (!el) return;
    el.classList.add('ic-just-added');
    el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    setTimeout(() => el.classList.remove('ic-just-added'), 2600);
  });
}

// ============================================================
// SEPARATOR PLACEMENT
// ============================================================

function isDividerEl(el) {
  return el.classList.contains('icon-separator');
}

// Every gap between two neighbouring icons (not next to an existing
// separator), in visible icon rows of the card. Marker geometry is relative
// to its icons group, so markers scroll with the card on their own.
function computeSlots(cardEl) {
  const slots = [];
  if (!cardEl) return slots;
  cardEl.querySelectorAll('.unified-content-group').forEach(groupEl => {
    const iconsGroup = groupEl.querySelector(':scope > .unified-icons-group');
    if (!iconsGroup) return;
    const gr = iconsGroup.getBoundingClientRect();
    if (!gr.width || !gr.height) return; // collapsed section
    const items = [...iconsGroup.children].filter(c => c.dataset && c.dataset.key);
    const keys = items.map(i => i.dataset.key);
    const gap = parseFloat(getComputedStyle(iconsGroup).columnGap) || 16;
    for (let i = 1; i < items.length; i++) {
      const a = items[i - 1];
      const b = items[i];
      if (isDividerEl(a) || isDividerEl(b)) continue;
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      const sameRow = Math.abs(ra.top - rb.top) < 8;
      const x = sameRow ? (ra.right + rb.left) / 2 : ra.right + gap / 2;
      const top = sameRow ? Math.min(ra.top, rb.top) : ra.top;
      const bottom = sameRow ? Math.max(ra.bottom, rb.bottom) : ra.bottom;
      slots.push({
        iconsGroup,
        subtitle: groupEl.dataset.subtitle || '_default',
        index: i,
        keys,
        rel: { x: x - gr.left, y: top - gr.top, h: bottom - top }
      });
    }
  });
  return slots;
}

function startSeparatorFromDialog() {
  const cardEl = findCardEl(ctx.sectionId) || ctx.cardEl;
  ctx.cardEl = cardEl;
  if (!computeSlots(cardEl).length) {
    // Nowhere to put one: explain inside the window
    setType('separator');
    return;
  }
  closeEmoji();
  root.hidden = true;
  startPlacement(cardEl, ctx.sectionId, (placed) => {
    if (placed) {
      root.hidden = false; // closeItemCreator expects an open window
      closeItemCreator();
    } else if (ctx) {
      root.hidden = false;
      setType(lastType);
      const tab = els.tabs.find(t => t.dataset.type === 'separator');
      if (tab) tab.focus();
    }
  });
}

function startPlacement(cardEl, sectionId, onEnd) {
  const coarse = matchMedia('(pointer: coarse)').matches;
  placing = { cardEl, sectionId, onEnd, slots: [], hover: null, radius: coarse ? 56 : 44 };

  cardEl.classList.add('sep-placing');
  document.documentElement.classList.add('sep-placing-active');
  buildMarkers();

  const hint = document.createElement('div');
  hint.className = 'sep-place-hint';
  hint.setAttribute('role', 'status');
  hint.innerHTML = `
    <span class="sep-place-hint-text">${coarse ? 'Tap' : 'Click'} between two icons to place the separator</span>
    <span class="sep-place-hint-key" aria-hidden="true"><kbd>Esc</kbd> cancel</span>
    <button type="button" class="sep-place-cancel">Cancel</button>`;
  hint.querySelector('.sep-place-cancel').addEventListener('click', () => endPlacement(false));
  document.body.appendChild(hint);
  placing.hint = hint;

  const swallow = (e) => {
    if (e.target.closest && e.target.closest('.sep-place-hint')) return;
    e.stopPropagation();
    if (e.type !== 'touchstart') e.preventDefault();
  };
  const onMove = (e) => {
    if (e.pointerType === 'touch') return;
    setHover(nearestSlot(e.clientX, e.clientY));
  };
  const onClick = (e) => {
    if (e.target.closest && e.target.closest('.sep-place-hint')) return;
    e.preventDefault();
    e.stopPropagation();
    const slot = nearestSlot(e.clientX, e.clientY);
    if (!placing) return;
    if (slot) placeSeparator(slot);
    else if (!placing.cardEl.contains(e.target)) endPlacement(false);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      endPlacement(false);
    } else if (e.key === 'Enter' && placing.hover) {
      e.preventDefault();
      placeSeparator(placing.hover);
    }
    e.stopPropagation();
  };
  const onScroll = () => setHover(placing.hover);
  const onResize = () => {
    buildMarkers();
    setHover(null);
  };

  placing.listeners = [
    ['pointerdown', swallow], ['mousedown', swallow], ['touchstart', swallow],
    ['contextmenu', swallow], ['dragstart', swallow], ['dblclick', swallow],
    ['pointermove', onMove], ['click', onClick], ['keydown', onKey],
    ['scroll', onScroll], ['resize', onResize]
  ];
  placing.listeners.forEach(([type, fn]) => window.addEventListener(type, fn, { capture: true, passive: false }));
}

function buildMarkers() {
  if (!placing) return;
  placing.slots.forEach(s => s.marker && s.marker.remove());
  placing.slots = computeSlots(placing.cardEl);
  placing.slots.forEach((slot, i) => {
    const marker = document.createElement('span');
    marker.className = 'sep-slot';
    marker.setAttribute('aria-hidden', 'true');
    marker.style.left = `${slot.rel.x.toFixed(1)}px`;
    marker.style.top = `${slot.rel.y.toFixed(1)}px`;
    marker.style.height = `${slot.rel.h.toFixed(1)}px`;
    // Uneven breathing phases, so the markers never pulse in step
    marker.style.animationDelay = `${(-(i * 1.37) % 5).toFixed(2)}s`;
    slot.iconsGroup.appendChild(marker);
    slot.marker = marker;
  });
}

// A re-render while placing (sync, another tab's change) replaces the card
// element: move the session onto the new one and rebuild its markers
function ensureFreshCard() {
  if (!placing || placing.cardEl.isConnected) return;
  const fresh = findCardEl(placing.sectionId);
  if (!fresh) {
    endPlacement(false);
    return;
  }
  placing.cardEl.classList.remove('sep-placing');
  placing.cardEl = fresh;
  fresh.classList.add('sep-placing');
  buildMarkers();
}

function nearestSlot(x, y) {
  ensureFreshCard();
  if (!placing) return null;
  let best = null;
  let bestD = Infinity;
  for (const slot of placing.slots) {
    const r = slot.marker.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
    const d = Math.hypot(x - cx, dy);
    if (d < bestD) {
      bestD = d;
      best = slot;
    }
  }
  return bestD <= placing.radius ? best : null;
}

function setHover(slot) {
  if (!placing) return;
  placing.hover = slot;
  if (!slot || !slot.marker.isConnected) {
    hideDropLight();
    return;
  }
  const r = slot.marker.getBoundingClientRect();
  showDropLight({ x: r.left + r.width / 2, y: r.top - 4, length: r.height + 8, vertical: true });
}

function endPlacement(placed) {
  if (!placing) return;
  const session = placing;
  placing = null;
  session.listeners.forEach(([type, fn]) => window.removeEventListener(type, fn, { capture: true }));
  hideDropLight();
  session.slots.forEach(s => s.marker && s.marker.remove());
  session.hint.remove();
  session.cardEl.classList.remove('sep-placing');
  document.documentElement.classList.remove('sep-placing-active');
  session.onEnd(placed);
}

// What you see is what's saved: the group is stored in its on-screen order
// (view mode shows Quick Access icons first), then the separator goes into
// the clicked gap
function placeSeparator(slot) {
  const sectionId = placing.sectionId;
  const data = currentData();
  const group = data[sectionId]?.[slot.subtitle];
  if (!group || !Array.isArray(group.icons)) {
    endPlacement(false);
    return;
  }
  const before = group.icons.slice();
  const byKey = new Map(group.icons.map(i => [i.key, i]));
  const ordered = slot.keys.map(k => byKey.get(k)).filter(Boolean);
  group.icons.forEach(i => { if (!ordered.includes(i)) ordered.push(i); });
  const key = generateKey('sep', group.icons);
  ordered.splice(slot.index, 0, { key, icon: DIVIDER_SRC(), isDivider: true });
  group.icons = ordered;
  const after = ordered.slice();

  endPlacement(true);
  commit();
  afterAdd({
    sectionId, subtitle: slot.subtitle, key, message: 'Separator added',
    undo: () => {
      const g = currentData()[sectionId]?.[slot.subtitle];
      if (!g || !Array.isArray(g.icons)) return false;
      const unchanged = g.icons.length === after.length && g.icons.every((item, i) => item === after[i]);
      if (unchanged) {
        g.icons = before;
        return true;
      }
      const idx = g.icons.findIndex(i => i.key === key);
      if (idx === -1) return false;
      g.icons.splice(idx, 1);
      return true;
    }
  });
}
