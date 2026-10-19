// Personal Dashboard - Import/Export Module
// Handles JSON import/export functionality
//
// NOTE: The full implementations of these functions remain in app.js due to their
// complexity and extensive dependencies. This module provides the interface for
// future migration. The window.* exports allow gradual transition.

import { model, editState, currentData, normalizeTaskCategories, resetModel } from '../state.js';
import { PLACEHOLDER_URL, APP_VERSION, LINKS_FILE_PATH, STORAGE_KEY, DEFAULT_TASK_CATEGORIES, MAX_TASK_CATEGORIES } from '../constants.js';
import { saveModel, restoreModel, rerenderDashboard, cleanupOldBackups, migrateToUnifiedCards, migrateToHalfWidthCards, sanitizeStoredRichText } from './storage.js';
import { migrateToDeviceLayouts, hydrateLayout, getActiveMode } from '../features/grid-engine.js';
import { getActiveStorageKey, markCloudDirty, noteStoredCopy, getStoredBase, noteReplacePending, cloudSave } from './sync.js';
import { getDataOwner, isLoggedIn } from './auth.js';
import { normalizeTimeLog, prepareImportedTimeLog } from './time-log.js';
import { makeSyncStamp } from './mobile-sync.js';
import { ITEM_TYPES, cardItemKeys, cardItemsOfType } from './card-move.js';
import { showToast } from '../utils.js';

// --- Helper to convert reminder from internal format to JSON for export
// Exports in the same format as the internal model (compatible with old app)
function convertReminderToJson(r) {
  const json = {
    key: r.key,
    title: r.title || '',
    name: r.title || '',  // Include both for compatibility
    url: r.url || PLACEHOLDER_URL,
    type: r.type || 'days',
    links: r.links || []
  };

  // Handle interval mode
  if (r.type === 'interval') {
    json.interval = r.interval || 0;
    json.currentNumber = r.currentNumber || 0;
    json.intervalType = r.intervalType || 'limit';
    json.intervalUnit = r.intervalUnit || 'none';
    if (r.breakdown) {
      json.breakdown = {
        locked: r.breakdown.locked || false,
        rows: Array.isArray(r.breakdown.rows) ? r.breakdown.rows.map(row => ({
          label: row.label || '',
          value: row.value || 0
        })) : []
      };
    }
    json.schedule = null;
  } else {
    // Handle calendar mode - export the schedule object directly
    if (r.schedule) {
      // Create a copy of the schedule and serialize dates
      const schedCopy = { ...r.schedule };
      if (schedCopy.date instanceof Date) {
        schedCopy.date = schedCopy.date.toISOString();
      }
      json.schedule = schedCopy;

      // Export scheduleSetAt for one-time reminders (needed for progress bar calculation)
      if (r.scheduleSetAt) {
        json.scheduleSetAt = r.scheduleSetAt;
      }
    } else {
      json.schedule = null;
    }
  }

  return json;
}

// --- Extract complete data for export
export function extractUrlOverrides() {
  const data = currentData();
  const obj = {};

  // Helper function to export unified card data
  const exportUnifiedCard = (sectionData) => {
    if (!sectionData || typeof sectionData !== 'object') return null;
    const exported = {};
    Object.entries(sectionData).forEach(([subtitle, items]) => {
      if (!items || typeof items !== 'object') return;
      exported[subtitle] = {
        icons: Array.isArray(items.icons) ? items.icons.map(i => {
          const icon = {
            key: i.key,
            icon: i.icon || ''
          };
          // Include isDivider for separators
          if (i.isDivider) {
            icon.isDivider = true;
          } else {
            // Regular icons have url, title, and optionally links
            icon.url = i.url || PLACEHOLDER_URL;
            icon.title = i.title || '';
            if (i.links && i.links.length > 0) {
              icon.links = i.links;
            }
            if (i.invertDark) icon.invertDark = true;
          }
          return icon;
        }) : [],
        reminders: Array.isArray(items.reminders) ? items.reminders.map(r => convertReminderToJson(r)) : [],
        subtasks: Array.isArray(items.subtasks) ? items.subtasks.map(i => ({
          key: i.key,
          url: i.url || PLACEHOLDER_URL,
          text: i.text || '',
          links: i.links || null
        })) : [],
        copyPaste: Array.isArray(items.copyPaste) ? items.copyPaste.map(i => ({
          key: i.key,
          text: i.text || '',
          copyText: i.copyText || ''
        })) : []
      };
    });
    return exported;
  };

  // Extract from ALL sections - all are now unified format
  data.sections.forEach(section => {
    if (data[section.id]) {
      // All card types are now unified format: { subtitle: { icons: [], reminders: [], subtasks: [], copyPaste: [] }, ... }
      const exported = exportUnifiedCard(data[section.id]);
      if (exported) {
        obj[section.id] = exported;
      }
    }
  });

  // Schema version for migration support
  obj.schemaVersion = data.schemaVersion || 8;

  // Structure information
  obj._structure = {
    sections: data.sections,
    sectionTitles: data.sectionTitles,
    sectionIcons: data.sectionIcons || {},
    sectionColors: data.sectionColors || {},
    subtitleColors: data.subtitleColors || {},
    collapsedSubtitles: data.collapsedSubtitles || {},
    collapsedCards: data.collapsedCards || {},
    cardNotes: data.cardNotes || {},
    subtaskNotes: data.subtaskNotes || {},
    header: data.header
  };

  // UI state
  obj.darkMode = data.darkMode || false;
  obj.glassMode = true;
  obj.glassTheme = data.glassTheme || 'classic';
  obj.timeTrackingExpanded = data.timeTrackingExpanded || false;
  obj.quickAccessExpanded = data.quickAccessExpanded || false;
  obj.selectorModeActive = data.selectorModeActive || false;
  obj.lastActiveMode = data.lastActiveMode || 'tablet'; // device-layout profiles ride in sections[].layouts
  obj.quickAccessItems = data.quickAccessItems || { icons: [], listItems: [], quickLinks: [] };
  obj.timers = data.timers || [];
  obj.tasks = data.tasks || [];
  obj.completedTasks = data.completedTasks || [];
  obj.projects = data.projects || [];
  obj.ideas = data.ideas || [];
  obj.meetings = data.meetings || [];
  obj.subtaskTemplates = data.subtaskTemplates || [];
  // Always from `model`: these never live on the edit-mode working copy
  obj.taskCategories = model.taskCategories || [];
  obj.timeTracking = normalizeTimeLog(model.timeTracking);

  // Metadata
  obj._metadata = {
    exportDate: new Date().toISOString(),
    totalSections: data.sections.length,
    sectionTypes: data.sections.map(s => ({ id: s.id, type: s.type, title: s.title })),
    version: APP_VERSION,
    description: 'Complete dashboard backup'
  };

  return obj;
}

