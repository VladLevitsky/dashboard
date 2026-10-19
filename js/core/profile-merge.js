// Personal Dashboard - Profile merge (pure: no DOM, no storage, Node-testable)
//
// The cloud keeps ONE profile row per account and a PUT replaces it whole, so two
// devices that both changed the dashboard must not erase each other's work. A sync
// merges three copies of the profile:
//   base   the last version this device and the cloud agreed on (sync-base.js)
//   local  this device's stored copy now
//   cloud  the cloud's copy now
// The rule (user decision 2026-10-19): a device changes or deletes something only when
// its own copy changed that thing since the base. Everything else comes from the cloud.
//   - the same on both sides                    → kept
//   - only one side differs from the base       → that side (a deletion is a change)
//   - gone on one side, changed on the other    → KEPT (a whole task / note / card stays
//     whole; a list or a group of lists is merged item by item against an empty side,
//     so a renamed card section never duplicates its items). Bookkeeping the app writes
//     by itself doesn't count as a change here (MECHANICAL: a task's `order`, a card
//     item's `taskIds`, a card's `layouts`), so a reorder never undoes a deletion
//   - changed on both                           → containers recurse; single values:
//     `prefer` (this device by default), except notes: the newer updatedAt wins
//   - order: the side that reordered the common items; the other side's additions go
//     after their predecessor (after the first side's own additions there)
// Modes (mobile-sync.js mergeModeFor picks one):
//   trusted  the cloud descends from the base
//   guarded  the base is known but the cloud doesn't descend from it (an old client or a
//            race wrote it blind, maybe from a stale copy): nothing missing from the cloud
//            is deleted and its additions still come in, but a value only the cloud
//            changed keeps this device's (stats.conflicts), as does the order; a note the
//            cloud holds with a newer updatedAt still comes in
//   union    no base: everything from both sides is kept; a conflicting value comes from
//            this device unless it is empty / a default and the cloud's is set (a task
//            completed on one side and active on the other stays completed)
//   replace  a JSON import: this device's copy as is, only the time log merged (the
//            import's resetAt drops the older cloud history, time-log.js)
// Per collection: tasks + completedTasks are one id space (pseudo-field __loc 'a' / 'c',
// so "completed there, renamed here" is a completed task with the new name; afterwards
// completed / completedAt follow the list the task ended in); a section carries its card
// data (__data) and a fingerprint of its card notes (__nsig), a subtask item one of its
// own notes, so a note added to a card or subtask deleted elsewhere keeps it; card data =
// section → subtitle (ordered) → type → key; notes by bucket → key; arrays inside records
// by what they point at (task links / files, linked items, meeting links / files,
// template subtasks, card item links, taskIds), so additions from both sides survive;
// Quick Access entries by card + section + key (older entries by their link / text /
// icon); the time log through mergeTimeLogs. Per-device fields (the flat grid props, gridSpan,
// lastActiveMode) are never compared and always this device's. Meta fields (_sync,
// _base, _replace) are never merged and never returned.
// Card items / sections that two devices created under the same key / id are told
// apart before merging (separateCollisions): the local one gets a free key / id and
// everything pointing at it follows (card-move.js relocateItemRefs, renameSectionId).
// After the merge, capTaskCategories keeps the coloured categories within their 8 slots;
// the rest stay in the list marked `overflow: true` (state.js normalizeTaskCategories,
// Task Settings lists them), never dropped unless a device deleted them.

import { mergeTimeLogs } from './time-log.js';
import { ITEM_TYPES, cardItemKeys, cardItemsOfType, freeKey, relocateItemRefs } from './card-move.js';
import { DEFAULT_TASK_CATEGORIES, MAX_TASK_CATEGORIES } from '../constants.js';

export const META_KEYS = Object.freeze(['_sync', '_base', '_replace']);
export const DEVICE_SECTION_KEYS = Object.freeze(['gridCol', 'gridRow', 'gridColSpan', 'gridRowSpan', 'gridSpan']);
export const MERGE_MODES = Object.freeze(['trusted', 'guarded', 'union', 'replace']);

const META = new Set(META_KEYS);
const PATH_LIMIT = 100;   // paths kept in stats.kept / stats.conflicts

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const arr = (v) => (Array.isArray(v) ? v : []);
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

// ---------- hashing --------------------------------------------------------
// cyrb53 (53-bit, fast, good spread), as numbers. Hashes live only for one merge
// (bases are stored whole), so the scheme may change freely. A Hasher feeds several
// strings / child hashes into one hash without building one big string
class Hasher {
  constructor(seed = 0) { this.h1 = 0xdeadbeef ^ seed; this.h2 = 0x41c6ce57 ^ seed; }
  add(str) {
    let h1 = this.h1, h2 = this.h2;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    // a separator, so ("ab", "c") and ("a", "bc") differ
    this.h1 = Math.imul(h1 ^ 0x1f, 2654435761);
    this.h2 = Math.imul(h2 ^ 0x1f, 1597334677);
    return this;
  }
  num(n) {                                  // a child hash (53-bit integer)
    const lo = n >>> 0, hi = Math.floor(n / 4294967296) >>> 0;
    this.h1 = Math.imul(Math.imul(this.h1 ^ lo, 2654435761) ^ hi, 2654435761);
    this.h2 = Math.imul(Math.imul(this.h2 ^ lo, 1597334677) ^ hi, 1597334677);
    return this;
  }
  done() {
    let h1 = this.h1, h2 = this.h2;
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)) || 7;   // never 0 (ABSENT)
  }
}
const cyrb53 = (str, seed = 0) => new Hasher(seed).add(str).done();

function stable(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  const keys = Object.keys(v).filter(k => v[k] !== undefined).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
}

const ABSENT = 0;                                    // fingerprint of "not there"
// Long strings (rich text, image data) are hashed once per merge: the four
// fingerprints of one merge meet the same text again and again (strings map lookups
// are native, the hash loop isn't)
let longCache = null;
const LONG = 64;
function hashString(str, seed) {
  if (longCache === null || str.length < LONG) return cyrb53(str, seed);
  const cache = longCache[seed] || (longCache[seed] = new Map());
  let x = cache.get(str);
  if (x === undefined) { x = cyrb53(str, seed); cache.set(str, x); }
  return x;
}
function withHashCache(fn) {
  if (longCache !== null) return fn();
  longCache = [];
  try { return fn(); } finally { longCache = null; }
}
// A value's hash; strings and numbers without JSON.stringify (a seed per type keeps
// "1" and 1 apart)
function hashOf(v) {
  if (v === undefined) return ABSENT;
  switch (typeof v) {
    case 'string': return hashString(v, 1);
    case 'number': return cyrb53(String(v), 2);
    case 'boolean': return v ? 2 : 1;
    default: return v === null ? 3 : hashString(stable(v), 3);
  }
}
const isNode = (x) => x !== null && typeof x === 'object';      // a container fingerprint
const h = (f) => (f == null ? f : (typeof f === 'number' ? f : f.h));
const ABSENT_NODE = Object.freeze({ h: ABSENT, f: {}, i: new Map(), o: [], oa: [], oc: [] });

