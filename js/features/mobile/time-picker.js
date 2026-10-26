// Personal Dashboard - Mobile shell: the time field and the time picker
// Chrome on Android never lets you type into an <input type="time">: a tap
// always opens the system clock dialog, whose header (hour, minutes, AM / PM)
// the page can't style and which reads washed out under the app's light
// theme colour. Under the shell a time field is ours instead:
//
//   enhanceTimeInput(input, { label, role, getStart })
//     puts a field after the native input: a text box that raises the number
//     keyboard ('3', '330', '1530', '3:30', '3pm': due-time.js parseTypedTime),
//     a visible AM | PM switch in 12-hour locales (the side in effect is
//     filled; a guessed side gets a dashed track and a line under the field
//     saying how it reads) and a clock button that opens the picker.
//     The native input stays the field of record: values go back into it
//     through HTMLInputElement's own value setter, followed by input / change
//     events, so the editor that owns it (tasks.js) runs unchanged. A
//     per-instance `value` property (delegating to the prototype's) repaints
//     the field whenever that code sets the value itself (opening a task, ×,
//     an end moved along with its start). removeTimeField() undoes all of it.
//     mobile.css §14 hides the native input under the shell and the field
//     everywhere else.
//
//   openTimePicker({ value, mode, start, title, hour12, onPick, onClear, onClose, returnFocus })
//     a bottom sheet over everything (a child of <body>, z 10055: above the
//     writer frames 10010-10012, focus mode 10040 and the file viewer 10050;
//     under help 10060 and the toasts). The readout [3] : [30] [AM | PM] fills,
//     rings and bolds the part being set; an hour grid, then a minute grid
//     (5-minute steps, ‹ › for single minutes). mode 'end' shows the start,
//     quick lengths and the length, and turns off every time at or before the
//     start. A shell layer: Back, Escape, the scrim and Cancel close it without
//     a change; the focus goes back to the opener (returnFocus: that element,
//     a text field included).

import { registerLayer, syncHistory } from './layers.js?v=2026-10-mobile-11';
import { animate, haptic, reduceMotion } from './ui.js?v=2026-10-mobile-11';
import {
  parseTypedTime, prefersHour12, timeKeyFromInput, timeKeyMinutes, minutesToTimeKey, formatTimeKey,
} from '../../core/due-time.js';

const VALUE = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
const CLOCK_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8.6"/><polyline points="12 7.2 12 12 15.2 14"/></svg>';
const PREV_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><polyline points="15 18 9 12 15 6"/></svg>';
const NEXT_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><polyline points="9 18 15 12 9 6"/></svg>';
const LENGTHS = [
  { min: 15, label: '15m', name: '15 minutes' },
  { min: 30, label: '30m', name: '30 minutes' },
  { min: 45, label: '45m', name: '45 minutes' },
  { min: 60, label: '1h', name: '1 hour' },
  { min: 90, label: '1½h', name: '1 hour 30 minutes' },
  { min: 120, label: '2h', name: '2 hours' },
];
const LAST_MINUTE = 1439;
const HALF_DAY = 720;

let uid = 0;
let current = null;            // the open picker's handle

// --- Small helpers ---------------------------------------------------------------------------

function el(tag, cls, attrs = {}) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  Object.entries(attrs).forEach(([k, v]) => {
    if (v == null || v === false) return;
    if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else n.setAttribute(k, v === true ? '' : v);
  });
  return n;
}

// Writes only what changed (glass-glow.js watches attributes and text)
function setText(node, text) {
  const t = node.firstChild;
  if (t && t.nodeType === 3 && !t.nextSibling) {
    if (t.data !== text) t.data = text;
  } else if (node.textContent !== text) {
    node.textContent = text;
  }
}

function setAttr(node, name, value) {
  if (value == null || value === false) {
    if (node.hasAttribute(name)) node.removeAttribute(name);
  } else {
    const v = value === true ? '' : String(value);
    if (node.getAttribute(name) !== v) node.setAttribute(name, v);
  }
}