// --- Download text file
export function downloadTextFile(filename, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}

// --- IndexedDB helpers
export function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('pd-fs-handles', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('handles')) db.createObjectStore('handles');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('handles', 'readonly');
    const store = tx.objectStore('handles');
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function idbSet(key, value) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('handles', 'readwrite');
    const store = tx.objectStore('handles');
    const req = store.put(value, key);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

export async function verifyPermission(handle, mode = 'readwrite') {
  if (!handle) return false;
  try {
    const opts = { mode };
    const q = await handle.queryPermission(opts);
    if (q === 'granted') return true;
    const r = await handle.requestPermission(opts);
    return r === 'granted';
  } catch { return false; }
}

export async function ensureProjectDirHandle() {
  if (!window.showDirectoryPicker) return null;
  try {
    if (editState.projectDirHandle) {
      const ok = await verifyPermission(editState.projectDirHandle);
      if (ok) return editState.projectDirHandle;
    }
    const stored = await idbGet('rootDir');
    if (stored) {
      const ok = await verifyPermission(stored);
      if (ok) { editState.projectDirHandle = stored; return stored; }
    }
    return null;
  } catch { return null; }
}

export async function selectProjectFolder() {
  if (!window.showDirectoryPicker) return null;
  try {
    const handle = await window.showDirectoryPicker({ id: 'personal-dashboard-root' });
    const ok = await verifyPermission(handle);
    if (!ok) return null;
    editState.projectDirHandle = handle;
    try { await idbSet('rootDir', handle); } catch {}
    return handle;
  } catch { return null; }
}

export async function writeTextFileToProject(subpath, content) {
  try {
    let root = await ensureProjectDirHandle();
    if (!root) return false;
    const parts = subpath.split('/');
    const fileName = parts.pop();
    let dir = root;
    for (const part of parts) { dir = await dir.getDirectoryHandle(part, { create: true }); }
    const fileHandle = await dir.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
    return true;
  } catch { return false; }
}

export async function persistUrlOverridesToFile() {
  const json = JSON.stringify(extractUrlOverrides(), null, 2);
  return await writeTextFileToProject(LINKS_FILE_PATH, json);
}

// --- Helper to convert reminder from JSON flat format to internal nested format
function convertReminderFromJson(r) {
  if (!r || typeof r !== 'object') {
    console.warn('Invalid reminder object:', r);
    return { key: 'invalid', title: 'Invalid', url: PLACEHOLDER_URL, type: 'days', schedule: null, links: [] };
  }

  // Use title/name if provided, otherwise format the key as display name
  let displayTitle = r.title || r.name || '';
  if (!displayTitle && r.key) {
    // Convert key like "power_bi" to "Power Bi"
    displayTitle = String(r.key)
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }
  // Fallback if still no title
  if (!displayTitle) {
    displayTitle = 'Untitled';
  }

  const reminder = {
    key: r.key || 'unknown',
    title: displayTitle,
    url: r.url || PLACEHOLDER_URL,
    links: Array.isArray(r.links) ? r.links : []
  };

  // Convert mode to type and handle interval data
  // Support both "mode" (new format) and "type" (old app format)
  const isInterval = r.mode === 'interval' || r.type === 'interval';
  if (isInterval) {
    reminder.type = 'interval';
    // Support both "interval" (old format) and "targetNumber" (new format)
    reminder.interval = r.interval || r.targetNumber || 0;
    reminder.currentNumber = r.currentNumber || 0;
    reminder.intervalType = r.intervalType || 'limit';
    // Support both "intervalUnit" (old format) and "unit" (new format)
    reminder.intervalUnit = r.intervalUnit || r.unit || 'none';
    reminder.breakdown = r.breakdown ? {
      locked: r.breakdown.locked || false,
      rows: Array.isArray(r.breakdown.rows) ? r.breakdown.rows.map(row => ({
        label: row.label || '',
        value: row.value || 0
      })) : []
    } : null;
    reminder.schedule = null;
  } else {
    // Calendar mode
    reminder.type = 'days';
    reminder.schedule = null;

    // Check if schedule is already in nested format (from old app export)
    if (r.schedule && typeof r.schedule === 'object') {
      // Already in internal format - use directly
      reminder.schedule = r.schedule;
      // Ensure date is a Date object if it exists
      if (reminder.schedule.date && typeof reminder.schedule.date === 'string') {
        reminder.schedule.date = new Date(reminder.schedule.date);
      }
      // Restore scheduleSetAt for one-time reminders (needed for progress bar calculation)
      if (r.scheduleSetAt) {
        reminder.scheduleSetAt = r.scheduleSetAt;
      }
    }
    // Convert flat date/repeat fields to schedule object
    else if (r.scheduledDate) {
      const date = new Date(r.scheduledDate);
      if (!isNaN(date.getTime())) {
        const repeat = r.repeat || 'none';

        if (repeat === 'none') {
          reminder.schedule = {
            type: 'once',
            date: date
          };
        } else if (repeat === 'weekly') {
          reminder.schedule = {
            type: 'weekday',
            weekday: date.getDay(),
            weekInterval: parseInt(r.weeklyInterval) || 1
          };
        } else if (repeat === 'monthly') {
          if (r.monthlyType === 'firstWeekday') {
            reminder.schedule = {
              type: 'firstWeekdayOfMonth',
              weekday: date.getDay() || 1
            };
          } else {
            reminder.schedule = {
              type: 'monthly',
              dayOfMonth: date.getDate()
            };
          }
        }
      }
    }
  }

  return reminder;
}