// ---------- spec -----------------------------------------------------------
const ATOM = { t: 'atom' };
const LOCAL = { t: 'local' };          // per device: never compared, this device's value
const TIME = { t: 'time' };
const TASKS = { t: 'tasks' };
const rec = (fields = {}, opts = {}) => ({ t: 'rec', fields, ...opts });
const list = (idOf, item) => ({ t: 'list', idOf, item });       // array of entities
const map = (item, opts = {}) => ({ t: 'map', item, ...opts });  // object; opts.ordered

const byId = (x) => (isObj(x) && x.id != null && x.id !== '' ? 'id:' + x.id : 'v:' + hashOf(x));
const byKey = (x) => (isObj(x) && x.key != null && x.key !== '' ? 'k:' + x.key : 'v:' + hashOf(x));
// Quick Access: by card + section + item key; an older entry (no card) by what it shows
export function quickAccessId(e) {
  if (isObj(e) && e.sectionType != null && e.name != null) {
    return `qa:${e.type || ''}|${e.sectionType}|${e.subtitle == null ? '' : e.subtitle}|${e.name}`;
  }
  return 'v:' + hashOf(isObj(e)
    ? { u: e.url ?? null, t: e.text ?? e.title ?? null, i: e.icon ?? null, c: e.copyText ?? null }
    : e);
}

// Arrays inside records: entries by what they point at, so each side's additions
// survive and a one-sided removal still applies (the renderers get plain arrays)
const isSet = (x) => x != null && x !== '';
// task.taskLinks ({ type: 'url', value } | { type: 'file', fileId }) and card item links
// ({ title, url } | { type: 'file', fileId } | { type: 'section', title })
const linkId = (x) => {
  if (!isObj(x)) return 'v:' + hashOf(x);
  if (x.type === 'file' || (isSet(x.fileId) && !isSet(x.url) && !isSet(x.value))) {
    return isSet(x.fileId) ? 'f:' + x.fileId : 'v:' + hashOf(x);
  }
  if (x.type === 'section') return 'h:' + (x.title == null ? '' : x.title);
  const u = isSet(x.value) ? x.value : x.url;
  return isSet(u) ? 'u:' + u : 'v:' + hashOf(x);
};
const refId = (x) => (isObj(x) ? `r:${x.type}|${x.sectionId}|${x.subtitle}|${x.key}` : 'v:' + hashOf(x));
const urlId = (x) => (isObj(x) && isSet(x.url) ? 'u:' + x.url : 'v:' + hashOf(x));
const fileIdOf = (x) => (isObj(x) && isSet(x.fileId) ? 'f:' + x.fileId : 'v:' + hashOf(x));
const titleId = (x) => (isObj(x) && typeof x.title === 'string' ? 't:' + x.title : 'v:' + hashOf(x));
const valueId = (x) => 'v:' + hashOf(x);                      // a set of plain values (task ids)

// rec opts: container (a group of lists), newer (notes: the newer one wins), mech (fields
// the app rewrites by itself: they never make "gone there, changed here" a change),
// notes (the view's fingerprints of the record's notes, one per note: only a note added
// or edited there makes it a change, see toView)
const NOTE = rec({}, { newer: 'updatedAt' });
const NOTE_LIST = list(byKey, NOTE);
const NOTES = map(NOTE_LIST);
const NOTE_SIGS = list(valueId, ATOM);
const CARD_ITEM = rec({ links: list(linkId, ATOM), taskIds: list(valueId, ATOM), __nsig: NOTE_SIGS }, { mech: ['taskIds'], notes: '__nsig' });
const ITEM_LIST = list(byKey, CARD_ITEM);
const GROUP = rec({ icons: ITEM_LIST, reminders: ITEM_LIST, subtasks: ITEM_LIST, copyPaste: ITEM_LIST }, { container: true });
const CARD = map(GROUP, { ordered: true });
const SECTION = rec({
  layouts: rec(), gridCol: LOCAL, gridRow: LOCAL, gridColSpan: LOCAL, gridRowSpan: LOCAL, gridSpan: LOCAL, __data: CARD,
  __nsig: NOTE_SIGS,
}, { mech: ['layouts'], notes: '__nsig' });
const TASK = rec({
  subtasks: list(byId, rec()), taskLinks: list(linkId, ATOM), linkedItems: list(refId, ATOM),
}, { mech: ['order'] });
const MEETING = rec({ links: list(urlId, ATOM), files: list(fileIdOf, ATOM) });
const TEMPLATE = rec({ items: list(titleId, ATOM) });
const ENTITY = rec();
const TOP = rec({
  lastActiveMode: LOCAL,
  sections: list(byId, SECTION),
  __tasks: TASKS,
  taskCategories: list(byId, ENTITY),
  subtaskTemplates: list(byId, TEMPLATE),
  projects: list(byId, ENTITY),
  meetings: list(byId, MEETING),
  ideas: list(byId, ENTITY),
  header: rec(),
  sectionTitles: map(ATOM), sectionIcons: map(ATOM), sectionColors: map(ATOM), subtitleColors: map(ATOM),
  collapsedSubtitles: map(ATOM), collapsedCards: map(ATOM),
  cardNotes: NOTES, subtaskNotes: NOTES,
  quickAccessItems: rec({ icons: list(quickAccessId, ATOM), listItems: list(quickAccessId, ATOM), quickLinks: list(byKey, ATOM) }),
  timeTracking: TIME,
});

// ---------- profile <-> merge view ----------------------------------------
// A card's notes (cardNotes[id]) and a subtask's notes (subtaskNotes["id:subtitle:key"])
// count as part of that card / subtask when one side deleted it: the view gives the
// card / subtask the fingerprints of its notes (__nsig, one per note), so "deleted there,
// a note added or edited here" keeps the card or subtask the note belongs to (a note
// only deleted there loses nothing: the deletion stands). The notes themselves still
// merge in their buckets (a copy keeps the buckets of what it deleted, so they always
// line up). An empty bucket counts as none (opening the notepad writes one)
const hasNotes = (x) => !isEmpty(x);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
function notesSig(bucket) {                        // (long texts hashed once per merge)
  const f = fp(NOTE_LIST, bucket);
  return isNode(f) ? f.o.map(id => h(f.i.get(id))) : [h(f)];
}

function withNoteSigs(data, sid, subNotes) {
  if (!isObj(data) || !isObj(subNotes)) return data;
  let out = null;
  for (const [sub, g] of Object.entries(data)) {
    if (!isObj(g) || !Array.isArray(g.subtasks)) continue;
    let items = null;
    const seen = new Set();
    g.subtasks.forEach((it, n) => {
      if (!isObj(it) || it.key == null || it.key === '') return;
      const id = `${sid}:${sub}:${it.key}`;
      if (seen.has(id)) return;                       // a repeated key: the first one
      seen.add(id);
      if (!own(subNotes, id) || !hasNotes(subNotes[id])) return;
      if (!items) items = g.subtasks.slice();
      items[n] = { ...it, __nsig: notesSig(subNotes[id]) };
    });
    if (items) {
      if (!out) out = { ...data };
      out[sub] = { ...g, subtasks: items };
    }
  }
  return out || data;
}

