// Personal Dashboard - Mobile shell: the date field and the date sheet
// Chrome on Android never lets you type into an <input type="date">: a tap
// always opens the system calendar dialog. Under the shell a date field is
// ours instead (the time field's pattern, time-picker.js):
//
//   enhanceDateInput(input, { label, showLabel, placeholder, clearable, calendar, sheetTitle, onEnter, now })
//     puts a field after the native input: a text box that raises the number
//     keyboard and reads what is typed day first (due-date.js parseTypedDate:
//     2112, 21/12, 21 12, 211226, fri, Dec 21 …), the date in words while not
//     typing ('Fri, Oct 23'), a live reading under it while typing, × (clear)
//     and a calendar button: input.showPicker() inside the tap (the native
//     dialog), the date sheet below when the browser won't. The native input
//     stays the field of record and stays rendered (0 x 0, see-through:
//     showPicker needs it): values go back into it through HTMLInputElement's
//     own value setter, followed by input / change events, so the code that
//     owns it (tasks.js, meetings.js, item-creator.js) runs unchanged. Every
//     readable keystroke writes the native input and fires `input`; `change`
//     fires once, when the box is left (or ×, a pick). A per-instance `value`
//     property repaints the field whenever that code sets the value itself, and
//     a native dialog's own events repaint it too. Labels pointing at the native
//     input (for= or a wrapping <label>) point at the box while enhanced, and a
//     focus() on the native input goes to the box. removeDateField() undoes all
//     of it. mobile.css §15 hides the native input under the shell and the
//     field everywhere else.
//     An unreadable date is never saved over in silence: the box keeps the
//     value it had and says why under the field; an Enter that couldn't commit
//     never reaches the owner's Enter-to-save, and an owner's explicit Save asks
//     handle.refuseSave() first (refused once right after a rejected entry, so
//     the line is seen; the next Save takes the kept date). Back never asks.
//
//   openDatePicker({ value, title, onPick, onClear, onClose, returnFocus, min, max, now })
//     a bottom sheet for places with no room for a field (a subtask's date
//     button, the actions sheet's Pick…, the composer's meeting chip), and the
//     calendar fallback: quick chips (Today, Tomorrow, the weekdays, Next Mon:
//     a tap picks and closes) and a typed box (focused, the keyboard up; the
//     sheet sits on it). Clear · Cancel · Set. Set always calls onPick, also
//     with the value it opened on (a native dialog fires nothing then: callers
//     decide what a same-value pick means). A child of <body> at z 10055 like
//     the time picker (it closes an open one); a shell layer: Back, Escape, the
//     scrim and Cancel close it without a change; the focus goes back to the
//     opener (returnFocus: an element, or a function giving one when the
//     opener may have been rebuilt meanwhile).

import { registerLayer, syncHistory } from './layers.js?v=2026-10-mobile-11';
import { animate, haptic, reduceMotion } from './ui.js?v=2026-10-mobile-11';
import { closeTimePicker } from './time-picker.js?v=2026-10-mobile-11';
import { parseTypedDate, dateWords, dateWordsLong, typedDateText, dateHint, isDateKey } from '../../core/due-date.js';
import { dateChips } from '../../core/mobile-compose.js';

const VALUE = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
const CAL_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3.5" y="5" width="17" height="15.5" rx="2.6"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/><line x1="3.5" y1="10" x2="20.5" y2="10"/></svg>';
const X_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';
// A showPicker() may move the focus to the native input: not a reason to raise the keyboard
const PICKER_FOCUS_MS = 1500;
// A Save tapped right after the box refused what was typed (that tap's own
// blur did the refusing): the Save is refused once, so the reason is seen
const REJECT_MS = 800;

let uid = 0;
let current = null;            // the open sheet's handle

// --- Small helpers (the time field's) --------------------------------------------------------

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

function setHidden(node, hidden) {
  if (node.hidden !== !!hidden) node.hidden = !!hidden;
}

function nativeValue(input) {
  return VALUE.get.call(input);
}

// The native input's own setter: its owner sees an ordinary value, and our
// instance setter (which repaints the field) is not involved
function writeNative(input, key) {
  if (nativeValue(input) === key) return false;
  VALUE.set.call(input, key);
  return true;
}