// --- Migrate imported JSON data from old format to unified format
// This transforms both the section types AND the data structure in place
function migrateImportedData(data, model) {
  // ALL card types that should become unified
  const legacyTypes = [
    'newCard', 'newCardAnalytics', 'copyPaste', 'reminders',
    'dailyTasks', 'dailyTools', 'contentCreation', 'ads',
    'analytics', 'tools', 'icon', 'list'
  ];

  // Helper to extract items from various data formats
  const extractItems = (rawData) => {
    if (!rawData) return null;
    // Format 1: Direct array [...]
    if (Array.isArray(rawData)) return rawData;
    // Format 2: Object with items array { title: '...', items: [...] }
    if (rawData.items && Array.isArray(rawData.items)) return rawData.items;
    // Format 3: Object with subtitles { "Subtitle": [...] }
    if (typeof rawData === 'object' && !Array.isArray(rawData)) {
      // Check if it's subtitle format (values are arrays)
      const firstValue = Object.values(rawData)[0];
      if (Array.isArray(firstValue)) return rawData; // Return as-is for subtitle processing
    }
    return null;
  };

  // Process sections in model (which was populated from data._structure)
  if (Array.isArray(model.sections)) {
    model.sections.forEach(section => {
      if (legacyTypes.includes(section.type)) {
        const sectionId = section.id;
        // Look for data at section.id first, then fall back to section.type
        let rawData = data[sectionId];
        let dataKey = sectionId;
        if (!rawData && data[section.type]) {
          rawData = data[section.type];
          dataKey = section.type;
        }

        // Extract items from various formats
        const oldData = extractItems(rawData);
        // Convert the data in the imported JSON to unified format
        if (oldData) {
          switch (section.type) {
            case 'newCard':
              // Icon-only: array → { "_default": { icons: [...], reminders: [], subtasks: [], copyPaste: [] }}
              if (Array.isArray(oldData)) {
                data[sectionId] = {
                  "_default": {
                    icons: oldData.map((item, idx) => {
                      const icon = {
                        key: item.key || (item.name ? item.name.toLowerCase().replace(/\s+/g, '_') : `icon_${idx}`),
                        icon: item.icon || ''
                      };
                      // Preserve separators (isDivider)
                      if (item.isDivider) {
                        icon.isDivider = true;
                      } else {
                        icon.url = item.url || PLACEHOLDER_URL;
                        icon.title = item.title || item.name || '';
                        if (item.links && item.links.length > 0) {
                          icon.links = item.links;
                        }
                      }
                      return icon;
                    }),
                    reminders: [],
                    subtasks: [],
                    copyPaste: []
                  }
                };
              }
              break;

            case 'newCardAnalytics':
              // Subtask-only: array → { "_default": { icons: [], reminders: [], subtasks: [...], copyPaste: [] }}
              if (Array.isArray(oldData)) {
                data[sectionId] = {
                  "_default": {
                    icons: [],
                    reminders: [],
                    subtasks: oldData.map((item, idx) => ({
                      key: item.key || (item.name ? item.name.toLowerCase().replace(/\s+/g, '_') : `item_${idx}`),
                      text: item.text || item.title || item.name || '',
                      url: item.url || PLACEHOLDER_URL,
                      links: item.links || null
                    })),
                    copyPaste: []
                  }
                };
              }
              break;

            case 'copyPaste':
              // Copy-paste with subtitles: { "Sub": [items] } → { "Sub": { icons: [], reminders: [], subtasks: [], copyPaste: [...] }}
              if (typeof oldData === 'object' && !Array.isArray(oldData)) {
                const migrated = {};
                Object.entries(oldData).forEach(([subtitle, items]) => {
                  if (Array.isArray(items)) {
                    migrated[subtitle] = {
                      icons: [],
                      reminders: [],
                      subtasks: [],
                      copyPaste: items.map(item => ({
                        key: item.key,
                        text: item.text || '',
                        copyText: item.copyText || ''
                      }))
                    };
                  } else if (items && typeof items === 'object' && items.copyPaste) {
                    // Already in unified format - keep it
                    migrated[subtitle] = items;
                  }
                });
                data[sectionId] = migrated;
              }
              break;

            case 'reminders':
              // Reminders with subtitles: { "Sub": [reminders] } → { "Sub": { icons: [], reminders: [...], subtasks: [], copyPaste: [] }}
              if (typeof oldData === 'object' && !Array.isArray(oldData)) {
                const migrated = {};
                Object.entries(oldData).forEach(([subtitle, items]) => {
                  if (Array.isArray(items)) {
                    migrated[subtitle] = {
                      icons: [],
                      reminders: items.map(r => {
                        // Generate title from key if not present
                        let title = r.title || r.name || '';
                        if (!title && r.key) {
                          title = String(r.key).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                        }
                        return {
                          key: r.key || `reminder_${Date.now()}_${Math.random().toString(36).slice(2)}`,
                          title: title || 'Untitled',
                          url: r.url || PLACEHOLDER_URL,
                          type: r.type || r.mode || 'days',
                          schedule: r.schedule || null,
                          interval: r.interval || r.targetNumber || null,
                          currentNumber: r.currentNumber || null,
                          intervalType: r.intervalType || 'goal',
                          intervalUnit: r.intervalUnit || r.unit || 'none',
                          breakdown: r.breakdown || null,
                          links: r.links || null
                        };
                      }),
                      subtasks: [],
                      copyPaste: []
                    };
                  } else if (items && typeof items === 'object' && items.reminders) {
                    // Already in unified format - keep it
                    migrated[subtitle] = items;
                  }
                });
                data[sectionId] = migrated;
              }
              break;

            case 'dailyTasks':
            case 'dailyTools':
            case 'contentCreation':
            case 'ads':
            case 'icon':
              // Icon-based cards: array → { "_default": { icons: [...], reminders: [], subtasks: [], copyPaste: [] }}
              if (Array.isArray(oldData)) {
                data[sectionId] = {
                  "_default": {
                    icons: oldData.map((item, idx) => {
                      // Support both old format (key) and JSON format (name)
                      const icon = {
                        key: item.key || (item.name ? item.name.toLowerCase().replace(/\s+/g, '_') : `icon_${idx}`),
                        icon: item.icon || ''
                      };
                      // Preserve separators (isDivider)
                      if (item.isDivider) {
                        icon.isDivider = true;
                      } else {
                        icon.url = item.url || PLACEHOLDER_URL;
                        icon.title = item.title || item.name || '';
                        if (item.links && item.links.length > 0) {
                          icon.links = item.links;
                        }
                      }
                      return icon;
                    }),
                    reminders: [],
                    subtasks: [],
                    copyPaste: []
                  }
                };
              }
              break;

            case 'analytics':
            case 'tools':
            case 'list':
              // List-based cards: array → { "_default": { icons: [], reminders: [], subtasks: [...], copyPaste: [] }}
              if (Array.isArray(oldData)) {
                data[sectionId] = {
                  "_default": {
                    icons: [],
                    reminders: [],
                    subtasks: oldData.map((item, idx) => ({
                      // Support both old format (key/text) and JSON format (name)
                      key: item.key || (item.name ? item.name.toLowerCase().replace(/\s+/g, '_') : `item_${idx}`),
                      text: item.text || item.title || item.name || '',
                      url: item.url || PLACEHOLDER_URL,
                      links: item.links || null
                    })),
                    copyPaste: []
                  }
                };
              }
              break;
          }
          // If data was at type key (not id key), clean up the old key
          if (dataKey !== sectionId && data[dataKey]) {
            delete data[dataKey];
          }
        }

        // Update section type to 'unified'
        section.type = 'unified';
      }
    });
  }

  // Also process sectionsStacked if it exists
  if (Array.isArray(model.sectionsStacked)) {
    model.sectionsStacked.forEach(section => {
      if (legacyTypes.includes(section.type)) {
        section.type = 'unified';
      }
    });
  }

}

