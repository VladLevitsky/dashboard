// Personal Dashboard - Import/Export Module
// Handles JSON import/export functionality
//
// NOTE: The full implementations of these functions remain in app.js due to their
// complexity and extensive dependencies. This module provides the interface for
// future migration. The window.* exports allow gradual transition.

import { model, editState, currentData } from '../state.js';
import { PLACEHOLDER_URL, APP_VERSION, STORAGE_KEY, LINKS_FILE_PATH } from '../constants.js';
import { saveModel, cleanupOldBackups, migrateToUnifiedCards } from './storage.js';

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
            // Regular icons have url and title
            icon.url = i.url || PLACEHOLDER_URL;
            icon.title = i.title || '';
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
  obj.schemaVersion = data.schemaVersion || 3;

  // Structure information
  obj._structure = {
    sections: data.sections,
    sectionsStacked: data.sectionsStacked,
    sectionTitles: data.sectionTitles,
    sectionIcons: data.sectionIcons || {},
    sectionColors: data.sectionColors || {},
    subtitleColors: data.subtitleColors || {},
    collapsedSubtitles: data.collapsedSubtitles || {},
    header: data.header
  };

  // UI state
  obj.darkMode = data.darkMode || false;
  obj.timeTrackingExpanded = data.timeTrackingExpanded || false;
  obj.quickAccessExpanded = data.quickAccessExpanded || false;
  obj.selectorModeActive = data.selectorModeActive || false;
  obj.displayMode = data.displayMode || 'normal';
  obj.quickAccessItems = data.quickAccessItems || { icons: [], listItems: [] };
  obj.timers = data.timers || [];

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
  console.log('[Migration] Starting migration. Legacy types:', legacyTypes);
  console.log('[Migration] Sections to process:', model.sections?.map(s => ({ id: s.id, type: s.type })));

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
          console.log(`[Migration] Found data at type key '${section.type}' instead of id '${sectionId}'`);
        }

        // Extract items from various formats
        const oldData = extractItems(rawData);
        console.log(`[Migration] Processing ${section.type} section: ${sectionId}`);
        console.log(`[Migration] Raw data for ${dataKey}:`, rawData);
        console.log(`[Migration] Extracted items:`, oldData);

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
                      }
                      return icon;
                    }),
                    reminders: [],
                    subtasks: [],
                    copyPaste: []
                  }
                };
                console.log(`[Migration] Migrated newCard ${sectionId} with ${oldData.length} icons`);
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
                console.log(`[Migration] Migrated newCardAnalytics ${sectionId} with ${oldData.length} subtasks`);
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
                console.log(`[Migration] Migrated copyPaste ${sectionId} with subtitles:`, Object.keys(migrated));
              }
              break;

            case 'reminders':
              // Reminders with subtitles: { "Sub": [reminders] } → { "Sub": { icons: [], reminders: [...], subtasks: [], copyPaste: [] }}
              if (typeof oldData === 'object' && !Array.isArray(oldData)) {
                const migrated = {};
                Object.entries(oldData).forEach(([subtitle, items]) => {
                  console.log(`[Migration] Processing reminders subtitle "${subtitle}":`, items);
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
                    console.log(`[Migration] Migrated ${items.length} reminders for subtitle "${subtitle}"`);
                  } else if (items && typeof items === 'object' && items.reminders) {
                    // Already in unified format - keep it
                    migrated[subtitle] = items;
                    console.log(`[Migration] Subtitle "${subtitle}" already in unified format`);
                  }
                });
                data[sectionId] = migrated;
                console.log(`[Migration] Final migrated data for ${sectionId}:`, data[sectionId]);
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
                      }
                      return icon;
                    }),
                    reminders: [],
                    subtasks: [],
                    copyPaste: []
                  }
                };
                console.log(`[Migration] Migrated icon card ${sectionId} with ${oldData.length} icons`);
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
                console.log(`[Migration] Migrated list card ${sectionId} with ${oldData.length} subtasks`);
              }
              break;
          }
          // If data was at type key (not id key), clean up the old key
          if (dataKey !== sectionId && data[dataKey]) {
            delete data[dataKey];
            console.log(`[Migration] Cleaned up old data key '${dataKey}'`);
          }
        } else {
          console.log(`[Migration] No data found for section ${sectionId}`);
        }

        // Update section type to 'unified'
        section.type = 'unified';
        console.log(`[Migration] Changed section ${sectionId} type to 'unified'`);
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

  console.log('[Migration] Migration complete');
}

