// Personal Dashboard - Storage Module
// Handles saving and restoring the model to/from localStorage

import { PLACEHOLDER_URL, APP_VERSION, STORAGE_KEY } from '../constants.js';
import { model, editState, currentData, normalizeTaskCategories, resetModel } from '../state.js';
import { showToast } from '../utils.js';
import { revertNoteMove } from './card-move.js';
import {
  getActiveStorageKey, markCloudDirty, noteStoredCopy, storedCopyChangedElsewhere, storedCopyIfChangedElsewhere,
  getStoredBase, noteStoredBase, isReplacePending, noteReplacePending, setModelApplier, isApplyBlocked, noteAdoptedCopy
} from './sync.js';
import { normalizeTimeLog } from './time-log.js';
import { sanitizeStoredHtml } from './markdown.js';
import { makeSyncStamp } from './mobile-sync.js';
import { profileHash, mergeProfiles } from './profile-merge.js';
import { migrateToGrid24, migrateToDeviceLayouts, hydrateLayout, persistActiveLayout, getActiveMode, DEFAULT_COL_SPAN, DEFAULT_ROW_SPAN } from '../features/grid-engine.js';

// --- Migrate legacy card types to unified card structure (schemaVersion 3)
// This converts:
//   - newCard (icon-only) → unified with icons in _default
//   - newCardAnalytics (subtask-only) → unified with subtasks in _default
//   - copyPaste (subtitle-grouped) → unified preserving subtitles
//   - reminders (subtitle-grouped) → unified preserving subtitles with reminders
export function migrateToUnifiedCards(data) {
  // Skip if already at latest version
  if (data.schemaVersion >= 3) {
    return data;
  }

  // Helper to migrate a section's data
  const migrateSectionData = (sectionId, sectionType, sectionData) => {
    if (!sectionData) return null;

    switch (sectionType) {
      case 'newCard':
        // Icon-only card: array of {key, icon, url, title, isDivider?}
        // → { "_default": { icons: [...], reminders: [], subtasks: [], copyPaste: [] }}
        if (Array.isArray(sectionData)) {
          return {
            "_default": {
              icons: sectionData.map(item => {
                const icon = {
                  key: item.key,
                  icon: item.icon
                };
                // Preserve separators (isDivider)
                if (item.isDivider) {
                  icon.isDivider = true;
                } else {
                  icon.url = item.url;
                  icon.title = item.title || '';
                }
                return icon;
              }),
              reminders: [],
              subtasks: [],
              copyPaste: []
            }
          };
        }
        return null;

      case 'newCardAnalytics':
        // Subtask-only card: array of {key, text, url, links?}
        // → { "_default": { icons: [], reminders: [], subtasks: [...], copyPaste: [] }}
        if (Array.isArray(sectionData)) {
          return {
            "_default": {
              icons: [],
              reminders: [],
              subtasks: sectionData.map(item => ({
                key: item.key,
                text: item.text,
                url: item.url,
                links: item.links || null
              })),
              copyPaste: []
            }
          };
        }
        return null;

      case 'copyPaste':
        // Copy-paste card: { "Subtitle": [{key, text, copyText}], ... }
        // → { "Subtitle": { icons: [], reminders: [], subtasks: [], copyPaste: [...] }, ... }
        if (typeof sectionData === 'object' && !Array.isArray(sectionData)) {
          const migrated = {};
          Object.entries(sectionData).forEach(([subtitle, items]) => {
            if (Array.isArray(items)) {
              migrated[subtitle] = {
                icons: [],
                reminders: [],
                subtasks: [],
                copyPaste: items.map(item => ({
                  key: item.key,
                  text: item.text,
                  copyText: item.copyText || ''
                }))
              };
            }
          });
          return migrated;
        }
        return null;

      case 'reminders':
        // Reminders card: { "Subtitle": [{key, title, url, type, schedule?, ...}], ... }
        // → { "Subtitle": { icons: [], reminders: [...], subtasks: [], copyPaste: [] }, ... }
        if (typeof sectionData === 'object' && !Array.isArray(sectionData)) {
          const migrated = {};
          Object.entries(sectionData).forEach(([subtitle, items]) => {
            if (Array.isArray(items)) {
              migrated[subtitle] = {
                icons: [],
                reminders: items.map(item => ({ ...item })), // Keep all reminder properties
                subtasks: [],
                copyPaste: []
              };
            }
          });
          return migrated;
        }
        return null;

      // Icon-based cards (dailyTasks, dailyTools, contentCreation, ads)
      case 'dailyTasks':
      case 'dailyTools':
      case 'contentCreation':
      case 'ads':
        // Icon array: [{key, icon, url, title?, isDivider?}]
        // → { "_default": { icons: [...], reminders: [], subtasks: [], copyPaste: [] }}
        if (Array.isArray(sectionData)) {
          return {
            "_default": {
              icons: sectionData.map(item => {
                const icon = {
                  key: item.key,
                  icon: item.icon
                };
                // Preserve separators (isDivider)
                if (item.isDivider) {
                  icon.isDivider = true;
                } else {
                  icon.url = item.url;
                  icon.title = item.title || '';
                }
                return icon;
              }),
              reminders: [],
              subtasks: [],
              copyPaste: []
            }
          };
        }
        return null;

      // List-based cards (analytics, tools)
      case 'analytics':
      case 'tools':
        // List array: [{key, text, url, links?}]
        // → { "_default": { icons: [], reminders: [], subtasks: [...], copyPaste: [] }}
        if (Array.isArray(sectionData)) {
          return {
            "_default": {
              icons: [],
              reminders: [],
              subtasks: sectionData.map(item => ({
                key: item.key,
                text: item.text || item.title || item.key,
                url: item.url,
                links: item.links || null
              })),
              copyPaste: []
            }
          };
        }
        return null;

      default:
        return null;
    }
  };

  // ALL legacy card types that should become unified
  const legacyTypes = [
    'newCard', 'newCardAnalytics', 'copyPaste', 'reminders',
    'dailyTasks', 'dailyTools', 'contentCreation', 'ads',
    'analytics', 'tools'
  ];

  // Process sections array (normal mode)
  if (Array.isArray(data.sections)) {
    data.sections.forEach(section => {
      if (legacyTypes.includes(section.type)) {
        // Migrate the section data
        const migratedData = migrateSectionData(section.id, section.type, data[section.id]);
        if (migratedData) {
          data[section.id] = migratedData;
        }
        // Update section type to 'unified'
        section.type = 'unified';
      }
    });
  }

  // Process sectionsStacked array (legacy stacked mode) if it exists
  if (Array.isArray(data.sectionsStacked)) {
    data.sectionsStacked.forEach(section => {
      if (legacyTypes.includes(section.type)) {
        // Data already migrated above if section.id matches
        // Just update section type to 'unified'
        section.type = 'unified';
      }
    });
  }

  // Upgrade existing unified cards from schemaVersion 2 to 3 (add reminders array)
  if (data.schemaVersion === 2) {
    if (Array.isArray(data.sections)) {
      data.sections.forEach(section => {
        if (section.type === 'unified' && data[section.id]) {
          Object.values(data[section.id]).forEach(subtitleData => {
            if (subtitleData && !subtitleData.reminders) {
              subtitleData.reminders = [];
            }
          });
        }
      });
    }
  }

  // Set schema version
  data.schemaVersion = 3;

  return data;
}