function withoutNoteSigs(data) {
  if (!isObj(data)) return data;
  let out = null;
  for (const [sub, g] of Object.entries(data)) {
    if (!isObj(g)) continue;
    let ng = null;
    for (const type of ITEM_TYPES) {
      const items = g[type];
      if (!Array.isArray(items) || !items.some(it => isObj(it) && '__nsig' in it)) continue;
      if (!ng) ng = { ...g };
      ng[type] = items.map(it => {
        if (!isObj(it) || !('__nsig' in it)) return it;
        const { __nsig, ...item } = it;
        return item;
      });
    }
    if (ng) {
      if (!out) out = { ...data };
      out[sub] = ng;
    }
  }
  return out || data;
}

export function toView(p) {
  const v = {};
  if (!isObj(p)) { v.sections = []; v.__tasks = { a: [], c: [] }; return v; }
  const sections = arr(p.sections);
  const sectionIds = new Set(sections.filter(isObj).map(s => s.id));
  for (const k of Object.keys(p)) {
    if (META.has(k) || k === 'tasks' || k === 'completedTasks' || k === 'sections' || sectionIds.has(k)) continue;
    v[k] = p[k];
  }
  const cardNotes = isObj(p.cardNotes) ? p.cardNotes : null;
  const subNotes = isObj(p.subtaskNotes) ? p.subtaskNotes : null;
  v.sections = sections.map(s => {
    if (!isObj(s)) return s;
    const out = { ...s, __data: withNoteSigs(p[s.id], s.id, subNotes) };
    if (cardNotes && own(cardNotes, s.id) && hasNotes(cardNotes[s.id])) out.__nsig = notesSig(cardNotes[s.id]);
    return out;
  });
  const loc = (where) => (t) => (isObj(t) ? { ...t, __loc: where } : t);
  v.__tasks = { a: arr(p.tasks).map(loc('a')), c: arr(p.completedTasks).map(loc('c')) };
  return v;
}

export function fromView(v) {
  const p = {};
  for (const k of Object.keys(v || {})) {
    if (k === '__tasks' || k === 'sections') continue;
    p[k] = v[k];
  }
  p.sections = [];
  for (const s of arr(v && v.sections)) {
    if (!isObj(s)) { p.sections.push(s); continue; }
    const { __data, __nsig, ...section } = s;
    p.sections.push(section);
    if (__data !== undefined) p[section.id] = withoutNoteSigs(__data);
  }
  const strip = (t) => {
    if (!isObj(t)) return t;
    const { __loc, ...task } = t;
    return task;
  };
  p.tasks = arr(v && v.__tasks && v.__tasks.a).map(strip);
  p.completedTasks = arr(v && v.__tasks && v.__tasks.c).map(strip);
  return p;
}

// ---------- fingerprints ---------------------------------------------------
// A tree of hashes shaped like the spec: rec { h, f: { field: fp } }, list / map
// { h, o: [ids in order], i: Map id → fp }, tasks { h, oa, oc, i }, atoms a hash number
function idsOf(idOf, items) {
  const seen = new Map();
  return items.map(x => {
    const id = idOf(x);
    const n = seen.get(id) || 0;
    seen.set(id, n + 1);
    return n ? `${id}#${n}` : id;           // duplicates stay distinct, never merged away
  });
}

function fp(spec, v) {
  if (v === undefined) return ABSENT;
  switch (spec.t) {
    case 'local': return undefined;
    case 'atom': case 'time': return hashOf(v);
    case 'rec': {
      if (!isObj(v)) return hashOf(v);
      const f = {};
      const hs = new Hasher(4);
      for (const k of Object.keys(v).sort()) {
        const x = fp(spec.fields[k] || ATOM, v[k]);
        if (x === undefined || x === ABSENT) continue;
        f[k] = x;
        hs.add(k).num(h(x));
      }
      return { h: hs.done(), f };
    }
    case 'list': case 'map': {
      const isMap = spec.t === 'map';
      if (isMap ? !isObj(v) : !Array.isArray(v)) return hashOf(v);
      const ids = isMap ? Object.keys(v) : idsOf(spec.idOf, v);
      const i = new Map();
      for (let n = 0; n < ids.length; n++) i.set(ids[n], fp(spec.item, isMap ? v[ids[n]] : v[n]));
      const order = isMap && !spec.ordered ? [...ids].sort() : ids;
      const hs = new Hasher(5);
      for (const id of order) hs.add(id).num(h(i.get(id)));
      return { h: hs.done(), o: ids, i };
    }
    case 'tasks': {
      const a = arr(v.a), c = arr(v.c);
      const all = [...a, ...c];
      const ids = idsOf(byId, all);
      const i = new Map();
      for (let n = 0; n < ids.length; n++) i.set(ids[n], fp(TASK, all[n]));
      const oa = ids.slice(0, a.length), oc = ids.slice(a.length);
      const hs = new Hasher(6);
      hs.num(a.length + 1);
      for (const id of ids) hs.add(id).num(h(i.get(id)));
      return { h: hs.done(), oa, oc, i };
    }
    default: return hashOf(v);
  }
}

// --- "Gone on one side, changed on the other": did the other side really change it?
// Bookkeeping fields (rec opts.mech) and note fingerprints (opts.notes) are left out of
// the comparison (a fingerprint's hash recomputed without them, all the way down); the
// notes count only for a note added or edited since the base (notesAdded)
const mechMemo = new WeakMap();
function hasMech(spec) {
  if (!spec || typeof spec !== 'object') return false;
  if (mechMemo.has(spec)) return mechMemo.get(spec);
  mechMemo.set(spec, false);                         // (no cycles in the spec, but cheap)
  let r = false;
  if (spec.t === 'rec') r = !!(spec.mech && spec.mech.length) || !!spec.notes || Object.values(spec.fields).some(hasMech);
  else if (spec.t === 'list' || spec.t === 'map') r = hasMech(spec.item);
  mechMemo.set(spec, r);
  return r;
}

function mechFree(spec, f) {
  if (!isNode(f) || !hasMech(spec)) return h(f);
  if (spec.t === 'rec') {
    const hs = new Hasher(4);
    for (const k of Object.keys(f.f).sort()) {
      if ((spec.mech && spec.mech.includes(k)) || k === spec.notes) continue;
      hs.add(k).num(mechFree(spec.fields[k] || ATOM, f.f[k]));
    }
    return hs.done();
  }
  if (spec.t === 'list' || spec.t === 'map') {
    const order = spec.t === 'map' && !spec.ordered ? [...f.o].sort() : f.o;
    const hs = new Hasher(5);
    for (const id of order) hs.add(id).num(mechFree(spec.item, f.i.get(id)));
    return hs.done();
  }
  return h(f);
}