// --- Apply URL overrides from imported JSON
export function applyUrlOverrides(data) {
  console.log('[Import] applyUrlOverrides called with data:', data);
  console.log('[Import] Data keys:', Object.keys(data || {}));
  console.log('[Import] schemaVersion:', data?.schemaVersion);
  console.log('[Import] _structure:', data?._structure);

  if (!data || typeof data !== 'object') return;
  // Don't apply overrides if localStorage has already been restored
  if (window.localStorageRestored) {
    console.log('[Import] Skipping - localStorage already restored');
    return;
  }
  // Always operate on model, not editState.working
  const current = model;

  // IMPORTANT: Apply structure FIRST so new sections are recognized before data import
  // Handle both new format (data._structure) and old format (data.sections directly)
  const structure = data._structure || data;
  console.log('[Import] Using structure:', structure);
  console.log('[Import] Structure sections:', structure?.sections);

  if (structure.sections && Array.isArray(structure.sections)) {
    current.sections = structure.sections;
    console.log('[Import] Applied sections to model:', current.sections.map(s => ({ id: s.id, type: s.type })));
  }
  // Restore sectionsStacked (separate section order for stacked mode)
  if (structure.sectionsStacked && Array.isArray(structure.sectionsStacked)) {
    current.sectionsStacked = structure.sectionsStacked;
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
  current.schemaVersion = 3;

  // Apply to ALL sections - all are now unified format
  // Helper function to import unified card data
  const importUnifiedCard = (sectionId, sectionData) => {
    if (!sectionData || typeof sectionData !== 'object') return null;

    const imported = {};
    Object.entries(sectionData).forEach(([subtitle, items]) => {
      // FALLBACK: If items is an array (old format), detect and convert on-the-fly
      if (Array.isArray(items)) {
        console.log(`[Import] Detected old array format for ${sectionId}/${subtitle}, converting...`);
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
            // Regular icons have url and title
            icon.url = i.url || PLACEHOLDER_URL;
            icon.title = i.title || '';
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

  console.log('[Import] Processing ALL sections as unified:', current.sections.map(s => ({ id: s.id, type: s.type })));
  current.sections.forEach(section => {
    console.log(`[Import] Section ${section.id}: type=${section.type}, hasData=${!!data[section.id]}`);
    if (data[section.id] && typeof data[section.id] === 'object' && !Array.isArray(data[section.id])) {
      const imported = importUnifiedCard(section.id, data[section.id]);
      if (imported) {
        current[section.id] = imported;
        console.log(`[Import] Applied unified data to ${section.id}`);
      }
    }
  });

  // Note: _structure is now applied at the beginning of this function

  // Apply UI state and preferences
  if (typeof data.darkMode === 'boolean') {
    current.darkMode = data.darkMode;
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

  // Apply display mode
  if (data.displayMode === 'normal' || data.displayMode === 'stacked') {
    current.displayMode = data.displayMode;
  }

  // Apply quick access items
  if (data.quickAccessItems && typeof data.quickAccessItems === 'object') {
    current.quickAccessItems = {
      icons: Array.isArray(data.quickAccessItems.icons) ? data.quickAccessItems.icons : [],
      listItems: Array.isArray(data.quickAccessItems.listItems) ? data.quickAccessItems.listItems : []
    };
  }

  // Apply timers data
  if (data.timers && Array.isArray(data.timers)) {
    current.timers = data.timers;
  }

  // Synchronize editState.working if in edit mode
  if (editState.enabled && editState.working) {
    editState.working = JSON.parse(JSON.stringify(model));
  }

  // Save the restored data to localStorage so it persists
  // Only save to localStorage, not to JSON file during import
  if (window.isImporting) {
    // During import, only save to localStorage without triggering JSON file save
    const payload = {
      schemaVersion: current.schemaVersion || 3,
      sections: current.sections,
      sectionsStacked: current.sectionsStacked,
      sectionTitles: current.sectionTitles,
      sectionIcons: current.sectionIcons,
      sectionColors: current.sectionColors,
      subtitleColors: current.subtitleColors,
      collapsedSubtitles: current.collapsedSubtitles,
      header: current.header,
      darkMode: current.darkMode,
      timers: current.timers,
      timeTrackingExpanded: current.timeTrackingExpanded,
      quickAccessExpanded: current.quickAccessExpanded,
      selectorModeActive: current.selectorModeActive,
      quickAccessItems: current.quickAccessItems,
      displayMode: current.displayMode,
    };

    // Add ALL sections - all are now unified format
    current.sections.forEach(section => {
      if (current[section.id]) {
        payload[section.id] = current[section.id];
      }
    });

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      if (error.name === 'QuotaExceededError') {
        // Emergency cleanup - remove ALL backup entries
        cleanupOldBackups();
        // Try again
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      } else {
        throw error;
      }
    }
  } else {
    saveModel();
  }
}