// --- Migrate twoColumnPair/pairIndex to halfWidth (schemaVersion 4)
export function migrateToHalfWidthCards(data) {
  if (data.schemaVersion >= 4) return data;

  // Handle old format where data is in _structure
  if (data._structure) {
    // Move sections from _structure to root
    if (data._structure.sections && !data.sections) {
      data.sections = data._structure.sections;
    }
    if (data._structure.sectionsStacked && !data.sectionsStacked) {
      data.sectionsStacked = data._structure.sectionsStacked;
    }
    if (data._structure.sectionTitles && !data.sectionTitles) {
      data.sectionTitles = data._structure.sectionTitles;
    }
    if (data._structure.sectionIcons && !data.sectionIcons) {
      data.sectionIcons = data._structure.sectionIcons;
    }
    if (data._structure.sectionColors && !data.sectionColors) {
      data.sectionColors = data._structure.sectionColors;
    }
    if (data._structure.subtitleColors && !data.subtitleColors) {
      data.subtitleColors = data._structure.subtitleColors;
    }
    if (data._structure.collapsedSubtitles && !data.collapsedSubtitles) {
      data.collapsedSubtitles = data._structure.collapsedSubtitles;
    }
    if (data._structure.collapsedCards && !data.collapsedCards) {
      data.collapsedCards = data._structure.collapsedCards;
    }
    if (data._structure.cardNotes && !data.cardNotes) {
      data.cardNotes = data._structure.cardNotes;
    }
    if (data._structure.header && !data.header) {
      data.header = data._structure.header;
    }
    // Clean up _structure
    delete data._structure;
  }

  const migrateArray = (sections) => {
    if (!Array.isArray(sections)) return;
    sections.forEach(section => {
      if (section.twoColumnPair) {
        section.halfWidth = true;
        delete section.twoColumnPair;
        delete section.pairIndex;
      }
    });
  };

  migrateArray(data.sections);
  migrateArray(data.sectionsStacked);
  data.schemaVersion = 4;
  return data;
}