// b / pf: fingerprints that are the same but for bookkeeping and notes (mechFree): does
// pf hold a note b doesn't (added, or edited: another fingerprint)?
function notesAdded(spec, b, pf) {
  if (!isNode(pf) || !hasMech(spec)) return false;
  if (spec.t === 'rec') {
    if (spec.notes && pf.f[spec.notes] !== undefined) {
      const pn = pf.f[spec.notes], bn = isNode(b) ? b.f[spec.notes] : undefined;
      if (!isNode(pn)) return h(pn) !== h(bn);
      const had = new Set(isNode(bn) ? bn.o : []);
      if (pn.o.some(id => !had.has(id))) return true;
    }
    for (const k of Object.keys(pf.f)) {
      if (k === spec.notes) continue;
      if (notesAdded(spec.fields[k] || ATOM, isNode(b) ? b.f[k] : undefined, pf.f[k])) return true;
    }
    return false;
  }
  if (spec.t === 'list' || spec.t === 'map') {
    for (const id of pf.o) if (notesAdded(spec.item, isNode(b) ? b.i.get(id) : undefined, pf.i.get(id))) return true;
  }
  return false;
}

// One hash of a profile's content: meta fields and per-device fields left out, map
// key order ignored (so it says whether two copies hold the same dashboard)
export function profileHash(profile) {
  return withHashCache(() => h(fp(TOP, toView(toObject(profile, false)))).toString(36));
}

// ---------- the merge ------------------------------------------------------
const isEmpty = (x) => x === undefined || x === null || x === '' ||
  (Array.isArray(x) && x.length === 0) || (isObj(x) && Object.keys(x).length === 0);
const isListLike = (spec) => spec.t === 'list' || spec.t === 'map' || !!spec.container;
// Nothing left inside (a card section whose lists all came out empty)
const isHollow = (x) => isEmpty(x) || (isObj(x) && Object.values(x).every(isEmpty));

const HEADER_DEFAULTS = Object.freeze({
  profileName: 'Your Name',
  profileTitle: 'Your Title',
  profilePhotoSrc: 'assets/icons/placeholder-profile.svg',
  companyLogoSrc: 'assets/icons/placeholder-logo.svg',
});

// Settings a new dashboard starts with (state.js model)
const TOP_DEFAULTS = Object.freeze({
  '$.darkMode': false,
  '$.glassTheme': 'classic',
  '$.timeTrackingExpanded': false,
  '$.quickAccessExpanded': false,
  '$.selectorModeActive': false,
});

// Union mode: a value that only says "never set here" (the new-dashboard defaults)
export function isDefaultValue(path, v) {
  if (typeof path !== 'string') return false;
  if (Object.prototype.hasOwnProperty.call(TOP_DEFAULTS, path)) return v === TOP_DEFAULTS[path];
  // A task's list: active is where every task starts, completed is what a device did
  if (path.startsWith('$.__tasks[') && path.endsWith('].__loc')) return v === 'a';
  if (!path.startsWith('$.header.')) return false;
  const key = path.slice('$.header.'.length);
  if (!Object.prototype.hasOwnProperty.call(HEADER_DEFAULTS, key)) return false;
  const d = HEADER_DEFAULTS[key];
  return v === d || (isObj(v) && v.type === 'asset' && v.src === d);
}

function note(listOf, path) {
  if (listOf.length < PATH_LIMIT && !path.includes('.__nsig')) listOf.push(path);   // (the view's note fingerprints: their notes say it)
}

// b: base fingerprint (null = union), lf / cf: local / cloud fingerprints,
// l / c: the values (undefined = absent). Returns the merged value (undefined = gone)
function mNode(spec, b, lf, cf, l, c, ctx, path) {
  if (spec.t === 'local') return l !== undefined ? l : c;
  const lh = h(lf), ch = h(cf);
  if (lh === ch) return l;
  const bh = b === null ? null : h(b);
  const st = ctx.st;

  if (spec.t === 'time') {
    if (l === undefined) return c;
    if (c === undefined) return l;
    if (bh !== null && bh !== ABSENT) {
      if (ch === bh) return l;                     // only this device tracked since
      if (lh === bh && ctx.trusted) return c;      // only the cloud (a descendant) did
    }
    return mergeTimeLogs(l, c);
  }

  if (bh !== null) {
    if (lh === bh) {                               // only the cloud changed
      if (!ctx.trusted) {
        // Guarded: the cloud was written blind, maybe from a stale copy. What it lacks
        // was not deleted by anyone, so it stays; what it adds comes in; a value it
        // holds differently from the base (and this device) keeps this device's:
        // inside a container, item by item
        if (c === undefined) { note(st.kept, path); return l; }
        if (l !== undefined) {
          if (spec.newer && isObj(l) && isObj(c) &&
            (Number(l[spec.newer]) || 0) > (Number(c[spec.newer]) || 0)) {
            note(st.conflicts, path); st.fromLocal++; return l;           // an older note
          }
          if (isNode(lf) && isNode(cf) && spec.t !== 'atom') {
            return mDeep(spec, isNode(b) ? b : ABSENT_NODE, lf, cf, l, c, ctx, path);
          }
          // ...unless this is inside a note the cloud holds a newer copy of
          if (!(ctx.byNewer && ctx.prefer === 'cloud')) { note(st.conflicts, path); st.fromLocal++; return l; }
        }
      }
      st.fromCloud++;
      return c;
    }
    if (ch === bh) { st.fromLocal++; return l; }   // only this device changed
  }

  // Both differ from the base, or there is no base
  if (l !== undefined && c === undefined && !ctx.trusted) { note(st.kept, path); return l; }
  if (l === undefined && c !== undefined && b === null) return c;
  if ((l === undefined) !== (c === undefined)) {
    // Gone on one side, changed on the other
    const pf = l === undefined ? cf : lf;
    if (isNode(b) && isNode(pf)) {
      // A list (or a group of lists) is merged against an empty side: what the other
      // side added or changed survives
      if (isListLike(spec)) {
        const empty = spec.t === 'list' ? [] : {};
        const ef = fp(spec, empty);
        note(st.kept, path);
        const x = mDeep(spec, b, l === undefined ? ef : lf, c === undefined ? ef : cf,
          l === undefined ? empty : l, c === undefined ? empty : c, ctx, path);
        return isHollow(x) ? undefined : x;
      }
      // Only bookkeeping changed there (a reorder, a linked task's id), or notes were only
      // deleted: the deletion stands
      if (hasMech(spec) && mechFree(spec, b) === mechFree(spec, pf) && !notesAdded(spec, b, pf)) {
        if (l === undefined) st.fromLocal++; else st.fromCloud++;
        return undefined;
      }
    }
    note(st.kept, path);
    return l === undefined ? c : l;
  }

  if (isNode(lf) && isNode(cf) && spec.t !== 'atom') {
    return mDeep(spec, b === null ? null : (isNode(b) ? b : ABSENT_NODE), lf, cf, l, c, ctx, path);
  }

  // A single value changed on both sides
  note(st.conflicts, path);
  // A list / record against a value of another shape (e.g. card notes stored as one
  // string by older builds, an array once the notepad opened them): the structured one
  if (spec.t !== 'atom' && isNode(lf) !== isNode(cf)) return isNode(lf) ? l : c;
  if (b === null && !ctx.byNewer) {
    const lDefault = isEmpty(l) || ctx.isDefault(path, l);
    const cDefault = isEmpty(c) || ctx.isDefault(path, c);
    return lDefault && !cDefault ? c : l;
  }
  return ctx.prefer === 'cloud' ? c : l;
}

