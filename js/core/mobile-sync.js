// Personal Dashboard - Sync stamps (pure rules, Node-testable)
// The profile is uploaded whole (last write wins). To let a phone notice that
// another device saved since it last looked, every saveModel() payload carries
// a stamp `_sync: { device, at }` (never in the model, never in exports).
//   - restoreModel() records a FOREIGN stamp as "seen": that copy came from
//     the cloud, so this browser already has it.
//   - Before a phone uploads, decideSync() compares the cloud stamp with this
//     device and the seen stamp. A foreign stamp it has not seen means another
//     device saved in between: pull it when clean, ask when both changed.
// Storage keys (per browser): pd_device_id, pd_sync_seen:<storageKey>.
// Every storage access is try/catch (private mode, quota, Node).

const DEVICE_KEY = 'pd_device_id';
const SEEN_PREFIX = 'pd_sync_seen:';

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

// What a device should do about the cloud copy:
//   'idle'     nothing to send, nothing new remotely
//   'push'     upload (no foreign change in between)
//   'pull'     adopt the cloud copy (another device saved; nothing local)
//   'conflict' both changed: ask the user
export function decideSync({ dirty = false, remote = null, me = null, seen = null } = {}) {
  const foreignUnseen = isStamp(remote) && remote.device !== me && !sameStamp(remote, seen);
  if (!foreignUnseen) return dirty ? 'push' : 'idle';
  return dirty ? 'conflict' : 'pull';
}

export function readSeen(storageKey, storage = defaultStorage()) {
  try {
    const raw = storage && storage.getItem(SEEN_PREFIX + storageKey);
    const parsed = raw ? JSON.parse(raw) : null;
    return isStamp(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeSeen(storageKey, stamp, storage = defaultStorage()) {
  if (!isStamp(stamp)) return false;
  try {
    if (!storage) return false;
    storage.setItem(SEEN_PREFIX + storageKey, JSON.stringify({ device: stamp.device, at: stamp.at }));
    return true;
  } catch {
    return false;
  }
}

// Called by restoreModel() with the stamp of the profile it just read: a stamp
// from another device means that copy came from the cloud (already seen here)
export function noteRestoredStamp(stamp, storageKey, storage = defaultStorage()) {
  if (!isStamp(stamp) || stamp.device === getDeviceId(storage)) return false;
  return writeSeen(storageKey, stamp, storage);
}