// --- Migrate embedded tasks to centralized Eisenhower Matrix (schemaVersion 5)
// Converts tasks from embedded arrays in reminders/subtasks to central model.tasks array
// Also converts 3-color system (red/yellow/green) to 4-color (red/orange/yellow/blue)
export function migrateToEisenhowerTasks(data) {
  if (data.schemaVersion >= 5) return data;

  // Initialize central tasks array
  data.tasks = data.tasks || [];

  // Helper to generate unique task ID
  const generateTaskId = () => 'task-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);

  // Color migration: green -> blue (Not Urgent & Not Important)
  const migrateColor = (oldColor) => {
    if (oldColor === 'green') return 'blue';
    return oldColor; // red and yellow stay the same
  };

  // Process all sections
  const processSection = (section) => {
    const cardData = data[section.id];
    if (!cardData || typeof cardData !== 'object') return;

    Object.entries(cardData).forEach(([subtitle, subtitleData]) => {
      if (!subtitleData) return;

      // Migrate reminder tasks
      if (subtitleData.reminders && Array.isArray(subtitleData.reminders)) {
        subtitleData.reminders.forEach(reminder => {
          if (reminder.tasks && Array.isArray(reminder.tasks) && reminder.tasks.length > 0) {
            reminder.taskIds = [];
            reminder.tasks.forEach((task, index) => {
              const taskId = generateTaskId();
              data.tasks.push({
                id: taskId,
                title: task.title || '',
                color: migrateColor(task.color || 'blue'),
                linkedItem: {
                  type: 'reminder',
                  key: reminder.key,
                  sectionId: section.id,
                  subtitle: subtitle
                },
                order: data.tasks.length
              });
              reminder.taskIds.push(taskId);
            });
            delete reminder.tasks; // Remove embedded tasks
          }
        });
      }

      // Migrate subtask tasks
      if (subtitleData.subtasks && Array.isArray(subtitleData.subtasks)) {
        subtitleData.subtasks.forEach(subtask => {
          if (subtask.tasks && Array.isArray(subtask.tasks) && subtask.tasks.length > 0) {
            subtask.taskIds = [];
            subtask.tasks.forEach((task, index) => {
              const taskId = generateTaskId();
              data.tasks.push({
                id: taskId,
                title: task.title || '',
                color: migrateColor(task.color || 'blue'),
                linkedItem: {
                  type: 'subtask',
                  key: subtask.key,
                  sectionId: section.id,
                  subtitle: subtitle
                },
                order: data.tasks.length
              });
              subtask.taskIds.push(taskId);
            });
            delete subtask.tasks; // Remove embedded tasks
          }
        });
      }

      // Icons don't have tasks in old system, but initialize taskIds for consistency
      if (subtitleData.icons && Array.isArray(subtitleData.icons)) {
        subtitleData.icons.forEach(icon => {
          if (!icon.taskIds) {
            icon.taskIds = [];
          }
        });
      }
    });
  };

  // Process sections array
  if (Array.isArray(data.sections)) {
    data.sections.forEach(processSection);
  }

  // Process sectionsStacked (data already migrated via section.id reference)
  // No need to process again since data is shared by section.id

  // Remove old tasksSummaryOrder (will be replaced by per-color ordering)
  delete data.tasksSummaryOrder;

  data.schemaVersion = 5;
  return data;
}

// --- Migrate to grid layout (schemaVersion 6)
// Converts halfWidth boolean to gridSpan number, removes stacked mode
export function migrateToGridLayout(data) {
  if (data.schemaVersion >= 6) return data;

  const migrateArray = (sections) => {
    if (!Array.isArray(sections)) return;
    sections.forEach(section => {
      const span = section.halfWidth ? 6 : 12;
      section.gridSpan = span;
      section.gridColSpan = span;
      delete section.halfWidth;
    });
  };

  // If user was in stacked mode, use that ordering
  if (data.displayMode === 'stacked' && Array.isArray(data.sectionsStacked) && data.sectionsStacked.length > 0) {
    migrateArray(data.sectionsStacked);
    data.sections = data.sectionsStacked;
  } else {
    migrateArray(data.sections);
  }

  delete data.sectionsStacked;
  delete data.displayMode;
  data.schemaVersion = 6;
  return data;
}

// migrateToGrid24 lives in grid-engine.js (single authoritative version, imported above)

// --- Clean up old backup entries to prevent localStorage quota issues
export function cleanupOldBackups() {
  const keys = Object.keys(localStorage);
  const backupKeys = keys.filter(key => key.includes('__backup__'));

  if (backupKeys.length > 0) {
    backupKeys.forEach(key => localStorage.removeItem(key));
  }
}

// --- Rich text that enters the model (localStorage, a cloud profile, a backup) is later shown with
// innerHTML: anything in it that could run script or cover the page goes through the allowlist
// sanitizer (markdown.js sanitizeStoredHtml); clean fields are left exactly as they are.
// Returns how many fields changed.
export function sanitizeStoredRichText(data) {
  if (!data || typeof data !== 'object') return 0;
  let changed = 0;
  const clean = (obj, key) => {
    if (!obj || typeof obj !== 'object' || typeof obj[key] !== 'string') return;
    const next = sanitizeStoredHtml(obj[key]);
    if (next !== obj[key]) { obj[key] = next; changed++; }
  };
  const each = (list, keys) => {
    if (Array.isArray(list)) list.forEach(item => keys.forEach(key => clean(item, key)));
  };
  each(data.projects, ['content']);
  each(data.meetings, ['description']);
  each(data.ideas, ['description', 'content']);
  [data.tasks, data.completedTasks].forEach(tasks => {
    if (!Array.isArray(tasks)) return;
    tasks.forEach(task => {
      clean(task, 'description');
      if (task && typeof task === 'object') each(task.subtasks, ['description']);
    });
  });
  [data.cardNotes, data.subtaskNotes].forEach(bucket => {
    if (!bucket || typeof bucket !== 'object') return;
    Object.keys(bucket).forEach(id => {
      if (typeof bucket[id] === 'string') clean(bucket, id); // old single-note format
      else each(bucket[id], ['content']);
    });
  });
  return changed;
}

// The saved copy the in-memory model was read from (restoreModel). Saves go
// back to it even while a sign-in or sign-out is still switching accounts (the
// session changes before the new dashboard is read), so the dashboard on
// screen is never written into another account's copy
let _modelStorageKey = null;

// Subtask notes as the stored copy must hold them. A move made in edit mode moves
// its notes on `model` at once (edit-mode.js mirrorNoteMoves) while the item move
// waits in the working copy, so until Confirm the saved copy keeps the notes with
// their items as saved (the moves undone on a copy, newest first): a save made
// meanwhile, then a reload or a closed tab without Confirm or Cancel, orphans none
function committedSubtaskNotes(notes) {
  const moves = editState.enabled ? editState.noteMoves : null;
  if (!Array.isArray(moves) || !moves.length || !notes || typeof notes !== 'object') return notes;
  const copy = { ...notes };
  for (let i = moves.length - 1; i >= 0; i--) revertNoteMove(copy, moves[i]);
  return copy;
}

