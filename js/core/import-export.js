// Personal Dashboard - Import/Export Module
// Handles JSON import/export functionality
//
// NOTE: The full implementations of these functions remain in app.js due to their
// complexity and extensive dependencies. This module provides the interface for
// future migration. The window.* exports allow gradual transition.

import { model, editState, currentData } from '../state.js';
import { PLACEHOLDER_URL, APP_VERSION, STORAGE_KEY, LINKS_FILE_PATH } from '../constants.js';
import { saveModel, cleanupOldBackups } from './storage.js';

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
  const sectionsIcon = ['dailyTasks','dailyTools','contentCreation','ads'];
  const sectionsList = ['analytics','tools'];
  const obj = {};

  // Extract COMPLETE data from standard sections
  sectionsIcon.forEach(sec => {
    if (data[sec] && Array.isArray(data[sec])) {
      obj[sec] = data[sec].map(i => ({
        key: i.key,
        url: i.url || PLACEHOLDER_URL,
        title: i.title || '',
        icon: i.icon || '',
        isDivider: !!i.isDivider
      }));
    }
  });

  sectionsList.forEach(sec => {
    if (data[sec] && Array.isArray(data[sec])) {
      obj[sec] = data[sec].map(i => ({
        key: i.key,
        url: i.url || PLACEHOLDER_URL,
        text: i.text || '',
        links: i.links || []
      }));
    }
  });

  // Extract from dynamic sections
  data.sections.forEach(section => {
    if (data[section.id]) {
      if (section.type === 'newCard' && Array.isArray(data[section.id])) {
        obj[section.id] = data[section.id].map(i => ({
          key: i.key,
          url: i.url || PLACEHOLDER_URL,
          title: i.title || '',
          icon: i.icon || '',
          isDivider: !!i.isDivider,
          isFile: !!i.isFile,
          fileName: i.fileName || '',
          fileSize: i.fileSize || 0,
          fileType: i.fileType || ''
        }));
      } else if (section.type === 'newCardAnalytics' && Array.isArray(data[section.id])) {
        obj[section.id] = data[section.id].map(i => ({
          key: i.key,
          url: i.url || PLACEHOLDER_URL,
          text: i.text || '',
          links: i.links || []
        }));
      } else if (section.type === 'copyPaste' && typeof data[section.id] === 'object') {
        obj[section.id] = {};
        Object.entries(data[section.id]).forEach(([subtitle, items]) => {
          if (Array.isArray(items)) {
            obj[section.id][subtitle] = items.map(i => ({
              key: i.key,
              text: i.text || '',
              copyText: i.copyText || ''
            }));
          }
        });
      } else if (section.type === 'reminders' && typeof data[section.id] === 'object') {
        obj[section.id] = {};
        Object.entries(data[section.id]).forEach(([subtitle, reminders]) => {
          if (Array.isArray(reminders)) {
            obj[section.id][subtitle] = reminders.map(r => convertReminderToJson(r));
          }
        });
      }
    }
  });

  // Handle original reminders
  if (data.reminders && typeof data.reminders === 'object') {
    obj.reminders = {};
    Object.entries(data.reminders).forEach(([subtitle, reminders]) => {
      if (Array.isArray(reminders)) {
        obj.reminders[subtitle] = reminders.map(r => convertReminderToJson(r));
      }
    });
  }

  // Structure information
  obj._structure = {
    sections: data.sections,
    sectionsStacked: data.sectionsStacked,
    sectionTitles: data.sectionTitles,
    sectionColors: data.sectionColors || {},
    subtitleColors: data.subtitleColors || {},
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
  if (data._structure) {
    if (data._structure.sections && Array.isArray(data._structure.sections)) {
      current.sections = data._structure.sections;
    }
    // Restore sectionsStacked (separate section order for stacked mode)
    if (data._structure.sectionsStacked && Array.isArray(data._structure.sectionsStacked)) {
      current.sectionsStacked = data._structure.sectionsStacked;
    }
    if (data._structure.sectionTitles) {
      current.sectionTitles = data._structure.sectionTitles;
    }
    // Restore section colors (independent light/dark mode colors)
    if (data._structure.sectionColors && typeof data._structure.sectionColors === 'object') {
      current.sectionColors = data._structure.sectionColors;
    }
    // Restore subtitle colors (independent light/dark mode colors)
    if (data._structure.subtitleColors && typeof data._structure.subtitleColors === 'object') {
      current.subtitleColors = data._structure.subtitleColors;
    }
    if (data._structure.header) {
      current.header = data._structure.header;
    }
  }

  // Apply URL overrides to standard sections
  const sectionsIcon = ['dailyTasks','dailyTools','contentCreation','ads'];
  const sectionsList = ['analytics','tools'];

  sectionsIcon.forEach(sec => {
    if (data[sec] && Array.isArray(data[sec]) && current[sec]) {
      data[sec].forEach(override => {
        const item = current[sec].find(i => i.key === override.key);
        if (item && override.url) {
          item.url = override.url;
        }
      });
    }
  });

  sectionsList.forEach(sec => {
    if (data[sec] && Array.isArray(data[sec]) && current[sec]) {
      data[sec].forEach(override => {
        const item = current[sec].find(i => i.key === override.key);
        if (item && override.url) {
          item.url = override.url;
        }
      });
    }
  });

  // Apply to standard sections with enhanced data - REPLACE ENTIRE ARRAYS
  const applySection = (sec) => {
    if (!data[sec]) return;

    // Handle both old object format and new array format
    if (Array.isArray(data[sec])) {
      // New array format - direct replacement
      current[sec] = data[sec].map(item => ({
        key: item.key,
        url: item.url || PLACEHOLDER_URL,
        title: item.title || '',
        text: item.text || '',
        icon: item.icon || '',
        isDivider: item.isDivider || false,
        isFile: item.isFile || false,
        fileName: item.fileName || '',
        fileSize: item.fileSize || 0,
        fileType: item.fileType || '',
        links: item.links || []
      }));
    } else if (typeof data[sec] === 'object') {
      // Old object format - convert to array
      const items = [];
      Object.entries(data[sec]).forEach(([key, itemData]) => {
        items.push({
          key: key,
          url: itemData.url || PLACEHOLDER_URL,
          title: itemData.title || '',
          text: itemData.text || '',
          icon: itemData.icon || '',
          isDivider: itemData.isDivider || false,
          isFile: itemData.isFile || false,
          fileName: itemData.fileName || '',
          fileSize: itemData.fileSize || 0,
          fileType: itemData.fileType || '',
          links: itemData.links || []
        });
      });
      current[sec] = items;
    }
  };

  ['dailyTasks','dailyTools','contentCreation','ads','analytics','tools'].forEach(sec => applySection(sec));

  // Apply to ALL dynamic sections (including new independent cards) - REPLACE ENTIRE DATA
  current.sections.forEach(section => {
    if (data[section.id]) {
      if (section.type === 'newCard') {
        // Regular new cards (icon grid style) - handle both formats
        if (Array.isArray(data[section.id])) {
          // New array format
          current[section.id] = data[section.id].map(item => ({
            key: item.key,
            url: item.url || PLACEHOLDER_URL,
            title: item.title || '',
            icon: item.icon || '',
            isDivider: item.isDivider || false
          }));
        } else if (typeof data[section.id] === 'object') {
          // Old object format - convert to array
          const items = [];
          Object.entries(data[section.id]).forEach(([key, itemData]) => {
            items.push({
              key: key,
              url: itemData.url || PLACEHOLDER_URL,
              title: itemData.title || '',
              icon: itemData.icon || '',
              isDivider: itemData.isDivider || false
            });
          });
          current[section.id] = items;
        }
      } else if (section.type === 'newCardAnalytics') {
        // Analytics-style new cards (list style) - handle both formats
        if (Array.isArray(data[section.id])) {
          // New array format
          current[section.id] = data[section.id].map(item => ({
            key: item.key,
            url: item.url || PLACEHOLDER_URL,
            text: item.text || '',
            links: item.links || []
          }));
        } else if (typeof data[section.id] === 'object') {
          // Old object format - convert to array
          const items = [];
          Object.entries(data[section.id]).forEach(([key, itemData]) => {
            items.push({
              key: key,
              url: itemData.url || PLACEHOLDER_URL,
              text: itemData.text || '',
              links: itemData.links || []
            });
          });
          current[section.id] = items;
        }
      } else if (section.type === 'copyPaste') {
        // Copy-paste cards with subtitle structure
        if (typeof data[section.id] === 'object' && !Array.isArray(data[section.id])) {
          current[section.id] = {};
          Object.entries(data[section.id]).forEach(([subtitle, items]) => {
            if (Array.isArray(items)) {
              current[section.id][subtitle] = items.map(item => ({
                key: item.key,
                text: item.text || '',
                copyText: item.copyText || ''
              }));
            }
          });
        }
      } else if (section.type === 'reminders' && typeof data[section.id] === 'object') {
        // Independent reminder sections - REPLACE ENTIRE OBJECT
        current[section.id] = {};
        Object.entries(data[section.id]).forEach(([subtitle, reminders]) => {
          if (Array.isArray(reminders)) {
            current[section.id][subtitle] = reminders.map(r => convertReminderFromJson(r));
          }
        });
      }
    }
  });

  // Handle original reminders section with subtitle structure - REPLACE ENTIRE OBJECT
  if (data.reminders && typeof data.reminders === 'object') {
    current.reminders = {};
    Object.entries(data.reminders).forEach(([subtitle, reminders]) => {
      if (Array.isArray(reminders)) {
        current.reminders[subtitle] = reminders.map(r => convertReminderFromJson(r));
      }
    });
  }

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
      sections: current.sections,
      sectionsStacked: current.sectionsStacked,
      sectionTitles: current.sectionTitles,
      sectionColors: current.sectionColors,
      subtitleColors: current.subtitleColors,
      header: current.header,
      darkMode: current.darkMode,
      reminders: current.reminders,
      dailyTasks: current.dailyTasks,
      dailyTools: current.dailyTools,
      contentCreation: current.contentCreation,
      ads: current.ads,
      analytics: current.analytics,
      tools: current.tools,
      timers: current.timers,
      timeTrackingExpanded: current.timeTrackingExpanded,
      quickAccessExpanded: current.quickAccessExpanded,
      selectorModeActive: current.selectorModeActive,
      quickAccessItems: current.quickAccessItems,
      displayMode: current.displayMode,
    };

    // Add dynamic sections (including independent reminders and copy-paste)
    current.sections.forEach(section => {
      if ((section.type === 'newCard' || section.type === 'newCardAnalytics' || section.type === 'copyPaste' || section.type === 'reminders') && current[section.id]) {
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
