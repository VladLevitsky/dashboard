// Personal Dashboard - Busy-time strip (Today on a computer, the Today tab on phones)
// One local day from Google free/busy (start and end only, never what the
// event is): a bar with the busy blocks, a "now" marker, the busy times in
// words and the next free stretch. An all-day busy event is a note, never a
// filled day.
//
// The bar shows 8 hours at a time (from the hour before now, with a short
// lead-in) and scrolls
// sideways through the rest of the day: swipe, drag with the mouse, the
// ‹ › buttons (4 hours a step), or Now to come back. Hour ticks every hour,
// half-hour marks between, and a block wide enough carries its own times.
// The window follows the clock (once an hour) until the bar is scrolled by
// hand; it starts again from now whenever the strip is shown again.
//
// The host is rebuilt only when the day or the data changes (gcalStateKey);
// the window survives a rebuild. Once a minute the "now" marker and the
// next-free line move in place (a CSS variable and Text.data), and the day is
// re-asked of Google every 5 minutes at most (google-calendar.js caches it).

import { busyDayLayout, pctOfDay } from '../core/gcal-plan.js';
import { shortClock, prefersHour12 } from '../core/due-time.js';
import { isLoggedIn } from '../core/auth.js';
import {
  getGcalStatus, gcalStateKey, getBusyDay, requestBusyDay, dayBounds, connectGoogleCalendar
} from './google-calendar.js';

const HOUR = 3600000;
const WINDOW_MS = 8 * HOUR;     // what the bar shows at once
const STEP_MS = 4 * HOUR;       // one ‹ / › press
const LEAD_MS = 15 * 60000;     // the window opens a little before its first hour (clear of the edge fade)

const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
const PREV_SVG = svg('<polyline points="15 18 9 12 15 6"/>');
const NEXT_SVG = svg('<polyline points="9 18 15 12 9 6"/>');

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function setText(node, text) {
  if (!node) return;
  const t = node.firstChild;
  if (t && t.nodeType === 3 && !t.nextSibling) { if (t.data !== text) t.data = text; }
  else node.textContent = text;
}

const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
let hourFormat = null;
const hourLabel = (ms) => {
  if (!hourFormat) hourFormat = new Intl.DateTimeFormat([], { hour: 'numeric' });
  return hourFormat.format(new Date(ms));
};

function duration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function range(start, end, bounds) {
  return `${start <= bounds.dayStart ? 'Midnight' : clock(start)}–${end >= bounds.dayEnd ? 'midnight' : clock(end)}`;
}

function reduceMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

// What the strip can show right now: 'off' (hide it) | 'reconnect' | 'loading' | 'failed' | 'ready'
function stripState(dayKey) {
  if (!isLoggedIn()) return 'off';
  const s = getGcalStatus();
  if (!s || !s.connected || !s.canBusy) return 'off';
  if (s.needsReconnect) return 'reconnect';
  const day = getBusyDay(dayKey);
  if (!day) return 'loading';
  return day.failed ? 'failed' : 'ready';
}

// Ask for the day's busy times when they're missing or stale (cheap to call often)
export function ensureBusyDay(dayKey) {
  requestBusyDay(dayKey);
}