// (through JSON text: the model holds Date objects where the copy holds their strings)
function sameDashboard(payload, raw) {
  try {
    return profileHash(JSON.stringify(payload)) === profileHash(raw);
  } catch (e) {
    return false;   // a copy that can't be read is written over
  }
}

// The stored copy still asks for its import to replace the cloud copy (another page's
// sync may have done it and cleared the flag since this page noted it)
function storedAsksReplace(key) {
  try {
    const obj = JSON.parse(localStorage.getItem(key));
    return !!obj && typeof obj === 'object' && obj._replace === true;
  } catch (e) {
    return false;
  }
}

// --- Another page of this browser wrote the copy since this page last read or wrote it
// (a tab whose storage event this page skipped while an editor or edit mode was open,
// or one not delivered yet): this page's save is merged into it, never written over
// it, or the other page's unsynced work would be gone from this browser and, at the
// next sync, from the cloud. A trusted 3-way merge (profile-merge.js): base = the copy
// this page last knew (its model descends from it, and so does the copy stored now),
// local = this save, cloud = the copy stored now. The merge keeps this page's meta
// fields (its stamp, and its base: an ancestor of both) and a pending import of the
// stored copy. Returns { json, behind } (behind: the merge holds something this
// page's model doesn't), or null to write the save as it is (the stored copy can't
// be read)
function mergeIntoStoredCopy(storageKey, payload, { known, now }) {
  let stored;
  try { stored = JSON.parse(now); } catch (e) { return null; }
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return null;
  const base = typeof known === 'string' ? known : null;
  let r = null;
  try {
    r = mergeProfiles({ base, local: payload, cloud: stored, mode: base ? 'trusted' : 'union' });
  } catch (e) {
    // The copy this page knew can't be read: keep everything of both
    try { r = mergeProfiles({ local: payload, cloud: stored, mode: 'union' }); } catch (err) { r = null; }
  }
  if (!r || !r.merged) return null;
  const scoped = storageKey !== STORAGE_KEY;
  const out = {
    ...r.merged,
    _sync: payload._sync,
    _base: payload._base,
    _replace: scoped && stored._replace === true ? true : undefined,
  };
  return { json: JSON.stringify(out), behind: !!r.localChanged };
}

// The merge holds another page's changes the model on screen lacks: the model becomes
// the stored copy once nothing holds it (an open editor, edit mode, a gesture: the same
// rule as a sync's merge). Until then every save merges again against the copy this
// page last knew, so nothing of either page is lost meanwhile
const REAPPLY_POLL_MS = 1500;
let _reapplyKey = null;
let _reapplyTimer = null;

function laterTimer(fn, ms) {
  const t = setTimeout(fn, ms);
  if (t && typeof t.unref === 'function') t.unref();   // Node tests: never keeps the process alive
  return t;
}

function scheduleReapply(key) {
  _reapplyKey = key;
  if (_reapplyTimer) return;
  const tick = () => {
    _reapplyTimer = null;
    const key = _reapplyKey;
    if (!key) return;
    // Another dashboard is on screen now (a sign-in or sign-out): it was read whole
    if (key !== (_modelStorageKey || getActiveStorageKey()) || key !== getActiveStorageKey()) { _reapplyKey = null; return; }
    if (isApplyBlocked()) { _reapplyTimer = laterTimer(tick, REAPPLY_POLL_MS); return; }
    _reapplyKey = null;
    noteAdoptedCopy();
    applyStoredCopy({ render: true });
  };
  _reapplyTimer = laterTimer(tick, 0);
}

// Another tab changed the copy while something held this page (its storage listener
// skipped the reload, init.js): the page shows that copy once nothing holds it any more,
// even when it never saves meanwhile (a save merges first, saveModel)
export function applyStoredCopyWhenFree() {
  scheduleReapply(_modelStorageKey || getActiveStorageKey());
}