// --- Apply URL overrides from imported JSON
export function applyUrlOverrides(data) {
  if (!data || typeof data !== 'object') return;
  // Don't apply overrides if localStorage has already been restored
  if (window.localStorageRestored) {
    return;
  }
  // Always operate on model, not editState.working
  const current = model;

  // IMPORTANT: Apply structure FIRST so new sections are recognized before data import
  // Handle both new format (data._structure) and old format (data.sections directly)
  const structure = data._structure || data;

  if (structure.sections && Array.isArray(structure.sections)) {
    current.sections = structure.sections;
  }
  if (structure.sectionTitles) {
    current.sectionTitles = structure.sectionTitles;
  }
  // Restore section icons (custom icons for list-type sections)
  if (structure.sectionIcons && typeof structure.sectionIcons === 'object') {
    current.sectionIcons = structure.sectionIcons;
  }
  // Restore section colors (independent light/dark mode colors)
  if (structure.sectionColors && typeof structure.sectionColors === 'object') {
    current.sectionColors = structure.sectionColors;
  }
  // Restore subtitle colors (independent light/dark mode colors)
  if (structure.subtitleColors && typeof structure.subtitleColors === 'object') {
    current.subtitleColors = structure.subtitleColors;
  }
  // Restore collapsed subtitles state
  if (structure.collapsedSubtitles && typeof structure.collapsedSubtitles === 'object') {
    current.collapsedSubtitles = structure.collapsedSubtitles;
  }
  // Restore collapsed cards state
  if (structure.collapsedCards && typeof structure.collapsedCards === 'object') {
    current.collapsedCards = structure.collapsedCards;
  }
  // Restore card notes
  if (structure.cardNotes && typeof structure.cardNotes === 'object') {
    current.cardNotes = structure.cardNotes;
  }
  if (structure.subtaskNotes && typeof structure.subtaskNotes === 'object') {
    current.subtaskNotes = structure.subtaskNotes;
  }
  if (structure.header) {
    current.header = structure.header;
  }

  // IMPORTANT: Run migration on IMPORTED DATA to convert old card types to unified format
  // This handles imports from older versions with 'reminders', 'newCard', etc.
  // We need to migrate the imported JSON data structure before applying it
  const importedVersion = data.schemaVersion || data._structure?.schemaVersion || 1;
  if (importedVersion < 3) {
    // Migrate section types and data in the imported JSON
    migrateImportedData(data, current);
  }
  // Run halfWidth migration for schema versions < 4
  if (importedVersion < 4) {
    // Migrate twoColumnPair to halfWidth
    migrateToHalfWidthCards(data);
    // Also apply to current model sections
    if (current.sections) {
      current.sections.forEach(section => {
        if (section.twoColumnPair) {
          section.halfWidth = true;
          delete section.twoColumnPair;
          delete section.pairIndex;
        }
      });
    }
  }

  // Run grid layout migration (v5 → v6 → v7)
  if (window.migrateToGridLayout) {
    window.migrateToGridLayout(current);
  } else {
    if (current.sections) {
      current.sections.forEach(section => {
        if (section.halfWidth !== undefined) {
          section.gridColSpan = section.halfWidth ? 6 : 12;
          delete section.halfWidth;
        }
      });
    }
    delete current.sectionsStacked;
    delete current.displayMode;
  }
  // Migrate to 24-col grid — ONLY for pre-v7 exports. Running this on
  // v7/v8 data would double legitimate small colSpans (e.g., mobile's 4).
  if (importedVersion < 7 && current.sections) {
    current.sections.forEach(section => {
      if (!section.gridColSpan) {
        const old = section.gridSpan || 12;
        section.gridColSpan = old * 2;
      } else if (section.gridColSpan <= 12) {
        section.gridColSpan = section.gridColSpan * 2;
        if (section.gridCol) section.gridCol = (section.gridCol - 1) * 2 + 1;
        if (section.gridRowSpan) section.gridRowSpan = section.gridRowSpan * 2;
      }
      delete section.gridSpan;
      delete section.minHeight;
    });
  }

  // Migrate to per-device layout profiles (v8), then show this browser's mode
  if (data.lastActiveMode) current.lastActiveMode = data.lastActiveMode;
  current.schemaVersion = importedVersion >= 8 ? 8 : 7;
  migrateToDeviceLayouts(current);
  if (Array.isArray(current.sections) && current.sections.length > 0) {
    // Flat props in the export represent its lastActiveMode — sync that profile
    const exportedMode = current.lastActiveMode || 'tablet';
    current.sections.forEach(s => {
      if (s.type === 'header' || !s.gridCol || !s.gridRow) return;
      if (!s.layouts) s.layouts = {};
      s.layouts[exportedMode] = {
        col: s.gridCol, row: s.gridRow,
        colSpan: s.gridColSpan || 24, rowSpan: s.gridRowSpan || 8,
      };
    });
    hydrateLayout(current.sections, getActiveMode());
    current.lastActiveMode = getActiveMode();
  }

  // Apply to ALL sections - all are now unified format
  // Helper function to import unified card data
  const importUnifiedCard = (sectionId, sectionData) => {
    if (!sectionData || typeof sectionData !== 'object') return null;

    const imported = {};
    Object.entries(sectionData).forEach(([subtitle, items]) => {
      // FALLBACK: If items is an array (old format), detect and convert on-the-fly
      if (Array.isArray(items)) {
        const firstItem = items[0];
        if (firstItem) {
          if (firstItem.type === 'days' || firstItem.type === 'interval' || firstItem.schedule !== undefined || (firstItem.title !== undefined && !firstItem.icon)) {
            // Old reminders format
            items = { icons: [], reminders: items, subtasks: [], copyPaste: [] };
          } else if (firstItem.copyText !== undefined) {
            // Old copy-paste format
            items = { icons: [], reminders: [], subtasks: [], copyPaste: items };
          } else if (firstItem.icon !== undefined) {
            // Old icons format
            items = { icons: items, reminders: [], subtasks: [], copyPaste: [] };
          } else if (firstItem.text !== undefined) {
            // Old subtasks format
            items = { icons: [], reminders: [], subtasks: items, copyPaste: [] };
          } else {
            items = { icons: [], reminders: [], subtasks: [], copyPaste: [] };
          }
        } else {
          items = { icons: [], reminders: [], subtasks: [], copyPaste: [] };
        }
      }

      if (!items || typeof items !== 'object') return;

      imported[subtitle] = {
        icons: Array.isArray(items.icons) ? items.icons.map(i => {
          const icon = {
            key: i.key,
            icon: i.icon || ''
          };
          // Preserve isDivider for separators
          if (i.isDivider) {
            icon.isDivider = true;
          } else {
            // Regular icons have url, title, and optionally links
            icon.url = i.url || PLACEHOLDER_URL;
            icon.title = i.title || '';
            if (i.links && i.links.length > 0) {
              icon.links = i.links;
            }
            if (i.invertDark) icon.invertDark = true;
          }
          return icon;
        }) : [],
        reminders: Array.isArray(items.reminders) ? items.reminders.map(r => convertReminderFromJson(r)) : [],
        subtasks: Array.isArray(items.subtasks) ? items.subtasks.map(i => ({
          key: i.key,
          url: i.url || PLACEHOLDER_URL,
          text: i.text || '',
          links: i.links || null
        })) : [],
        copyPaste: Array.isArray(items.copyPaste) ? items.copyPaste.map(i => ({
          key: i.key,
          text: i.text || '',
          copyText: i.copyText || ''
        })) : []
      };
    });
    return imported;
  };

  current.sections.forEach(section => {
    if (data[section.id] && typeof data[section.id] === 'object' && !Array.isArray(data[section.id])) {
      const imported = importUnifiedCard(section.id, data[section.id]);
      if (imported) {
        current[section.id] = imported;
      }
    }
  });

  // Note: _structure is now applied at the beginning of this function

  // Apply UI state and preferences
  if (typeof data.darkMode === 'boolean') {
    current.darkMode = data.darkMode;
  }
  if (typeof data.glassMode === 'boolean') {
    current.glassMode = data.glassMode;
  }
  if (data.glassTheme) {
    current.glassTheme = data.glassTheme;
  }
  if (typeof data.timeTrackingExpanded === 'boolean') {
    current.timeTrackingExpanded = data.timeTrackingExpanded;
  }
  if (typeof data.quickAccessExpanded === 'boolean') {
    current.quickAccessExpanded = data.quickAccessExpanded;
  }
  if (typeof data.selectorModeActive === 'boolean') {
    current.selectorModeActive = data.selectorModeActive;
  }


  // Apply quick access items
  if (data.quickAccessItems && typeof data.quickAccessItems === 'object') {
    current.quickAccessItems = {
      icons: Array.isArray(data.quickAccessItems.icons) ? data.quickAccessItems.icons : [],
      listItems: Array.isArray(data.quickAccessItems.listItems) ? data.quickAccessItems.listItems : [],
      quickLinks: Array.isArray(data.quickAccessItems.quickLinks) ? data.quickAccessItems.quickLinks : []
    };
  }

  // Apply timers data
  if (data.timers && Array.isArray(data.timers)) {
    current.timers = data.timers;
  }


  // Apply centralized tasks (Eisenhower Matrix)
  if (data.tasks && Array.isArray(data.tasks)) {
    current.tasks = data.tasks;
  }

  // Apply completed tasks archive
  if (data.completedTasks && Array.isArray(data.completedTasks)) {
    current.completedTasks = data.completedTasks;
  }

  // Apply projects
  if (data.projects && Array.isArray(data.projects)) {
    current.projects = data.projects;
  }

  // Apply ideas
  if (data.ideas && Array.isArray(data.ideas)) {
    current.ideas = data.ideas;
  }

  // Apply meetings
  if (data.meetings && Array.isArray(data.meetings)) {
    current.meetings = data.meetings;
  }

  // Apply subtask templates
  if (data.subtaskTemplates && Array.isArray(data.subtaskTemplates)) {
    current.subtaskTemplates = data.subtaskTemplates;
  }

  // Apply task categories
  if (Array.isArray(data.taskCategories)) {
    current.taskCategories = normalizeTaskCategories(data.taskCategories);
  }

  // Apply the task time log. It replaces history older than now (so cloud
  // sync won't merge the pre-import log back in); a timer that was running
  // in the backup closes at the export time.
  if (data.timeTracking && typeof data.timeTracking === 'object') {
    const exportedAt = Date.parse(data._metadata?.exportDate || '');
    current.timeTracking = prepareImportedTimeLog(data.timeTracking, exportedAt, Date.now());
  }

  // Imported rich text goes through the allowlist sanitizer before anything renders it
  sanitizeStoredRichText(current);

  // Synchronize editState.working if in edit mode
  if (editState.enabled && editState.working) {
    editState.working = JSON.parse(JSON.stringify(model));
  }
  // The imported notes are the new baseline: no note move made in this edit session
  // applies to them (Cancel would shift them off their items; edit-mode.js)
  editState.noteMoves = [];

  // Save the restored data to localStorage so it persists
  // Only save to localStorage, not to JSON file during import
  if (window.isImporting) {
    // During import, only save to localStorage without triggering JSON file save
    const payload = {
      schemaVersion: current.schemaVersion || 8,
      sections: current.sections,
      lastActiveMode: current.lastActiveMode || 'tablet',
      sectionTitles: current.sectionTitles,
      sectionIcons: current.sectionIcons,
      sectionColors: current.sectionColors,
      subtitleColors: current.subtitleColors,
      collapsedSubtitles: current.collapsedSubtitles,
      collapsedCards: current.collapsedCards,
      cardNotes: current.cardNotes,
      subtaskNotes: current.subtaskNotes,
      header: current.header,
      darkMode: current.darkMode,
      glassMode: current.glassMode,
      glassTheme: current.glassTheme,
      timers: current.timers,
      timeTrackingExpanded: current.timeTrackingExpanded,
      timeTracking: current.timeTracking,
      taskCategories: current.taskCategories,
      quickAccessExpanded: current.quickAccessExpanded,
      selectorModeActive: current.selectorModeActive,
      quickAccessItems: current.quickAccessItems,
      tasks: current.tasks || [],
      completedTasks: current.completedTasks || [],
      projects: current.projects || [],
      ideas: current.ideas || [],
      meetings: current.meetings || [],
      subtaskTemplates: current.subtaskTemplates || [],
    };

    // An import is the one explicit "replace": the next cloud sync sends this copy
    // as it is (only the time log merged, its resetAt dropping older history)
    // instead of merging it (sync.js). Kept in the copy until that sync is done
    const storageKey = getActiveStorageKey();
    const scoped = storageKey !== STORAGE_KEY;
    payload._sync = makeSyncStamp();
    if (scoped && getStoredBase(storageKey)) payload._base = getStoredBase(storageKey);
    if (scoped) payload._replace = true;

    // Add ALL sections - all are now unified format
    current.sections.forEach(section => {
      if (current[section.id]) {
        payload[section.id] = current[section.id];
      }
    });

    const json = JSON.stringify(payload);
    try {
      localStorage.setItem(storageKey, json);
    } catch (error) {
      if (error.name === 'QuotaExceededError') {
        // Emergency cleanup - remove ALL backup entries
        cleanupOldBackups();
        // Try again
        localStorage.setItem(storageKey, json);
      } else {
        throw error;
      }
    }
    noteStoredCopy(storageKey, json);
    noteReplacePending(storageKey, scoped);
    // Mark for cloud sync after import
    markCloudDirty();
  } else {
    saveModel();
  }
}