// Fill (or empty) `host` for one day. Returns true when the strip shows.
export function renderBusyStrip(host, dayKey, { now = Date.now() } = {}) {
  if (!host) return false;
  const state = stripState(dayKey);
  const sig = `${dayKey}|${state}|${gcalStateKey()}`;
  if (host._busySig === sig) {
    tick(host, now, { window: false });   // a repaint of the page: no layout reads here
    return state !== 'off';
  }
  host._busySig = sig;
  host.textContent = '';
  host.hidden = state === 'off';
  host._busy = null;
  if (state === 'off') { stopTicking(host); unobserve(host); return false; }

  host.classList.add('busy-strip');
  const bounds = dayBounds(dayKey);
  const head = el('div', 'busy-strip-head');
  const summary = el('span', 'busy-strip-summary');
  head.append(el('span', 'busy-strip-title', 'Busy times'));
  host.append(head);

  if (state === 'reconnect') {
    head.append(summary);
    host.append(el('p', 'busy-strip-note', 'Google Calendar needs reconnecting to show busy times.'));
    const b = el('button', 'busy-strip-action', 'Reconnect');
    b.type = 'button';
    b.addEventListener('click', connectGoogleCalendar);
    host.append(b);
    stopTicking(host);
    unobserve(host);
    return true;
  }

  // The scroller holds a track as wide as the day: 8 hours per screen width
  const span = bounds.dayEnd - bounds.dayStart;
  const scroller = el('div', 'busy-strip-scroll');
  scroller.tabIndex = 0;
  scroller.setAttribute('role', 'group');
  scroller.setAttribute('aria-label', 'Busy times through the day. Scroll sideways for other hours');
  const track = el('div', 'busy-strip-track');
  track.setAttribute('role', 'img');
  track.style.setProperty('--span', (span / WINDOW_MS).toFixed(4));
  addTicks(track, bounds);
  scroller.append(track);

  const nav = buildNav(host);
  const right = el('span', 'busy-strip-head-right');
  right.append(summary, nav.box);
  head.append(right);
  host.append(scroller);

  let layout = null;
  if (state === 'loading' || state === 'failed') {
    track.setAttribute('aria-label', state === 'loading' ? 'Loading busy times' : 'Busy times unavailable');
    setText(summary, state === 'loading' ? 'Loading…' : '');
    if (state === 'failed') {
      const p = el('p', 'busy-strip-note', 'Couldn’t load busy times. ');
      const retry = el('button', 'busy-strip-link', 'Try again');
      retry.type = 'button';
      retry.addEventListener('click', () => requestBusyDay(dayKey, { force: true }));
      p.append(retry);
      host.append(p);
    }
  } else {
    layout = busyDayLayout(getBusyDay(dayKey).calendars, { dayStart: bounds.dayStart, dayEnd: bounds.dayEnd });
    const hour12 = prefersHour12();
    for (const b of layout.blocks) {
      const block = el('span', 'busy-strip-block');
      const l = b.left.toFixed(3);
      const w = Math.max(b.width, 0.35).toFixed(3);
      block.style.setProperty('--l', l);
      block.style.setProperty('--w', w);
      block.title = `Busy ${range(b.start, b.end, bounds)}`;
      // Its times ride on their own layer of the same size, above the now line
      const text = el('span', 'busy-strip-block-text');
      text.style.setProperty('--l', l);
      text.style.setProperty('--w', w);
      text.append(blockLabel(b, bounds, hour12));
      track.append(block, text);
    }
    const nowMark = el('span', 'busy-strip-now');
    nowMark.setAttribute('aria-hidden', 'true');
    track.append(nowMark);

    const ranges = layout.blocks.map((b) => range(b.start, b.end, bounds));
    track.setAttribute('aria-label', ranges.length ? `Busy ${ranges.join(', ')}` : 'Nothing booked');
    setText(summary, layout.busyMinutes ? `${duration(layout.busyMinutes)} booked` : 'Nothing booked');

    if (layout.allDay) {
      const note = el('p', 'busy-strip-allday', 'Busy all day');
      note.title = 'An all-day event marked Busy (its meetings that day may be hidden under it)';
      host.insertBefore(note, scroller);
    }
    // Each range stays on one line ("7:30 PM–9:00 PM" never splits)
    const list = el('p', 'busy-strip-list');
    if (ranges.length) {
      ranges.forEach((r, i) => {
        if (i) list.append(' · ');
        list.append(el('span', 'busy-strip-range', r));
      });
    } else {
      list.textContent = layout.allDay ? 'No other busy times' : 'Free all day';
    }
    host.append(list);
    const next = el('p', 'busy-strip-next');
    host.append(next);
    if (layout.errors.length) {
      host.append(el('p', 'busy-strip-note', `Couldn’t read ${layout.errors.length === 1 ? 'one calendar' : `${layout.errors.length} calendars`}: check its ID under Google Calendar.`));
    }
    host._busy = { dayKey, bounds, layout, calendars: getBusyDay(dayKey).calendars, nowMark, next, scroller, nav };
  }
  if (!host._busy) host._busy = { dayKey, bounds, layout: null, calendars: null, nowMark: null, next: null, scroller, nav };

  // The window: kept across a rebuild of the same day, else from now
  const kept = host._busyView && host._busyView.dayKey === dayKey ? host._busyView : null;
  host._busyView = kept || freshView(host, now);
  wireScroller(host, scroller);
  observe(host, scroller);
  applyView(host);
  tick(host, now);
  if (state === 'ready') startTicking(host); else stopTicking(host);
  return true;
}