// --- Save model to localStorage
// opts.unchanged: { raw, stamp } (restoreModel): the copy as it was read and its
// stamp. When the model saves to exactly that text again (its stamp kept), nothing
// is written: a page that only read the copy (a load, another tab's write it
// reloaded) never writes it back, so it can't put an older read over a newer write
export function saveModel(opts = null) {
  // Clean up old backups before saving to prevent quota issues
  cleanupOldBackups();

  // Always save the main model, not the working copy
  const data = model;
  const storageKey = _modelStorageKey || getActiveStorageKey();
  const scoped = storageKey !== STORAGE_KEY;

  const payload = {
    schemaVersion: data.schemaVersion || 8,
    sections: data.sections,
    lastActiveMode: data.lastActiveMode || 'tablet',
    sectionTitles: data.sectionTitles,
    sectionIcons: data.sectionIcons,
    sectionColors: data.sectionColors,
    subtitleColors: data.subtitleColors,
    collapsedSubtitles: data.collapsedSubtitles,
    collapsedCards: data.collapsedCards,
    cardNotes: data.cardNotes,
    subtaskNotes: committedSubtaskNotes(data.subtaskNotes),
    header: data.header,
    darkMode: data.darkMode,
    glassMode: data.glassMode,
    glassTheme: data.glassTheme,
    timers: data.timers,
    timeTrackingExpanded: data.timeTrackingExpanded,
    timeTracking: data.timeTracking,
    taskCategories: data.taskCategories,
    quickAccessExpanded: data.quickAccessExpanded,
    selectorModeActive: data.selectorModeActive,
    quickAccessItems: data.quickAccessItems,
    tasks: data.tasks || [],
    ideas: data.ideas || [],
    meetings: data.meetings || [],
    completedTasks: data.completedTasks || [],
    projects: data.projects || [],
    subtaskTemplates: data.subtaskTemplates || [],
    // Which device saved this copy, and when (payload only: never in the
    // model or an export)
    _sync: makeSyncStamp(),
    // The version this copy descends from (sync.js cloudSync, sync-base.js) and a
    // JSON import still waiting to replace the cloud copy. Payload only; an
    // account's copy only (the signed-out dashboard never syncs)
    _base: scoped ? (getStoredBase(storageKey) || undefined) : undefined,
    _replace: scoped && isReplacePending(storageKey) && storedAsksReplace(storageKey) ? true : undefined,
  };

  // Add ALL sections - all are now unified format
  data.sections.forEach(section => {
    if (data[section.id]) {
      payload[section.id] = data[section.id];
    }
  });

  if (opts && typeof opts.unchanged?.raw === 'string') {
    // A write-back from a read is no new change of this device: it keeps the
    // copy's stamp (a first merge after the update tells the newer copy by it).
    // Same position for the stamp, so the text compares as a whole
    payload._sync = opts.unchanged.stamp;
    // The same text, or the same dashboard in another key order (a copy a sync
    // wrote: profile-merge.js profileHash, this device's own layout fields aside)
    if (JSON.stringify(payload) === opts.unchanged.raw || sameDashboard(payload, opts.unchanged.raw)) {
      noteStoredCopy(storageKey, opts.unchanged.raw);
      announceSave();
      return true;
    }
  }

  let json = null;
  let behind = false;
  const elsewhere = storedCopyIfChangedElsewhere(storageKey);
  if (elsewhere && typeof elsewhere.now === 'string') {
    const merged = mergeIntoStoredCopy(storageKey, payload, elsewhere);
    if (merged) ({ json, behind } = merged);
  }
  if (json === null) json = JSON.stringify(payload);
  try {
    localStorage.setItem(storageKey, json);
  } catch (error) {
    if (error.name === 'QuotaExceededError') {
      try {
        const keys = Object.keys(localStorage);
        const backupKeys = keys.filter(key => key.includes('__backup__'));
        backupKeys.forEach(key => localStorage.removeItem(key));
        localStorage.setItem(storageKey, json);
      } catch (retryError) {
        console.error('Failed to save even after cleanup:', retryError);
        showToast('Error: Unable to save data. Storage quota exceeded.');
        return false;
      }
    } else {
      console.error('Error saving to localStorage:', error);
      showToast('Error: Failed to save data.');
      return false;
    }
  }
  // What this page knows is stored (a page restored from the back/forward cache compares
  // it). Behind (a merge brought in another page's changes): still the copy the model
  // descends from, until the model is the stored copy again
  if (behind) scheduleReapply(storageKey);
  else noteStoredCopy(storageKey, json);

  // Mark cloud sync as needed (skip during initial load / restore)
  if (!window.isInitialLoad) {
    markCloudDirty(storageKey);
  }

  announceSave();
  return true;
}

// The saved copy of the dashboard on screen no longer holds what this page last
// wrote or read there (the device stamp aside): another page of this browser
// changed it while this one was frozen in the back/forward cache (init.js)
export function storedModelChangedElsewhere() {
  return storedCopyChangedElsewhere(_modelStorageKey || getActiveStorageKey());
}

// One change funnel: every persisted write raises a coalesced window event
// 'model:saved' (one per microtask, detail.seq = saves so far). The mobile
// shell re-renders from it. Node-safe (no window, no event).
let _saveSeq = 0;
let _saveEventQueued = false;
function announceSave() {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  _saveSeq++;
  window.__modelSaveSeq = _saveSeq;
  if (_saveEventQueued) return;
  _saveEventQueued = true;
  queueMicrotask(() => {
    _saveEventQueued = false;
    try { window.dispatchEvent(new CustomEvent('model:saved', { detail: { seq: _saveSeq } })); } catch (e) { /* no CustomEvent */ }
  });
}

// --- Restore model from localStorage
// restoreModelNow() is the whole read, synchronous (a sync applies its merge with
// it: storage.js applyStoredCopy); restoreModel() is the same, as a promise
export async function restoreModel() {
  restoreModelNow();
}