function mDeep(spec, b, lf, cf, l, c, ctx, path) {
  if (spec.t === 'rec') return mRec(spec, b, lf, cf, l, c, ctx, path);
  if (spec.t === 'list' || spec.t === 'map') return mList(spec, b, lf, cf, l, c, ctx, path);
  if (spec.t === 'tasks') return mTasks(b, lf, cf, l, c, ctx, path);
  return ctx.prefer === 'cloud' ? c : l;
}

function mRec(spec, b, lf, cf, l, c, ctx, path) {
  let sub = ctx;
  if (spec.newer) {
    const ln = Number(l[spec.newer]) || 0, cn = Number(c[spec.newer]) || 0;
    if (ln !== cn) sub = { ...ctx, prefer: ln > cn ? 'local' : 'cloud', byNewer: true };
  }
  const out = {};
  const keys = new Set([...Object.keys(l), ...Object.keys(c)]);
  for (const k of keys) {
    const s = spec.fields[k] || ATOM;
    const bk = b === null ? null : (b.f && b.f[k] !== undefined ? b.f[k] : ABSENT);
    const lk = lf.f[k], ck = cf.f[k];
    let x = mNode(s, bk, lk === undefined ? ABSENT : lk, ck === undefined ? ABSENT : ck, l[k], c[k], sub, path + '.' + k);
    // A card section keeps all its item lists (the renderers expect them), even one
    // whose items all went
    if (x === undefined && spec.container && s.t === 'list' && (Array.isArray(l[k]) || Array.isArray(c[k]))) x = [];
    if (x !== undefined) out[k] = x;
  }
  return out;
}

// The side that reordered the common items gives the order (this device's when both or
// neither did, or when the cloud was written blind: guarded); items only the other side
// has go after their predecessor there
function mergeOrder(bo, lo, co, keep, keepLocal = false) {
  let skel = lo, other = co;
  if (bo && !keepLocal) {
    const lset = new Set(lo), cset = new Set(co);
    const common = bo.filter(id => lset.has(id) && cset.has(id));
    const cs = new Set(common);
    const same = (seq) => {
      const s = seq.filter(id => cs.has(id));
      return s.length === common.length && s.every((id, n) => id === common[n]);
    };
    if (!same(co) && same(lo)) { skel = co; other = lo; }
  }
  const out = skel.filter(id => keep.has(id));
  const placed = new Set(out);
  const inOther = new Set(other);
  other.forEach((id, n) => {
    if (!keep.has(id) || placed.has(id)) return;
    let at = 0;
    for (let j = n - 1; j >= 0; j--) {
      const p = out.indexOf(other[j]);
      if (p >= 0) { at = p + 1; break; }
    }
    while (at < out.length && !inOther.has(out[at])) at++;
    out.splice(at, 0, id);
    placed.add(id);
  });
  for (const id of keep.keys()) if (!placed.has(id)) { out.push(id); placed.add(id); }
  return out;
}

function mList(spec, b, lf, cf, l, c, ctx, path) {
  const isMap = spec.t === 'map';
  const lv = new Map(lf.o.map((id, n) => [id, isMap ? l[id] : l[n]]));
  const cv = new Map(cf.o.map((id, n) => [id, isMap ? c[id] : c[n]]));
  const res = new Map();
  for (const id of new Set([...lf.o, ...cf.o])) {
    const bi = b === null ? null : (b.i && b.i.has(id) ? b.i.get(id) : ABSENT);
    const li = lf.i.get(id), ci = cf.i.get(id);
    const x = mNode(spec.item, bi, li === undefined ? ABSENT : li, ci === undefined ? ABSENT : ci,
      lv.get(id), cv.get(id), ctx, path + '[' + id + ']');
    if (x !== undefined) res.set(id, x);
  }
  let order;
  if (isMap && !spec.ordered) {
    order = [...lf.o.filter(id => res.has(id)), ...cf.o.filter(id => res.has(id) && !lv.has(id))];
  } else {
    order = mergeOrder(b === null ? null : (b.o || []), lf.o, cf.o, res, ctx.mode === 'guarded');
  }
  if (isMap) {
    const o = {};
    for (const id of order) o[id] = res.get(id);
    return o;
  }
  return order.map(id => res.get(id));
}

function mTasks(b, lf, cf, l, c, ctx, path) {
  const lAll = [...arr(l.a), ...arr(l.c)], cAll = [...arr(c.a), ...arr(c.c)];
  const lIds = [...lf.oa, ...lf.oc], cIds = [...cf.oa, ...cf.oc];
  const lv = new Map(lIds.map((id, n) => [id, lAll[n]]));
  const cv = new Map(cIds.map((id, n) => [id, cAll[n]]));
  const res = new Map();
  for (const id of new Set([...lIds, ...cIds])) {
    const bi = b === null ? null : (b.i && b.i.has(id) ? b.i.get(id) : ABSENT);
    const li = lf.i.get(id), ci = cf.i.get(id);
    const x = mNode(TASK, bi, li === undefined ? ABSENT : li, ci === undefined ? ABSENT : ci,
      lv.get(id), cv.get(id), ctx, path + '[' + id + ']');
    if (x !== undefined) res.set(id, x);
  }
  // completed / completedAt follow the list the task ended in (its __loc and those
  // fields merge one by one: an active task must never say completed, a completed one
  // keeps the time it was completed)
  const act = new Map(), done = new Map();
  for (const [id, t] of res) {
    if (!isObj(t)) { act.set(id, t); continue; }
    if (t.__loc === 'c') {
      let x = t;
      if (x.completed !== true) x = { ...x, completed: true };
      if (x.completedAt == null) {
        const at = [lv.get(id), cv.get(id)].find(s => isObj(s) && s.__loc === 'c' && s.completedAt != null);
        if (at) x = { ...x, completedAt: at.completedAt };
      }
      done.set(id, x);
    } else {
      let x = t;
      if ('completed' in x || 'completedAt' in x) {
        const { completed, completedAt, ...rest } = x;
        x = rest;
      }
      act.set(id, x);
    }
  }
  const keepLocal = ctx.mode === 'guarded';
  return {
    a: mergeOrder(b === null ? null : b.oa, lf.oa, cf.oa, act, keepLocal).map(id => act.get(id)),
    c: mergeOrder(b === null ? null : b.oc, lf.oc, cf.oc, done, keepLocal).map(id => done.get(id)),
  };
}

