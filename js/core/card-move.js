// Personal Dashboard - Card item moves (pure: no DOM, Node-testable)
// Moving a card item (icon, reminder, subtask, copy-paste) to another section of its
// own card or to another card, and the list of places it can go (the edit popover's
// Move list on a computer, the item sheet's "Move to…" on a phone).
// Everything that points at the item keeps pointing at it: linked tasks (active and
// completed), its Quick Access entry and, for a subtask, its notes (subtaskNotes are
// keyed "sectionId:subtitle:key"). Item keys are kept unique per type across the whole
// card: a move into a section whose key is taken gives the moved item a new key.

export const ITEM_TYPES = ['icons', 'reminders', 'subtasks', 'copyPaste'];
const REF_TYPES = { icons: 'icon', reminders: 'reminder', subtasks: 'subtask', copyPaste: 'copyPaste' };
const KEY_PREFIX = { icons: 'icon', reminders: 'reminder', subtasks: 'subtask', copyPaste: 'copy' };

const isGroup = (g) => !!g && typeof g === 'object' && !Array.isArray(g);
export const emptyGroup = () => ({ icons: [], reminders: [], subtasks: [], copyPaste: [] });
export const subtaskNoteId = (sectionId, subtitle, key) => `${sectionId}:${subtitle}:${key}`;

// --- Keys of one item type across a card (optionally skipping one section, or one item)
export function cardItemKeys(cardData, itemType, { skipSubtitle, skipItem } = {}) {
  const keys = new Set();
  if (!isGroup(cardData)) return keys;
  Object.entries(cardData).forEach(([subtitle, group]) => {
    if (subtitle === skipSubtitle || !isGroup(group) || !Array.isArray(group[itemType])) return;
    group[itemType].forEach(item => { if (item && item !== skipItem && item.key) keys.add(item.key); });
  });
  return keys;
}

// --- A key free in `taken`: the key itself, else "<prefix>_<n>" with the lowest free n
export function freeKey(key, taken, itemType) {
  if (key && !taken.has(key)) return key;
  const prefix = String(key || '').replace(/_\d+$/, '') || KEY_PREFIX[itemType] || 'item';
  let n = 1;
  while (taken.has(`${prefix}_${n}`)) n++;
  return `${prefix}_${n}`;
}

// --- Every item of a card as one array per type (key generation for new items)
export function cardItemsOfType(cardData, itemType) {
  if (!isGroup(cardData)) return [];
  return Object.values(cardData).flatMap(g => (isGroup(g) && Array.isArray(g[itemType]) ? g[itemType] : []));
}

// --- Notes of one subtask moved from one id to another inside a subtaskNotes bucket.
// Never overwrites: notes already under the new id stay and the moved ones follow them.
// Returns what revertNoteMove needs, or null when there was nothing to move.
export function moveNotes(bucket, fromId, toId) {
  if (!bucket || fromId === toId || !Array.isArray(bucket[fromId])) return null;
  const moved = bucket[fromId];
  const prevTarget = Array.isArray(bucket[toId]) ? bucket[toId] : null;
  bucket[toId] = prevTarget ? [...prevTarget, ...moved] : moved;
  delete bucket[fromId];
  return { fromId, toId, moved, prevTarget };
}

export function revertNoteMove(bucket, rec) {
  if (!bucket || !rec) return;
  const now = Array.isArray(bucket[rec.toId]) ? bucket[rec.toId] : [];
  // Notes the target already had stay; the rest (incl. notes written since) go back
  const stayed = rec.prevTarget ? now.filter(n => rec.prevTarget.includes(n)) : [];
  const back = now.filter(n => !stayed.includes(n));
  if (back.length) bucket[rec.fromId] = back;
  if (stayed.length) bucket[rec.toId] = stayed;
  else delete bucket[rec.toId];
}