// ===== Add back from a backup file =====
// Puts what a backup holds and this dashboard lacks back into it, without
// changing or removing anything the dashboard holds now (Settings → JSON File
// Backup → Add back…, More → Backup → Add back… on a phone). How recovered data
// (an export, or a profile read out of a D1 restore) goes back in.
//   tasks / completed tasks  an id in either list now is left alone (kept,
//                            changed or completed since); a missing active task
//                            goes to the end of its colour, a missing completed
//                            one to Completed
//   categories               the dashboard's own list stands and missing ones are
//                            added (the ones a task uses first) while a colour slot
//                            is free (8); a dashboard still on the new-dashboard
//                            defaults takes the backup's list (a default a task
//                            uses stays)
//   subtask templates, projects, meetings, ideas   by id
//   cards                    a missing card comes back whole (title, icon, colours,
//                            its notes), below the others; a card both have gets
//                            its missing sections and the items whose key it lacks
//   card notes, subtask notes   by note key
// Never touched: the header, the theme, Quick Access, the time log, the layout
// of the cards already here. Both inputs are left as they are.

const AB_MAX_PROFILE_BYTES = 2 * 1024 * 1024;
const abIsObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const abArr = (v) => (Array.isArray(v) ? v : []);
const abClone = (v) => JSON.parse(JSON.stringify(v));
const AB_SECTION_MAPS = ['sectionTitles', 'sectionIcons', 'sectionColors', 'subtitleColors', 'collapsedSubtitles', 'collapsedCards', 'cardNotes', 'subtaskNotes'];