export function restoreModelNow() {
  try {
    const storageKey = getActiveStorageKey();
    _modelStorageKey = storageKey;
    _reapplyKey = null;            // the model is the stored copy again
    let raw = localStorage.getItem(storageKey);
    noteStoredCopy(storageKey, raw);
    let saved = raw ? JSON.parse(raw) : null;
    // Read from the copy itself, not this module (another tab may have written it)
    noteStoredBase(storageKey, saved && storageKey !== STORAGE_KEY ? saved._base : null);
    noteReplacePending(storageKey, !!(saved && storageKey !== STORAGE_KEY && saved._replace === true));
    const readBack = raw && saved && typeof saved === 'object' ? { raw, stamp: saved._sync } : null;

    if (!saved && storageKey === STORAGE_KEY) {
      // Fallback: try legacy v1 key (the signed-out dashboard's ancestor: never an account's)
      const rawV1 = localStorage.getItem('personal_dashboard_model_v1');
      if (rawV1) saved = JSON.parse(rawV1);
    }

    if (!saved) {
      return;
    }

    // Run migration for legacy card types (schemaVersion < 2)
    saved = migrateToUnifiedCards(saved);

    // Run migration for twoColumnPair to halfWidth (schemaVersion < 4)
    saved = migrateToHalfWidthCards(saved);

    // Run migration for embedded tasks to Eisenhower Matrix (schemaVersion < 5)
    saved = migrateToEisenhowerTasks(saved);

    // Run migration for grid layout (schemaVersion < 6)
    saved = migrateToGridLayout(saved);

    // Run migration for 24-column grid (schemaVersion < 7)
    saved = migrateToGrid24(saved);

    // Run migration for per-device layout profiles (schemaVersion < 8)
    saved = migrateToDeviceLayouts(saved);

    // Restore schema version
    if (saved.schemaVersion) {
      model.schemaVersion = saved.schemaVersion;
    }

    if (saved.sections) {
      model.sections = saved.sections;
    }

    // Which device mode the saved flat layout represents
    if (saved.lastActiveMode) {
      model.lastActiveMode = saved.lastActiveMode;
    }

    // Reconcile device layout profiles with the flat working layout:
    // the flat props were saved from lastActiveMode — only seed the profile
    // if it doesn't exist yet (don't overwrite designed values with flat
    // props from an older build that saved content growth).
    // Then hydrate whichever mode THIS browser wants to display.
    if (Array.isArray(model.sections) && model.sections.length > 0) {
      const savedMode = model.lastActiveMode || 'tablet';
      model.sections.forEach(s => {
        if (s.type === 'header' || !s.gridCol || !s.gridRow) return;
        if (!s.layouts) s.layouts = {};
        if (!s.layouts[savedMode]) {
          s.layouts[savedMode] = {
            col: s.gridCol, row: s.gridRow,
            colSpan: s.gridColSpan || DEFAULT_COL_SPAN,
            rowSpan: s.gridRowSpan || DEFAULT_ROW_SPAN,
          };
        }
      });
      hydrateLayout(model.sections, getActiveMode());
      model.lastActiveMode = getActiveMode();
    }

    if (saved.sectionTitles) {
      model.sectionTitles = { ...model.sectionTitles, ...saved.sectionTitles };
    }

    if (saved.sectionIcons) {
      model.sectionIcons = { ...model.sectionIcons, ...saved.sectionIcons };
    }

    if (saved.sectionColors) {
      model.sectionColors = { ...model.sectionColors, ...saved.sectionColors };
    }

    if (saved.subtitleColors) {
      model.subtitleColors = { ...model.subtitleColors, ...saved.subtitleColors };
    }

    if (saved.collapsedSubtitles) {
      model.collapsedSubtitles = { ...model.collapsedSubtitles, ...saved.collapsedSubtitles };
    }

    if (saved.collapsedCards) {
      model.collapsedCards = { ...model.collapsedCards, ...saved.collapsedCards };
    }

    if (saved.cardNotes) {
      model.cardNotes = { ...model.cardNotes, ...saved.cardNotes };
    }

    if (saved.subtaskNotes) {
      model.subtaskNotes = { ...model.subtaskNotes, ...saved.subtaskNotes };
    }

    if (saved.header) {
      model.header = { ...model.header, ...saved.header };
    }

    if (typeof saved.darkMode === 'boolean') {
      model.darkMode = saved.darkMode;
    }

    if (typeof saved.glassMode === 'boolean') {
      model.glassMode = saved.glassMode;
    }

    if (saved.glassTheme) {
      model.glassTheme = saved.glassTheme;
    }

    // Note: Legacy reminders/dailyTasks/etc. arrays are now migrated to unified format
    // by migrateToUnifiedCards above, so we restore all section data uniformly

    // Legacy standalone timers (no longer shown, kept so old data isn't lost)
    if (saved.timers && Array.isArray(saved.timers)) {
      model.timers = saved.timers;
    }

    // Restore time tracking panel state
    if (typeof saved.timeTrackingExpanded === 'boolean') {
      model.timeTrackingExpanded = saved.timeTrackingExpanded;
    }

    // Task time log — a running timer keeps running across reloads (it's timestamp-based)
    model.timeTracking = normalizeTimeLog(saved.timeTracking);

    // Task categories (profiles saved before categories existed keep the defaults)
    if (Array.isArray(saved.taskCategories)) {
      model.taskCategories = normalizeTaskCategories(saved.taskCategories);
    }

    // Restore quick access state
    if (typeof saved.quickAccessExpanded === 'boolean') {
      model.quickAccessExpanded = saved.quickAccessExpanded;
    }
    if (typeof saved.selectorModeActive === 'boolean') {
      model.selectorModeActive = saved.selectorModeActive;
    }
    if (saved.quickAccessItems) {
      model.quickAccessItems = saved.quickAccessItems;
    }

    // Restore centralized tasks (Eisenhower Matrix)
    if (saved.tasks && Array.isArray(saved.tasks)) {
      model.tasks = saved.tasks;
    }

    // Restore ideas
    if (saved.ideas && Array.isArray(saved.ideas)) {
      model.ideas = saved.ideas;
    }

    // Restore meetings
    if (saved.meetings && Array.isArray(saved.meetings)) {
      model.meetings = saved.meetings;
    }

    // Restore completed tasks archive
    if (saved.completedTasks && Array.isArray(saved.completedTasks)) {
      model.completedTasks = saved.completedTasks;
    }

    // Restore projects
    if (saved.projects && Array.isArray(saved.projects)) {
      model.projects = saved.projects;
    }

    // Restore subtask templates
    if (saved.subtaskTemplates && Array.isArray(saved.subtaskTemplates)) {
      model.subtaskTemplates = saved.subtaskTemplates;
    }

    // Restore ALL section data (all are now unified format after migration)
    if (saved.sections) {
      saved.sections.forEach(section => {
        if (saved[section.id] && typeof saved[section.id] === 'object') {
          model[section.id] = saved[section.id];

          // Fix reminder dates that were serialized as strings
          if (model[section.id]) {
            Object.values(model[section.id]).forEach(subtitleData => {
              if (subtitleData && Array.isArray(subtitleData.reminders)) {
                subtitleData.reminders.forEach(reminder => {
                  if (reminder.schedule && reminder.schedule.date && typeof reminder.schedule.date === 'string') {
                    reminder.schedule.date = new Date(reminder.schedule.date);
                  }
                });
              }
            });
          }
        }
      });
    }

    // Stored rich text is shown with innerHTML: clean anything unsafe (also covers a cloud profile,
    // which arrives through localStorage and a reload); the save below keeps the cleaned copy
    sanitizeStoredRichText(model);

    // Set flags
    window.skipUrlOverrides = true;
    window.localStorageRestored = true;
    window.isInitialLoad = true;
    // Written back only when the read changed something (a migration, cleaned
    // rich text, this device's layout): an unchanged copy is left as it is
    saveModel({ unchanged: readBack });
    window.isInitialLoad = false;

  } catch (error) {
    console.error('Error in restoreModel:', error);
  }
}