// ---------- collisions: one key / id, two different things -----------------
// Older builds handed out sequential keys ("icon_4", "new-card-3"), so two devices
// adding at once could both make "icon_4" with different items. A card section or
// item that the base doesn't have (or any, without a base), present on both sides
// with different content, is two things: the LOCAL one gets a free key / id before
// the merge, and everything in the local copy that points at it follows.
const IDENTITY = {
  icons: ['url', 'fileId', 'isDivider', 'isSeparator'],
  subtasks: ['text'],
  reminders: ['title'],
  copyPaste: ['copyText'],
};
// Same main field(s): the same item, edited (merged field by field), never two
function sameIdentity(type, a, b) {
  return (IDENTITY[type] || []).every(k => stable(a && a[k]) === stable(b && b[k]));
}

function sectionTitle(p, s) {
  const t = isObj(p.sectionTitles) ? p.sectionTitles[s.id] : undefined;
  return (typeof t === 'string' && t) || s.title || '';
}

// Two cards under one id: different titles and no item in common
function sectionsLookDifferent(L, ls, C, cs) {
  if (sectionTitle(L, ls) === sectionTitle(C, cs)) return false;
  for (const type of ITEM_TYPES) {
    const cItems = cardItemsOfType(C[cs.id], type);
    for (const li of cardItemsOfType(L[ls.id], type)) {
      if (li && li.key && cItems.some(ci => ci && ci.key === li.key && sameIdentity(type, li, ci))) return false;
    }
  }
  return true;
}

function freeSectionId(id, profiles) {
  const taken = new Set();
  for (const p of profiles) {
    if (!isObj(p)) continue;
    Object.keys(p).forEach(k => taken.add(k));
    arr(p.sections).forEach(s => { if (isObj(s)) taken.add(s.id); });
  }
  let n = 2;
  while (taken.has(`${id}-${n}`)) n++;
  return `${id}-${n}`;
}

function renameKey(obj, from, to) {
  if (!isObj(obj) || !(from in obj)) return;
  if (!(to in obj)) obj[to] = obj[from];
  delete obj[from];
}

function renamePrefix(obj, from, to) {
  if (!isObj(obj)) return;
  for (const k of Object.keys(obj)) {
    if (!k.startsWith(from)) continue;
    const nk = to + k.slice(from.length);
    if (!(nk in obj)) obj[nk] = obj[k];
    delete obj[k];
  }
}

// --- A card (section) gets a new id; everything that points at it follows: its card
// data, title / icon / colour / collapse entries, subtitle colours and collapse flags
// ("id:subtitle"), card notes, subtask notes ("id:subtitle:key"), Quick Access entries,
// linked tasks (active + completed, linkedItems + legacy linkedItem) and note highlights.
// Mutates `data`; returns false when there is no such section (or the id is taken)
export function renameSectionId(data, fromId, toId) {
  if (!isObj(data) || !fromId || !toId || fromId === toId) return false;
  const sections = arr(data.sections);
  const section = sections.find(s => isObj(s) && s.id === fromId);
  if (!section || sections.some(s => isObj(s) && s.id === toId)) return false;
  section.id = toId;
  if (fromId in data) {
    data[toId] = data[fromId];
    delete data[fromId];
  }
  for (const k of ['sectionTitles', 'sectionIcons', 'sectionColors', 'collapsedCards', 'cardNotes']) renameKey(data[k], fromId, toId);
  for (const k of ['subtitleColors', 'collapsedSubtitles', 'subtaskNotes']) renamePrefix(data[k], fromId + ':', toId + ':');
  const qa = data.quickAccessItems;
  if (isObj(qa)) {
    [...arr(qa.icons), ...arr(qa.listItems)].forEach(e => { if (isObj(e) && e.sectionType === fromId) e.sectionType = toId; });
  }
  const moveRef = (ref) => { if (isObj(ref) && ref.sectionId === fromId) ref.sectionId = toId; };
  [...arr(data.tasks), ...arr(data.completedTasks)].forEach(t => {
    if (!isObj(t)) return;
    arr(t.linkedItems).forEach(moveRef);
    moveRef(t.linkedItem);
    const nh = t.noteHighlight;
    if (isObj(nh) && typeof nh.sectionId === 'string') {
      if (nh.sectionId === fromId) nh.sectionId = toId;
      else if (nh.sectionId.startsWith(fromId + ':')) nh.sectionId = toId + nh.sectionId.slice(fromId.length);
    }
  });
  return true;
}

// Mutates `local` (a private copy). Returns { sections, items } (how many were re-keyed)
export function separateCollisions(local, cloud, base = null) {
  const out = { sections: 0, items: 0 };
  if (!isObj(local) || !isObj(cloud)) return out;
  const cloudSections = new Map(arr(cloud.sections).filter(isObj).map(s => [s.id, s]));
  const baseIds = base ? new Set(arr(base.sections).filter(isObj).map(s => s.id)) : null;

  // 1. Sections
  for (const ls of arr(local.sections).filter(isObj)) {
    const cs = cloudSections.get(ls.id);
    if (!cs || (baseIds && baseIds.has(ls.id))) continue;
    const lh = h(fp(SECTION, { ...ls, __data: local[ls.id] }));
    const ch = h(fp(SECTION, { ...cs, __data: cloud[cs.id] }));
    if (lh === ch || !sectionsLookDifferent(local, ls, cloud, cs)) continue;
    if (renameSectionId(local, ls.id, freeSectionId(ls.id, [local, cloud, base]))) out.sections++;
  }

  // 2. Card items, in the cards both sides have
  for (const ls of arr(local.sections).filter(isObj)) {
    const sid = ls.id;
    const lc = local[sid], cc = cloud[sid];
    if (!isObj(lc) || !isObj(cc)) continue;
    const bc = base && isObj(base[sid]) ? base[sid] : null;
    for (const type of ITEM_TYPES) {
      const baseKeys = bc ? cardItemKeys(bc, type) : null;
      const cloudByKey = new Map();
      Object.entries(cc).forEach(([sub, g]) => {
        if (!isObj(g)) return;
        arr(g[type]).forEach(item => {
          if (!isObj(item) || !item.key) return;
          if (!cloudByKey.has(item.key)) cloudByKey.set(item.key, []);
          cloudByKey.get(item.key).push({ sub, item });
        });
      });
      for (const [sub, lg] of Object.entries(lc)) {
        if (!isObj(lg)) continue;
        for (const item of arr(lg[type])) {
          if (!isObj(item) || !item.key || (baseKeys && baseKeys.has(item.key))) continue;
          const twins = cloudByKey.get(item.key);
          if (!twins) continue;
          const ih = hashOf(item);
          const here = twins.filter(t => t.sub === sub);
          if (here.length) {
            // The same item: identical in the same section, or the same main field there
            if (here.every(t => hashOf(t.item) === ih || sameIdentity(type, item, t.item))) continue;
          } else if (!base) {
            // No base: older data repeats keys across sections (this copy has the key
            // in the cloud's section too), or one item moved (the same main field):
            // left alone. Else two items under one key in one card: told apart
            const repeats = twins.some(t => sameIdentity(type, item, t.item) ||
              arr(isObj(lc[t.sub]) ? lc[t.sub][type] : null).some(x => isObj(x) && x.key === item.key));
            if (repeats) continue;
          }
          const taken = new Set([...cardItemKeys(lc, type), ...cardItemKeys(cc, type), ...(baseKeys || [])]);
          const to = freeKey(item.key, taken, type);
          relocateItemRefs(local, type, { sectionId: sid, subtitle: sub, key: item.key }, { sectionId: sid, subtitle: sub, key: to });
          item.key = to;
          out.items++;
        }
      }
    }
  }
  return out;
}