// A Settings export keeps the cards' structure under _structure; a cloud
// profile (a D1 recovery) has it at the top. Either becomes a profile
function backupAsProfile(b) {
  if (!abIsObj(b)) return null;
  const s = abIsObj(b._structure) ? b._structure : {};
  const p = {};
  ['sections', 'header', ...AB_SECTION_MAPS].forEach(k => { p[k] = s[k] !== undefined ? s[k] : b[k]; });
  ['tasks', 'completedTasks', 'taskCategories', 'subtaskTemplates', 'projects', 'meetings', 'ideas'].forEach(k => { p[k] = b[k]; });
  abArr(p.sections).forEach(sec => { if (abIsObj(sec) && sec.id && abIsObj(b[sec.id])) p[sec.id] = b[sec.id]; });
  return p;
}

const isUnifiedGroup = (g) => abIsObj(g) && ITEM_TYPES.some(t => Array.isArray(g[t]));

// One section of card items as the dashboard stores it (an export's reminders
// in its JSON shape, like an import reads them)
function groupFromBackup(g) {
  const out = {};
  ITEM_TYPES.forEach(t => {
    const items = abArr(g[t]).filter(abIsObj).map(abClone);
    out[t] = t === 'reminders' ? items.map(r => convertReminderFromJson(r)) : items;
  });
  return out;
}

function isDefaultCategories(list) {
  if (!Array.isArray(list)) return true;          // missing: the app shows the defaults
  if (list.length !== DEFAULT_TASK_CATEGORIES.length) return false;
  return DEFAULT_TASK_CATEGORIES.every((d, i) => abIsObj(list[i]) && list[i].id === d.id && String(list[i].name || '').trim() === d.name);
}

function titleOf(p, section) {
  const t = abIsObj(p.sectionTitles) ? p.sectionTitles[section.id] : undefined;
  return (typeof t === 'string' && t) || section.title || '';
}

// Notes of one bucket (a card's, or a subtask's): the ones whose key isn't there
function addMissingNotes(curBuckets, bakBuckets, bucketIds, report) {
  bucketIds.forEach(id => {
    const bak = bakBuckets[id];
    const cur = curBuckets[id];
    if (cur === undefined) {
      if (bak === undefined || (Array.isArray(bak) && !bak.length) || bak === '') return;
      curBuckets[id] = abClone(bak);
      report.notes += Array.isArray(bak) ? bak.length : 1;
      return;
    }
    if (!Array.isArray(cur) || !Array.isArray(bak)) return;   // an old single note: left as it is
    const keys = new Set(cur.filter(abIsObj).map(n => n.key));
    bak.filter(n => abIsObj(n) && n.key && !keys.has(n.key)).forEach(n => {
      cur.push(abClone(n));
      keys.add(n.key);
      report.notes++;
    });
  });
}