// --- Point everything at an item that moved (and maybe got a new key).
// from / to: { sectionId, subtitle, key }. Returns the note move (or null).
export function relocateItemRefs(data, itemType, from, to) {
  if (!data || !from || !to || !from.key) return null;
  if (from.sectionId === to.sectionId && from.subtitle === to.subtitle && from.key === to.key) return null;
  const refType = REF_TYPES[itemType];
  const moveRef = (ref) => {
    if (ref && typeof ref === 'object' && ref.type === refType && ref.key === from.key &&
        ref.sectionId === from.sectionId && (ref.subtitle === undefined || ref.subtitle === from.subtitle)) {
      ref.sectionId = to.sectionId;
      ref.subtitle = to.subtitle;
      ref.key = to.key;
    }
  };
  [...(Array.isArray(data.tasks) ? data.tasks : []), ...(Array.isArray(data.completedTasks) ? data.completedTasks : [])].forEach(task => {
    if (!task) return;
    if (Array.isArray(task.linkedItems)) task.linkedItems.forEach(moveRef);
    moveRef(task.linkedItem);
  });

  const qa = data.quickAccessItems;
  if (qa && typeof qa === 'object') {
    const matches = (entry) => entry && entry.name === from.key && entry.sectionType === from.sectionId && entry.subtitle === from.subtitle;
    const point = (entry) => { entry.sectionType = to.sectionId; entry.subtitle = to.subtitle; entry.name = to.key; };
    if (itemType === 'icons') (Array.isArray(qa.icons) ? qa.icons : []).forEach(e => { if (matches(e)) point(e); });
    else {
      // listItems hold reminders, subtasks and copy-paste: the same kind rule as getQuickAccessItems
      const kindOf = (e) => (e.copyText !== undefined && e.type !== 'list' && e.type !== 'reminder')
        ? 'copyPaste' : (e.type === 'reminder' ? 'reminders' : 'subtasks');
      (Array.isArray(qa.listItems) ? qa.listItems : []).forEach(e => { if (matches(e) && kindOf(e) === itemType) point(e); });
    }
  }

  if (itemType === 'subtasks' && data.subtaskNotes && typeof data.subtaskNotes === 'object') {
    return moveNotes(data.subtaskNotes,
      subtaskNoteId(from.sectionId, from.subtitle, from.key),
      subtaskNoteId(to.sectionId, to.subtitle, to.key));
  }
  return null;
}

// --- Move one item. src: { sectionId, subtitle, itemType, key }; dst: { sectionId, subtitle,
// index?, key? } (index = position in the target list, default the end; key = the key to
// prefer, e.g. the old one on Undo). Returns { item, from, to, noteMove } or { error }.
export function moveCardItem(data, src, dst) {
  if (!data || !src || !dst) return { error: 'Nothing to move' };
  if (!ITEM_TYPES.includes(src.itemType)) return { error: 'This item can’t be moved' };
  const group = isGroup(data[src.sectionId]) ? data[src.sectionId][src.subtitle] : null;
  const list = isGroup(group) && Array.isArray(group[src.itemType]) ? group[src.itemType] : null;
  if (!list) return { error: 'Source not found' };
  const index = list.findIndex(i => i && i.key === src.key);
  if (index === -1) return { error: 'Item not found' };
  if (src.sectionId === dst.sectionId && src.subtitle === dst.subtitle) return { error: 'It is already there' };
  if (!isGroup(data[dst.sectionId])) return { error: 'That card no longer exists' };

  const [item] = list.splice(index, 1);
  const card = data[dst.sectionId];
  if (!isGroup(card[dst.subtitle])) card[dst.subtitle] = emptyGroup();
  const target = card[dst.subtitle];
  if (!Array.isArray(target[src.itemType])) target[src.itemType] = [];
  const taken = cardItemKeys(card, src.itemType, { skipItem: item });
  // A subtask never lands on notes it doesn't own (older builds kept the notes of a
  // subtask deleted in edit mode): a key whose note id there already holds notes is
  // taken too. Not on Undo (dst.key): it goes back to its own key and its own notes
  if (src.itemType === 'subtasks' && !dst.key && isGroup(data.subtaskNotes)) {
    const prefix = subtaskNoteId(dst.sectionId, dst.subtitle, '');
    Object.entries(data.subtaskNotes).forEach(([id, notes]) => {
      if (id.startsWith(prefix) && Array.isArray(notes) && notes.length) taken.add(id.slice(prefix.length));
    });
  }
  const key = freeKey(dst.key || item.key, taken, src.itemType);
  item.key = key;
  const at = Number.isInteger(dst.index) ? Math.max(0, Math.min(dst.index, target[src.itemType].length)) : target[src.itemType].length;
  target[src.itemType].splice(at, 0, item);

  const from = { sectionId: src.sectionId, subtitle: src.subtitle, key: src.key, index };
  const to = { sectionId: dst.sectionId, subtitle: dst.subtitle, key, index: at };
  const noteMove = relocateItemRefs(data, src.itemType, from, to);
  return { item, itemType: src.itemType, from, to, noteMove };
}