// A block's own times ("9–10:30"), shown when the block is wide enough for
// that text (container queries in styles.css, by length class: a 1-hour block
// fits "1–2", a 30-minute one doesn't fit "10:30–11"). Too narrow for the
// range: just its start, unless the start is on the hour (the axis says it)
function blockLabel(b, bounds, hour12) {
  const startText = b.start <= bounds.dayStart ? (hour12 ? '12' : '00:00') : shortClock(b.start, hour12);
  const endText = b.end >= bounds.dayEnd ? (hour12 ? '12' : '24:00') : shortClock(b.end, hour12);
  const rangeText = `${startText}–${endText}`;
  const fit = (text) => (text.length <= 4 ? 'a' : text.length <= 7 ? 'b' : text.length <= 9 ? 'c' : 'd');
  const label = el('span', `busy-strip-block-label r-${fit(rangeText)}`);
  label.setAttribute('aria-hidden', 'true');
  label.append(el('span', 'busy-strip-block-range', rangeText));
  if (new Date(b.start).getMinutes() && b.start > bounds.dayStart) {
    label.classList.add(`s-${fit(startText)}`);
    label.append(el('span', 'busy-strip-block-start', startText));
  }
  return label;
}

// Hour ticks from real local hours (23 or 25 on DST days), a half-hour mark
// between, a label on every hour but midnight (narrow strips hide odd hours)
function addTicks(track, bounds) {
  const seen = new Set();
  for (let h = 0; h < 24; h++) {
    const at = new Date(new Date(bounds.dayStart).setHours(h, 0, 0, 0)).getTime();
    if (at < bounds.dayStart || at >= bounds.dayEnd || seen.has(at)) continue;
    seen.add(at);
    const tickEl = el('span', `busy-strip-tick${h % 2 ? ' is-odd' : ''}`);
    tickEl.style.setProperty('--at', pctOfDay(at, bounds.dayStart, bounds.dayEnd).toFixed(3));
    if (h) tickEl.append(el('span', 'busy-strip-hour', hourLabel(at)));
    track.append(tickEl);
    const half = at + HOUR / 2;
    if (half < bounds.dayEnd) {
      const halfEl = el('span', 'busy-strip-tick is-half');
      halfEl.style.setProperty('--at', pctOfDay(half, bounds.dayStart, bounds.dayEnd).toFixed(3));
      track.append(halfEl);
    }
  }
}

// --- The window --------------------------------------------------------------------------------

// Where the window starts: the hour before now (today), else the hour before
// the first busy block, else 8 AM, each with a short lead-in; never past the
// day's ends
function anchorStart(b, now) {
  const { dayStart, dayEnd } = b.bounds;
  if (dayEnd - dayStart <= WINDOW_MS) return dayStart;
  const hourBefore = (ms) => { const d = new Date(ms); d.setMinutes(0, 0, 0); return d.getTime() - HOUR; };
  let start;
  if (now >= dayStart && now < dayEnd) start = hourBefore(now);
  else if (b.layout && b.layout.blocks.length) start = hourBefore(b.layout.blocks[0].start);
  else start = new Date(dayStart).setHours(8, 0, 0, 0);
  return Math.min(Math.max(start - LEAD_MS, dayStart), dayEnd - WINDOW_MS);
}

function freshView(host, now = Date.now()) {
  const b = host._busy;
  const { dayStart, dayEnd } = b.bounds;
  return { dayKey: b.dayKey, start: anchorStart(b, now), follow: now >= dayStart && now < dayEnd };
}