function setClass(node, cls, on) {
  if (node.classList.contains(cls) !== !!on) node.classList.toggle(cls, !!on);
}

function setDisabled(btn, off) {
  if (btn.disabled !== !!off) btn.disabled = !!off;
}

const pad = (n) => String(n).padStart(2, '0');
const halfOf = (mins) => (mins == null ? null : mins < HALF_DAY ? 'am' : 'pm');

// What the field shows: '3:30' (the AM / PM switch says the rest) or '15:30'
function fieldText(key, hour12) {
  const mins = timeKeyMinutes(key);
  if (mins == null) return '';
  const h = Math.floor(mins / 60);
  return hour12 ? `${h % 12 || 12}:${pad(mins % 60)}` : `${pad(h)}:${pad(mins % 60)}`;
}

// 90 → '1 h 30 min'
export function lengthLabel(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

function nativeValue(input) {
  return VALUE.get.call(input);
}

// The native input's own setter: tasks.js sees an ordinary value, and our
// instance setter (which repaints the field) is not involved
function writeNative(input, key) {
  if (nativeValue(input) === key) return false;
  VALUE.set.call(input, key);
  return true;
}

function fire(input, ...types) {
  types.forEach(type => input.dispatchEvent(new Event(type, { bubbles: true })));
}

// --- The field -----------------------------------------------------------------------------------

// input: an <input type="time">. role 'end' (with getStart() → 'HH:MM') reads
// a typed time without AM / PM as the first one after the start
export function enhanceTimeInput(input, { label = 'Time', role = 'start', getStart = null, placeholder = '--:--' } = {}) {
  if (!input) return null;
  if (input._mxTf) { input._mxTf.refresh(); return input._mxTf; }
  const hour12 = prefersHour12();
  const id = `mx-tf-${++uid}`;

  const wrap = el('span', 'mx-tf', { 'data-role': role });
  const lab = el('label', 'mx-tf-label', { for: id, text: label });
  const text = el('input', 'mx-tf-text', {
    id, type: 'text', inputmode: 'numeric', enterkeyhint: 'done', autocomplete: 'off', autocapitalize: 'off',
    autocorrect: 'off', spellcheck: 'false', placeholder, 'aria-describedby': `${id}-full ${id}-hint`,
  });
  const full = el('span', 'mx-visually-hidden', { id: `${id}-full` });
  const clock = el('button', 'mx-tf-clock', {
    type: 'button', html: CLOCK_SVG, title: 'Pick on a clock', 'aria-label': `${label}: pick on a clock`,
  });
  const hint = el('span', 'mx-tf-hint', { id: `${id}-hint`, 'aria-live': 'polite' });
  let ampm = null;
  const halves = {};
  if (hour12) {
    ampm = el('span', 'mx-tf-ampm', { role: 'group', 'aria-label': `${label}: AM or PM` });
    ['am', 'pm'].forEach(half => {
      const b = el('button', 'mx-tf-half', { type: 'button', 'data-half': half, 'aria-pressed': 'false', text: half.toUpperCase() });
      // The text box keeps the focus (and the keyboard stays up)
      b.addEventListener('pointerdown', (e) => e.preventDefault());
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => onHalf(half));
      halves[half] = b;
      ampm.appendChild(b);
    });
  }
  wrap.append(lab, text);
  if (ampm) wrap.appendChild(ampm);
  wrap.append(clock, hint, full);

  // focused: typing; atFocus: the value when typing began; shown / guessedAtFocus:
  // the box's text and the guess then (a box left as it showed changes neither);
  // pinned: the AM / PM a typed time takes, pinnedBy: 'kept' (the side the field
  // showed) or 'tap'; guessed: the AM / PM wasn't said (typed or tapped); msg: a
  // line under the field
  const st = {
    focused: false, atFocus: '', shown: '', guessedAtFocus: false, pinned: null, pinnedBy: null, guessed: false, msg: '', error: false,
  };

  function currentKey() {
    return timeKeyFromInput(nativeValue(input));
  }

  function startKey() {
    return timeKeyFromInput(typeof getStart === 'function' ? getStart() : '');
  }

  // Nothing typed since the focus (or typed back to what the box showed), and
  // no side tapped: the value it had stays, and isn't a new guess
  function untouched() {
    return !!st.shown && text.value === st.shown && st.pinnedBy !== 'tap';
  }

  function keepAsShown() {
    st.guessed = st.guessedAtFocus;
    if (writeNative(input, st.atFocus)) fire(input, 'input');
  }

  function parseTyped(raw) {
    if (!hour12) return parseTypedTime(raw, { hour12: false });
    const explicit = /[a-z]/i.test(raw);
    if (explicit || st.pinned) {
      const r = parseTypedTime(raw, { hour12: true, meridiem: st.pinned });
      if (explicit) return r.key ? { ...r, guessed: false } : r;
      // The side the switch already showed, kept: still not something the
      // user said, so the field says how it reads (unless the side was tapped)
      if (r.key && st.pinnedBy !== 'tap') {
        const other = parseTypedTime(raw, { hour12: true, meridiem: st.pinned === 'am' ? 'pm' : 'am' });
        // An end keeps the first-reading-after-the-start rule too: only a
        // tapped side may read before its start
        if (role === 'end' && other.key && other.key !== r.key) {
          const start = startKey();
          if (start && r.key <= start && other.key > start) return { ...other, guessed: true };
        }
        if (other.key !== r.key) return { ...r, guessed: true };
      }
      return r;
    }
    let r = parseTypedTime(raw, { hour12: true });
    // An end without AM / PM: the first reading after its start
    if (role === 'end' && r.key && r.guessed) {
      const start = startKey();
      if (start) {
        const pick = ['am', 'pm'].map(m => parseTypedTime(raw, { hour12: true, meridiem: m })).find(x => x.key && x.key > start);
        if (pick) r = { ...pick, guessed: true };
      }
    }
    return r;
  }

  function paint() {
    const key = currentKey();
    const mins = timeKeyMinutes(key);
    if (!st.focused) {
      const shown = fieldText(key, hour12);
      if (text.value !== shown) text.value = shown;
    }
    const half = mins != null ? halfOf(mins) : st.pinned;
    if (ampm) {
      setAttr(halves.am, 'aria-pressed', String(half === 'am'));
      setAttr(halves.pm, 'aria-pressed', String(half === 'pm'));
      setClass(ampm, 'is-guessed', st.guessed && mins != null);
    }
    setText(full, key ? formatTimeKey(key) : 'No time');
    let msg = st.msg;
    if (!msg && st.guessed && key && ampm) {
      msg = `Reads as ${formatTimeKey(key)} · tap ${half === 'am' ? 'PM' : 'AM'} to change`;
    }
    setText(hint, msg);
    setClass(hint, 'is-error', !!st.msg && st.error);
    setAttr(text, 'aria-invalid', input.getAttribute('aria-invalid') === 'true' ? 'true' : null);
    setDisabled(text, input.disabled);
    setDisabled(clock, input.disabled);
    if (ampm) { setDisabled(halves.am, input.disabled); setDisabled(halves.pm, input.disabled); }
  }

  function say(msg, error = false) {
    st.msg = msg;
    st.error = error;
  }

  // Programmatic sets on the native input (tasks.js) repaint the field. One
  // that changes the value while the box is being typed in (its start moved
  // this end along) starts the box again from the new value: shown, all
  // selected, its side kept, or the blur would write the old text back
  function onExternal(before) {
    st.guessed = false;
    if (!st.focused) {
      st.pinned = null;
      st.pinnedBy = null;
    } else if (nativeValue(input) !== before) {
      const key = currentKey();
      st.atFocus = nativeValue(input);
      st.pinned = halfOf(timeKeyMinutes(key));
      st.pinnedBy = st.pinned ? 'kept' : null;
      text.value = fieldText(key, hour12);
      st.shown = text.value;
      st.guessedAtFocus = false;
      try { text.select(); } catch { /* not selectable */ }
    }
    say('');
    paint();
  }
  Object.defineProperty(input, 'value', {
    configurable: true,
    enumerable: true,
    get() { return VALUE.get.call(this); },
    set(v) {
      const before = VALUE.get.call(this);
      VALUE.set.call(this, v);
      onExternal(before);
    },
  });

  text.addEventListener('focus', () => {
    st.focused = true;
    st.atFocus = nativeValue(input);
    st.shown = text.value;
    st.guessedAtFocus = st.guessed;
    const mins = timeKeyMinutes(currentKey());
    // Typing keeps the side the switch shows (a guessed one keeps guessing);
    // an empty field keeps a side tapped before typing
    if (mins != null) {
      st.pinned = st.guessed ? null : halfOf(mins);
      st.pinnedBy = st.pinned ? 'kept' : null;
    }
    say('');
    paint();
    // All of it selected, so the first key replaces it (again a frame later:
    // the tap that focused places a caret after this; not once typing began)
    const shown = text.value;
    try { text.select(); } catch { /* not selectable */ }
    requestAnimationFrame(() => {
      if (document.activeElement === text && text.value === shown) { try { text.select(); } catch { /* not selectable */ } }
    });
  });

  // Every keystroke that reads as a time goes in right away (tasks.js moves
  // the end along, counted from where this edit began); an empty or unreadable
  // box waits for the blur
  text.addEventListener('input', () => {
    if (untouched()) {
      keepAsShown();
    } else {
      const r = parseTyped(text.value);
      if (r.key) {
        st.guessed = !!r.guessed;
        if (writeNative(input, r.key)) fire(input, 'input');
      }
    }
    if (st.msg) say('');
    paint();
  });

  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      text.blur();
    }
  });

  text.addEventListener('blur', () => {
    const same = untouched();
    const r = same ? null : parseTyped(text.value);
    st.focused = false;
    if (same) {
      keepAsShown();
    } else if (r.empty) {
      st.guessed = false;
      if (writeNative(input, '')) fire(input, 'input');
    } else if (r.error) {
      // Back to the value typing began with
      const before = timeKeyFromInput(st.atFocus);
      st.guessed = false;
      if (writeNative(input, st.atFocus)) fire(input, 'input');
      say(before ? `${r.error} · kept ${formatTimeKey(before)}` : r.error, true);
    } else {
      st.guessed = !!r.guessed;
      if (writeNative(input, r.key)) fire(input, 'input');
    }
    if (nativeValue(input) !== st.atFocus) fire(input, 'change');
    paint();
  });

  function onHalf(half) {
    if (input.disabled) return;
    haptic('tick');
    st.pinned = half;
    st.pinnedBy = 'tap';
    st.guessed = false;
    say('');
    if (st.focused) {
      // The box is being typed in: read it again with this side
      const r = parseTyped(text.value);
      if (r.key && writeNative(input, r.key)) fire(input, 'input');
    } else {
      const mins = timeKeyMinutes(currentKey());
      if (mins == null) {
        // Nothing to turn yet: the side waits for the time (and the keyboard comes up)
        paint();
        try { text.focus({ preventScroll: true }); } catch { /* gone */ }
        return;
      }
      const next = minutesToTimeKey((mins % HALF_DAY) + (half === 'pm' ? HALF_DAY : 0));
      if (next && writeNative(input, next)) fire(input, 'input', 'change');
    }
    paint();
  }

  clock.addEventListener('click', () => {
    if (input.disabled) return;
    if (st.focused) text.blur();                 // what was typed counts first
    const value = currentKey();
    const start = role === 'end' && typeof getStart === 'function' ? timeKeyFromInput(getStart()) : null;
    openTimePicker({
      value,
      mode: start ? 'end' : 'start',
      start,
      title: label,
      hour12,
      returnFocus: clock,
      onPick: (key) => {
        st.guessed = false;
        st.pinned = null;
        st.pinnedBy = null;
        say('');
        if (writeNative(input, key)) fire(input, 'input', 'change');
        paint();
      },
      onClear: value ? () => {
        st.guessed = false;
        st.pinned = null;
        st.pinnedBy = null;
        say('');
        if (writeNative(input, '')) fire(input, 'input', 'change');
        paint();
      } : null,
    });
  });

  // tasks.js marks an end that isn't after its start (and could disable the field)
  const attrObserver = new MutationObserver(() => paint());
  attrObserver.observe(input, { attributes: true, attributeFilter: ['aria-invalid', 'disabled'] });

  input.dataset.mxTf = role;
  input.after(wrap);

  const handle = {
    el: wrap,
    text,
    refresh: () => { if (!st.focused) { st.guessed = false; say(''); } paint(); },
    destroy() {
      attrObserver.disconnect();
      delete input.value;                         // back to the prototype's
      delete input.dataset.mxTf;
      wrap.remove();
      input._mxTf = null;
    },
  };
  input._mxTf = handle;
  paint();
  return handle;
}