// --- A whole section that now sits under `to` (renamed, or moved to another card):
// re-key items whose key another section of the card already uses, then point
// everything at them. Returns the note moves made.
export function relocateSectionRefs(data, from, to) {
  const card = data && isGroup(data[to.sectionId]) ? data[to.sectionId] : null;
  const group = card && isGroup(card[to.subtitle]) ? card[to.subtitle] : null;
  if (!group) return [];
  const noteMoves = [];
  ITEM_TYPES.forEach(itemType => {
    const items = Array.isArray(group[itemType]) ? group[itemType] : [];
    const taken = cardItemKeys(card, itemType, { skipSubtitle: to.subtitle });
    items.forEach(item => {
      if (!item || !item.key) return;
      const oldKey = item.key;
      const key = freeKey(oldKey, taken, itemType);
      taken.add(key);
      item.key = key;
      const rec = relocateItemRefs(data, itemType,
        { sectionId: from.sectionId, subtitle: from.subtitle, key: oldKey },
        { sectionId: to.sectionId, subtitle: to.subtitle, key });
      if (rec) noteMoves.push(rec);
    });
  });
  return noteMoves;
}

// --- A card's sections with one renamed, keeping their order (a fresh object)
export function renameSection(cardData, from, to) {
  const out = {};
  Object.keys(cardData).forEach(k => { out[k === from ? to : k] = cardData[k]; });
  return out;
}

// --- Where an item (or a whole section) can move: rows for a list.
// Item moves: the item's own card first (its OTHER sections), then every other card;
// a card with named sections is a header with its sections beneath it ("Top of card"
// = the unnamed top part); a card without named sections is one row (its top).
// Section moves (isSubtitle): the other cards, one row each.
// Rows: { kind: 'header', sectionId, label, isSource }
//     | { kind: 'section', sectionId, subtitle, label, cardLabel, isTop }
//     | { kind: 'card', sectionId, subtitle: '_default', label }
export function buildMoveTargets(data, sections, ctx) {
  const cards = (Array.isArray(sections) ? sections : []).filter(s => s && s.type === 'unified');
  const name = (s) => s.title || 'Untitled card';
  const rows = [];
  if (ctx.isSubtitle) {
    cards.forEach(s => { if (s.id !== ctx.sectionId) rows.push({ kind: 'card', sectionId: s.id, subtitle: '_default', label: name(s) }); });
    return rows;
  }
  const ordered = [...cards.filter(s => s.id === ctx.sectionId), ...cards.filter(s => s.id !== ctx.sectionId)];
  ordered.forEach(s => {
    const isSource = s.id === ctx.sectionId;
    const named = Object.keys(isGroup(data && data[s.id]) ? data[s.id] : {}).filter(k => k !== '_default');
    const targets = [];
    if (!isSource || ctx.subtitle !== '_default') targets.push('_default');
    named.forEach(k => { if (!(isSource && k === ctx.subtitle)) targets.push(k); });
    if (!targets.length) return;
    if (!named.length && !isSource) {
      rows.push({ kind: 'card', sectionId: s.id, subtitle: '_default', label: name(s) });
      return;
    }
    rows.push({ kind: 'header', sectionId: s.id, label: name(s), isSource });
    targets.forEach(k => rows.push({
      kind: 'section', sectionId: s.id, subtitle: k, cardLabel: name(s),
      label: k === '_default' ? 'Top of card' : k, isTop: k === '_default'
    }));
  });
  return rows;
}

// --- Toast text for a finished move
export function moveToastText(result, sections) {
  const card = (Array.isArray(sections) ? sections : []).find(s => s && s.id === result.to.sectionId);
  const other = result.to.sectionId !== result.from.sectionId ? ((card && card.title) || 'another card') : null;
  if (result.to.subtitle === '_default') return other ? `Moved to ${other}` : 'Moved to the top of the card';
  return `Moved to “${result.to.subtitle}”${other ? ` in ${other}` : ''}`;
}