// Scroll the bar to the window's start (smooth: a button press)
function applyView(host, { smooth = false } = {}) {
  const b = host._busy;
  const v = host._busyView;
  if (!b || !v || !b.scroller.isConnected) return;
  const sc = b.scroller;
  const client = sc.clientWidth;
  if (!client) return;                      // not shown: the resize observer applies it later
  const width = sc.scrollWidth;
  const { dayStart, dayEnd } = b.bounds;
  const px = Math.max(0, Math.min(width - client, Math.round(((v.start - dayStart) / (dayEnd - dayStart)) * width)));
  if (Math.abs(sc.scrollLeft - px) >= 1) {
    if (smooth && !reduceMotion()) {
      host._busyGlide = { target: px, until: performance.now() + 900 };
      sc.scrollTo({ left: px, behavior: 'smooth' });
    } else {
      host._busyExpect = px;
      sc.scrollLeft = px;
    }
  }
  paintNav(host);
}

// What is in view right now, from the real scroll position
function visibleRange(b) {
  const sc = b.scroller;
  const width = sc.scrollWidth || 1;
  const { dayStart, dayEnd } = b.bounds;
  const span = dayEnd - dayStart;
  return {
    from: dayStart + (sc.scrollLeft / width) * span,
    to: dayStart + ((sc.scrollLeft + sc.clientWidth) / width) * span,
    atStart: sc.scrollLeft <= 1,
    atEnd: sc.scrollLeft >= sc.scrollWidth - sc.clientWidth - 1
  };
}

function setAttr(node, name, value) {
  if (value == null) { if (node.hasAttribute(name)) node.removeAttribute(name); }
  else if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}

// The ‹ › buttons, Now, and the edge fades (written only when they change)
function paintNav(host, now = Date.now()) {
  const b = host._busy;
  if (!b || !b.scroller.clientWidth) return;
  const r = visibleRange(b);
  const { dayStart, dayEnd } = b.bounds;
  if (b.nav.prev.disabled !== r.atStart) b.nav.prev.disabled = r.atStart;
  if (b.nav.next.disabled !== r.atEnd) b.nav.next.disabled = r.atEnd;
  const isToday = now >= dayStart && now < dayEnd;
  const nowHidden = !isToday || (now >= r.from && now <= r.to);
  if (b.nav.now.hidden !== nowHidden) b.nav.now.hidden = nowHidden;
  setAttr(b.scroller, 'data-more', r.atStart && r.atEnd ? null : r.atStart ? 'end' : r.atEnd ? 'start' : 'both');
}

function buildNav(host) {
  const box = el('span', 'busy-strip-nav');
  const make = (cls, html, label, onClick) => {
    const btn = el('button', `busy-strip-navbtn ${cls}`);
    btn.type = 'button';
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.innerHTML = html;
    btn.addEventListener('click', onClick);
    return btn;
  };
  const step = (dir) => {
    const b = host._busy;
    const v = host._busyView;
    if (!b || !v) return;
    const r = visibleRange(b);
    const { dayStart, dayEnd } = b.bounds;
    v.start = Math.min(Math.max(r.from + dir * STEP_MS, dayStart), dayEnd - WINDOW_MS);
    v.follow = false;
    applyView(host, { smooth: true });
  };
  const prev = make('busy-strip-prev', PREV_SVG, 'Earlier hours', () => step(-1));
  const next = make('busy-strip-next-hours', NEXT_SVG, 'Later hours', () => step(1));
  const now = make('busy-strip-now-btn', '', 'Back to now', () => {
    const b = host._busy;
    if (!b) return;
    host._busyView = freshView(host);
    applyView(host, { smooth: true });
  });
  now.textContent = 'Now';
  now.hidden = true;
  box.append(prev, now, next);
  return { box, prev, next, now };
}

// Scrolling by hand (or a drag) leaves the clock behind until Now
function onScroll(host) {
  const b = host._busy;
  const v = host._busyView;
  if (!b || !v) return;
  const left = b.scroller.scrollLeft;
  const glide = host._busyGlide;
  if (glide) {
    // A button's smooth scroll: the view already says where it ends
    if (Math.abs(left - glide.target) <= 1 || performance.now() > glide.until) host._busyGlide = null;
    paintNav(host);
    return;
  }
  if (host._busyExpect != null && Math.abs(left - host._busyExpect) <= 1) {
    host._busyExpect = null;              // our own jump
    paintNav(host);
    return;
  }
  host._busyExpect = null;
  v.follow = false;
  v.start = visibleRange(b).from;
  paintNav(host);
}

