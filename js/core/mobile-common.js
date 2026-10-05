// Personal Dashboard - Mobile shell shared rules (pure, Node-testable)
// Small helpers every mobile unit uses: the order cards are listed in on a
// phone (the designed reading order, never a mobile grid), card titles, a
// title from the first line of a note, short dates, relative times and the
// breathing phase of a pill. No DOM access; never mutates its inputs.

import { htmlToPlainText } from './markdown.js';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const isPos = (p) => !!p && Number.isFinite(p.row) && Number.isFinite(p.col);

// Cards (header excluded) in the order a reader meets them on the computer:
// the desktop profile (row, then column), else the tablet profile, else the
// flat grid props, else array order. One source for the whole list, so rows
// and columns are always compared within the same layout.
export function orderCardsForMobile(sections) {
  const cards = (Array.isArray(sections) ? sections : [])
    .map((s, index) => ({ s, index }))
    .filter(({ s }) => s && s.type !== 'header');
  const sources = [
    ({ s }) => s.layouts && s.layouts.desktop,
    ({ s }) => s.layouts && s.layouts.tablet,
    ({ s }) => (Number.isFinite(s.gridRow) && Number.isFinite(s.gridCol) ? { row: s.gridRow, col: s.gridCol } : null),
  ];
  const source = sources.find(get => cards.length && cards.every(c => isPos(get(c))));
  const sorted = [...cards].sort((a, b) => {
    if (source) {
      const pa = source(a), pb = source(b);
      if (pa.row !== pb.row) return pa.row - pb.row;
      if (pa.col !== pb.col) return pa.col - pb.col;
    }
    return a.index - b.index;
  });
  return sorted.map(c => c.s);
}

// The title a card shows (the user's rename wins over the stored title)
export function cardTitle(data, section) {
  if (!section) return '';
  const titles = (data && data.sectionTitles) || {};
  return titles[section.id] || section.title || 'Untitled card';
}

// First non-empty line of plain text or rich-text HTML, cut to `max`
// characters (the ellipsis included)
export function firstLineTitle(textOrHtml, max = 60) {
  const raw = textOrHtml == null ? '' : String(textOrHtml);
  const text = /<[a-z!/]/i.test(raw) ? htmlToPlainText(raw) : raw;
  const line = text.split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).find(Boolean) || '';
  if (line.length <= max) return line;
  return line.slice(0, Math.max(1, max - 1)).trimEnd() + '…';
}

// 'YYYY-MM-DD' -> 'Sun, Oct 4' (local calendar day; '' for anything else)
export function shortDay(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
  if (!m) return '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (d.getMonth() !== Number(m[2]) - 1) return '';
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

// How long ago `ms` was, seen from `now`: 'just now', '4 min ago', '3 h ago',
// 'yesterday', '5 days ago', '2 weeks ago', then 'Sep 12' (or 'Sep 12, 2025').
// { short: true } gives the compact form for list rows: 'now', '4m', '3h',
// '2d', '2w', 'Sep 12'.
export function relativeTime(ms, now = Date.now(), { short = false } = {}) {
  if (!Number.isFinite(ms)) return '';
  const diff = Math.max(0, now - ms);
  const min = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const then = new Date(ms);
  const today = new Date(now);
  const dayDiff = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()) -
    new Date(then.getFullYear(), then.getMonth(), then.getDate())) / 86400000);
  const dateLabel = then.getFullYear() === today.getFullYear()
    ? `${MONTHS[then.getMonth()]} ${then.getDate()}`
    : `${MONTHS[then.getMonth()]} ${then.getDate()}, ${then.getFullYear()}`;
  if (short) {
    if (min < 1) return 'now';
    if (min < 60) return `${min}m`;
    if (hours < 24) return `${hours}h`;
    if (dayDiff < 7) return `${Math.max(1, dayDiff)}d`;
    if (dayDiff < 35) return `${Math.floor(dayDiff / 7)}w`;
    return dateLabel;
  }
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  if (hours < 24 && dayDiff === 0) return `${hours} h ago`;
  if (dayDiff <= 1) return 'yesterday';
  if (dayDiff < 7) return `${dayDiff} days ago`;
  if (dayDiff < 35) { const w = Math.floor(dayDiff / 7); return `${w} week${w === 1 ? '' : 's'} ago`; }
  return dateLabel;
}

// Breathing phase for a pill, stable for an id (so a move never rewrites it).
// Same duration / delay sets as the Today view (today.js), so neighbours
// never pulse in sync.
const PHASE_DURS = ['6.3s', '7.7s', '5.4s'];
const PHASE_DELAYS = ['-2.2s', '-5.1s', '-0.9s', '-3.7s'];
export function phaseFor(id) {
  const s = String(id == null ? '' : id);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return { dur: PHASE_DURS[h % 3], delay: PHASE_DELAYS[(h >>> 4) % 4] };
}