// ---------- task categories: at most 8 colour slots -------------------------
// A union (or a deletion on one side kept because the other side changed something,
// or two devices adding at once) can bring the list past MAX_TASK_CATEGORIES coloured
// categories. Nothing a device didn't delete goes: only categories no task uses that a
// device did delete are dropped (defaults one side doesn't have, categories in the base
// one side deleted). Still over: same-name categories are combined (tasks and the time
// log follow the first). Still over: the extras stay in the list marked overflow: true
// (no colour slot; tasks keep them, the chart shows them as Other, Task Settings lists
// them to keep or remove), the ones least likely missed first: no task uses them,
// defaults on both sides, other categories on both, then new ones; within a tier the
// ones without tracked time first, then from the end. Then one colour slot each (the
// first keeps its slot, the rest get the lowest free: normalizeTaskCategories' rule).
// Mutates profile.taskCategories (and, when combining, task categoryIds); returns
// { dropped: [ids], combined: [[fromId, toId]], overflow: [ids set aside now], overCap, reslotted: [ids] }
export function capTaskCategories(profile, { base = null, local = null, cloud = null, max = MAX_TASK_CATEGORIES } = {}) {
  const res = { dropped: [], combined: [], overflow: [], overCap: false, reslotted: [] };
  if (!isObj(profile) || !Array.isArray(profile.taskCategories)) return res;
  const valid = (c) => isObj(c) && typeof c.id === 'string' && c.id !== '';
  const coloured = (c) => valid(c) && c.overflow !== true;
  let cats = profile.taskCategories;
  let count = cats.filter(coloured).length;
  if (count > max) {
    const tasks = [...arr(profile.tasks), ...arr(profile.completedTasks)].filter(isObj);
    const timeEntries = isObj(profile.timeTracking) && isObj(profile.timeTracking.tasks)
      ? Object.values(profile.timeTracking.tasks).filter(isObj) : [];
    const uses = new Map();
    tasks.forEach(t => { if (t.categoryId) uses.set(t.categoryId, (uses.get(t.categoryId) || 0) + 1); });
    const timed = new Set(timeEntries.map(e => e.categoryId).filter(Boolean));
    const idsOn = (p) => new Set(arr(p && p.taskCategories).filter(valid).map(c => c.id));
    const L = idsOn(local), C = idsOn(cloud), B = base ? idsOn(base) : null;
    const DEFAULTS = new Set(DEFAULT_TASK_CATEGORIES.map(c => c.id));
    const tierOf = (c) => {
      const both = L.has(c.id) && C.has(c.id);
      const isDefault = DEFAULTS.has(c.id);
      if (isDefault && !both) return 0;            // a device deleted it (or never had it)
      if (B && B.has(c.id) && !both) return 1;     // in the base, a device deleted it
      if (isDefault) return 2;
      if (both) return 3;
      return 4;
    };
    const rank = (x, y) => tierOf(x.c) - tierOf(y.c) ||
      (timed.has(x.c.id) ? 1 : 0) - (timed.has(y.c.id) ? 1 : 0) || y.index - x.index;
    const indexed = () => cats.map((c, index) => ({ c, index })).filter(({ c }) => coloured(c));
    // 1. Deleted by a device and unused: those go
    const drop = new Set();
    for (const { c } of indexed().filter(({ c }) => !uses.get(c.id) && tierOf(c) <= 1).sort(rank)) {
      if (count <= max) break;
      drop.add(c.id);
      count--;
    }
    if (drop.size) {
      cats = cats.filter(c => !(valid(c) && drop.has(c.id)));
      res.dropped = [...drop];
    }
    // 2. Two categories under one name: one
    if (count > max) {
      const byName = new Map();
      const combine = new Map();
      for (const c of cats) {
        if (!coloured(c)) continue;
        const name = String(c.name || '').trim().toLowerCase();
        if (!name) continue;
        if (!byName.has(name)) byName.set(name, c.id);
        else if (count > max) { combine.set(c.id, byName.get(name)); count--; }
      }
      if (combine.size) {
        cats = cats.filter(c => !(valid(c) && combine.has(c.id)));
        tasks.forEach(t => { if (combine.has(t.categoryId)) t.categoryId = combine.get(t.categoryId); });
        timeEntries.forEach(e => { if (combine.has(e.categoryId)) e.categoryId = combine.get(e.categoryId); });
        res.combined = [...combine];
      }
    }
    // 3. The rest past the slots: set aside, never dropped
    if (count > max) {
      const aside = new Set();
      const order = indexed().sort((x, y) => (uses.get(x.c.id) ? 1 : 0) - (uses.get(y.c.id) ? 1 : 0) || rank(x, y));
      for (const { c } of order) {
        if (count <= max) break;
        aside.add(c.id);
        count--;
      }
      cats = cats.map(c => {
        if (!valid(c) || !aside.has(c.id)) return c;
        const { slot, ...rest } = c;
        return { ...rest, overflow: true };
      });
      res.overflow = cats.filter(c => valid(c) && aside.has(c.id)).map(c => c.id);
      res.overCap = true;
    }
  }
  // One colour slot each (a category set aside has none)
  const slots = new Set();
  const needs = [];
  cats.forEach((c, index) => {
    if (!valid(c)) return;
    if (c.overflow === true) {
      if ('slot' in c) {
        if (cats === profile.taskCategories) cats = cats.slice();
        const { slot, ...rest } = c;
        cats[index] = rest;
      }
      return;
    }
    if (Number.isInteger(c.slot) && c.slot >= 1 && c.slot <= max && !slots.has(c.slot)) slots.add(c.slot);
    else needs.push(index);
  });
  if (needs.length) {
    if (cats === profile.taskCategories) cats = cats.slice();
    for (const index of needs) {
      let s = 1;
      while (s <= max && slots.has(s)) s++;
      if (s > max) break;
      slots.add(s);
      cats[index] = { ...cats[index], slot: s };
      res.reslotted.push(cats[index].id);
    }
  }
  profile.taskCategories = cats;
  return res;
}

