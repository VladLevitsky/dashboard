// Personal Dashboard - Busy-time strip (Today on a computer, the Today tab on phones)
// One local day, all 24 hours, from Google free/busy (start and end only,
// never what the event is): a compact bar with the busy blocks, a "now"
// marker, the busy times in words and the next free stretch. An all-day busy
// event is a note, never a filled day.
//
// The host is rebuilt only when the day or the data changes (gcalStateKey);
// once a minute the "now" marker and the next-free line move in place (a CSS
// variable and Text.data), and the day is re-asked of Google every 5 minutes
// at most (google-calendar.js caches it).

import { busyDayLayout, pctOfDay } from '../core/gcal-plan.js';
import { isLoggedIn } from '../core/auth.js';
import {
  getGcalStatus, gcalStateKey, getBusyDay, requestBusyDay, dayBounds, connectGoogleCalendar
} from './google-calendar.js';

const TICK_HOURS = [0, 3, 6, 9, 12, 15, 18, 21];
const LABEL_HOURS = new Set([6, 12, 18]);

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

function duration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function range(start, end, bounds) {
  return `${start <= bounds.dayStart ? 'Midnight' : clock(start)}–${end >= bounds.dayEnd ? 'midnight' : clock(end)}`;
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
    tick(host, now);
    return state !== 'off';
  }
  host._busySig = sig;
  host.textContent = '';
  host.hidden = state === 'off';
  host._busy = null;
  if (state === 'off') { stopTicking(host); return false; }

  host.classList.add('busy-strip');
  const bounds = dayBounds(dayKey);
  const head = el('div', 'busy-strip-head');
  const summary = el('span', 'busy-strip-summary');
  head.append(el('span', 'busy-strip-title', 'Busy times'), summary);
  host.append(head);

  if (state === 'reconnect') {
    host.append(el('p', 'busy-strip-note', 'Google Calendar needs reconnecting to show busy times.'));
    const b = el('button', 'busy-strip-action', 'Reconnect');
    b.type = 'button';
    b.addEventListener('click', connectGoogleCalendar);
    host.append(b);
    stopTicking(host);
    return true;
  }

  const track = el('div', 'busy-strip-track');
  track.setAttribute('role', 'img');
  for (const h of TICK_HOURS) {
    const at = new Date(new Date(bounds.dayStart).setHours(h, 0, 0, 0)).getTime();
    const tickEl = el('span', 'busy-strip-tick' + (LABEL_HOURS.has(h) ? ' has-label' : ''));
    tickEl.style.setProperty('--at', pctOfDay(at, bounds.dayStart, bounds.dayEnd).toFixed(3));
    if (LABEL_HOURS.has(h)) tickEl.append(el('span', 'busy-strip-hour', String(new Date(at).toLocaleTimeString([], { hour: 'numeric' }))));
    track.append(tickEl);
  }
  host.append(track);

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
    stopTicking(host);
    return true;
  }

  const layout = busyDayLayout(getBusyDay(dayKey).calendars, { dayStart: bounds.dayStart, dayEnd: bounds.dayEnd });
  for (const b of layout.blocks) {
    const block = el('span', 'busy-strip-block');
    block.style.setProperty('--l', b.left.toFixed(3));
    block.style.setProperty('--w', Math.max(b.width, 0.35).toFixed(3));
    block.title = `Busy ${range(b.start, b.end, bounds)}`;
    track.append(block);
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
    host.insertBefore(note, track);
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

  host._busy = { dayKey, bounds, calendars: getBusyDay(dayKey).calendars, nowMark, next };
  tick(host, now);
  startTicking(host);
  return true;
}

// The parts that move with the clock, written in place
function tick(host, now = Date.now()) {
  const b = host._busy;
  if (!b) return;
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
}

function startTicking(host) {
  if (host._busyTimer) return;
  host._busyTimer = setInterval(() => {
    if (!host.isConnected) { stopTicking(host); return; }
    // Nothing to keep fresh while it isn't shown (Today closed, another tab)
    if (document.hidden || !host._busy || !host.getClientRects().length) return;
    tick(host);
    requestBusyDay(host._busy.dayKey); // refreshes after 5 minutes; repaints only on a change
  }, 60000);
}

function stopTicking(host) {
  if (host._busyTimer) { clearInterval(host._busyTimer); host._busyTimer = null; }
}