function fire(input, ...types) {
  types.forEach(type => input.dispatchEvent(new Event(type, { bubbles: true })));
}

// Set a date input the way a person would (its input + change listeners run),
// for inputs that have no field of their own (the subtask rows' hidden ones)
export function setDateInputValue(input, key) {
  if (!input || !input.isConnected) return false;
  const v = isDateKey(key) ? key : '';
  if (!writeNative(input, v)) return false;
  fire(input, 'input', 'change');
  return true;
}

const keyOrEmpty = (v) => (isDateKey(v) ? v : '');

// --- The field -----------------------------------------------------------------------------------

// input: an <input type="date">. calendar: 'native' (showPicker, else the
// sheet), 'native-only' (no sheet: the sheet's own box), 'sheet', 'none'.
// showLabel false where the form already labels the field (its label then
// names the box). clearable false keeps a value: an emptied box goes back
export function enhanceDateInput(input, {
  label = 'Date', showLabel = true, placeholder = 'ddmm', clearable = true, calendar = 'native',
  sheetTitle = null, onEnter = null, now = () => new Date(),
} = {}) {
  if (!input) return null;
  if (input._mxDf) { input._mxDf.refresh(); return input._mxDf; }
  const id = `mx-df-${++uid}`;
  const today = () => { try { return now(); } catch { return new Date(); } };

  const wrap = el('span', 'mx-df', { 'data-label': showLabel ? 'on' : 'off' });
  const lab = showLabel ? el('label', 'mx-df-label', { for: id, text: label }) : null;
  const text = el('input', 'mx-df-text', {
    id, type: 'text', inputmode: 'numeric', enterkeyhint: 'done', autocomplete: 'off', autocapitalize: 'off',
    autocorrect: 'off', spellcheck: 'false', placeholder, 'aria-describedby': `${id}-full ${id}-hint`,
  });
  const cal = calendar === 'none' ? null : el('button', 'mx-df-cal', {
    type: 'button', html: CAL_SVG, title: 'Pick on a calendar', 'aria-label': `${label}: pick on a calendar`,
  });
  const clear = clearable ? el('button', 'mx-df-clear', {
    type: 'button', html: X_SVG, title: 'Remove the date', 'aria-label': `${label}: remove the date`,
  }) : null;
  const hint = el('span', 'mx-df-hint', { id: `${id}-hint`, 'aria-live': 'polite' });
  const full = el('span', 'mx-visually-hidden', { id: `${id}-full` });
  if (lab) wrap.appendChild(lab);
  wrap.appendChild(text);
  if (cal) wrap.appendChild(cal);
  if (clear) wrap.appendChild(clear);
  wrap.append(hint, full);

  // focused: typing; atFocus: the value when typing began; shown: the box's
  // text then (a box left as it showed changes nothing); msg: the line under
  // the field after a commit (error: it says why a typed date wasn't taken;
  // rejectedAt: when)
  const st = { focused: false, atFocus: '', shown: '', msg: '', error: false, rejectedAt: -Infinity, pickerAt: -Infinity, destroyed: false };
  let firing = 0;

  const currentKey = () => keyOrEmpty(nativeValue(input));
  const bounds = () => ({ min: keyOrEmpty(input.min) || null, max: keyOrEmpty(input.max) || null });
  // One reading per text (a keystroke's handler and its paint read it once)
  let last = { sig: null, r: null };
  const parse = (raw) => {
    const n = today();
    const b = bounds();
    const sig = `${raw}|${b.min}|${b.max}|${n.getFullYear()}-${n.getMonth()}-${n.getDate()}`;
    if (last.sig !== sig) last = { sig, r: parseTypedDate(raw, { now: n, ...b }) };
    return last.r;
  };
  const untouched = () => text.value === st.shown;

  // Our own events: the native-event repaint below leaves them alone
  function emit(...types) {
    firing++;
    try { fire(input, ...types); } finally { firing--; }
  }

  function put(key, ...types) {
    if (!writeNative(input, key)) return false;
    if (types.length) emit(...types);
    return true;
  }

  function say(msg, error = false) {
    st.msg = msg || '';
    st.error = !!(msg && error);
  }

  function paint() {
    if (st.destroyed) return;
    const key = currentKey();
    const n = today();
    if (!st.focused) {
      const shown = key ? dateWords(key, n) : '';
      if (text.value !== shown) text.value = shown;
    }
    setText(full, key ? dateWordsLong(key) : 'No date');
    // While typing: how the box reads (errors wait for the blur)
    let msg = st.msg;
    let reading = false;
    if (!msg && st.focused) {
      const k = untouched() ? keyOrEmpty(st.atFocus) : (parse(text.value).key || '');
      if (k) { msg = dateWords(k, n); reading = true; }
    }
    setText(hint, msg);
    setClass(hint, 'is-error', st.error && !!st.msg);
    setClass(hint, 'is-reading', reading);
    setAttr(wrap, 'data-value', key ? '1' : null);
    setAttr(text, 'aria-invalid', input.getAttribute('aria-invalid') === 'true' ? 'true' : null);
    setDisabled(text, input.disabled);
    if (cal) setDisabled(cal, input.disabled);
    if (clear) {
      setHidden(clear, !key);
      setDisabled(clear, input.disabled);
    }
  }

  // Code-driven sets on the native input (opening a task, a time picked
  // without a date, a form reset) repaint the field. One that changes the
  // value while the box is being typed in starts the box again from it
  function onExternal(before) {
    if (st.destroyed) return;
    if (st.focused && nativeValue(input) !== before) {
      st.atFocus = nativeValue(input);
      text.value = typedDateText(currentKey(), today());
      st.shown = text.value;
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

  // The native dialog (or anyone else) set the value and said so
  const onNativeEvent = () => {
    if (firing || st.focused || st.destroyed) return;
    say('');
    paint();
  };
  // Validation and labels focus the native input: the box takes it
  const onNativeFocus = () => {
    if (st.destroyed || performance.now() - st.pickerAt < PICKER_FOCUS_MS) return;
    try { text.focus({ preventScroll: true }); } catch { /* gone */ }
  };
  input.addEventListener('input', onNativeEvent);
  input.addEventListener('change', onNativeEvent);
  input.addEventListener('focus', onNativeFocus);

  text.addEventListener('focus', () => {
    st.focused = true;
    st.atFocus = nativeValue(input);
    text.value = typedDateText(currentKey(), today());
    st.shown = text.value;
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

  // Every keystroke that reads as a date goes in right away (Back and the
  // draft snapshot see it); an empty or unreadable box waits for the blur
  text.addEventListener('input', () => {
    if (untouched()) {
      put(st.atFocus, 'input');
    } else {
      const r = parse(text.value);
      if (r.key) put(r.key, 'input');
    }
    if (st.msg) say('');
    paint();
  });

  // Enter settles the box. One that couldn't take what was typed stops here:
  // the owner's Enter-to-save (the item creator's) never runs, and the line
  // under the field says why (no refocus: a focus clears that line). That is
  // this entry's one refusal: a Save tapped next takes the kept date
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      if (typeof onEnter === 'function') onEnter();
      else if (handle.refuseSave()) e.stopPropagation();
    }
  });

  text.addEventListener('blur', () => {
    if (st.destroyed || !st.focused) return;
    const same = untouched();
    const r = same ? null : parse(text.value);
    st.focused = false;
    if (same) {
      put(st.atFocus, 'input');
    } else if (r.empty) {
      // Emptied: no date (a field that must keep one goes back)
      put(clearable ? '' : st.atFocus, 'input');
    } else if (r.error) {
      // Back to the value typing began with, and why
      const before = keyOrEmpty(st.atFocus);
      put(st.atFocus, 'input');
      say(before ? `${r.error} · kept ${dateWords(before, today())}` : r.error, true);
      st.rejectedAt = performance.now();
    } else {
      put(r.key, 'input');
      say(dateHint(r, today()));
    }
    if (nativeValue(input) !== st.atFocus) emit('change');
    paint();
  });

  if (clear) {
    clear.addEventListener('click', (e) => {
      if (input.disabled) return;
      haptic('tick');
      say('');
      put('', 'input', 'change');
      paint();
      // Only the keyboard's own activation brings the box (and the keyboard) back
      if (e.detail === 0) { try { text.focus({ preventScroll: true }); } catch { /* gone */ } }
    });
  }

  function openSheet() {
    const value = currentKey();
    openDatePicker({
      value,
      title: sheetTitle || label,
      returnFocus: cal || text,
      now: today,
      ...bounds(),
      onPick: (key) => {
        say('');
        put(key, 'input', 'change');
        paint();
      },
      onClear: clearable && value ? () => {
        say('');
        put('', 'input', 'change');
        paint();
      } : null,
    });
  }

  if (cal) {
    cal.addEventListener('click', () => {
      if (input.disabled) return;
      if (st.focused) text.blur();                 // what was typed counts first
      if (calendar === 'native' || calendar === 'native-only') {
        // Inside the tap (showPicker needs the user activation)
        try {
          if (typeof input.showPicker === 'function') {
            st.pickerAt = performance.now();
            input.showPicker();
            return;
          }
        } catch { st.pickerAt = -Infinity; /* not allowed here: the sheet */ }
        if (calendar === 'native-only') return;
      }
      openSheet();
    });
  }

  // Labels that pointed at the native input now name the box
  const relabeled = [];
  const retarget = (node) => {
    if (!node || relabeled.some(r => r.node === node)) return;
    relabeled.push({ node, had: node.hasAttribute('for'), was: node.getAttribute('for') });
    node.htmlFor = id;
  };
  if (input.id) {
    const safe = window.CSS && CSS.escape ? CSS.escape(input.id) : input.id;
    document.querySelectorAll(`label[for="${safe}"]`).forEach(retarget);
  }
  const wrapping = input.closest('label');
  if (wrapping && !wrapping.hasAttribute('for')) retarget(wrapping);
  if (!lab && !relabeled.length) text.setAttribute('aria-label', label);
  const prevAttrs = { tabindex: input.getAttribute('tabindex'), hidden: input.getAttribute('aria-hidden') };
  input.setAttribute('tabindex', '-1');
  input.setAttribute('aria-hidden', 'true');

  // Watched: disabled, the bounds, an owner's aria-invalid
  const attrObserver = new MutationObserver(() => paint());
  attrObserver.observe(input, { attributes: true, attributeFilter: ['aria-invalid', 'disabled', 'min', 'max'] });

  input.dataset.mxDf = '1';
  input.after(wrap);

  const handle = {
    el: wrap,
    text,
    refresh: () => { if (!st.focused) say(''); paint(); },
    // A box being typed in settles (as its blur would). True when it took
    // what was typed (false: it said why not, and kept the value)
    commit: () => {
      if (!st.focused) return !st.error;
      text.blur();
      if (st.focused) {                            // a blur that didn't happen (not focused after all)
        st.focused = false;
        paint();
      }
      return !st.error;
    },
    focused: () => st.focused,
    hasError: () => st.error && !!st.msg,
    // The box refused what was typed a moment ago (the blur of a tap on Save)
    justRejected: () => st.error && !!st.msg && performance.now() - st.rejectedAt < REJECT_MS,
    // An explicit save (Add, Save; never Back, which never traps) asks first.
    // True = refuse it: the box, still being typed in, couldn't take what was
    // typed, or it refused an entry just now. Once per refused entry: the line
    // under the field is seen, and the next save takes the date it kept
    refuseSave: () => {
      const refused = st.focused ? !handle.commit() : handle.justRejected();
      st.rejectedAt = -Infinity;
      if (refused) haptic('tick');
      return refused;
    },
    focus: () => { try { text.focus({ preventScroll: true }); } catch { /* gone */ } },
    destroy() {
      if (st.destroyed) return;
      st.destroyed = true;
      attrObserver.disconnect();
      input.removeEventListener('input', onNativeEvent);
      input.removeEventListener('change', onNativeEvent);
      input.removeEventListener('focus', onNativeFocus);
      relabeled.forEach(r => { if (r.had) r.node.setAttribute('for', r.was); else r.node.removeAttribute('for'); });
      if (prevAttrs.tabindex == null) input.removeAttribute('tabindex'); else input.setAttribute('tabindex', prevAttrs.tabindex);
      if (prevAttrs.hidden == null) input.removeAttribute('aria-hidden'); else input.setAttribute('aria-hidden', prevAttrs.hidden);
      delete input.value;                          // back to the prototype's
      delete input.dataset.mxDf;
      wrap.remove();
      input._mxDf = null;
    },
  };
  input._mxDf = handle;
  paint();
  return handle;
}

export function removeDateField(input) {
  if (input && input._mxDf) input._mxDf.destroy();
}

// --- The sheet -----------------------------------------------------------------------------------

export function isDatePickerOpen() {
  return !!current;
}

export function closeDatePicker({ immediate = false } = {}) {
  if (current) current.close({ immediate });
}

export function openDatePicker(opts = {}) {
  if (current) current.close({ immediate: true });
  closeTimePicker({ immediate: true });
  const now = typeof opts.now === 'function' ? opts.now : () => new Date();
  const today = () => { try { return now(); } catch { return new Date(); } };
  const value = keyOrEmpty(opts.value);
  const min = keyOrEmpty(opts.min) || null;
  const max = keyOrEmpty(opts.max) || null;
  const st = { closed: false };
  const opener = document.activeElement;
  const title = opts.title || 'Date';
  let unregister = null;

  // --- DOM -------------------------------------------------------------------------------
  const root = el('div', 'mx-dp', { id: 'mx-date-picker', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'mx-dp-title' });
  const scrim = el('div', 'mx-tp-scrim', { 'aria-hidden': 'true' });
  const sheet = el('section', 'mx-tp-sheet mx-dp-sheet', { tabindex: '-1' });
  const head = el('header', 'mx-tp-head');
  head.append(el('h2', 'mx-tp-title', { id: 'mx-dp-title', text: title }),
    el('p', 'mx-tp-sub mx-dp-sub', { text: value ? `Now ${dateWords(value, today())}` : 'No date yet' }));

  // Quick chips: a tap picks and closes (the keyboard is never in the way: the
  // box keeps the focus until the sheet goes)
  const chipRow = el('div', 'mx-dp-chips', { role: 'group', 'aria-label': 'Quick dates' });
  const chips = [];
  dateChips(today()).forEach(c => {
    if (!c.key) return;
    const sub = c.id === 'today' || c.id === 'tomorrow' || c.id === 'next-mon' ? c.sub : String(Number(c.key.slice(8)));
    const b = el('button', 'mx-dp-chip', { type: 'button', 'data-key': c.key, 'aria-pressed': 'false', 'aria-label': `${c.label}, ${dateWordsLong(c.key)}` });
    b.append(el('span', 'mx-dp-chip-label', { text: c.label, 'aria-hidden': 'true' }), el('span', 'mx-dp-chip-sub', { text: sub, 'aria-hidden': 'true' }));
    b.disabled = (min && c.key < min) || (max && c.key > max);
    b.addEventListener('click', () => pick(c.key));
    chips.push({ key: c.key, b });
    chipRow.appendChild(b);
  });

  const fieldHost = el('div', 'mx-dp-field');
  const native = el('input', 'mx-dp-native', { type: 'date' });
  if (min) native.min = min;
  if (max) native.max = max;
  VALUE.set.call(native, value);
  fieldHost.appendChild(native);

  const foot = el('footer', 'mx-tp-foot');
  const clearBtn = el('button', 'mx-btn mx-btn-quiet mx-btn-danger mx-tp-clear mx-dp-clear', { type: 'button', text: 'Clear' });
  const cancelBtn = el('button', 'mx-btn mx-tp-cancel mx-dp-cancel', { type: 'button', text: 'Cancel' });
  const setBtn = el('button', 'mx-btn mx-btn-primary mx-tp-set mx-dp-set', { type: 'button', text: 'Set' });
  if (typeof opts.onClear === 'function') foot.appendChild(clearBtn);
  foot.append(el('span', 'mx-tp-spacer'), cancelBtn, setBtn);

  sheet.append(head, chipRow, fieldHost, foot);
  root.append(scrim, sheet);
  document.body.appendChild(root);

  const field = enhanceDateInput(native, {
    label: 'Type a date', showLabel: false, clearable: true, calendar: 'native-only', now: today,
    onEnter: () => commit(),
  });

  // Buttons don't take the focus from the box on press: Set reads it still
  // being typed in (an unreadable date keeps the sheet open, saying why)
  [...chips.map(c => c.b), clearBtn, cancelBtn, setBtn].forEach(b => {
    b.addEventListener('pointerdown', (e) => e.preventDefault());
    b.addEventListener('mousedown', (e) => e.preventDefault());
  });

  function paint() {
    if (st.closed) return;
    const k = keyOrEmpty(nativeValue(native));
    chips.forEach(({ key, b }) => setAttr(b, 'aria-pressed', String(key === k)));
  }
  native.addEventListener('input', paint);
  native.addEventListener('change', paint);

  // --- Close ------------------------------------------------------------------------------------
  function restoreFocus() {
    const active = document.activeElement;
    if (active && active !== document.body && !root.contains(active)) return;
    let back = opts.returnFocus;
    if (typeof back === 'function') { try { back = back(); } catch { back = null; } }
    const target = back || opener;
    if (!target || target === document.body || !target.isConnected || root.contains(target)) return;
    if (!back && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
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
    removeDateField(native);                       // before the focus moves: its blur writes nothing
    restoreFocus();
    const done = () => root.remove();
    if (immediate || reduceMotion()) {
      done();
    } else {
      root.inert = true;
      root.dataset.closing = '1';
      const a = animate(sheet, [{ transform: 'translateY(0)', opacity: 1 }, { transform: 'translateY(32px)', opacity: 0 }], { duration: 150, easing: 'ease-in' });
      animate(scrim, [{ opacity: 1 }, { opacity: 0 }], { duration: 150 });
      if (a) { a.onfinish = done; a.oncancel = done; } else done();
    }
    if (typeof opts.onClose === 'function') {
      try { opts.onClose(); } catch (err) { console.error('[mobile] date picker onClose failed', err); }
    }
  }

  function pick(key) {
    if (st.closed || !isDateKey(key)) return;
    haptic('commit');
    try { if (typeof opts.onPick === 'function') opts.onPick(key); } catch (err) { console.error('[mobile] date picker onPick failed', err); }
    close();
  }

  function clear() {
    if (st.closed) return;
    try { opts.onClear(); } catch (err) { console.error('[mobile] date picker onClear failed', err); }
    close();
  }

  // Set: the box settles first; an unreadable date keeps the sheet open (the
  // line under the box says why, and the next Set takes the date it kept)
  function commit() {
    if (st.closed) return;
    const typing = field && field.focused();
    if (field) field.commit();
    if (typing && field.hasError()) { haptic('tick'); return; }
    const k = keyOrEmpty(nativeValue(native));
    if (k) { pick(k); return; }
    if (value && typeof opts.onClear === 'function') { clear(); return; }
    close();
  }

  // Escape closes the sheet before anything under it sees the key; Tab stays inside
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
      const list = [...sheet.querySelectorAll('button:not(:disabled), input.mx-df-text:not(:disabled)')].filter(n => n.getClientRects().length);
      if (!list.length) return;
      const i = list.indexOf(document.activeElement);
      const next = e.shiftKey ? (i <= 0 ? list.length - 1 : i - 1) : (i < 0 || i === list.length - 1 ? 0 : i + 1);
      e.preventDefault();
      list[next].focus();
    }
  }

  // --- Wire up ------------------------------------------------------------------------------------
  scrim.addEventListener('click', () => close());
  cancelBtn.addEventListener('click', () => close());
  setBtn.addEventListener('click', commit);
  clearBtn.addEventListener('click', clear);
  window.addEventListener('keydown', onKey, true);

  const handle = { el: root, close, commit, field };
  paint();
  current = handle;
  // A shell layer above every reused modal: Back closes the sheet first. The
  // history entry is pushed now, inside the tap
  unregister = registerLayer({
    id: 'date-picker', kind: 'shell',
    root: () => root, isOpen: () => !st.closed, back: () => close(),
  });
  syncHistory();
  animate(sheet, [{ transform: 'translateY(28px)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }], { duration: 200 });
  animate(scrim, [{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
  // The box takes the focus in the tap (the keyboard comes up; the sheet sits on it)
  if (field) field.focus(); else { try { sheet.focus({ preventScroll: true }); } catch { /* not focusable */ } }
  return handle;
}