export function removeTimeField(input) {
  if (input && input._mxTf) input._mxTf.destroy();
}

// --- The picker -----------------------------------------------------------------------------------

export function isTimePickerOpen() {
  return !!current;
}

export function closeTimePicker({ immediate = false } = {}) {
  if (current) current.close({ immediate });
}

function nextWholeHour() {
  const d = new Date();
  return ((d.getHours() + 1) % 24) * 60;
}

export function openTimePicker(opts = {}) {
  if (current) current.close({ immediate: true });
  const hour12 = opts.hour12 != null ? !!opts.hour12 : prefersHour12();
  const start = opts.mode === 'end' ? timeKeyFromInput(opts.start) : null;
  const mode = start ? 'end' : 'start';
  const startMin = start ? timeKeyMinutes(start) : -1;
  const given = timeKeyMinutes(timeKeyFromInput(opts.value));
  const st = {
    min: given != null ? given : (mode === 'end' ? Math.min(startMin + 60, LAST_MINUTE) : nextWholeHour()),
    part: 'hour',
    closed: false,
  };
  const opener = document.activeElement;
  const title = opts.title || (mode === 'end' ? 'Ends' : 'Time');
  let unregister = null;

  // --- DOM -------------------------------------------------------------------------------
  const root = el('div', 'mx-tp', {
    id: 'mx-time-picker', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'mx-tp-title',
    'data-mode': mode, 'data-hour12': String(hour12),
  });
  const scrim = el('div', 'mx-tp-scrim', { 'aria-hidden': 'true' });
  const sheet = el('section', 'mx-tp-sheet', { tabindex: '-1' });
  const head = el('header', 'mx-tp-head');
  head.appendChild(el('h2', 'mx-tp-title', { id: 'mx-tp-title', text: title }));
  if (mode === 'end') head.appendChild(el('p', 'mx-tp-sub', { text: `Starts ${formatTimeKey(start)}` }));

  const readout = el('div', 'mx-tp-readout', { role: 'group', 'aria-label': 'Time' });
  const hourBtn = el('button', 'mx-tp-part', { type: 'button', 'data-part': 'hour', 'aria-pressed': 'true' });
  const minuteBtn = el('button', 'mx-tp-part', { type: 'button', 'data-part': 'minute', 'aria-pressed': 'false' });
  const hourDigits = el('span', 'mx-tp-digits', { 'aria-hidden': 'true', text: ' ' });
  const minuteDigits = el('span', 'mx-tp-digits', { 'aria-hidden': 'true', text: ' ' });
  hourBtn.appendChild(hourDigits);
  minuteBtn.appendChild(minuteDigits);
  readout.append(hourBtn, el('span', 'mx-tp-colon', { 'aria-hidden': 'true', text: ':' }), minuteBtn);
  const halves = {};
  if (hour12) {
    const seg = el('span', 'mx-tp-ampm', { role: 'group', 'aria-label': 'AM or PM' });
    ['am', 'pm'].forEach(half => {
      const b = el('button', 'mx-tp-half', { type: 'button', 'data-half': half, 'aria-pressed': 'false', text: half.toUpperCase() });
      b.addEventListener('click', () => setHalf(half));
      halves[half] = b;
      seg.appendChild(b);
    });
    readout.appendChild(seg);
  }

  let lengthLine = null;
  const lengthBtns = [];
  let lengths = null;
  if (mode === 'end') {
    lengthLine = el('p', 'mx-tp-length', { text: ' ' });
    lengths = el('div', 'mx-tp-lengths', { role: 'group', 'aria-label': 'How long' });
    LENGTHS.forEach(len => {
      const b = el('button', 'mx-tp-len', { type: 'button', 'aria-pressed': 'false', 'aria-label': `${len.name} long`, text: len.label });
      b.addEventListener('click', () => {
        if (startMin + len.min > LAST_MINUTE) return;
        st.min = startMin + len.min;
        st.part = 'minute';
        haptic('tick');
        paint();
      });
      lengthBtns.push({ len, b });
      lengths.appendChild(b);
    });
  }

  // Caption row: what the grid sets, and the one-minute nudges
  const capRow = el('div', 'mx-tp-caprow');
  const caption = el('p', 'mx-tp-caption', { text: ' ' });
  const nudges = el('span', 'mx-tp-nudges');
  const earlier = el('button', 'mx-tp-nudge', { type: 'button', html: PREV_SVG, 'aria-label': 'One minute earlier', title: 'One minute earlier' });
  const later = el('button', 'mx-tp-nudge', { type: 'button', html: NEXT_SVG, 'aria-label': 'One minute later', title: 'One minute later' });
  nudges.append(earlier, later);
  capRow.append(caption, nudges);

  const hourGrid = el('div', 'mx-tp-grid mx-tp-grid--hour', { role: 'group', 'aria-label': 'Hour' });
  const hourCells = [];
  const hourLabels = hour12 ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] : [...Array(24).keys()];
  hourLabels.forEach(n => {
    const b = el('button', 'mx-tp-cell', { type: 'button', 'aria-pressed': 'false', text: hour12 ? String(n) : pad(n) });
    b.addEventListener('click', () => pickHour(n));
    hourCells.push({ n, b });
    hourGrid.appendChild(b);
  });
  const minuteGrid = el('div', 'mx-tp-grid mx-tp-grid--minute', { role: 'group', 'aria-label': 'Minutes' });
  minuteGrid.hidden = true;
  const minuteCells = [];
  for (let m = 0; m < 60; m += 5) {
    const b = el('button', 'mx-tp-cell', { type: 'button', 'aria-pressed': 'false', text: pad(m), 'aria-label': `:${pad(m)}` });
    b.addEventListener('click', () => pickMinute(m));
    minuteCells.push({ m, b });
    minuteGrid.appendChild(b);
  }

  const foot = el('footer', 'mx-tp-foot');
  const clearBtn = el('button', 'mx-btn mx-btn-quiet mx-btn-danger mx-tp-clear', { type: 'button', text: 'Clear' });
  const cancelBtn = el('button', 'mx-btn mx-tp-cancel', { type: 'button', text: 'Cancel' });
  const setBtn = el('button', 'mx-btn mx-btn-primary mx-tp-set', { type: 'button', text: 'Set' });
  if (typeof opts.onClear === 'function') foot.appendChild(clearBtn);
  foot.append(el('span', 'mx-tp-spacer'), cancelBtn, setBtn);
  const live = el('span', 'mx-visually-hidden', { 'aria-live': 'polite' });

  sheet.append(head, readout);
  if (lengthLine) sheet.append(lengthLine, lengths);
  sheet.append(capRow, hourGrid, minuteGrid, foot, live);
  root.append(scrim, sheet);

  // --- State → DOM (only what changed is written) ----------------------------------------------
  const valid = () => mode !== 'end' || st.min > startMin;
  const hourOf = (n, half) => (hour12 ? (n % 12) + (half === 'pm' ? 12 : 0) : n);

  function paint() {
    const h = Math.floor(st.min / 60);
    const m = st.min % 60;
    const half = halfOf(st.min);
    setText(hourDigits, hour12 ? String(h % 12 || 12) : pad(h));
    setText(minuteDigits, pad(m));
    setAttr(hourBtn, 'aria-pressed', String(st.part === 'hour'));
    setAttr(minuteBtn, 'aria-pressed', String(st.part === 'minute'));
    setAttr(hourBtn, 'aria-label', `Hour, ${hour12 ? h % 12 || 12 : pad(h)}${st.part === 'hour' ? ', being set' : ''}`);
    setAttr(minuteBtn, 'aria-label', `Minutes, ${pad(m)}${st.part === 'minute' ? ', being set' : ''}`);
    if (hour12) {
      setAttr(halves.am, 'aria-pressed', String(half === 'am'));
      setAttr(halves.pm, 'aria-pressed', String(half === 'pm'));
      // An end can't be in a half of the day that is all before its start
      setDisabled(halves.am, mode === 'end' && startMin >= HALF_DAY - 1);
      setDisabled(halves.pm, mode === 'end' && startMin >= LAST_MINUTE);
    }
    hourCells.forEach(({ n, b }) => {
      const h24 = hourOf(n, half);
      setAttr(b, 'aria-pressed', String(h24 === h));
      setDisabled(b, mode === 'end' && h24 * 60 + 59 <= startMin);
    });
    minuteCells.forEach(({ m: mm, b }) => {
      setAttr(b, 'aria-pressed', String(mm === m));
      setDisabled(b, mode === 'end' && h * 60 + mm <= startMin);
    });
    setDisabled(earlier, st.min <= 0 || (mode === 'end' && st.min - 1 <= startMin));
    setDisabled(later, st.min >= LAST_MINUTE);
    hourGrid.hidden = st.part !== 'hour';
    minuteGrid.hidden = st.part !== 'minute';
    setText(caption, st.part === 'hour' ? 'Hour' : 'Minutes');
    if (mode === 'end') {
      const ok = valid();
      setText(lengthLine, ok ? `Lasts ${lengthLabel(st.min - startMin)}` : 'Ends before it starts');
      setClass(lengthLine, 'is-invalid', !ok);
      lengthBtns.forEach(({ len, b }) => {
        setAttr(b, 'aria-pressed', String(st.min - startMin === len.min));
        setDisabled(b, startMin + len.min > LAST_MINUTE);
      });
    }
    setDisabled(setBtn, !valid());
    setText(live, formatTimeKey(minutesToTimeKey(st.min)));
  }

  // The grid that just appeared takes the focus when the old one had it
  // (keyboard and screen reader users keep their place)
  function showPart(part) {
    const hadFocus = hourGrid.contains(document.activeElement) || minuteGrid.contains(document.activeElement);
    st.part = part;
    paint();
    if (hadFocus) {
      const grid = part === 'hour' ? hourGrid : minuteGrid;
      const target = grid.querySelector('[aria-pressed="true"]:not(:disabled)') || grid.querySelector('button:not(:disabled)');
      if (target) { try { target.focus({ preventScroll: true }); } catch { /* gone */ } }
    }
  }

  function pickHour(n) {
    const h24 = hourOf(n, halfOf(st.min));
    st.min = h24 * 60 + (st.min % 60);
    haptic('tick');
    showPart('minute');
  }

  function pickMinute(m) {
    st.min = Math.floor(st.min / 60) * 60 + m;
    haptic('tick');
    paint();
  }

  function setHalf(half) {
    if (halfOf(st.min) === half) return;
    st.min = (st.min % HALF_DAY) + (half === 'pm' ? HALF_DAY : 0);
    haptic('tick');
    paint();
  }

  function nudge(delta) {
    const next = st.min + delta;
    if (next < 0 || next > LAST_MINUTE) return;
    st.min = next;
    if (st.part !== 'minute') st.part = 'minute';
    haptic('tick');
    paint();
  }

  // --- Close ------------------------------------------------------------------------------------
  function restoreFocus() {
    const active = document.activeElement;
    if (active && active !== document.body && !root.contains(active)) return;
    const target = opts.returnFocus || opener;
    if (!target || target === document.body || !target.isConnected || root.contains(target)) return;
    if (!opts.returnFocus && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    if (target.closest('[inert], [hidden]')) return;
    try { target.focus({ preventScroll: true }); } catch { /* gone */ }
  }

  function close({ immediate = false } = {}) {
    if (st.closed) return;
    st.closed = true;
    if (current === handle) current = null;
    window.removeEventListener('keydown', onKey, true);
    if (unregister) { unregister(); unregister = null; }
    syncHistory();
    restoreFocus();
    const done = () => root.remove();
    if (immediate || reduceMotion()) {
      done();
    } else {
      // Out of the way at once; removed when the fade ends
      root.inert = true;
      root.dataset.closing = '1';
      const a = animate(sheet, [{ transform: 'translateY(0)', opacity: 1 }, { transform: 'translateY(32px)', opacity: 0 }], { duration: 150, easing: 'ease-in' });
      animate(scrim, [{ opacity: 1 }, { opacity: 0 }], { duration: 150 });
      if (a) { a.onfinish = done; a.oncancel = done; } else done();
    }
    if (typeof opts.onClose === 'function') {
      try { opts.onClose(); } catch (err) { console.error('[mobile] time picker onClose failed', err); }
    }
  }

  function commit() {
    if (!valid()) return;
    const key = minutesToTimeKey(st.min);
    haptic('commit');
    try { if (typeof opts.onPick === 'function') opts.onPick(key); } catch (err) { console.error('[mobile] time picker onPick failed', err); }
    close();
  }

  function clear() {
    try { opts.onClear(); } catch (err) { console.error('[mobile] time picker onClear failed', err); }
    close();
  }

  // Escape closes the picker before anything under it sees the key (the writer
  // frame's own Escape, the preview's layer Escape); Tab stays inside
  function onKey(e) {
    if (st.closed) return;
    const t = e.target;
    const ours = t === document.body || t === document.documentElement || (t instanceof Node && root.contains(t));
    if (!ours) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key === 'Tab') {
      const list = [...sheet.querySelectorAll('button:not(:disabled)')].filter(n => n.getClientRects().length);
      if (!list.length) return;
      const i = list.indexOf(document.activeElement);
      const next = e.shiftKey ? (i <= 0 ? list.length - 1 : i - 1) : (i < 0 || i === list.length - 1 ? 0 : i + 1);
      e.preventDefault();
      list[next].focus();
    }
  }

  // --- Wire up ------------------------------------------------------------------------------------
  hourBtn.addEventListener('click', () => showPart('hour'));
  minuteBtn.addEventListener('click', () => showPart('minute'));
  earlier.addEventListener('click', () => nudge(-1));
  later.addEventListener('click', () => nudge(1));
  scrim.addEventListener('click', () => close());
  cancelBtn.addEventListener('click', () => close());
  setBtn.addEventListener('click', commit);
  clearBtn.addEventListener('click', clear);
  window.addEventListener('keydown', onKey, true);

  const handle = { el: root, close, commit };
  paint();
  document.body.appendChild(root);
  current = handle;
  // A shell layer above every reused modal: Back closes the picker first. The
  // history entry is pushed now, inside the tap
  unregister = registerLayer({
    id: 'time-picker', kind: 'shell',
    root: () => root, isOpen: () => !st.closed, back: () => close(),
  });
  syncHistory();
  animate(sheet, [{ transform: 'translateY(28px)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }], { duration: 200 });
  animate(scrim, [{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
  try { sheet.focus({ preventScroll: true }); } catch { /* not focusable */ }
  return handle;
}