export function mergeBackupInto(current, backup) {
  const merged = abClone(abIsObj(current) ? current : {});
  const report = { tasks: 0, completed: 0, categories: [], categoriesLeftOut: [], templates: 0, projects: 0, meetings: 0, ideas: 0, cards: 0, items: 0, notes: 0, total: 0, lines: [], summary: '' };
  const bak = backupAsProfile(backup);
  if (!bak) return { merged, report };

  // --- Tasks and completed tasks, by id
  merged.tasks = abArr(merged.tasks);
  merged.completedTasks = abArr(merged.completedTasks);
  const present = new Set([...merged.tasks, ...merged.completedTasks].filter(abIsObj).map(t => t.id));
  const maxOrder = {};
  merged.tasks.filter(abIsObj).forEach(t => {
    const o = Number(t.order);
    if (Number.isFinite(o)) maxOrder[t.color] = Math.max(maxOrder[t.color] ?? -1, o);
  });
  abArr(bak.completedTasks).filter(t => abIsObj(t) && t.id && !present.has(t.id)).forEach(t => {
    merged.completedTasks.push(abClone(t));
    present.add(t.id);
    report.completed++;
  });
  abArr(bak.tasks).filter(t => abIsObj(t) && t.id && !present.has(t.id))
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))
    .forEach(t => {
      const task = abClone(t);
      const next = (maxOrder[task.color] ?? -1) + 1;
      maxOrder[task.color] = next;
      task.order = next;
      merged.tasks.push(task);
      present.add(task.id);
      report.tasks++;
    });

  // --- Categories
  if (Array.isArray(bak.taskCategories) && bak.taskCategories.length) {
    const cur = abArr(merged.taskCategories).filter(abIsObj);
    const used = new Set([...merged.tasks, ...merged.completedTasks].filter(abIsObj).map(t => t.categoryId).filter(Boolean));
    const from = bak.taskCategories.filter(c => abIsObj(c) && typeof c.id === 'string' && c.id && String(c.name || '').trim());
    let next;
    if (isDefaultCategories(merged.taskCategories) && !isDefaultCategories(bak.taskCategories)) {
      // Never chosen here: the backup's list, and any default a task uses
      next = [...from.map(abClone), ...cur.filter(c => used.has(c.id) && !from.some(b => b.id === c.id))];
    } else {
      next = [...cur];
      const ids = new Set(cur.map(c => c.id));
      // Overflow categories (no colour slot) don't use one of the 8 slots
      const coloured = () => next.filter(c => !c.overflow).length;
      const missing = from.filter(c => !ids.has(c.id))
        .map((c, i) => ({ c, i }))
        .sort((x, y) => (used.has(y.c.id) ? 1 : 0) - (used.has(x.c.id) ? 1 : 0) || x.i - y.i)
        .map(x => x.c);
      missing.forEach(c => {
        if (coloured() >= MAX_TASK_CATEGORIES) { report.categoriesLeftOut.push(String(c.name).trim()); return; }
        next.push(abClone(c));
        ids.add(c.id);
      });
    }
    const before = new Set(cur.map(c => c.id));
    merged.taskCategories = normalizeTaskCategories(next);
    report.categories = merged.taskCategories.filter(c => !before.has(c.id)).map(c => c.name);
  }

  // --- Templates, projects, meetings, ideas: by id
  [['subtaskTemplates', 'templates'], ['projects', 'projects'], ['meetings', 'meetings'], ['ideas', 'ideas']].forEach(([k, r]) => {
    merged[k] = abArr(merged[k]);
    const ids = new Set(merged[k].filter(abIsObj).map(d => d.id));
    abArr(bak[k]).filter(d => abIsObj(d) && d.id && !ids.has(d.id)).forEach(d => {
      merged[k].push(abClone(d));
      ids.add(d.id);
      report[r]++;
    });
  });

  // --- Cards and their items
  merged.sections = abArr(merged.sections);
  AB_SECTION_MAPS.forEach(k => { if (!abIsObj(merged[k])) merged[k] = {}; });
  const bakMaps = {};
  AB_SECTION_MAPS.forEach(k => { bakMaps[k] = abIsObj(bak[k]) ? bak[k] : {}; });
  const takenIds = new Set([...merged.sections.filter(abIsObj).map(s => s.id), ...Object.keys(merged)]);
  abArr(bak.sections).filter(s => abIsObj(s) && s.id && s.type !== 'header').forEach(bs => {
    const bakCard = abIsObj(bak[bs.id]) ? bak[bs.id] : {};
    const here = merged.sections.find(s => abIsObj(s) && s.id === bs.id);
    // The same id for another card (older builds numbered new cards): a different
    // title and no item in common
    const sameCard = here && (titleOf(merged, here) === titleOf(bak, bs) || ITEM_TYPES.some(t => {
      const keys = cardItemKeys(merged[bs.id], t);
      return cardItemsOfType(bakCard, t).some(i => abIsObj(i) && keys.has(i.key));
    }));
    if (here && sameCard) {
      const card = abIsObj(merged[bs.id]) ? merged[bs.id] : (merged[bs.id] = {});
      Object.entries(bakCard).forEach(([sub, g]) => {
        if (!isUnifiedGroup(g)) return;
        if (!abIsObj(card[sub])) {
          const group = groupFromBackup(g);
          const n = ITEM_TYPES.reduce((sum, t) => sum + group[t].length, 0);
          if (!n) return;
          card[sub] = group;
          report.items += n;
          return;
        }
        ITEM_TYPES.forEach(t => {
          const keys = cardItemKeys(card, t);
          const list = Array.isArray(card[sub][t]) ? card[sub][t] : (card[sub][t] = []);
          groupFromBackup({ [t]: g[t] })[t]
            .filter(i => i.key && !keys.has(i.key) && !(t === 'icons' && (i.isDivider || i.isSeparator)))
            .forEach(i => { list.push(i); keys.add(i.key); report.items++; });
        });
      });
      addMissingNotes(merged.cardNotes, bakMaps.cardNotes, [bs.id], report);
      addMissingNotes(merged.subtaskNotes, bakMaps.subtaskNotes, Object.keys(bakMaps.subtaskNotes).filter(id => id.startsWith(bs.id + ':')), report);
      return;
    }
    // A card this dashboard lacks: whole, under a free id when its id is taken,
    // without a layout (it is placed below the other cards)
    let id = bs.id;
    if (takenIds.has(id)) { let n = 2; while (takenIds.has(`${bs.id}-${n}`)) n++; id = `${bs.id}-${n}`; }
    takenIds.add(id);
    const section = abClone(bs);
    section.id = id;
    delete section.layouts;
    ['gridCol', 'gridRow', 'gridColSpan', 'gridRowSpan', 'gridSpan'].forEach(k => { delete section[k]; });
    merged.sections.push(section);
    const card = {};
    Object.entries(bakCard).forEach(([sub, g]) => { if (isUnifiedGroup(g)) card[sub] = groupFromBackup(g); });
    merged[id] = card;
    report.cards++;
    ['sectionTitles', 'sectionIcons', 'sectionColors', 'collapsedCards'].forEach(k => {
      if (bakMaps[k][bs.id] !== undefined && merged[k][id] === undefined) merged[k][id] = abClone(bakMaps[k][bs.id]);
    });
    ['subtitleColors', 'collapsedSubtitles'].forEach(k => {
      Object.keys(bakMaps[k]).filter(x => x.startsWith(bs.id + ':')).forEach(x => {
        const nk = id + x.slice(bs.id.length);
        if (merged[k][nk] === undefined) merged[k][nk] = abClone(bakMaps[k][x]);
      });
    });
    if (bakMaps.cardNotes[bs.id] !== undefined && merged.cardNotes[id] === undefined) {
      merged.cardNotes[id] = abClone(bakMaps.cardNotes[bs.id]);
      report.notes += Array.isArray(merged.cardNotes[id]) ? merged.cardNotes[id].length : 1;
    }
    Object.keys(bakMaps.subtaskNotes).filter(x => x.startsWith(bs.id + ':')).forEach(x => {
      const nk = id + x.slice(bs.id.length);
      if (merged.subtaskNotes[nk] !== undefined) return;
      merged.subtaskNotes[nk] = abClone(bakMaps.subtaskNotes[x]);
      report.notes += Array.isArray(merged.subtaskNotes[nk]) ? merged.subtaskNotes[nk].length : 1;
    });
  });

  // --- The report
  const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
  const parts = [];
  if (report.tasks) parts.push(plural(report.tasks, 'task'));
  if (report.completed) parts.push(plural(report.completed, 'completed task'));
  if (report.categories.length) parts.push(plural(report.categories.length, 'category', 'categories'));
  if (report.templates) parts.push(plural(report.templates, 'subtask template'));
  if (report.projects) parts.push(plural(report.projects, 'project'));
  if (report.meetings) parts.push(plural(report.meetings, 'meeting'));
  if (report.ideas) parts.push(plural(report.ideas, 'idea'));
  if (report.cards) parts.push(plural(report.cards, 'card'));
  if (report.items) parts.push(plural(report.items, 'card item'));
  if (report.notes) parts.push(plural(report.notes, 'note'));
  report.total = report.tasks + report.completed + report.categories.length + report.templates + report.projects +
    report.meetings + report.ideas + report.cards + report.items + report.notes;
  report.lines = parts.map(p => `• ${p}`);
  if (report.categories.length) report.lines.push(`Categories: ${report.categories.join(', ')}`);
  if (report.categoriesLeftOut.length) report.lines.push(`No free slot (8 at most) for: ${report.categoriesLeftOut.join(', ')}`);
  report.summary = parts.join(', ');
  return { merged, report };
}