// --- One re-render of everything the model shows (a sync applied a merge, a
// sign-in or sign-out switched dashboards). stickyNotes: also this browser's
// sticky notes (they belong to the dashboard, not the model). init.js sets the
// full renderer (the matrix, the cards, an open calendar: tasks.js refreshTaskViews)
let _renderDashboard = null;
export function setDashboardRenderer(fn) {
  _renderDashboard = typeof fn === 'function' ? fn : null;
}

export function rerenderDashboard({ stickyNotes = false } = {}) {
  if (typeof window === 'undefined') return;
  const call = (name, fn = window[name]) => {
    if (typeof fn !== 'function') return;
    try { fn(); } catch (err) { console.error('[render] failed:', name, err); }
  };
  call('renderHeaderAndTitles');
  if (_renderDashboard) call('dashboard', _renderDashboard);
  else call('renderAllSections');
  call('applyDarkMode');
  call('applyGlassMode');
  call('applyGlassTheme');
  call('applyCellSize');
  call('ensureSectionPlusButtons');
  call('refreshTimeTrackingUI');
  if (stickyNotes) call('refreshStickyNotes');
  // Stored images shown while signed out can load now
  call('hydrateRichTextImages');
  call('updateNotificationBadge');
}

// A sync's merge, written to the stored copy, becomes the model on screen
function applyStoredCopy({ render = true } = {}) {
  resetModel();
  restoreModelNow();
  if (render) rerenderDashboard();
}
setModelApplier(applyStoredCopy);

// --- Export a timestamped backup of the model into localStorage
export function exportBackupFile() {
  const now = new Date();
  const ts = now.toISOString().replace(/[:.]/g, '-');
  const storageKey = getActiveStorageKey();
  const key = `${storageKey}__backup__${ts}`;
  try {
    const data = localStorage.getItem(storageKey);
    if (data) localStorage.setItem(key, data);
  } catch {}
}