function wireScroller(host, sc) {
  sc.addEventListener('scroll', () => onScroll(host), { passive: true });
  // A mouse drags the day sideways (touch scrolls natively)
  sc.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    if (sc._busyDragEnd) sc._busyDragEnd();
    const startX = e.clientX;
    const startLeft = sc.scrollLeft;
    let dragging = false;
    const move = (ev) => {
      // Released where this gesture didn't hear it: over, never a hover-scroll
      if ((ev.buttons & 1) === 0) { up(); return; }
      const dx = ev.clientX - startX;
      if (!dragging) {
        if (Math.abs(dx) < 4) return;
        dragging = true;
        sc.classList.add('is-dragging');
        try { sc.setPointerCapture(e.pointerId); } catch { /* still scrolls while over the bar */ }
      }
      sc.scrollLeft = startLeft - dx;
    };
    const up = (ev) => {
      if (ev && ev.pointerId !== e.pointerId) return;
      sc.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      if (sc._busyDragEnd === up) sc._busyDragEnd = null;
      if (dragging) sc.classList.remove('is-dragging');
    };
    sc._busyDragEnd = up;
    sc.addEventListener('pointermove', move);
    // On the window: a release off the bar (no capture until a real drag) ends it too
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
  });
}

// Shown again after being hidden (Today reopened, back on the tab): start
// from now again. Any other size change keeps the window where it is
function observe(host, sc) {
  if (typeof ResizeObserver !== 'function') return;
  if (!host._busyResize) {
    host._busyResize = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      const width = entry ? entry.contentRect.width : 0;
      if (!width) { host._busyWasHidden = true; return; }
      if (host._busyWasHidden && host._busy) {
        host._busyWasHidden = false;
        host._busyView = freshView(host);
      }
      applyView(host);
    });
  }
  host._busyResize.disconnect();
  host._busyResize.observe(sc);
}

function unobserve(host) {
  if (host._busyResize) host._busyResize.disconnect();
}

// The parts that move with the clock, written in place (window: also move a
// window that follows the clock, and repaint the buttons)
function tick(host, now = Date.now(), { window: moveWindow = true } = {}) {
  const b = host._busy;
  if (!b || !b.nowMark) return;
  const { dayStart, dayEnd } = b.bounds;
  const isToday = now >= dayStart && now < dayEnd;
  const pct = isToday ? pctOfDay(now, dayStart, dayEnd).toFixed(2) : '';
  if (b.nowMark.hidden !== !isToday) b.nowMark.hidden = !isToday;
  if (isToday && b.nowMark.style.getPropertyValue('--at') !== pct) b.nowMark.style.setProperty('--at', pct);
  let text = '';
  if (isToday) {
    const { nextFree } = busyDayLayout(b.calendars, { dayStart, dayEnd, now });
    if (nextFree) {
      text = nextFree.start <= now + 60000
        ? `Free now until ${nextFree.end >= dayEnd ? 'midnight' : clock(nextFree.end)}`
        : `Next free: ${range(nextFree.start, nextFree.end, b.bounds)} (${duration(nextFree.minutes)})`;
    } else {
      text = 'No free time left today';
    }
  }
  if (b.next.hidden !== !text) b.next.hidden = !text;
  setText(b.next, text);
  if (!moveWindow) return;
  // Following the clock: the window moves on once an hour
  const v = host._busyView;
  if (v && v.follow && isToday) {
    const start = anchorStart(b, now);
    if (start !== v.start) { v.start = start; applyView(host); }
  }
  paintNav(host, now);
}

function startTicking(host) {
  if (host._busyTimer) return;
  host._busyTimer = setInterval(() => {
    if (!host.isConnected) { stopTicking(host); unobserve(host); return; }
    // Nothing to keep fresh while it isn't shown (Today closed, another tab)
    if (document.hidden || !host._busy || !host.getClientRects().length) return;
    tick(host);
    requestBusyDay(host._busy.dayKey); // refreshes after 5 minutes; repaints only on a change
  }, 60000);
}

function stopTicking(host) {
  if (host._busyTimer) { clearInterval(host._busyTimer); host._busyTimer = null; }
}