// The flow behind the Add back… buttons: read the file, say what comes back,
// and on Confirm put it into this dashboard (the one on screen, never another
// account's), then sync. Refused in edit mode (the working copy would hide it,
// and Confirm would write over it)
export async function addBackFromBackupFile(file) {
  if (!file) return { ok: false };
  if (editState.enabled) { showToast('Save or cancel your edits first, then add back'); return { ok: false, reason: 'editing' }; }
  const owner = getDataOwner();
  const key = getActiveStorageKey();
  let backup = null;
  try { backup = JSON.parse(await file.text()); } catch (e) { backup = null; }
  if (!abIsObj(backup) || !(Array.isArray(backup.tasks) || Array.isArray(backup.sections) || abIsObj(backup._structure))) {
    showToast('That file isn’t a dashboard backup');
    return { ok: false, reason: 'invalid' };
  }
  // Signed in or out, or edit mode opened, while the file was read: not this dashboard any more
  const stillHere = () => !editState.enabled && getDataOwner() === owner && getActiveStorageKey() === key;
  if (!stillHere()) return { ok: false, reason: 'changed' };

  const readCurrent = () => {
    let raw = localStorage.getItem(key);
    if (!raw) { saveModel(); raw = localStorage.getItem(key); }
    return raw;
  };
  let raw = readCurrent();
  let current;
  try { current = JSON.parse(raw); } catch (e) { current = null; }
  if (!abIsObj(current)) { showToast('This dashboard couldn’t be read, so nothing was added'); return { ok: false, reason: 'unreadable' }; }
  let { merged, report } = mergeBackupInto(current, backup);
  if (!report.total) {
    showToast('Nothing to add back: everything in this backup is already here');
    return { ok: true, added: 0, report };
  }
  const name = file.name ? `“${file.name}”` : 'the backup';
  const question = `Add back from ${name}:\n${report.lines.join('\n')}\n\nNothing on this dashboard is changed or removed.`;
  if (!window.confirm(question)) return { ok: false, reason: 'cancelled', report };
  if (!stillHere()) return { ok: false, reason: 'changed' };

  // The copy may have changed while the question was open (another tab): merge into it as it is now
  const rawNow = readCurrent();
  if (rawNow !== raw) {
    raw = rawNow;
    try { current = JSON.parse(raw); } catch (e) { current = null; }
    if (!abIsObj(current)) return { ok: false, reason: 'unreadable' };
    ({ merged, report } = mergeBackupInto(current, backup));
  }
  merged._sync = makeSyncStamp();
  const json = JSON.stringify(merged);
  if (new TextEncoder().encode(json).byteLength > AB_MAX_PROFILE_BYTES) {
    showToast('Adding all of it would pass the 2 MB dashboard limit, so nothing was added');
    return { ok: false, reason: 'too_big', report };
  }
  try {
    localStorage.setItem(key, json);
  } catch (e) {
    showToast('This browser’s storage is full, so nothing was added');
    return { ok: false, reason: 'storage', report };
  }
  noteStoredCopy(key, json);
  markCloudDirty(key);
  resetModel();
  await restoreModel();
  rerenderDashboard();
  showToast(`Added back: ${report.summary}`);
  if (isLoggedIn() && getDataOwner() === owner) cloudSave(null, { quiet: true, reason: 'add-back' });
  return { ok: true, added: report.total, report };
}
