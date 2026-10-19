// Personal Dashboard - Sync stamps (pure rules, Node-testable)
// Every saveModel() payload carries a stamp `_sync: { device, at }` (who saved
// this copy, and when; never in the model, never in exports). Every upload's
// stamp also names the version it creates and the versions it descends from
// (makeUploadStamp below), so a sync can tell whether the cloud copy descends
// from its base (sync.js cloudSync, profile-merge.js). Nothing here decides to
// pull or to keep one device's copy over another's any more: every sync merges.
// Storage key (per browser): pd_device_id.
// Every storage access is try/catch (private mode, quota, Node).

const DEVICE_KEY = 'pd_device_id';

let memoryDeviceId = null;   // used when storage is unavailable (stable for this page)

function defaultStorage() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

function newDeviceId() {
  const rand = Math.random().toString(36).slice(2, 10);
  return 'd-' + Date.now().toString(36) + '-' + rand;
}

// This browser's id (created on first use)
export function getDeviceId(storage = defaultStorage()) {
  try {
    const stored = storage && storage.getItem(DEVICE_KEY);
    if (stored) return stored;
  } catch { /* storage blocked: fall through to the in-memory id */ }
  if (!memoryDeviceId) memoryDeviceId = newDeviceId();
  try { if (storage) storage.setItem(DEVICE_KEY, memoryDeviceId); } catch { /* keep the in-memory id */ }
  return memoryDeviceId;
}

export function makeSyncStamp(now = Date.now(), storage = defaultStorage()) {
  return { device: getDeviceId(storage), at: now };
}

function isStamp(s) {
  return !!s && typeof s === 'object' && typeof s.device === 'string' && s.device !== '' && Number.isFinite(s.at);
}

export function sameStamp(a, b) {
  return isStamp(a) && isStamp(b) && a.device === b.device && a.at === b.at;
}

// --- Version stamps for the change-based merge (profile-merge.js) ---
// Every upload's _sync also names the version it creates (`id`) and the versions it
// descends from (`lineage`: newest first, the last LINEAGE_LIMIT). A stored base
// (sync-base.js) is one such version. The cloud copy descends from the base when the
// Worker's rev / chain say so, else when the base's id is the cloud's id or in its
// lineage (an older Worker without rev). An older stamp ({ device, at }, no id) is the
// version 'legacy:<device>@<at>'; a copy without a stamp has no known version.
//   upload stamp: { device, at, id, lineage: [parentId, baseId?, ...parent's lineage] }
export const LINEAGE_LIMIT = 50;

function randomPart(n = 8) {
  try {
    const c = globalThis.crypto;
    if (c && typeof c.getRandomValues === 'function') {
      const bytes = c.getRandomValues(new Uint8Array(n));
      return Array.from(bytes, b => (b % 36).toString(36)).join('');
    }
  } catch { /* fall back to Math.random */ }
  let s = '';
  while (s.length < n) s += Math.random().toString(36).slice(2);
  return s.slice(0, n);
}

// The version a stamp names (null: none known)
export function stampId(stamp) {
  if (stamp && typeof stamp === 'object' && typeof stamp.id === 'string' && stamp.id) return stamp.id;
  return isStamp(stamp) ? `legacy:${stamp.device}@${stamp.at}` : null;
}

// The versions a stamp descends from, newest first (never its own id)
export function stampLineage(stamp) {
  if (!stamp || typeof stamp !== 'object' || !Array.isArray(stamp.lineage)) return [];
  return stamp.lineage.filter(id => typeof id === 'string' && id).slice(0, LINEAGE_LIMIT);
}

// The version a profile (cloud copy, stored copy) holds, from its _sync stamp
export function versionIdOf(profile) {
  return profile && typeof profile === 'object' ? stampId(profile._sync) : null;
}

export function newVersionId(now = Date.now(), storage = defaultStorage()) {
  return `v-${getDeviceId(storage)}-${Number(now).toString(36)}-${randomPart(6)}`;
}

// The stamp for an upload of a merge made against `parent` (the cloud copy's stamp,
// or null when the cloud had none) and the base `baseId` (null in union mode). The
// merge holds every change of both, so both are its ancestors. parentId: the version
// id the cloud copy is known by when its stamp names none (sync.js cloudVersionOf: a
// content hash), so a device whose base is that copy still finds it in the lineage
export function makeUploadStamp({ parent = null, parentId = null, baseId = null, now = Date.now(), storage = defaultStorage() } = {}) {
  const lineage = [];
  const add = (id) => { if (typeof id === 'string' && id && !lineage.includes(id)) lineage.push(id); };
  add(stampId(parent));
  add(parentId);
  add(baseId);
  stampLineage(parent).forEach(add);
  return { device: getDeviceId(storage), at: now, id: newVersionId(now, storage), lineage: lineage.slice(0, LINEAGE_LIMIT) };
}

const isRev = (r) => Number.isInteger(r) && r >= 0;
const sameChain = (a, b) => (typeof a === 'string' ? a : '') === (typeof b === 'string' ? b : '');

// rev / chain are a hint, never the identity of a version: after a D1 restore (Time
// Travel, a profile_history row copied back) or a Worker rollback and redeploy, the
// same rev on the same chain comes back for other content. The stamp's id decides
// whenever the cloud copy names one

// The cloud copy IS the base version: nothing changed in the cloud since (fast path)
// cloud: the cloud profile (its _sync), base: { id, rev, chain } (a sync-base record),
// rev / chain: what the Worker returned with the cloud copy (absent on an older Worker)
export function isSameVersion(cloud, base, { rev, chain } = {}) {
  if (!base) return false;
  const id = versionIdOf(cloud);
  if (isRev(rev) && isRev(base.rev)) return rev === base.rev && sameChain(chain, base.chain) && (!id || id === base.id);
  return !!id && id === base.id;
}

// The cloud copy descends from the base: what the base has and the cloud lacks was
// deleted on purpose somewhere ('trusted' merge). Otherwise an older client, a race or
// a restore wrote it ('guarded': nothing missing from it is deleted). The stamps say
// so (the cloud's id is the base's, or its lineage names it); the Worker's rev / chain
// only when the stamps can't tell: a cloud copy without a stamp, or a lineage too long
// to still name the base (it fell out of the last LINEAGE_LIMIT versions)
export function cloudDescendsFrom(cloud, base, { rev, chain } = {}) {
  if (!base) return false;
  const stamp = cloud && typeof cloud === 'object' ? cloud._sync : null;
  const id = stampId(stamp);
  const lineage = stampLineage(stamp);
  if (id && base.id && (id === base.id || lineage.includes(base.id))) return true;
  const revSays = isRev(rev) && isRev(base.rev) && sameChain(chain, base.chain) && rev >= base.rev;
  return revSays && (!id || lineage.length >= LINEAGE_LIMIT);
}

// The profile-merge.js mode for a sync: no base -> 'union'
export function mergeModeFor(base, cloud, { rev, chain } = {}) {
  if (!base) return 'union';
  return cloudDescendsFrom(cloud, base, { rev, chain }) ? 'trusted' : 'guarded';
}