// --- Deep merge function to properly merge working copy back to main model
// Deliberately NOT merged: timeTracking, taskCategories and subtaskTemplates.
// All are written straight to `model` (timers tick, Task Settings and the task
// editor's template save run outside the edit-mode confirm/cancel cycle), so
// the working copy's snapshot of them is stale and must never overwrite the model.
export function deepMergeModel(target, source) {
  // Handle arrays - replace them completely
  if (Array.isArray(source.sections)) {
    target.sections = [...source.sections];
  }
  if (Array.isArray(source.timers)) {
    target.timers = [...source.timers];
  }
  if (Array.isArray(source.meetings)) {
    target.meetings = [...source.meetings];
  }

  // Handle objects - merge them
  if (source.sectionTitles) {
    target.sectionTitles = { ...(target.sectionTitles || {}), ...source.sectionTitles };
  }
  if (source.sectionIcons) {
    target.sectionIcons = { ...(target.sectionIcons || {}), ...source.sectionIcons };
  }

  // Deep merge sectionColors to preserve independent light/dark mode colors
  if (source.sectionColors) {
    if (!target.sectionColors) {
      target.sectionColors = {};
    }
    Object.keys(source.sectionColors).forEach(sectionId => {
      const sourceColor = source.sectionColors[sectionId];
      const targetColor = target.sectionColors[sectionId];

      // If source is a string (legacy) or target doesn't exist, just copy source
      if (typeof sourceColor === 'string' || !targetColor) {
        target.sectionColors[sectionId] = sourceColor;
      } else if (typeof sourceColor === 'object' && sourceColor !== null) {
        // Deep merge the light/dark color object
        if (typeof targetColor === 'string') {
          // Target is legacy format, convert to object and merge
          target.sectionColors[sectionId] = {
            light: targetColor,
            dark: sourceColor.dark || null
          };
          if (sourceColor.light !== undefined) {
            target.sectionColors[sectionId].light = sourceColor.light;
          }
        } else {
          // Both are objects, merge them preserving existing values
          target.sectionColors[sectionId] = {
            light: sourceColor.light !== undefined ? sourceColor.light : (targetColor.light || null),
            dark: sourceColor.dark !== undefined ? sourceColor.dark : (targetColor.dark || null)
          };
        }
      }
    });
  }

  // Deep merge subtitleColors to preserve independent light/dark mode colors
  if (source.subtitleColors) {
    if (!target.subtitleColors) {
      target.subtitleColors = {};
    }
    Object.keys(source.subtitleColors).forEach(colorKey => {
      const sourceColor = source.subtitleColors[colorKey];
      const targetColor = target.subtitleColors[colorKey];

      // If source is a string (legacy) or target doesn't exist, just copy source
      if (typeof sourceColor === 'string' || !targetColor) {
        target.subtitleColors[colorKey] = sourceColor;
      } else if (typeof sourceColor === 'object' && sourceColor !== null) {
        // Deep merge the light/dark color object
        if (typeof targetColor === 'string') {
          // Target is legacy format, convert to object and merge
          target.subtitleColors[colorKey] = {
            light: targetColor,
            dark: sourceColor.dark || null
          };
          if (sourceColor.light !== undefined) {
            target.subtitleColors[colorKey].light = sourceColor.light;
          }
        } else {
          // Both are objects, merge them preserving existing values
          target.subtitleColors[colorKey] = {
            light: sourceColor.light !== undefined ? sourceColor.light : (targetColor.light || null),
            dark: sourceColor.dark !== undefined ? sourceColor.dark : (targetColor.dark || null)
          };
        }
      }
    });
  }
  if (source.collapsedSubtitles) {
    target.collapsedSubtitles = { ...(target.collapsedSubtitles || {}), ...source.collapsedSubtitles };
  }
  if (source.header) {
    target.header = { ...target.header, ...source.header };
  }
  if (source.cardNotes) {
    target.cardNotes = { ...(target.cardNotes || {}), ...source.cardNotes };
  }
  // Every note write mirrors into the working copy (edit-mode.js storeNotes / saveNote),
  // and moves made in edit mode move the notes on both copies, so the working copy is
  // complete: taking it whole drops the notes of subtasks deleted (or moved) while editing
  if (source.subtaskNotes) {
    target.subtaskNotes = { ...source.subtaskNotes };
  }
  if (source.collapsedCards) {
    target.collapsedCards = { ...(target.collapsedCards || {}), ...source.collapsedCards };
  }
  if (source.reminders) {
    target.reminders = JSON.parse(JSON.stringify(source.reminders));
  }
  if (source.quickAccessItems) {
    target.quickAccessItems = JSON.parse(JSON.stringify(source.quickAccessItems));
  }

  // Handle simple properties
  if (typeof source.schemaVersion !== 'undefined') {
    target.schemaVersion = source.schemaVersion;
  }
  // Carry lastActiveMode through edit-mode confirm (device-layout profiles).
  // switchDeviceMode writes both model and working copies, but the merge must
  // be explicit so confirm can never desync them.
  if (typeof source.lastActiveMode !== 'undefined') {
    target.lastActiveMode = source.lastActiveMode;
  }
  if (typeof source.darkMode !== 'undefined') {
    target.darkMode = source.darkMode;
  }
  if (typeof source.glassMode !== 'undefined') {
    target.glassMode = source.glassMode;
  }
  if (typeof source.glassTheme !== 'undefined') {
    target.glassTheme = source.glassTheme;
  }
  if (typeof source.timeTrackingExpanded !== 'undefined') {
    target.timeTrackingExpanded = source.timeTrackingExpanded;
  }
  if (typeof source.quickAccessExpanded !== 'undefined') {
    target.quickAccessExpanded = source.quickAccessExpanded;
  }
  if (typeof source.selectorModeActive !== 'undefined') {
    target.selectorModeActive = source.selectorModeActive;
  }
  if (source.tasks && Array.isArray(source.tasks)) {
    target.tasks = JSON.parse(JSON.stringify(source.tasks));
  }
  if (source.ideas && Array.isArray(source.ideas)) {
    target.ideas = JSON.parse(JSON.stringify(source.ideas));
  }
  if (source.completedTasks && Array.isArray(source.completedTasks)) {
    target.completedTasks = JSON.parse(JSON.stringify(source.completedTasks));
  }
  if (source.projects && Array.isArray(source.projects)) {
    target.projects = JSON.parse(JSON.stringify(source.projects));
  }

  // Handle ALL section data (unified format - objects keyed by section ID)
  // This includes dynamic 'new-card-*' sections AND legacy section IDs like 'dailyTasks', 'analytics', etc.
  // that have been migrated to unified format (objects, not arrays)
  if (Array.isArray(source.sections)) {
    source.sections.forEach(section => {
      if (source[section.id] && typeof source[section.id] === 'object' && !Array.isArray(source[section.id])) {
        // Deep copy the unified card data
        target[section.id] = JSON.parse(JSON.stringify(source[section.id]));
      }
    });
  }
}