// ---------- after the merge -------------------------------------------------
// The flat grid props are this device's working layout in its own mode (lastActiveMode).
// Kept from the local copy, except when the cloud changed this mode's layout profile
// (they then follow it); a card only the cloud has gets them from its layout profile
// for this mode, else none (restoreModel / hydrateLayout place it), unless both
// devices are in the same mode
function settleDeviceLayout(merged, local, cloud) {
  const mode = local.lastActiveMode !== undefined ? local.lastActiveMode : cloud.lastActiveMode;
  if (mode !== undefined) merged.lastActiveMode = mode; else delete merged.lastActiveMode;
  const localSections = new Map(arr(local.sections).filter(isObj).map(s => [s.id, s]));
  const profileOf = (s) => (mode && isObj(s.layouts) && isObj(s.layouts[mode]) ? s.layouts[mode] : null);
  const validProfile = (p) => p && Number.isFinite(p.col) && Number.isFinite(p.row);
  const setFlat = (s, p) => {
    s.gridCol = p.col;
    s.gridRow = p.row;
    if (Number.isFinite(p.colSpan)) s.gridColSpan = p.colSpan; else delete s.gridColSpan;
    if (Number.isFinite(p.rowSpan)) s.gridRowSpan = p.rowSpan; else delete s.gridRowSpan;
  };
  const copyFlat = (s, from) => {
    DEVICE_SECTION_KEYS.forEach(k => {
      if (from && k in from) s[k] = from[k]; else delete s[k];
    });
  };
  for (const s of arr(merged.sections)) {
    if (!isObj(s)) continue;
    const ls = localSections.get(s.id);
    const prof = profileOf(s);
    if (ls) {
      const lprof = profileOf(ls);
      if (validProfile(prof) && stable(prof) !== stable(lprof)) setFlat(s, prof);
      else copyFlat(s, ls);
    } else if (mode && cloud.lastActiveMode !== mode) {
      if (validProfile(prof)) setFlat(s, prof);
      else ['gridCol', 'gridRow', 'gridColSpan', 'gridRowSpan'].forEach(k => { delete s[k]; });
    }
  }
}

// Photo / logo and their framing go together: when the two sides hold different
// images, the framing comes from the side whose image the merge kept
const HEADER_GROUPS = [
  ['profilePhotoSrc', 'profilePhotoZoom', 'profilePhotoXPercent', 'profilePhotoYPercent'],
  ['companyLogoSrc', 'companyLogoZoom', 'companyLogoXPercent', 'companyLogoYPercent', 'companyLogoInvertDark'],
];
function settleHeaderGroups(merged, local, cloud) {
  const mh = merged.header, lh = local.header, ch = cloud.header;
  if (!isObj(mh) || !isObj(lh) || !isObj(ch)) return;
  for (const [src, ...framing] of HEADER_GROUPS) {
    const ls = stable(lh[src]), cs = stable(ch[src]), ms = stable(mh[src]);
    if (ls === cs) continue;
    const from = ms === cs ? ch : (ms === ls ? lh : null);
    if (!from) continue;
    framing.forEach(k => { if (k in from) mh[k] = clone(from[k]); else delete mh[k]; });
  }
}

function toObject(x, copy = true) {
  if (x == null) return {};
  if (typeof x === 'string') {
    const parsed = JSON.parse(x);              // a corrupt copy throws: never merge it as empty
    return isObj(parsed) ? parsed : {};
  }
  if (!isObj(x)) return {};
  return copy ? clone(x) : x;
}

function stripMeta(p) {
  const out = {};
  for (const k of Object.keys(p)) if (!META.has(k)) out[k] = p[k];
  return out;
}

// ---------- entry point ----------------------------------------------------
// mergeProfiles({ base, local, cloud, mode, prefer, isDefault }):
//   base / local / cloud  profile objects or JSON strings (never modified); base null =
//                         unknown; cloud null / {} = the cloud has no profile yet
//   mode                  'trusted' | 'guarded' | 'union' | 'replace' (default: trusted
//                         with a base, else union; trusted / guarded without a base = union)
//   prefer                'local' (default) | 'cloud': who wins a value both changed
//   isDefault(path, v)    union mode: "this value was never set" (default isDefaultValue)
// Returns { merged, mode, localChanged, cloudChanged, stats }:
//   merged        the profile both sides should hold (fresh objects, no meta fields)
//   localChanged  merged holds something the local copy doesn't (write it locally)
//   cloudChanged  merged holds something the cloud copy doesn't (upload it)
//   stats         { mode, fromCloud, fromLocal, kept: [paths], conflicts: [paths],
//                   collisions: { sections, items }, categories: capTaskCategories() }
// The comparisons leave out meta fields, per-device fields and map key order.
export function mergeProfiles(opts = {}) {
  return withHashCache(() => mergeInner(opts));
}

function mergeInner({ base = null, local = null, cloud = null, mode, prefer = 'local', isDefault } = {}) {
  const L = toObject(local), C = toObject(cloud);
  let B = base == null ? null : toObject(base);
  let m = MERGE_MODES.includes(mode) ? mode : (B ? 'trusted' : 'union');
  if ((m === 'trusted' || m === 'guarded') && !B) m = 'union';
  if (m !== 'trusted' && m !== 'guarded') B = null;
  const stats = {
    mode: m, fromCloud: 0, fromLocal: 0, kept: [], conflicts: [],
    collisions: { sections: 0, items: 0 },
    categories: { dropped: [], combined: [], overflow: [], overCap: false, reslotted: [] },
  };

  const lv0 = toView(L);
  const lf0 = fp(TOP, lv0);
  const cf = fp(TOP, toView(C));

  if (m === 'replace') {
    const merged = stripMeta(L);
    if (isObj(L.timeTracking) && isObj(C.timeTracking)) merged.timeTracking = mergeTimeLogs(L.timeTracking, C.timeTracking);
    const mh = h(fp(TOP, toView(merged)));
    return { merged, mode: m, localChanged: mh !== h(lf0), cloudChanged: mh !== h(cf), stats };
  }

  const bf = B ? fp(TOP, toView(B)) : null;
  stats.collisions = separateCollisions(L, C, B);
  const changedKeys = stats.collisions.sections + stats.collisions.items > 0;
  const lv = changedKeys ? toView(L) : lv0;
  const lf = changedKeys ? fp(TOP, lv) : lf0;
  const cv = toView(C);

  const ctx = {
    mode: m, trusted: m === 'trusted', prefer: prefer === 'cloud' ? 'cloud' : 'local', byNewer: false,
    isDefault: typeof isDefault === 'function' ? isDefault : isDefaultValue, st: stats,
  };
  const mv = mNode(TOP, bf, lf, cf, lv, cv, ctx, '$');
  const merged = fromView(isObj(mv) ? mv : {});

  settleDeviceLayout(merged, L, C);
  settleHeaderGroups(merged, L, C);
  if (Number.isFinite(L.schemaVersion) || Number.isFinite(C.schemaVersion)) {
    merged.schemaVersion = Math.max(Number(L.schemaVersion) || 0, Number(C.schemaVersion) || 0);
  }
  stats.categories = capTaskCategories(merged, { base: B, local: L, cloud: C });

  const mh = h(fp(TOP, toView(merged)));
  return { merged, mode: m, localChanged: mh !== h(lf0), cloudChanged: mh !== h(cf), stats };
}
