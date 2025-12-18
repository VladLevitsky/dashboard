// Personal Dashboard - fully local, no external runtime deps
// ES6 modules are loaded first via js/main.js which exposes all globals

// Verify modules are loaded
if (!window.model || !window.PLACEHOLDER_URL) {
  console.error('ES6 modules not loaded! Make sure js/main.js is loaded first.');
  throw new Error('ES6 modules required but not loaded');
}

console.log('ES6 modules detected - using module exports');

// Use window globals directly - no local variable shadowing
// All these are set by js/main.js:
// - model, editState, dragState
// - PLACEHOLDER_URL, icons, LINK_ICON_SVG, etc.
// - $, $$, showToast, deepClone, etc.
// - saveModel, restoreModel, etc.

// NOTE: All constants, model, editState, dragState, utility functions, and storage
// functions are now provided by the ES6 modules. The code below starts with
// application-specific functions that use those globals.
// --- URL overrides file (cross-device persistence)
function extractUrlOverrides() {
  const data = currentData();
  const sectionsIcon = ['dailyTasks','dailyTools','contentCreation','ads'];
  const sectionsList = ['analytics','tools'];
  const obj = {};
  
  // Extract COMPLETE data from standard sections (not just links)
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
  
  // Extract COMPLETE data from ALL dynamic sections (including new independent cards)
  data.sections.forEach(section => {
    if (data[section.id]) {
      if (section.type === 'newCard' && Array.isArray(data[section.id])) {
        // Regular new cards (icon grid style)
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
        // Analytics-style new cards (list style)
        obj[section.id] = data[section.id].map(i => ({
          key: i.key,
          url: i.url || PLACEHOLDER_URL,
          text: i.text || '',
          links: i.links || []
        }));
      } else if (section.type === 'copyPaste' && typeof data[section.id] === 'object') {
        // Copy-paste cards with subtitle structure
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
        // Independent reminder sections
        obj[section.id] = {};
        Object.entries(data[section.id]).forEach(([subtitle, reminders]) => {
          if (Array.isArray(reminders)) {
            obj[section.id][subtitle] = reminders.map(r => ({
              key: r.key,
              name: r.name || '',
              mode: r.mode || 'calendar',
              // Calendar mode fields
              scheduledDate: r.scheduledDate || null,
              repeat: r.repeat || 'none',
              weeklyInterval: r.weeklyInterval || null,
              monthlyType: r.monthlyType || null,
              // Interval mode fields
              targetNumber: r.targetNumber || null,
              currentNumber: r.currentNumber || null,
              intervalType: r.intervalType || 'limit',
              unit: r.unit || 'none',
              // Breakdown data
              breakdown: r.breakdown ? {
                locked: r.breakdown.locked || false,
                rows: Array.isArray(r.breakdown.rows) ? r.breakdown.rows.map(row => ({
                  label: row.label || '',
                  value: row.value || 0
                })) : []
              } : null,
              // Links
              links: r.links || []
            }));
          }
        });
      }
    }
  });
  
  // Handle original reminders section with subtitle structure
  if (data.reminders && typeof data.reminders === 'object') {
    obj.reminders = {};
    Object.entries(data.reminders).forEach(([subtitle, reminders]) => {
      if (Array.isArray(reminders)) {
        obj.reminders[subtitle] = reminders.map(r => ({
          key: r.key,
          name: r.name || '',
          mode: r.mode || 'calendar',
          // Calendar mode fields
          scheduledDate: r.scheduledDate || null,
          repeat: r.repeat || 'none',
          weeklyInterval: r.weeklyInterval || null,
          monthlyType: r.monthlyType || null,
          // Interval mode fields
          targetNumber: r.targetNumber || null,
          currentNumber: r.currentNumber || null,
          intervalType: r.intervalType || 'limit',
          unit: r.unit || 'none',
          // Breakdown data
          breakdown: r.breakdown ? {
            locked: r.breakdown.locked || false,
            rows: Array.isArray(r.breakdown.rows) ? r.breakdown.rows.map(row => ({
              label: row.label || '',
              value: row.value || 0
            })) : []
          } : null,
          // Links
          links: r.links || []
        }));
      }
    });
  }
  
  // Add COMPLETE structure information
  obj._structure = {
    sections: data.sections,
    sectionsStacked: data.sectionsStacked, // Separate section order for stacked mode
    sectionTitles: data.sectionTitles,
    header: data.header
  };

  // Add UI state and preferences
  obj.darkMode = data.darkMode || false;
  obj.timeTrackingExpanded = data.timeTrackingExpanded || false;
  obj.quickAccessExpanded = data.quickAccessExpanded || false;
  obj.selectorModeActive = data.selectorModeActive || false;
  obj.displayMode = data.displayMode || 'normal';

  // Add quick access items (icons and list items selected)
  obj.quickAccessItems = data.quickAccessItems || { icons: [], listItems: [] };

  // Add timers data
  obj.timers = data.timers || [];

  // Add metadata for better organization
  obj._metadata = {
    exportDate: new Date().toISOString(),
    totalSections: data.sections.length,
    sectionTypes: data.sections.map(s => ({ id: s.id, type: s.type, title: s.title })),
    version: APP_VERSION,
    description: 'Complete dashboard backup including all sections, cards, separators, timers, quick access, and UI state'
  };

  return obj;
}

function applyUrlOverrides(data) {
  if (!data || typeof data !== 'object') return;
  // Don't apply overrides if localStorage has already been restored
  if (window.localStorageRestored) {
    console.log('Skipping applyUrlOverrides - localStorage already restored');
    return;
  }
  // Always operate on model, not editState.working
  const current = model;
  console.log('applyUrlOverrides - applying URL overrides only');
  
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
      console.log(`Converting old object format for ${sec} to new array format`);
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
          console.log(`Converting old object format for dynamic section ${section.id} to new array format`);
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
          console.log(`Converting old object format for dynamic section ${section.id} to new array format`);
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
            current[section.id][subtitle] = reminders.map(r => ({
              key: r.key,
              name: r.name || '',
              mode: r.mode || 'calendar',
              // Calendar mode fields
              scheduledDate: r.scheduledDate || null,
              repeat: r.repeat || 'none',
              weeklyInterval: r.weeklyInterval || null,
              monthlyType: r.monthlyType || null,
              // Interval mode fields
              targetNumber: r.targetNumber || null,
              currentNumber: r.currentNumber || null,
              intervalType: r.intervalType || 'limit',
              unit: r.unit || 'none',
              // Breakdown data
              breakdown: r.breakdown ? {
                locked: r.breakdown.locked || false,
                rows: Array.isArray(r.breakdown.rows) ? r.breakdown.rows.map(row => ({
                  label: row.label || '',
                  value: row.value || 0
                })) : []
              } : null,
              // Links
              links: r.links || []
            }));
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
        current.reminders[subtitle] = reminders.map(r => ({
          key: r.key,
          name: r.name || '',
          mode: r.mode || 'calendar',
          // Calendar mode fields
          scheduledDate: r.scheduledDate || null,
          repeat: r.repeat || 'none',
          weeklyInterval: r.weeklyInterval || null,
          monthlyType: r.monthlyType || null,
          // Interval mode fields
          targetNumber: r.targetNumber || null,
          currentNumber: r.currentNumber || null,
          intervalType: r.intervalType || 'limit',
          unit: r.unit || 'none',
          // Breakdown data
          breakdown: r.breakdown ? {
            locked: r.breakdown.locked || false,
            rows: Array.isArray(r.breakdown.rows) ? r.breakdown.rows.map(row => ({
              label: row.label || '',
              value: row.value || 0
            })) : []
          } : null,
          // Links
          links: r.links || []
        }));
      }
    });
  }

  // Apply structure information if available (includes sections order)
  if (data._structure) {
    if (data._structure.sections && Array.isArray(data._structure.sections)) {
      current.sections = data._structure.sections;
      console.log('Applied sections order from import:', current.sections.map(s => s.id));
    }
    // Restore sectionsStacked (separate section order for stacked mode)
    if (data._structure.sectionsStacked && Array.isArray(data._structure.sectionsStacked)) {
      current.sectionsStacked = data._structure.sectionsStacked;
      console.log('Applied sectionsStacked order from import:', current.sectionsStacked.map(s => s.id));
    }
    if (data._structure.sectionTitles) {
      current.sectionTitles = data._structure.sectionTitles;
    }
    if (data._structure.header) {
      current.header = data._structure.header;
    }
  }

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

  console.log('applyUrlOverrides - sections after:', current.sections.map(s => ({ id: s.id, type: s.type })));
  
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
      sectionTitles: current.sectionTitles,
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

    // Add dynamic sections
    current.sections.forEach(section => {
      if ((section.type === 'newCard' || section.type === 'newCardAnalytics' || section.type === 'copyPaste') && current[section.id]) {
        payload[section.id] = current[section.id];
      }
    });
    
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      console.log('Saved imported data to localStorage (skipping JSON file save)');
    } catch (error) {
      if (error.name === 'QuotaExceededError') {
        console.log('localStorage quota exceeded during import, performing emergency cleanup...');
        // Emergency cleanup - remove ALL backup entries
        cleanupOldBackups();
        
        // Try again
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        console.log('Successfully saved imported data to localStorage after emergency cleanup');
      } else {
        throw error;
      }
    }
  } else {
    saveModel();
  }
}

async function loadUrlOverridesFromFile() {
  // Only load URL overrides when explicitly requested, not during normal page load
  if (window.skipUrlOverrides || window.localStorageRestored) {
    console.log('Skipping URL overrides load - localStorage already restored');
    return;
  }
  
  try {
    const res = await fetch(LINKS_FILE_PATH, { cache: 'no-cache' });
    if (!res.ok) return;
    const json = await res.json();
    applyUrlOverrides(json);
  } catch (error) {
    // Silently handle CORS errors when opening via file:// protocol
    // This is expected behavior and shouldn't break the app
    if (error.name !== 'TypeError' || !error.message.includes('CORS')) {
      console.error('Error loading URL overrides:', error);
    }
  }
}

// IndexedDB helpers to persist directory handle (no downloads)
function idbOpen() {
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
async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('handles', 'readonly');
    const store = tx.objectStore('handles');
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}
async function idbSet(key, value) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('handles', 'readwrite');
    const store = tx.objectStore('handles');
    const req = store.put(value, key);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

async function verifyPermission(handle, mode = 'readwrite') {
  if (!handle) return false;
  try {
    const opts = { mode };
    const q = await handle.queryPermission(opts);
    if (q === 'granted') return true;
    const r = await handle.requestPermission(opts);
    return r === 'granted';
  } catch { return false; }
}

async function ensureProjectDirHandle() {
  if (!window.showDirectoryPicker) return null;
  try {
    if (editState.projectDirHandle) {
      const ok = await verifyPermission(editState.projectDirHandle);
      if (ok) return editState.projectDirHandle;
    }
    const stored = await idbGet('rootDir');
    if (stored) {
      // Some browsers lose permission on reload; request if needed
      const ok = await verifyPermission(stored);
      if (ok) { editState.projectDirHandle = stored; return stored; }
    }
    return null;
  } catch { return null; }
}

async function selectProjectFolder() {
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

async function writeTextFileToProject(subpath, content) {
  try {
    let root = await ensureProjectDirHandle();
    if (!root) {
      // Don't automatically open directory picker - return false silently
      return false;
    }
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

function downloadTextFile(filename, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}

async function persistUrlOverridesToFile() {
  const json = JSON.stringify(extractUrlOverrides(), null, 2);
  return await writeTextFileToProject(LINKS_FILE_PATH, json);
}

// Utility function to map section IDs to data keys
// getSectionDataKey moved to js/utils.js
// showToast moved to js/utils.js

// --- Reminder scheduler helpers
function daysUntil(date) {
  // Ensure date is a valid Date object
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    console.warn('daysUntil called with invalid date:', date);
    return 0;
  }
  
  const today = new Date();
  // Use EST dates for consistent timezone across computers
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startOfTarget = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const msPerDay = 24 * 60 * 60 * 1000;
  const result = Math.round((startOfTarget - startOfToday) / msPerDay);
  
  // Debug logging for unusually high days calculations
  if (result > 60) { // Changed from 31 to 60 days as a more reasonable threshold
    console.warn('daysUntil: Unusually high days calculation detected:', {
      inputDate: date.toISOString(),
      today: today.toISOString(),
      startOfToday: startOfToday.toISOString(),
      startOfTarget: startOfTarget.toISOString(),
      result: result
    });
  }
  
  return result;
}

function getNextOccurrence(spec) {
  // Handle null or undefined spec
  if (!spec) {
    console.warn('getNextOccurrence called with null/undefined spec');
    return new Date(); // Return current date as default
  }
  
  // Ensure spec is a valid object
  if (typeof spec !== 'object') {
    console.warn('getNextOccurrence called with invalid spec:', spec);
    return new Date();
  }
  
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  
  if (spec.type === 'weekday') {
    // Next specific weekday with optional week interval
    const targetDow = spec.weekday; // 0=Sunday..6=Saturday, our config uses 1=Mon,3=Wed
    const weekInterval = spec.weekInterval || 1; // Default to 1 week if not specified
    const todayDow = now.getDay();
    
    // Find the next occurrence of this weekday
    let daysToAdd = (targetDow - todayDow + 7) % 7;
    if (daysToAdd === 0) {
      // If today is the target day, return today (not next interval)
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }
    
    const next = new Date(now);
    next.setDate(now.getDate() + daysToAdd);
    return next;
  }
  
  if (spec.type === 'firstWeekdayOfMonth') {
    // First occurrence of given weekday in current or next month if already passed today
    function firstWeekday(y, m, weekday) {
      const first = new Date(y, m, 1);
      const diff = (weekday - first.getDay() + 7) % 7;
      return new Date(y, m, 1 + diff);
    }
    
    let candidate = firstWeekday(year, month, spec.weekday);
    const todayOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const candStart = new Date(candidate.getFullYear(), candidate.getMonth(), candidate.getDate());
    
    console.log('firstWeekdayOfMonth debug:', {
      year, month, weekday: spec.weekday,
      firstDayOfMonth: new Date(year, month, 1).getDay(),
      calculatedFirst: candidate.toISOString(),
      todayOnly: todayOnly.toISOString(),
      candStart: candStart.toISOString(),
      isInPast: candStart < todayOnly
    });
    
    if (candStart < todayOnly) {
      // Calculate next month and year properly - FIXED VERSION
      let nextMonth, nextYear;
      if (month === 11) { // December
        nextMonth = 0; // January
        nextYear = year + 1;
      } else {
        nextMonth = month + 1;
        nextYear = year;
      }
      candidate = firstWeekday(nextYear, nextMonth, spec.weekday);
      console.log('Moving to next month:', { nextMonth, nextYear, newCandidate: candidate.toISOString() });
    } else if (candStart.getTime() === todayOnly.getTime()) {
      // If today is the target day, return today
      console.log('Today is the target day, returning today');
      return todayOnly;
    }
    return candidate;
  }
  
  if (spec.type === 'monthly') {
    // Monthly on specific day of month
    const dayOfMonth = spec.dayOfMonth;
    let candidate = new Date(year, month, dayOfMonth);
    const todayOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (candidate < todayOnly) {
      // Calculate next month and year properly - FIXED VERSION
      let nextMonth, nextYear;
      if (month === 11) { // December
        nextMonth = 0; // January
        nextYear = year + 1;
      } else {
        nextMonth = month + 1;
        nextYear = year;
      }
      candidate = new Date(nextYear, nextMonth, dayOfMonth);

      // Validate that the day exists in this month (e.g., Feb 31 -> Feb 28/29)
      if (candidate.getDate() !== dayOfMonth) {
        // Day doesn't exist in this month, use last day of month
        candidate = new Date(nextYear, nextMonth + 1, 0);
      }
    } else if (candidate.getTime() === todayOnly.getTime()) {
      // If today is the target day, return today
      return todayOnly;
    }
    return candidate;
  }
  
  if (spec.type === 'monthlyWeekday') {
    // Monthly on specific weekday (e.g., first Sunday of every month)
    const weekOfMonth = spec.weekOfMonth; // 1=first, 2=second, etc.
    const weekday = spec.weekday; // 0=Sunday, 1=Monday, etc.
    
    function getWeekdayInMonth(y, m, weekOfMonth, weekday) {
      const first = new Date(y, m, 1);
      const firstWeekday = first.getDay();
      const daysToAdd = (weekday - firstWeekday + 7) % 7 + (weekOfMonth - 1) * 7;
      return new Date(y, m, 1 + daysToAdd);
    }
    
    let candidate = getWeekdayInMonth(year, month, weekOfMonth, weekday);
    const todayOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    if (candidate < todayOnly) {
      // Calculate next month and year properly - FIXED VERSION
      let nextMonth, nextYear;
      if (month === 11) { // December
        nextMonth = 0; // January
        nextYear = year + 1;
      } else {
        nextMonth = month + 1;
        nextYear = year;
      }
      candidate = getWeekdayInMonth(nextYear, nextMonth, weekOfMonth, weekday);
    } else if (candidate.getTime() === todayOnly.getTime()) {
      // If today is the target day, return today
      return todayOnly;
    }
    return candidate;
  }
  
  if (spec.type === 'once') {
    // One-time reminder
    // Ensure date is a Date object
    if (spec.date instanceof Date) {
      return spec.date;
    } else if (typeof spec.date === 'string') {
      return new Date(spec.date);
    } else {
      console.warn('Invalid date in once schedule:', spec.date);
      return now;
    }
  }
  
  return now;
}

function classForDaysLeft(n) {
  if (n >= 8) return 'days-green';    // 8+ days
  if (n >= 3) return 'days-warn';     // 3-7 days (yellow)
  if (n >= 1) return 'days-orange';   // 1-2 days (orange)
  return 'days-danger';                // 0 or negative (red)
}

// --- Rendering
// currentData moved to js/state.js
// currentSections moved to js/state.js
// ensureSectionInBothArrays moved to js/state.js
// removeSectionFromBothArrays moved to js/state.js

function renderHeaderAndTitles() {
  const data = currentData();
  const logoEl = $('.company-logo');
  if (logoEl) logoEl.src = data.header.companyLogoSrc;
  const profileEl = $('.profile-photo');
  if (profileEl) profileEl.src = data.header.profilePhotoSrc;
  const nameEl = $('.profile-name');
  if (nameEl) nameEl.textContent = data.header.profileName;
  const titleEl = $('.profile-title');
  if (titleEl) titleEl.textContent = data.header.profileTitle;
  $$('.section-title').forEach(h => {
    const key = h.dataset.section;
    if (key && data.sectionTitles[key]) h.textContent = data.sectionTitles[key];
  });
}



function createEditableSeparator(item, section) {
  console.log('Creating editable separator for:', item.key, 'in section:', section);
  
  const separatorEl = document.createElement('img');
  separatorEl.src = item.icon;
  separatorEl.alt = 'divider';
  separatorEl.className = 'icon-separator icon-separator--wide';
  
  // Make separator editable in edit mode
  if (editState.enabled) {
    console.log('Edit mode enabled, making separator editable');
    separatorEl.classList.add('editable');
    separatorEl.dataset.type = section;
    separatorEl.dataset.key = item.key;
    separatorEl.style.cursor = 'pointer';
    separatorEl.title = 'Click to edit separator';
    
    separatorEl.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log('Separator clicked:', item.key, 'in section:', section);
      
      // Debug: Check if we can find the item in the collection
      const collection = currentData()[section];
      console.log('Current collection:', collection);
      console.log('Looking for item with key:', item.key);
      const existingItem = collection.find(i => i.key === item.key);
      console.log('Found existing item:', existingItem);
      
      openEditPopover(separatorEl, { 
        hideText: true, 
        hideUrl: true,
        allowImage: false, 
        allowDelete: true,
        isSeparator: true 
      }, async ({ url, chosenMedia, delete: doDelete, accept }) => {
        console.log('Edit popover result:', { doDelete, accept, chosenMedia });
        if (!accept) return;
        if (doDelete) {
          console.log('Deleting separator:', item.key);
          // Remove separator from collection
          const collection = currentData()[section];
          console.log('Collection before deletion:', collection);
          const idx = collection.findIndex(i => i.key === item.key);
          console.log('Found index:', idx);
          if (idx !== -1) {
            collection.splice(idx, 1);
            console.log('Separator removed from collection');
            console.log('Collection after deletion:', collection);
          } else {
            console.log('Separator not found in collection');
            console.log('Available keys:', collection.map(i => i.key));
          }
          markDirtyAndSave();
          renderAllSections();
          return;
        }
        // Update separator image if provided
        if (chosenMedia) {
          item.icon = persistImageFromLibraryEntry(chosenMedia);
          separatorEl.src = item.icon;
          console.log('Separator image updated');
        }
        markDirtyAndSave();
      });
    });
  } else {
    console.log('Edit mode disabled, separator not editable');
  }
  
  return separatorEl;
}

function createIconButton(item, section) {
  const btn = document.createElement('button');
  btn.className = 'icon-button editable';
  btn.dataset.type = section;
  btn.dataset.key = item.key;

  btn.title = item.title || '';

  const img = document.createElement('img');
  img.src = item.icon; img.alt = item.key;
  btn.appendChild(img);

  btn.addEventListener('click', () => {
    if (!editState.enabled) {
      openUrl(item.url);
    } else {
      openEditPopover(btn, { hideText: true, url: item.url, allowImage: true, allowDelete: true }, async ({ text, url, chosenMedia, delete: doDelete, accept }) => {
        if (!accept) return;
        if (doDelete) {
          // remove item from its collection
          const collection = currentData()[section];
          const idx = collection.findIndex(i => i.key === item.key);
          if (idx !== -1) {
            collection.splice(idx, 1);
          }
          markDirtyAndSave();
          renderAllSections();
          return;
        }
        // No text field for icon buttons
        item.url = url || PLACEHOLDER_URL;
        if (chosenMedia) item.icon = persistImageFromLibraryEntry(chosenMedia);
        markDirtyAndSave();
        // re-render the icons immediately to reflect the new image while staying in edit mode
        renderAllSections();
      });
    }
  });

  // Add drag handlers for reordering in edit mode
  if (editState.enabled) {
    initializeItemDragHandlers(btn, item.key, section);
  }

  return btn;
}

function renderIconGrids() {
  const data = currentData();
  const dailyTasksGrid = $('#daily-tasks-grid');
  const dailyToolsGrid = $('#daily-tools-grid');
  dailyTasksGrid.innerHTML = ''; dailyToolsGrid.innerHTML = '';
  data.dailyTasks.forEach(item => dailyTasksGrid.appendChild(createIconButton(item, 'dailyTasks')));
  data.dailyTools.forEach(item => dailyToolsGrid.appendChild(createIconButton(item, 'dailyTools')));
  if (editState.enabled) {
    dailyTasksGrid.appendChild(createAddTile('dailyTasks'));
    dailyToolsGrid.appendChild(createAddTile('dailyTools'));
  }

  const ccRow = $('#content-creation-row');
  ccRow.innerHTML = '';
  console.log('Rendering contentCreation items:', data.contentCreation);
  data.contentCreation.forEach(item => {
    console.log('Processing item:', item.key, 'isDivider:', item.isDivider);
    if (item.isDivider) {
      console.log('Creating separator for:', item.key);
      const separatorEl = createEditableSeparator(item, 'contentCreation');
      ccRow.appendChild(separatorEl);
    } else {
      ccRow.appendChild(createIconButton(item, 'contentCreation'));
    }
  });
  if (editState.enabled) {
    ccRow.appendChild(createAddTile('contentCreation'));
  }

  const adsRow = $('#ads-row');
  adsRow.innerHTML = '';
  console.log('Rendering ads items:', data.ads);
  data.ads.forEach(item => {
    console.log('Processing ads item:', item.key, 'isDivider:', item.isDivider);
    if (item.isDivider) {
      console.log('Creating ads separator for:', item.key);
      const separatorEl = createEditableSeparator(item, 'ads');
      adsRow.appendChild(separatorEl);
    } else {
      adsRow.appendChild(createIconButton(item, 'ads'));
    }
  });
  if (editState.enabled) {
    adsRow.appendChild(createAddTile('ads'));
  }
}

function renderList(sectionKey, targetEl, isTools) {
  const data = currentData();
  targetEl.innerHTML = '';
  data[sectionKey].forEach(item => {
    const div = document.createElement('div');
    div.className = `list-item ${isTools ? 'tools' : ''} editable`;
    div.dataset.type = sectionKey;
    div.dataset.key = item.key;

    if (!editState.enabled) {
      // In view mode: make the div directly clickable with text
      div.textContent = item.text;
      div.style.cursor = 'pointer';

      div.addEventListener('click', () => {
        if (item.url && item.url !== PLACEHOLDER_URL) {
          window.open(item.url, '_blank', 'noopener,noreferrer');
        }
      });
    } else {
      // In edit mode: use link element
      const a = document.createElement('a');
      a.href = item.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = item.text;
      div.appendChild(a);

      div.addEventListener('click', (e) => {
        e.preventDefault();
        openEditPopover(div, { text: item.text, url: item.url, allowDelete: true }, ({ text, url, delete: doDelete, accept }) => {
          if (!accept) return;
          if (doDelete) {
            const collection = currentData()[sectionKey];
            const idx = collection.findIndex(i => i.key === item.key);
            if (idx !== -1) collection.splice(idx, 1);
            markDirtyAndSave();
            renderAllSections();
            return;
          }
          item.text = text || item.text;
          item.url = url || PLACEHOLDER_URL;
          markDirtyAndSave();
          renderAllSections();
        });
      });
    }

    // Add drag handlers for reordering in edit mode
    if (editState.enabled) {
      initializeItemDragHandlers(div, item.key, sectionKey);
    }

    targetEl.appendChild(div);
  });
  if (editState.enabled) {
    const add = document.createElement('button');
    add.type = 'button';
    add.className = `list-item ${isTools ? 'tools' : ''} add-tile`;
    add.textContent = '+';
    add.addEventListener('click', (event) => openAddItemOptions(sectionKey, event));
    targetEl.appendChild(add);
  }
}

function renderLists() {
  renderList('analytics', $('#analytics-list'), false);
  renderList('tools', $('#tools-list'), true);
}

// --- Edit mode
// editState moved to js/state.js
// dragState moved to js/state.js

// markDirtyAndSave moved to js/features/edit-mode.js

// deepMergeModel moved to js/core/storage.js
// deepClone moved to js/utils.js
// lightenAndDesaturateColor moved to js/utils.js
// darkenColor moved to js/utils.js
// convertToDarkModeColor moved to js/utils.js

// toggleEditMode moved to js/features/edit-mode.js
// applyDarkMode moved to js/features/edit-mode.js

// toggleDarkMode moved to js/features/edit-mode.js
// Note: keeping a reference here for backwards compatibility
function toggleDarkMode_legacy() {
  model.darkMode = !model.darkMode;
  // Also update working copy if in edit mode
  if (editState.working) {
    editState.working.darkMode = model.darkMode;
  }
  applyDarkMode();
  saveModel();

  // Update timer displays immediately to reflect new theme
  if (timerInterval && model.timeTrackingExpanded) {
    updateTimerDisplay();
  }
}

// hideEditPopover moved to js/features/edit-mode.js
// hideCalendarPopover moved to js/features/edit-mode.js

function openCalendarPopover(reminder) {
  const pop = $('#calendar-popover');
  const dateInput = $('#calendar-date');
  const repeatSelect = $('#calendar-repeat');
  const monthlyTypeSelect = $('#calendar-monthly-type');
  const monthlyOptions = $('#monthly-options');
  const weeklyTypeSelect = $('#calendar-weekly-type');
  const weeklyOptions = $('#weekly-options');
  
  // Set current values - handle null schedule
  let currentDate = reminder.schedule ? getNextOccurrence(reminder.schedule) : new Date();
  
  // Ensure currentDate is a Date object
  if (!(currentDate instanceof Date) || isNaN(currentDate.getTime())) {
    console.warn('Invalid currentDate in openCalendarPopover:', currentDate);
    currentDate = new Date();
  }
  
  dateInput.value = currentDate.toISOString().split('T')[0];
  
  // Determine current repeat type
  let repeatType = 'none';
  let monthlyType = 'sameDay';
  let weeklyType = '1';
  if (reminder.schedule && reminder.schedule.type === 'weekday') {
    repeatType = 'weekly';
    weeklyType = (reminder.schedule.weekInterval || 1).toString();
  } else if (reminder.schedule && reminder.schedule.type === 'monthly') {
    repeatType = 'monthly';
    monthlyType = 'sameDay';
  } else if (reminder.schedule && reminder.schedule.type === 'monthlyWeekday') {
    repeatType = 'monthly';
    monthlyType = 'firstWeekday';
  } else if (reminder.schedule && reminder.schedule.type === 'firstWeekdayOfMonth') {
    repeatType = 'monthly';
    monthlyType = 'firstWeekday';
  }
  
  repeatSelect.value = repeatType;
  monthlyTypeSelect.value = monthlyType;
  weeklyTypeSelect.value = weeklyType;
  
  // Ensure options are hidden by default
  monthlyOptions.style.display = 'none';
  weeklyOptions.style.display = 'none';
  
  // Show appropriate options based on current type
  if (repeatType === 'monthly') {
    monthlyOptions.style.display = 'block';
  } else if (repeatType === 'weekly') {
    weeklyOptions.style.display = 'block';
  }
  
  // Function to update monthly option labels dynamically
          function updateMonthlyLabels() {
      const selectedDate = new Date(dateInput.value + 'T00:00:00');
      const dayOfMonth = selectedDate.getDate();
      const weekday = selectedDate.getDay();
      const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const weekdayName = weekdayNames[weekday];

      // Update the options with dynamic text
      const sameDayOption = monthlyTypeSelect.querySelector('option[value="sameDay"]');
      const firstWeekdayOption = monthlyTypeSelect.querySelector('option[value="firstWeekday"]');

      sameDayOption.textContent = `Every first ${dayOfMonth} of the month`;
      firstWeekdayOption.textContent = `Every first ${weekdayName} of the month`;
    }
  
  // Update labels when date changes
  dateInput.onchange = updateMonthlyLabels;
  
  // Initial update of labels
  updateMonthlyLabels();
  
  // Handle repeat type change
  repeatSelect.onchange = () => {
    if (repeatSelect.value === 'monthly') {
      monthlyOptions.style.display = 'block';
      weeklyOptions.style.display = 'none';
      updateMonthlyLabels(); // Update labels when showing monthly options
    } else if (repeatSelect.value === 'weekly') {
      weeklyOptions.style.display = 'block';
      monthlyOptions.style.display = 'none';
    } else {
      weeklyOptions.style.display = 'none';
      monthlyOptions.style.display = 'none';
    }
  };
  
  // Save button handler
  const saveBtn = $('#calendar-save');
  const originalOnClick = saveBtn.onclick;
          saveBtn.onclick = () => {
      const selectedDate = new Date(dateInput.value + 'T00:00:00');
      const repeatType = repeatSelect.value;
      const monthlyType = monthlyTypeSelect.value;

      let newSchedule;
      if (repeatType === 'none') {
        newSchedule = { type: 'once', date: selectedDate };
      } else if (repeatType === 'weekly') {
        const weeklyType = $('#calendar-weekly-type').value;
        newSchedule = { 
          type: 'weekday', 
          weekday: selectedDate.getDay(),
          weekInterval: parseInt(weeklyType) || 1
        };
      } else if (repeatType === 'monthly') {
        if (monthlyType === 'sameDay') {
          newSchedule = { type: 'monthly', dayOfMonth: selectedDate.getDate() };
        } else if (monthlyType === 'firstWeekday') {
          newSchedule = {
            type: 'monthlyWeekday',
            weekday: selectedDate.getDay(),
            weekOfMonth: 1
          };
        }
      }

      reminder.schedule = newSchedule;
      markDirtyAndSave();
      renderAllSections();
      hideCalendarPopover();
    };
  
  // Cancel button handler
  $('#calendar-cancel').onclick = hideCalendarPopover;
  $('#calendar-close').onclick = hideCalendarPopover;
  
  // Show popover
  pop.hidden = false;
  editState.currentCalendarTarget = reminder;
}

// openEditPopover moved to js/features/edit-mode.js

async function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ===== MEDIA LIBRARY FUNCTIONS =====
// NOTE: These functions have been extracted to js/features/media-library.js
// They remain here temporarily until all dependent code is migrated.
// The module exports are available via window.* for external access.

function loadMediaLibrary() {
  try {
    const raw = localStorage.getItem(MEDIA_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch { return []; }
}
function saveMediaLibrary(items) {
  try { localStorage.setItem(MEDIA_STORAGE_KEY, JSON.stringify(items)); } catch {}
}
function addFilesToMediaLibrary(files) {
  const lib = loadMediaLibrary();
  const now = Date.now();
  const entries = [];
  for (const file of files) {
    entries.push(fileToDataURL(file).then(dataUrl => ({ id: `${now}_${Math.random().toString(36).slice(2)}`, name: file.name, src: dataUrl })));
  }
  return Promise.all(entries).then(newItems => {
    const updated = [...lib, ...newItems];
    saveMediaLibrary(updated);
    return updated;
  });
}
function persistImageFromLibraryEntry(entry) {
  return entry.src; // use data URL
}

async function loadManifestMedia() {
  try {
    const res = await fetch(MEDIA_MANIFEST_PATH, { cache: 'no-cache' });
    if (!res.ok) return [];
    const json = await res.json();
    let files = [];
    if (Array.isArray(json)) files = json; else if (Array.isArray(json.files)) files = json.files; else if (Array.isArray(json.items)) files = json.items;
    const entries = files.map((f) => {
      if (typeof f === 'string') {
        return { id: `manifest:${f}`, name: f, src: `Media Library/${f}` };
      }
      if (f && typeof f === 'object') {
        const name = f.name || f.path || f.src;
        const src = f.path || f.src || `Media Library/${name}`;
        return { id: `manifest:${name}`, name, src };
      }
      return null;
    }).filter(Boolean);
    return entries;
  } catch { return []; }
}

// getColorForCurrentMode moved to js/utils.js
// setColorForCurrentMode moved to js/utils.js
// openColorPicker moved to js/features/edit-mode.js
// openSubtitleColorPicker moved to js/features/edit-mode.js

function wireUI() {
  $('#edit-toggle').addEventListener('click', toggleEditMode);
  $('#dark-mode-toggle').addEventListener('click', toggleDarkMode);

  // Time tracking event handlers
  $('#time-tracking-toggle').addEventListener('click', toggleTimeTracking);
  $('#reset-all-timers').addEventListener('click', resetAllTimers);
  $('#add-timer-btn').addEventListener('click', addNewTimer);

  // Display mode toggle
  $('#display-mode-toggle').addEventListener('click', openDisplayModeModal);

  // Quick access event handlers
  $('#quick-access-toggle').addEventListener('click', toggleQuickAccess);
  $('#selector-mode-toggle').addEventListener('click', toggleSelectorMode);
  $('#quick-access-clear').addEventListener('click', clearQuickAccess);

  // Global drag and drop event listeners
  document.addEventListener('dragover', handleDragOver);
  document.addEventListener('drop', handleDrop);

  // Global click handler for item selection in selector mode
  document.addEventListener('click', handleItemSelection, true);

  // Close reminder and list item link bubbles when clicking outside
  document.addEventListener('click', (e) => {
    const clickedOnReminderToggle = e.target.closest('.reminder-links-toggle');
    const clickedOnListItemToggle = e.target.closest('.list-item-links-toggle');
    const clickedOnBubble = e.target.closest('.reminder-link-bubble');
    if (!clickedOnReminderToggle && !clickedOnBubble) {
      closeAllReminderLinks();
    }
    if (!clickedOnListItemToggle && !clickedOnBubble) {
      closeAllListItemLinks();
    }
    // Close display mode bubbles when clicking outside
    const clickedOnDisplayToggle = e.target.closest('#display-mode-toggle');
    const clickedOnDisplayOption = e.target.closest('.display-mode-option');
    if (!clickedOnDisplayToggle && !clickedOnDisplayOption) {
      closeDisplayModeModal();
    }
  });

  document.addEventListener('dragenter', (e) => e.preventDefault());
  document.addEventListener('dragleave', (e) => e.preventDefault());
  $('#edit-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const payload = { text: $('#edit-text').value.trim(), url: $('#edit-url').value.trim(), chosenMedia: editState.chosenMedia || null, accept: true };
    if (editState.currentTarget) editState.currentTarget.onDone(payload);
    hideEditPopover();
    // Re-render items that might show new text
    renderAllSections();
    refreshEditingClasses();
  });
  $('#edit-cancel').addEventListener('click', () => {
    if (editState.currentTarget) editState.currentTarget.onDone({ accept: false });
    hideEditPopover();
  });

  // Global accept/cancel
  // Completely override the button behavior
  $('#edit-accept-global').onclick = function(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    
    if (!editState.enabled) return false;
    
    if (editState.working) {
      // Deep merge the working copy into the model to preserve all nested structures
      deepMergeModel(model, editState.working);
      saveModel();
      // Also create a timestamped backup file for longevity
      try { exportBackupFile(); } catch {}
      // Skip file persistence to avoid triggering Edge file system access
    }

    toggleEditMode();
    return false;
  };
  
  // Remove all other event listeners and prevent any default behavior
  $('#edit-accept-global').addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    return false;
  });
  
  $('#edit-accept-global').addEventListener('mouseup', (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    return false;
  });
  
  $('#edit-accept-global').addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    return false;
  });
  $('#edit-cancel-global').addEventListener('click', () => {
    if (!editState.enabled) return;
    toggleEditMode();
  });



  // Restore last backup flow
  const overrideBtn = $('#override-links');
  const overridePop = $('#override-confirm');
  const overrideAccept = $('#override-accept');
  const overrideCancel = $('#override-cancel');
  const importBtn = $('#import-links');
  const importInput = $('#import-links-input');
  const connectBtn = $('#connect-folder');
  // Override links confirmation - now downloads the file instead of trying to write directly
  overrideBtn.addEventListener('click', () => {
    try {
      // Extract current dashboard state (including new items)
      const currentState = extractUrlOverrides();
      const json = JSON.stringify(currentState, null, 2);

      // Generate filename with today's date
      const today = new Date();
      const year = today.getFullYear();
      const month = String(today.getMonth() + 1).padStart(2, '0');
      const day = String(today.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;
      const filename = `Personal Dashboard (${dateStr}).json`;

      // Create a download link to save the file
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showToast(`Dashboard backup saved as: ${filename}`);
    } catch (error) {
      showToast('Error creating backup file.');
    }
  });

  // Import links from JSON without any server
  importBtn.addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', async () => {
    const file = importInput.files && importInput.files[0];
    if (!file) return;
    try {
      // Set import flag to prevent automatic JSON file saving during import
      window.isImporting = true;
      
      // Clear the flags for manual imports to allow override application
      window.skipUrlOverrides = false;
      window.localStorageRestored = false;
      
      const text = await file.text();
      const json = JSON.parse(text);

      // Basic validation
      if (!json || typeof json !== 'object') {
        throw new Error('Invalid file format: not a valid JSON object');
      }

      // Validate critical data structures
      if (json._structure && !Array.isArray(json._structure.sections)) {
        throw new Error('Invalid file format: sections must be an array');
      }

      // Validate reminders structure if present
      if (json.reminders && typeof json.reminders !== 'object') {
        throw new Error('Invalid file format: reminders must be an object');
      }

      // Validate quick access items if present
      if (json.quickAccessItems) {
        if (!json.quickAccessItems.icons || !Array.isArray(json.quickAccessItems.icons)) {
          throw new Error('Invalid file format: quickAccessItems.icons must be an array');
        }
        if (!json.quickAccessItems.listItems || !Array.isArray(json.quickAccessItems.listItems)) {
          throw new Error('Invalid file format: quickAccessItems.listItems must be an array');
        }
      }

      // Optional: validate expected keys exist and warn if different version
      if (json._metadata && json._metadata.version && json._metadata.version !== APP_VERSION) {
        if (!confirm(`This file was exported from a different version (${json._metadata.version}). Import anyway?`)) {
          window.isImporting = false;
          return;
        }
      }

      applyUrlOverrides(json);

      // Re-render to show the imported data
      console.log('About to render with currentData sections:', currentData().sections.map(s => ({ id: s.id, type: s.type })));
      renderAllSections();

      // Wait for rendering to complete using requestAnimationFrame (ensures DOM updates finish)
      await new Promise(resolve => {
        requestAnimationFrame(() => {
          requestAnimationFrame(resolve); // Double RAF ensures render completes
        });
      });

      // Clear import flag after render completes
      window.isImporting = false;
      console.log('Import flag cleared after render completion');

      showToast('Links imported. Press checkmark to keep them.');
    } catch (error) {
      console.error('JSON import error:', error);
      showToast(`Invalid JSON file: ${error.message}`);
      // Clear the import flag immediately on error
      window.isImporting = false;
    } finally {
      importInput.value = '';
    }
  });

  // Manually connect project folder (works on file:// if browser supports FS Access)
  connectBtn.addEventListener('click', async () => {
    const handle = await selectProjectFolder();
    showToast(handle ? 'Project folder connected.' : 'Could not connect folder.');
  });

  // Editable section titles
  $$('.section-title').forEach(titleEl => {
    titleEl.addEventListener('click', (e) => {
      if (!editState.enabled) return;
      const key = (e.currentTarget).dataset.section;
      const data = currentData();
      openEditPopover(titleEl, { text: data.sectionTitles[key], hideUrl: true }, ({ text, accept }) => {
        if (!accept) return;
        data.sectionTitles[key] = text || data.sectionTitles[key];
        markDirtyAndSave();
        renderHeaderAndTitles();
      });
    });
  });

  // Header editable fields
  $('.company-logo').addEventListener('click', (e) => {
    if (!editState.enabled) return;
    const data = currentData();
    openEditPopover(e.currentTarget, { hideText: true, hideUrl: true, allowImage: true }, async ({ chosenMedia, accept }) => {
      if (!accept || !chosenMedia) return;
      const savedSrc = persistImageFromLibraryEntry(chosenMedia);
      if (savedSrc) data.header.companyLogoSrc = savedSrc;
      markDirtyAndSave();
      renderHeaderAndTitles();
    });
  });
  $('.profile-photo').addEventListener('click', (e) => {
    if (!editState.enabled) return;
    const data = currentData();
    openEditPopover(e.currentTarget, { hideText: true, hideUrl: true, allowImage: true }, async ({ chosenMedia, accept }) => {
      if (!accept || !chosenMedia) return;
      const savedSrc = persistImageFromLibraryEntry(chosenMedia);
      if (savedSrc) data.header.profilePhotoSrc = savedSrc;
      markDirtyAndSave();
      renderHeaderAndTitles();
    });
  });
  $('.profile-name').addEventListener('click', (e) => {
    if (!editState.enabled) return;
    const data = currentData();
    openEditPopover(e.currentTarget, { text: data.header.profileName, hideUrl: true }, ({ text, accept }) => {
      if (!accept) return;
      data.header.profileName = text || data.header.profileName;
      markDirtyAndSave();
      renderHeaderAndTitles();
    });
  });
  $('.profile-title').addEventListener('click', (e) => {
    if (!editState.enabled) return;
    const data = currentData();
    openEditPopover(e.currentTarget, { text: data.header.profileTitle, hideUrl: true }, ({ text, accept }) => {
      if (!accept) return;
      data.header.profileTitle = text || data.header.profileTitle;
      markDirtyAndSave();
      renderHeaderAndTitles();
    });
  });

  // Hook up "Choose Image…" to open media library
  $('#choose-from-library').addEventListener('click', () => {
    openMediaLibrary((chosen) => {
      editState.chosenMedia = chosen;
      $('#chosen-image-name').textContent = chosen.name;
    });
  });

  // Breakdown modal event listeners
  $('#breakdown-add-row').addEventListener('click', () => {
    if (!currentBreakdownReminder) return;
    if (!currentBreakdownReminder.breakdown.rows) {
      currentBreakdownReminder.breakdown.rows = [];
    }
    currentBreakdownReminder.breakdown.rows.push({ title: '', value: 0 });
    renderBreakdownRows();
  });

  $('#breakdown-lock').addEventListener('change', (e) => {
    const currentInput = $('#breakdown-current');
    currentInput.disabled = !e.target.checked;

    // If unlocking, recalculate sum
    if (!e.target.checked && currentBreakdownReminder) {
      updateBreakdownSum();
    }
  });

  $('#breakdown-accept').addEventListener('click', acceptBreakdownModal);
  $('#breakdown-cancel').addEventListener('click', cancelBreakdownModal);
  $('#breakdown-close').addEventListener('click', cancelBreakdownModal);

  // Close on backdrop click
  $('#breakdown-modal .breakdown-backdrop').addEventListener('click', cancelBreakdownModal);

  // Interval breakdown button
  $('#interval-breakdown-btn').addEventListener('click', () => {
    if (currentBreakdownReminder) {
      openBreakdownModal(currentBreakdownReminder);
    }
  });

  // Copy-text modal event listeners
  $('#copy-text-accept').addEventListener('click', acceptCopyTextModal);
  $('#copy-text-cancel').addEventListener('click', hideCopyTextModal);
  $('#copy-text-close').addEventListener('click', hideCopyTextModal);

  // Close on backdrop click
  $('#copy-text-modal .copy-text-backdrop').addEventListener('click', hideCopyTextModal);

  // Card collapse/expand functionality (only in view mode)
  setupCardCollapseExpand();
}

// Track card collapse state
let cardsCollapsed = false;

function setupCardCollapseExpand() {
  // Use event delegation on the main container
  const main = $('.app-main');
  if (!main) return;

  main.addEventListener('click', (e) => {
    // Only work when NOT in edit mode
    if (editState.enabled) return;

    const clickedCard = e.target.closest('.card');
    if (!clickedCard) return;

    // Check if click was on an interactive element
    const isInteractive = e.target.closest('a, button, input, .editable, .reminder-item, .icon-button, .list-item, .copy-paste-item');

    if (cardsCollapsed) {
      // If cards are collapsed, clicking any card expands all and scrolls to it
      expandAllCards();
      setTimeout(() => {
        clickedCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    } else if (!isInteractive) {
      // If cards are not collapsed and click is on empty space, collapse all
      collapseAllCards();
    }
  });
}

function collapseAllCards() {
  const cards = $$('.app-main .card');
  const twoColContainers = $$('.app-main .two-col');

  cards.forEach(card => card.classList.add('collapsed'));
  twoColContainers.forEach(container => container.classList.add('collapsed'));

  cardsCollapsed = true;
}

function expandAllCards() {
  const cards = $$('.app-main .card');
  const twoColContainers = $$('.app-main .two-col');

  cards.forEach(card => card.classList.remove('collapsed'));
  twoColContainers.forEach(container => container.classList.remove('collapsed'));

  cardsCollapsed = false;
}

// refreshEditingClasses moved to js/features/edit-mode.js

function ensureSectionPlusButtons() {
  const addable = [
    { sel: '#daily-tasks', key: 'dailyTasks' },
    { sel: '#daily-tools', key: 'dailyTools' },
    { sel: '#content-creation', key: 'contentCreation' },
    { sel: '#ads', key: 'ads' },
    { sel: '#analytics', key: 'analytics' },
    { sel: '#tools', key: 'tools' },
  ];
  addable.forEach(({ sel, key }) => {
    const section = $(sel);
    if (!section) return;
    // Remove old corner plus if present; we now use inline add tiles
    const old = section.querySelector('.section-plus');
    if (old) old.remove();
  });
}

// generateKey moved to js/utils.js

function onAddItem(sectionKey, subtitle = null) {
  console.log(`onAddItem called with sectionKey: ${sectionKey}, subtitle: ${subtitle}`);
  const data = currentData();
  console.log('Current data reminders structure:', data.reminders);
  
  if (['dailyTasks','dailyTools','contentCreation','ads'].includes(sectionKey)) {
    const collection = data[sectionKey];
    const key = generateKey('item', collection);
    collection.push({ key, icon: 'assets/logos/Tools_1.svg', url: PLACEHOLDER_URL, title: '' });
    markDirtyAndSave();
    renderAllSections();
  } else if (['analytics','tools'].includes(sectionKey)) {
    const collection = data[sectionKey];
    const key = generateKey('link', collection);
    collection.push({ key, text: 'New Link', url: PLACEHOLDER_URL });
    markDirtyAndSave();
    renderAllSections();
  } else if (sectionKey === 'reminders' || (data.sections.find(s => s.id === sectionKey) && data.sections.find(s => s.id === sectionKey).type === 'reminders')) {
    console.log(`Processing reminders section with subtitle: ${subtitle}`);
    
    // Determine which reminders data to use
    let remindersData;
    if (sectionKey === 'reminders') {
      // Original reminders section
      remindersData = data.reminders;
    } else {
      // New reminder section
      remindersData = data[sectionKey];
    }
    
    // Ensure reminders data structure exists and is properly formatted
    if (!remindersData || typeof remindersData !== 'object') {
      console.log('Creating new reminders object');
      remindersData = {};
      if (sectionKey === 'reminders') {
        data.reminders = remindersData;
      } else {
        data[sectionKey] = remindersData;
      }
    }
    
    if (!subtitle) {
      // If no subtitle provided, add to the first available subtitle or create a default one
      const subtitles = Object.keys(remindersData);
      console.log('No subtitle provided, available subtitles:', subtitles);
      if (subtitles.length === 0) {
        remindersData['General'] = [];
        subtitle = 'General';
        console.log('Created default subtitle: General');
      } else {
        subtitle = subtitles[0];
        console.log(`Using first available subtitle: ${subtitle}`);
      }
    }
    
    console.log(`Final subtitle to use: ${subtitle}`);
    
    // Ensure the subtitle exists in the data structure and is an array
    if (!remindersData[subtitle]) {
      console.log(`Creating new array for subtitle: ${subtitle}`);
      remindersData[subtitle] = [];
    } else if (!Array.isArray(remindersData[subtitle])) {
      // If it exists but is not an array, convert it to an array
      console.log(`Converting subtitle ${subtitle} to array`);
      remindersData[subtitle] = [];
    }
    
    const collection = remindersData[subtitle];
    console.log(`Adding item to collection for subtitle: ${subtitle}, collection length: ${collection.length}`);
    const key = generateKey('reminder', collection);
    const newItem = { 
      key, 
      title: 'New Reminder', 
      url: PLACEHOLDER_URL,
      schedule: null, // No schedule initially
      type: 'days' // Default to days mode
    };
    collection.push(newItem);
    console.log(`Added item to ${subtitle}, new collection length: ${collection.length}`);
    
    markDirtyAndSave();
    
    // Force a complete re-render to ensure the new item appears in the correct subtitle
    renderAllSections();
  } else {
    // Handle dynamic sections (new cards)
    const section = data.sections.find(s => s.id === sectionKey);

    if (section && section.type === 'copyPaste') {
      // Copy-paste card with subtitle structure
      const copyPasteData = data[sectionKey] || {};

      // Ensure structure exists
      if (typeof copyPasteData !== 'object' || Array.isArray(copyPasteData)) {
        data[sectionKey] = {};
      }

      if (!subtitle) {
        // If no subtitle provided, add to the first available subtitle or create a default one
        const subtitles = Object.keys(data[sectionKey]);
        if (subtitles.length === 0) {
          data[sectionKey]['General'] = [];
          subtitle = 'General';
        } else {
          subtitle = subtitles[0];
        }
      }

      // Ensure the subtitle exists and is an array
      if (!data[sectionKey][subtitle]) {
        data[sectionKey][subtitle] = [];
      }

      const collection = data[sectionKey][subtitle];
      const key = generateKey('copy', collection);
      collection.push({ key, text: 'New Item', copyText: '' });

      renderAllSections();
    } else {
      // Handle other dynamic sections (arrays)
      const collection = data[sectionKey] || [];
      const key = generateKey('link', collection);

      if (section && section.type === 'newCard') {
        // Regular new card - add as icon grid item
        collection.push({ key, title: 'New Item', url: PLACEHOLDER_URL, icon: 'assets/icons/UI_wrench.svg' });
      } else if (section && section.type === 'newCardAnalytics') {
        // Analytics-style new card - add as list item
        collection.push({ key, text: 'New Link', url: PLACEHOLDER_URL });
      } else {
        // Fallback for other section types
        collection.push({ key, text: 'New Link', url: PLACEHOLDER_URL });
      }

      renderAllSections();
    }
  }
}

function createAddTile(sectionKey) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'icon-add-tile';
  el.textContent = '+';
  el.title = 'Add item';
  el.addEventListener('click', (event) => {
    // Show options menu for all sections (file option available everywhere)
    openAddItemOptions(sectionKey, event);
  });
  return el;
}

function openAddItemOptions(sectionKey, event) {
  console.log('Opening add item options for section:', sectionKey);
  
  // Get click position
  const clickX = event ? event.clientX : window.innerWidth / 2;
  const clickY = event ? event.clientY : window.innerHeight / 2;
  
  // Create a simple popover with icon buttons
  const popover = document.createElement('div');
  popover.className = 'edit-popover';
  popover.style.cssText = `
    position: fixed;
    left: ${clickX}px;
    top: ${clickY}px;
    transform: translate(-50%, -50%);
    background: white;
    border-radius: 8px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.08);
    padding: 8px;
    border: 1px solid #e5e7eb;
    z-index: 1000;
    width: fit-content;
    height: fit-content;
  `;
  
  // Get the appropriate separator icon
  let separatorIcon;
  if (sectionKey === 'contentCreation') {
    separatorIcon = icons.Content_creation_divider;
  } else if (sectionKey === 'ads') {
    separatorIcon = icons.Ads_divider;
  } else {
    separatorIcon = icons.Content_creation_divider; // fallback
  }
  
  // Check if this section supports separators
  const supportsSeparators = ['contentCreation', 'ads'].includes(sectionKey);
  
  popover.innerHTML = `
    <div style="display: flex; gap: 8px; align-items: center;">
      <button id="add-item-btn" style="width: 56px; height: 56px; border: 1px solid #e5e7eb; border-radius: 6px; background: #f8fafc; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 28px; font-weight: bold;">+</button>
      ${supportsSeparators ? `<button id="add-separator-btn" style="width: 56px; height: 56px; border: 1px solid #e5e7eb; border-radius: 6px; background: #f8fafc; cursor: pointer; display: flex; align-items: center; justify-content: center;">
        <img src="${separatorIcon}" alt="separator" style="width: 40px; height: 40px;">
      </button>` : ''}
      <button id="cancel-btn" style="width: 32px; height: 32px; border: none; border-radius: 50%; background: #fee2e2; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 16px; font-weight: bold; color: #7f1d1d;">✕</button>
    </div>
  `;
  
  document.body.appendChild(popover);
  
  // Add event listeners
  popover.querySelector('#add-item-btn').addEventListener('click', () => {
    console.log('Adding item to section:', sectionKey);
    document.body.removeChild(popover);
    onAddItem(sectionKey);
  });
  

  
  // Only add separator listener if the button exists
  const separatorBtn = popover.querySelector('#add-separator-btn');
  if (separatorBtn) {
    separatorBtn.addEventListener('click', () => {
      console.log('Adding separator to section:', sectionKey);
      document.body.removeChild(popover);
      onAddSeparator(sectionKey);
    });
  }
  
  popover.querySelector('#cancel-btn').addEventListener('click', () => {
    console.log('Canceling add options');
    document.body.removeChild(popover);
  });
  
  // Close on backdrop click
  popover.addEventListener('click', (e) => {
    if (e.target === popover) {
      document.body.removeChild(popover);
    }
  });
}

function onAddSeparator(sectionKey) {
  console.log('onAddSeparator called for section:', sectionKey);
  const data = currentData();
  const collection = data[sectionKey];
  console.log('Current collection:', collection);
  
  const key = generateKey('separator', collection);
  console.log('Generated key:', key);
  
  // Create a separator item with the appropriate icon based on section
  let separatorIcon;
  if (sectionKey === 'contentCreation') {
    separatorIcon = icons.Content_creation_divider;
  } else if (sectionKey === 'ads') {
    separatorIcon = icons.Ads_divider;
  } else {
    separatorIcon = icons.Content_creation_divider; // fallback
  }
  
  const separatorItem = {
    key,
    icon: separatorIcon,
    url: PLACEHOLDER_URL,
    isDivider: true
  };
  
  console.log('Created separator item:', separatorItem);
  collection.push(separatorItem);
  console.log('Collection after adding separator:', collection);
  
  markDirtyAndSave();
  renderAllSections();
}

// Copy text to clipboard
function copyToClipboard(text) {
  if (!navigator.clipboard) {
    // Fallback for older browsers
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    document.body.appendChild(textArea);
    textArea.select();
    try {
      document.execCommand('copy');
      showToast('Copied to clipboard!');
    } catch (err) {
      showToast('Failed to copy');
    }
    document.body.removeChild(textArea);
    return;
  }

  navigator.clipboard.writeText(text).then(() => {
    showToast('Copied to clipboard!');
  }).catch(() => {
    showToast('Failed to copy');
  });
}

// Open copy text modal
let currentCopyTextItem = null;
let currentCopyTextSection = null;

function openCopyTextModal(item, sectionId) {
  currentCopyTextItem = item;
  currentCopyTextSection = sectionId;

  const modal = $('#copy-text-modal');
  const textarea = $('#copy-text-content');

  // Set current value
  textarea.value = item.copyText || item.text || '';

  // Show modal
  modal.hidden = false;

  // Focus textarea
  setTimeout(() => textarea.focus(), 100);
}

function hideCopyTextModal() {
  const modal = $('#copy-text-modal');
  modal.hidden = true;
  currentCopyTextItem = null;
  currentCopyTextSection = null;
}

function acceptCopyTextModal() {
  if (!currentCopyTextItem || !currentCopyTextSection) return;

  const textarea = $('#copy-text-content');
  const text = textarea.value.trim();

  if (!text) {
    showToast('Please enter some text');
    return;
  }

  // Update the item's copyText field
  currentCopyTextItem.copyText = text;

  markDirtyAndSave();
  renderAllSections();
  hideCopyTextModal();
  showToast('Copy text updated');
}

// Generate unique section ID
function generateSectionId(prefix = 'new-card') {
  const data = currentData();
  const existingIds = data.sections.map(s => s.id);
  let counter = 1;
  let newId = `${prefix}-${counter}`;
  while (existingIds.includes(newId)) {
    counter++;
    newId = `${prefix}-${counter}`;
  }
  return newId;
}

// Generate unique card title
function generateUniqueCardTitle(baseTitle) {
  const data = currentData();
  let counter = 1;
  let title = baseTitle;
  
  console.log('generateUniqueCardTitle called with:', baseTitle);
  console.log('Existing section titles:', data.sections.map(s => s.title));
  
  while (data.sections.some(s => s.title === title)) {
    counter++;
    title = `${baseTitle} ${counter}`;
    console.log('Title conflict, trying:', title);
  }
  
  console.log('Final unique title:', title);
  return title;
}

// Add a new card (section)
function onAddCard(targetSectionId) {
  const data = currentData();
  const sections = currentSections(); // Use display-mode-specific sections
  const targetIndex = sections.findIndex(s => s.id === targetSectionId);
  if (targetIndex === -1) return;

  // Determine the type of card to create based on the target section
  const targetSection = sections[targetIndex];
  let newCardType = 'newCard';
  let newCardStructure = 'regular'; // 'regular' or 'analytics-style'

  // If adding from Analytics or Tools cards, create an analytics-style card
  if (['analytics', 'tools'].includes(targetSection.type)) {
    newCardType = 'newCardAnalytics';
    newCardStructure = 'analytics-style';
  }

  const newSectionId = generateSectionId();
  const uniqueTitle = generateUniqueCardTitle('New Card');
  const newSection = {
    id: newSectionId,
    type: newCardType,
    title: uniqueTitle,
    structure: newCardStructure
  };

  // Insert the new section into current display mode's sections array
  sections.splice(targetIndex, 0, newSection);
  // Also add to the other sections array (for when switching modes)
  ensureSectionInBothArrays(newSection);

  // Create the corresponding data structure
  data[newSectionId] = [];

  // Add to sectionTitles
  data.sectionTitles[newSectionId] = uniqueTitle;

  markDirtyAndSave();
  renderAllSections();
}

// Delete a card (section)
function onDeleteCard(sectionId) {
  // Add confirmation dialog
  if (!confirm('Delete this entire card? All items will be removed. This cannot be undone.')) {
    return;
  }

  const data = currentData();
  const sections = currentSections();
  const sectionIndex = sections.findIndex(s => s.id === sectionId);
  if (sectionIndex === -1) return;

  // Remove from both sections arrays (normal and stacked)
  removeSectionFromBothArrays(sectionId);

  // Remove from sectionTitles
  delete data.sectionTitles[sectionId];

  // Remove the data array
  delete data[sectionId];

  markDirtyAndSave();
  renderAllSections();
}

// Move card up in the sections array
function moveCardUp(sectionId) {
  const data = currentData();
  const sections = currentSections(); // Use display-mode-specific sections
  const index = sections.findIndex(s => s.id === sectionId);

  if (index > 0) {
    // Store current scroll position
    const scrollY = window.scrollY;

    const currentCard = sections[index];
    const prevCard = sections[index - 1];

    // Check if current card is part of a two-column pair
    if (currentCard.twoColumnPair) {
      // Find its pair
      const pairIndex = currentCard.pairIndex === 0 ? index + 1 : index - 1;
      const pairCard = sections[pairIndex];

      // Remove two-column properties when moving out of pair
      delete currentCard.twoColumnPair;
      delete currentCard.pairIndex;

      // Also update the pair card to be standalone
      if (pairCard && pairCard.twoColumnPair) {
        delete pairCard.twoColumnPair;
        delete pairCard.pairIndex;
      }
    }

    // Check if previous card is part of a two-column pair
    if (prevCard.twoColumnPair && prevCard.pairIndex === 1) {
      // Moving up into position between a two-column pair
      // Break the pair first
      const prevPairCard = sections[index - 2];
      if (prevPairCard && prevPairCard.twoColumnPair) {
        delete prevPairCard.twoColumnPair;
        delete prevPairCard.pairIndex;
      }
      delete prevCard.twoColumnPair;
      delete prevCard.pairIndex;
    }

    // Special handling: break up dailyTasks/dailyTools pairing if moving between them
    if ((currentCard.type === 'dailyTasks' || currentCard.type === 'dailyTools') &&
        (prevCard.type === 'dailyTasks' || prevCard.type === 'dailyTools')) {
      // These cards will naturally separate when moved
      // No special action needed as they're based on type adjacency
    }

    // Swap with previous card
    sections[index] = prevCard;
    sections[index - 1] = currentCard;

    // Re-render and update
    markDirtyAndSave();
    renderAllSections();
    if (editState.enabled) {
      ensureSectionPlusButtons();
      refreshEditingClasses();
    }

    // Restore scroll position to prevent jump
    window.scrollTo(0, scrollY);

    showToast('Card moved up');
  }
}

// Move card down in the sections array
function moveCardDown(sectionId) {
  const data = currentData();
  const sections = currentSections(); // Use display-mode-specific sections
  const index = sections.findIndex(s => s.id === sectionId);

  if (index >= 0 && index < sections.length - 1) {
    // Store current scroll position
    const scrollY = window.scrollY;

    const currentCard = sections[index];
    const nextCard = sections[index + 1];

    // Check if current card is part of a two-column pair
    if (currentCard.twoColumnPair) {
      // Find its pair
      const pairIndex = currentCard.pairIndex === 0 ? index + 1 : index - 1;
      const pairCard = sections[pairIndex];

      // Remove two-column properties when moving out of pair
      delete currentCard.twoColumnPair;
      delete currentCard.pairIndex;

      // Also update the pair card to be standalone
      if (pairCard && pairCard.twoColumnPair) {
        delete pairCard.twoColumnPair;
        delete pairCard.pairIndex;
      }
    }

    // Check if next card is part of a two-column pair
    if (nextCard.twoColumnPair && nextCard.pairIndex === 0) {
      // Moving down into position between a two-column pair
      // Break the pair first
      const nextPairCard = sections[index + 2];
      if (nextPairCard && nextPairCard.twoColumnPair) {
        delete nextPairCard.twoColumnPair;
        delete nextPairCard.pairIndex;
      }
      delete nextCard.twoColumnPair;
      delete nextCard.pairIndex;
    }

    // Special handling: break up dailyTasks/dailyTools pairing if moving between them
    if ((currentCard.type === 'dailyTasks' || currentCard.type === 'dailyTools') &&
        (nextCard.type === 'dailyTasks' || nextCard.type === 'dailyTools')) {
      // These cards will naturally separate when moved
      // No special action needed as they're based on type adjacency
    }

    // Swap with next card
    sections[index] = nextCard;
    sections[index + 1] = currentCard;

    // Re-render and update
    markDirtyAndSave();
    renderAllSections();
    if (editState.enabled) {
      ensureSectionPlusButtons();
      refreshEditingClasses();
    }

    // Restore scroll position to prevent jump
    window.scrollTo(0, scrollY);

    showToast('Card moved down');
  }
}

// Create card add button
function createCardAddButton(sectionId) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'card-add-btn';
  btn.textContent = '+';
  btn.title = 'Add new card above this one';
  btn.addEventListener('click', () => onAddCard(sectionId));
  return btn;
}

// Create card delete button
function createCardDeleteButton(sectionId) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'card-delete-btn';
  btn.textContent = '×';
  btn.title = 'Delete this card';
  btn.addEventListener('click', () => onDeleteCard(sectionId));
  return btn;
}

function createCardReorderButtons(sectionId, sectionType) {
  const container = document.createElement('div');
  container.className = 'card-reorder-buttons';

  // Color picker button (for analytics/tools cards only) - on the left
  if (['analytics', 'tools', 'newCardAnalytics'].includes(sectionType)) {
    const colorPickerBtn = document.createElement('button');
    colorPickerBtn.type = 'button';
    colorPickerBtn.className = 'color-picker-btn';
    colorPickerBtn.title = 'Change bubble color';
    colorPickerBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="9" fill="url(#colorGradient-${sectionId})" stroke="currentColor" stroke-width="1"/>
        <defs>
          <linearGradient id="colorGradient-${sectionId}" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#ff6b6b;stop-opacity:1" />
            <stop offset="25%" style="stop-color:#4ecdc4;stop-opacity:1" />
            <stop offset="50%" style="stop-color:#ffe66d;stop-opacity:1" />
            <stop offset="75%" style="stop-color:#a8dadc;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#f1c0e8;stop-opacity:1" />
          </linearGradient>
        </defs>
      </svg>
    `;
    colorPickerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openColorPicker(sectionId, sectionType);
    });
    container.appendChild(colorPickerBtn);
  }

  // Up button
  const upBtn = document.createElement('button');
  upBtn.type = 'button';
  upBtn.className = 'card-reorder-btn';
  upBtn.title = 'Move card up';
  upBtn.innerHTML = `
    <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" d="M5 15l7-7 7 7"></path>
    </svg>
  `;
  upBtn.addEventListener('click', () => moveCardUp(sectionId));

  // Down button
  const downBtn = document.createElement('button');
  downBtn.type = 'button';
  downBtn.className = 'card-reorder-btn';
  downBtn.title = 'Move card down';
  downBtn.innerHTML = `
    <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"></path>
    </svg>
  `;
  downBtn.addEventListener('click', () => moveCardDown(sectionId));

  container.appendChild(upBtn);
  container.appendChild(downBtn);

  return container;
}

// Create reorder buttons for two-column paired cards (moves entire pair)
function createTwoColReorderButtons(leftCardId) {
  const container = document.createElement('div');
  container.className = 'card-reorder-buttons';

  // Up button - moves the entire pair up
  const upBtn = document.createElement('button');
  upBtn.type = 'button';
  upBtn.className = 'card-reorder-btn';
  upBtn.title = 'Move pair up';
  upBtn.innerHTML = `
    <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" d="M5 15l7-7 7 7"></path>
    </svg>
  `;
  upBtn.addEventListener('click', () => moveTwoColUp(leftCardId));

  // Down button - moves the entire pair down
  const downBtn = document.createElement('button');
  downBtn.type = 'button';
  downBtn.className = 'card-reorder-btn';
  downBtn.title = 'Move pair down';
  downBtn.innerHTML = `
    <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"></path>
    </svg>
  `;
  downBtn.addEventListener('click', () => moveTwoColDown(leftCardId));

  container.appendChild(upBtn);
  container.appendChild(downBtn);

  return container;
}

// ===== DRAG AND DROP FUNCTIONS =====
// NOTE: These functions have been extracted to js/features/drag-drop.js
// They remain here temporarily until all dependent code is migrated.
// The module exports are available via window.* for external access.

// Initialize drag handlers for a card
function initializeDragHandlers(cardElement, sectionId) {
  if (!cardElement || !editState.enabled) return;

  // Make card draggable
  cardElement.draggable = true;
  cardElement.style.cursor = 'move';

  // Drag start
  cardElement.addEventListener('dragstart', (e) => {
    // Prevent dragging if clicking on buttons or interactive elements
    if (e.target.tagName === 'BUTTON' ||
        e.target.tagName === 'A' ||
        e.target.tagName === 'INPUT' ||
        e.target.closest('button') ||
        e.target.closest('.editable') ||
        e.target.closest('.icon-btn') ||
        e.target.closest('.list-item')) {
      e.preventDefault();
      return;
    }

    dragState.draggedElement = cardElement;
    dragState.draggedSection = sectionId;

    // Add dragging class for visual feedback
    cardElement.classList.add('dragging');

    // Set drag effect
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', sectionId);

    // Create drop indicator if it doesn't exist
    if (!dragState.dropIndicator) {
      dragState.dropIndicator = document.createElement('div');
      dragState.dropIndicator.className = 'drop-indicator';
      dragState.dropIndicator.style.position = 'absolute';
      dragState.dropIndicator.style.zIndex = '1000';
      dragState.dropIndicator.style.pointerEvents = 'none';
      dragState.dropIndicator.innerHTML = '<div class="drop-line"></div>';
      document.body.appendChild(dragState.dropIndicator);
    }
    // Make sure indicator starts hidden
    dragState.dropIndicator.style.display = 'none';
  });

  // Drag end
  cardElement.addEventListener('dragend', (e) => {
    // Remove dragging class
    cardElement.classList.remove('dragging');

    // Hide drop indicator
    if (dragState.dropIndicator) {
      dragState.dropIndicator.style.display = 'none';
    }

    // Reset drag state
    dragState.draggedElement = null;
    dragState.draggedSection = null;
    dragState.potentialDropZone = null;
    dragState.potentialDropPosition = null;
  });
}

// Handle drag over for determining drop zones
function handleDragOver(e) {
  // Check for either regular card drag or two-col container drag
  if ((!dragState.draggedElement && !dragState.draggedTwoCol) || !editState.enabled) return;

  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';

  // Throttle the event to prevent performance issues
  const now = Date.now();
  if (now - dragState.lastDragOverTime < 50) return; // 50ms throttle
  dragState.lastDragOverTime = now;

  // Check if we're over the main area
  const main = document.querySelector('.app-main');
  if (!main) return;

  const allCards = Array.from(main.querySelectorAll('.card:not(.dragging)'));

  // If no other cards, hide indicator and return
  if (allCards.length === 0) {
    if (dragState.dropIndicator) {
      dragState.dropIndicator.style.display = 'none';
    }
    return;
  }

  // Get mouse position
  const mouseY = e.clientY;
  const mouseX = e.clientX;

  // Find the closest card
  let closestCard = null;
  let closestDistance = Infinity;
  let dropPosition = 'before'; // or 'after' or 'beside'

  allCards.forEach(card => {
    const rect = card.getBoundingClientRect();
    const cardMiddleY = rect.top + rect.height / 2;
    const cardMiddleX = rect.left + rect.width / 2;

    // Check if we're near this card
    const distanceY = Math.abs(mouseY - cardMiddleY);

    if (distanceY < closestDistance) {
      closestDistance = distanceY;
      closestCard = card;

      // Determine drop position
      if (mouseY < cardMiddleY) {
        dropPosition = 'before';
      } else {
        dropPosition = 'after';
      }

      // Check if we're dragging to the side for two-column layout
      const horizontalDistance = Math.abs(mouseX - cardMiddleX);
      const verticalThreshold = rect.height * 0.3; // Within 30% of card height

      if (distanceY < verticalThreshold && horizontalDistance > rect.width * 0.4) {
        // Check if this card can form a two-column pair
        const data = currentData();
        const sections = currentSections(); // Use display-mode-specific sections
        const cardSection = sections.find(s => s.id === card.id);
        const draggedSectionData = sections.find(s => s.id === dragState.draggedSection);

        // Allow two-column creation for any cards (they can already be in pairs, we'll break them)
        if (cardSection && draggedSectionData && cardSection.id !== draggedSectionData.id) {
          dropPosition = mouseX < cardMiddleX ? 'beside-left' : 'beside-right';
        }
      }
    }
  });

  // Check if we're trying to drop between two-column pair cards
  // If so, adjust the drop position to treat the pair as a unit
  if (closestCard && (dropPosition === 'before' || dropPosition === 'after')) {
    const data = currentData();
    const sections = currentSections();
    const cardSection = sections.find(s => s.id === closestCard.id);

    if (cardSection && cardSection.twoColumnPair) {
      // If dropping "before" the RIGHT card (pairIndex 1), redirect to "before" the LEFT card
      if (dropPosition === 'before' && cardSection.pairIndex === 1) {
        // Find the left card of this pair
        const cardIndex = sections.findIndex(s => s.id === closestCard.id);
        if (cardIndex > 0) {
          const leftCard = sections[cardIndex - 1];
          if (leftCard && leftCard.twoColumnPair && leftCard.pairIndex === 0) {
            const leftCardEl = document.getElementById(leftCard.id);
            if (leftCardEl) {
              closestCard = leftCardEl;
            }
          }
        }
      }
      // If dropping "after" the LEFT card (pairIndex 0), redirect to "after" the RIGHT card
      else if (dropPosition === 'after' && cardSection.pairIndex === 0) {
        // Find the right card of this pair
        const cardIndex = sections.findIndex(s => s.id === closestCard.id);
        if (cardIndex < sections.length - 1) {
          const rightCard = sections[cardIndex + 1];
          if (rightCard && rightCard.twoColumnPair && rightCard.pairIndex === 1) {
            const rightCardEl = document.getElementById(rightCard.id);
            if (rightCardEl) {
              closestCard = rightCardEl;
            }
          }
        }
      }
    }
  }

  // Update drop indicator position
  if (closestCard && dragState.dropIndicator) {
    const rect = closestCard.getBoundingClientRect();
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

    // Make indicator visible
    dragState.dropIndicator.style.display = 'block';

    // Position the drop indicator absolutely
    if (dropPosition === 'before') {
      dragState.dropIndicator.style.left = `${rect.left + scrollLeft}px`;
      dragState.dropIndicator.style.top = `${rect.top + scrollTop - 6}px`;
      dragState.dropIndicator.style.width = `${rect.width}px`;
      dragState.dropIndicator.style.height = '4px';
      dragState.dropIndicator.className = 'drop-indicator horizontal';
    } else if (dropPosition === 'after') {
      dragState.dropIndicator.style.left = `${rect.left + scrollLeft}px`;
      dragState.dropIndicator.style.top = `${rect.bottom + scrollTop + 2}px`;
      dragState.dropIndicator.style.width = `${rect.width}px`;
      dragState.dropIndicator.style.height = '4px';
      dragState.dropIndicator.className = 'drop-indicator horizontal';
    } else if (dropPosition === 'beside-left') {
      dragState.dropIndicator.style.left = `${rect.left + scrollLeft - 6}px`;
      dragState.dropIndicator.style.top = `${rect.top + scrollTop}px`;
      dragState.dropIndicator.style.width = '4px';
      dragState.dropIndicator.style.height = `${rect.height}px`;
      dragState.dropIndicator.className = 'drop-indicator vertical beside-left';
    } else if (dropPosition === 'beside-right') {
      dragState.dropIndicator.style.left = `${rect.right + scrollLeft + 2}px`;
      dragState.dropIndicator.style.top = `${rect.top + scrollTop}px`;
      dragState.dropIndicator.style.width = '4px';
      dragState.dropIndicator.style.height = `${rect.height}px`;
      dragState.dropIndicator.className = 'drop-indicator vertical beside-right';
    }

    dragState.potentialDropZone = closestCard.id;
    dragState.potentialDropPosition = dropPosition;
  } else if (dragState.dropIndicator) {
    // Hide indicator if no valid drop zone
    dragState.dropIndicator.style.display = 'none';
  }
}

// Handle drop event
function handleDrop(e) {
  e.preventDefault();

  if (!dragState.draggedSection || !dragState.potentialDropZone || !editState.enabled) return;

  const data = currentData();
  const sections = currentSections(); // Use display-mode-specific sections

  // Handle two-column container drop (moving both cards together)
  if (dragState.draggedTwoCol) {
    handleTwoColDrop(e, sections);
    return;
  }

  const draggedIndex = sections.findIndex(s => s.id === dragState.draggedSection);
  let targetIndex = sections.findIndex(s => s.id === dragState.potentialDropZone);

  if (draggedIndex === -1 || targetIndex === -1 || draggedIndex === targetIndex) return;

  let position = dragState.potentialDropPosition;

  // Prevent wedging cards between two-column pair cards
  // Redirect to treat the pair as a unit
  if (position === 'before' || position === 'after') {
    const targetCard = sections[targetIndex];
    if (targetCard && targetCard.twoColumnPair) {
      // If dropping "before" the RIGHT card (pairIndex 1), redirect to "before" the LEFT card
      if (position === 'before' && targetCard.pairIndex === 1) {
        if (targetIndex > 0) {
          const leftCard = sections[targetIndex - 1];
          if (leftCard && leftCard.twoColumnPair && leftCard.pairIndex === 0) {
            targetIndex = targetIndex - 1;
          }
        }
      }
      // If dropping "after" the LEFT card (pairIndex 0), redirect to "after" the RIGHT card
      else if (position === 'after' && targetCard.pairIndex === 0) {
        if (targetIndex < sections.length - 1) {
          const rightCard = sections[targetIndex + 1];
          if (rightCard && rightCard.twoColumnPair && rightCard.pairIndex === 1) {
            targetIndex = targetIndex + 1;
          }
        }
      }
    }
  }

  if (position === 'beside-left' || position === 'beside-right') {
    // Create two-column layout
    const draggedCard = sections[draggedIndex];
    const targetCard = sections[targetIndex];

    // Check if dragged card was part of a two-column pair and break it
    if (draggedCard.twoColumnPair) {
      const draggedPairIndex = draggedCard.pairIndex === 0 ? draggedIndex + 1 : draggedIndex - 1;
      if (draggedPairIndex >= 0 && draggedPairIndex < sections.length) {
        const draggedPairCard = sections[draggedPairIndex];
        if (draggedPairCard && draggedPairCard.twoColumnPair) {
          delete draggedPairCard.twoColumnPair;
          delete draggedPairCard.pairIndex;
        }
      }
    }

    // Check if target card was part of a two-column pair and break it
    if (targetCard.twoColumnPair) {
      const targetPairIndex = targetCard.pairIndex === 0 ? targetIndex + 1 : targetIndex - 1;
      if (targetPairIndex >= 0 && targetPairIndex < sections.length) {
        const targetPairCard = sections[targetPairIndex];
        if (targetPairCard && targetPairCard.twoColumnPair) {
          delete targetPairCard.twoColumnPair;
          delete targetPairCard.pairIndex;
        }
      }
    }

    // Remove dragged card from its current position
    sections.splice(draggedIndex, 1);

    // Update target index after removal
    const newTargetIndex = draggedIndex < targetIndex ? targetIndex - 1 : targetIndex;

    // Set two-column properties
    draggedCard.twoColumnPair = true;
    targetCard.twoColumnPair = true;

    if (position === 'beside-left') {
      // Dragged card goes on the left (index 0), target on the right (index 1)
      draggedCard.pairIndex = 0;
      targetCard.pairIndex = 1;
      // Ensure they are consecutive: [dragged, target]
      sections.splice(newTargetIndex, 0, draggedCard);
      console.log('Created two-column pair (beside-left):', draggedCard.id, targetCard.id);
    } else {
      // Dragged card goes on the right (index 1), target on the left (index 0)
      draggedCard.pairIndex = 1;
      targetCard.pairIndex = 0;
      // Ensure they are consecutive: [target, dragged]
      sections.splice(newTargetIndex + 1, 0, draggedCard);
      console.log('Created two-column pair (beside-right):', targetCard.id, draggedCard.id);
    }

    // Log the final sections array to verify ordering
    console.log('Sections after two-column creation:', sections.map(s => ({
      id: s.id,
      twoColumnPair: s.twoColumnPair,
      pairIndex: s.pairIndex
    })));
  } else {
    // Normal reordering
    const draggedCard = sections[draggedIndex];

    // Check if dragged card was part of a two-column pair and break it
    if (draggedCard.twoColumnPair) {
      const pairIndex = draggedCard.pairIndex === 0 ? draggedIndex + 1 : draggedIndex - 1;
      const pairCard = sections[pairIndex];
      if (pairCard && pairCard.twoColumnPair) {
        delete pairCard.twoColumnPair;
        delete pairCard.pairIndex;
      }
      delete draggedCard.twoColumnPair;
      delete draggedCard.pairIndex;
    }

    // Remove from current position
    sections.splice(draggedIndex, 1);

    // Calculate new index
    let newIndex = draggedIndex < targetIndex ? targetIndex - 1 : targetIndex;
    if (position === 'after') {
      newIndex = draggedIndex < targetIndex ? targetIndex : targetIndex + 1;
    }

    // Insert at new position
    sections.splice(newIndex, 0, draggedCard);
  }

  // Update and re-render
  markDirtyAndSave();
  renderAllSections();
  if (editState.enabled) {
    ensureSectionPlusButtons();
    refreshEditingClasses();
  }

  if (position === 'beside-left' || position === 'beside-right') {
    showToast('Two-column layout created');
  } else {
    showToast('Card moved');
  }
}

// Handle drop for two-column container (moves both cards together)
function handleTwoColDrop(e, sections) {
  const firstCardId = dragState.draggedSection;
  const secondCardId = dragState.draggedSecondSection;

  const firstIndex = sections.findIndex(s => s.id === firstCardId);
  const secondIndex = sections.findIndex(s => s.id === secondCardId);

  if (firstIndex === -1 || secondIndex === -1) return;

  // Get the target - could be a card or a two-col container
  let targetIndex = sections.findIndex(s => s.id === dragState.potentialDropZone);

  // If target is part of the dragged pair, ignore
  if (dragState.potentialDropZone === firstCardId || dragState.potentialDropZone === secondCardId) return;

  // If target wasn't found directly, check if it's a two-col container
  if (targetIndex === -1) {
    // potentialDropZone might be a container element, not a section
    return;
  }

  let position = dragState.potentialDropPosition;

  // Prevent wedging cards between two-column pair cards
  // Redirect to treat the pair as a unit
  if (position === 'before' || position === 'after') {
    const targetCard = sections[targetIndex];
    if (targetCard && targetCard.twoColumnPair) {
      // If dropping "before" the RIGHT card (pairIndex 1), redirect to "before" the LEFT card
      if (position === 'before' && targetCard.pairIndex === 1) {
        if (targetIndex > 0) {
          const leftCard = sections[targetIndex - 1];
          if (leftCard && leftCard.twoColumnPair && leftCard.pairIndex === 0) {
            targetIndex = targetIndex - 1;
          }
        }
      }
      // If dropping "after" the LEFT card (pairIndex 0), redirect to "after" the RIGHT card
      else if (position === 'after' && targetCard.pairIndex === 0) {
        if (targetIndex < sections.length - 1) {
          const rightCard = sections[targetIndex + 1];
          if (rightCard && rightCard.twoColumnPair && rightCard.pairIndex === 1) {
            targetIndex = targetIndex + 1;
          }
        }
      }
    }
  }

  // Don't allow beside positioning when dragging a two-col (they stay together)
  if (position === 'beside-left' || position === 'beside-right') {
    showToast('Two-column pairs must stay together');
    return;
  }

  // Get both cards
  const firstCard = sections[firstIndex];
  const secondCard = sections[secondIndex];

  // Determine which card is actually first in the array (lower index)
  const lowerIndex = Math.min(firstIndex, secondIndex);
  const higherIndex = Math.max(firstIndex, secondIndex);

  // Remove both cards (remove higher index first to preserve lower index)
  const cardAtHigher = sections.splice(higherIndex, 1)[0];
  const cardAtLower = sections.splice(lowerIndex, 1)[0];

  // Recalculate target index after removals
  let adjustedTargetIndex = targetIndex;
  if (targetIndex > higherIndex) adjustedTargetIndex -= 1;
  if (targetIndex > lowerIndex) adjustedTargetIndex -= 1;

  // Calculate insertion index
  let insertIndex = adjustedTargetIndex;
  if (position === 'after') {
    insertIndex = adjustedTargetIndex + 1;
  }

  // Insert both cards at the new position (maintain their relative order)
  // The card with pairIndex 0 should come first
  const leftCard = cardAtLower.pairIndex === 0 ? cardAtLower : cardAtHigher;
  const rightCard = cardAtLower.pairIndex === 0 ? cardAtHigher : cardAtLower;

  sections.splice(insertIndex, 0, leftCard, rightCard);

  // Update and re-render
  markDirtyAndSave();
  renderAllSections();
  if (editState.enabled) {
    ensureSectionPlusButtons();
    refreshEditingClasses();
  }

  showToast('Cards moved');
}

// ===== ITEM-LEVEL DRAG AND DROP =====

// Initialize drag handlers for items (icons, list items)
function initializeItemDragHandlers(element, itemKey, sectionKey) {
  if (!element || !editState.enabled) return;

  // Make item draggable
  element.draggable = true;
  element.style.cursor = 'grab';

  // Drag start
  element.addEventListener('dragstart', (e) => {
    e.stopPropagation(); // Prevent card dragging

    dragState.draggedItem = element;
    dragState.draggedItemKey = itemKey;
    dragState.draggedItemSection = sectionKey;

    // Add dragging class
    element.classList.add('item-dragging');
    element.style.cursor = 'grabbing';

    // Set drag effect
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', itemKey);

    // Create item drop indicator if it doesn't exist
    if (!dragState.itemDropIndicator) {
      dragState.itemDropIndicator = document.createElement('div');
      dragState.itemDropIndicator.className = 'item-drop-indicator';
      dragState.itemDropIndicator.style.position = 'absolute';
      dragState.itemDropIndicator.style.zIndex = '1001';
      dragState.itemDropIndicator.style.pointerEvents = 'none';
      dragState.itemDropIndicator.innerHTML = '<div class="item-drop-line"></div>';
      document.body.appendChild(dragState.itemDropIndicator);
    }
    dragState.itemDropIndicator.style.display = 'none';
  });

  // Drag end
  element.addEventListener('dragend', (e) => {
    e.stopPropagation();

    // Remove dragging class
    element.classList.remove('item-dragging');
    element.style.cursor = 'grab';

    // Hide drop indicator
    if (dragState.itemDropIndicator) {
      dragState.itemDropIndicator.style.display = 'none';
    }

    // Reset drag state
    dragState.draggedItem = null;
    dragState.draggedItemKey = null;
    dragState.draggedItemSection = null;
  });

  // Note: dragover and drop are now handled at container level for better coverage
  // See initializeContainerDragHandlers()
}

// Initialize container-level drag handlers for better drop zone coverage
function initializeContainerDragHandlers(container, sectionKey) {
  if (!container || !editState.enabled) return;

  // Check if already initialized to avoid duplicates
  if (container.dataset.dragInitialized) return;
  container.dataset.dragInitialized = 'true';

  const isIconContainer = container.classList.contains('icon-grid') || container.classList.contains('icon-row');

  // Determine gap size based on container type
  let gapSize = 12; // default for lists
  if (container.classList.contains('icon-grid')) {
    gapSize = 16;
  } else if (container.classList.contains('icon-row')) {
    gapSize = 24;
  }
  const halfGap = gapSize / 2;

  // Drag over - detect where to drop (container level)
  container.addEventListener('dragover', (e) => {
    if (!dragState.draggedItem || !editState.enabled) return;
    if (dragState.draggedItemSection !== sectionKey) return;

    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';

    const mouseX = e.clientX;
    const mouseY = e.clientY;
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

    // Get all draggable items in this container (excluding dragged item, add tiles, and separators)
    const items = Array.from(container.querySelectorAll('[data-key]')).filter(item =>
      !item.classList.contains('add-tile') &&
      !item.classList.contains('item-dragging') &&
      !item.classList.contains('icon-separator')
    );

    if (items.length === 0) {
      dragState.itemDropIndicator.style.display = 'none';
      return;
    }

    // Find closest item with row-awareness for grids
    let closestItem = null;
    let closestDistance = Infinity;
    let dropPosition = 'before';

    if (isIconContainer) {
      // For grid/row layouts: group items by row, then find closest within row
      const itemsByRow = [];
      const rowTolerance = 10; // pixels tolerance for considering items in same row

      // Group items by their vertical position (row)
      items.forEach(item => {
        const rect = item.getBoundingClientRect();
        const itemTop = rect.top;

        // Find existing row or create new one
        let rowGroup = itemsByRow.find(row => Math.abs(row.top - itemTop) < rowTolerance);
        if (!rowGroup) {
          rowGroup = { top: itemTop, items: [] };
          itemsByRow.push(rowGroup);
        }
        rowGroup.items.push({ element: item, rect });
      });

      // Sort rows by vertical position
      itemsByRow.sort((a, b) => a.top - b.top);

      // Sort items within each row by horizontal position
      itemsByRow.forEach(row => {
        row.items.sort((a, b) => a.rect.left - b.rect.left);
      });

      // Find which row the mouse is in (find closest row by vertical distance)
      let targetRow = null;
      let closestRowDistance = Infinity;

      itemsByRow.forEach(row => {
        // Get the vertical center of this row
        const rowTop = row.items[0].rect.top;
        const rowBottom = row.items[0].rect.bottom;
        const rowCenterY = (rowTop + rowBottom) / 2;

        // Calculate vertical distance from mouse to row center
        const distance = Math.abs(mouseY - rowCenterY);

        if (distance < closestRowDistance) {
          closestRowDistance = distance;
          targetRow = row;
        }
      });

      // Find closest item in the target row
      if (targetRow && targetRow.items.length > 0) {
        targetRow.items.forEach(({ element: item, rect }) => {
          const itemCenterX = rect.left + rect.width / 2;
          const distance = Math.abs(mouseX - itemCenterX);

          if (distance < closestDistance) {
            closestDistance = distance;
            closestItem = item;
            dropPosition = mouseX < itemCenterX ? 'before' : 'after';
          }
        });

        // Check if we're past the last item in this row (for end of row placement)
        const lastInRow = targetRow.items[targetRow.items.length - 1];
        if (lastInRow && mouseX > lastInRow.rect.right + halfGap) {
          closestItem = lastInRow.element;
          dropPosition = 'after';
        }
      }
    } else {
      // For vertical lists: use simple vertical distance
      items.forEach(item => {
        const rect = item.getBoundingClientRect();
        const itemCenterY = rect.top + rect.height / 2;
        const distance = Math.abs(mouseY - itemCenterY);

        if (distance < closestDistance) {
          closestDistance = distance;
          closestItem = item;
          dropPosition = mouseY < itemCenterY ? 'before' : 'after';
        }
      });

      // Check if we're past the last item (for end placement)
      const lastItem = items[items.length - 1];
      if (lastItem) {
        const lastRect = lastItem.getBoundingClientRect();
        if (mouseY > lastRect.bottom + halfGap) {
          closestItem = lastItem;
          dropPosition = 'after';
        }
      }
    }

    if (closestItem && dragState.itemDropIndicator) {
      const rect = closestItem.getBoundingClientRect();
      dragState.itemDropIndicator.style.display = 'block';

      // Store target info for drop handler
      dragState.itemDropIndicator.dataset.targetKey = closestItem.dataset.key;
      dragState.itemDropIndicator.dataset.position = dropPosition;

      if (isIconContainer) {
        // Vertical indicator for icon grids/rows
        if (dropPosition === 'before') {
          dragState.itemDropIndicator.style.left = `${rect.left + scrollLeft - halfGap - 1.5}px`;
        } else {
          dragState.itemDropIndicator.style.left = `${rect.right + scrollLeft + halfGap - 1.5}px`;
        }
        dragState.itemDropIndicator.style.top = `${rect.top + scrollTop}px`;
        dragState.itemDropIndicator.style.width = '3px';
        dragState.itemDropIndicator.style.height = `${rect.height}px`;
        dragState.itemDropIndicator.className = 'item-drop-indicator vertical';
      } else {
        // Horizontal indicator for lists
        dragState.itemDropIndicator.style.left = `${rect.left + scrollLeft}px`;
        if (dropPosition === 'before') {
          dragState.itemDropIndicator.style.top = `${rect.top + scrollTop - halfGap - 1.5}px`;
        } else {
          dragState.itemDropIndicator.style.top = `${rect.bottom + scrollTop + halfGap - 1.5}px`;
        }
        dragState.itemDropIndicator.style.width = `${rect.width}px`;
        dragState.itemDropIndicator.style.height = '3px';
        dragState.itemDropIndicator.className = 'item-drop-indicator horizontal';
      }
    }
  });

  // Drop - reorder the item (container level)
  container.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (!dragState.draggedItemKey || !dragState.draggedItemSection) return;
    if (dragState.draggedItemSection !== sectionKey) return;

    const data = currentData();

    // Handle composite keys for copy-paste items (format: "sectionId:subtitle")
    let collection;
    if (sectionKey.includes(':')) {
      const [sectionId, subtitle] = sectionKey.split(':');
      collection = data[sectionId]?.[subtitle];
    } else {
      collection = data[sectionKey];
    }

    if (!Array.isArray(collection)) return;

    const targetKey = dragState.itemDropIndicator?.dataset.targetKey;
    const position = dragState.itemDropIndicator?.dataset.position;

    if (!targetKey) return;

    const draggedIndex = collection.findIndex(item => item.key === dragState.draggedItemKey);
    const targetIndex = collection.findIndex(item => item.key === targetKey);

    if (draggedIndex === -1 || targetIndex === -1 || draggedIndex === targetIndex) return;

    // Calculate final position
    let finalIndex;
    if (position === 'before') {
      finalIndex = targetIndex;
    } else {
      finalIndex = targetIndex + 1;
    }

    // Check if this would result in no change
    if (finalIndex === draggedIndex || finalIndex === draggedIndex + 1) return;

    // Remove and reinsert
    const [draggedItem] = collection.splice(draggedIndex, 1);

    let newIndex;
    if (draggedIndex < finalIndex) {
      newIndex = finalIndex - 1;
    } else {
      newIndex = finalIndex;
    }

    collection.splice(newIndex, 0, draggedItem);

    // Update and re-render
    markDirtyAndSave();
    renderAllSections();
    if (editState.enabled) {
      ensureSectionPlusButtons();
      refreshEditingClasses();
    }

    showToast('Item moved');
  });
}

// Initialize drag handlers for reminder items
function initializeReminderDragHandlers(element, itemKey, subtitle, sectionId) {
  if (!element || !editState.enabled) return;

  // Make item draggable
  element.draggable = true;
  element.style.cursor = 'grab';

  // Drag start
  element.addEventListener('dragstart', (e) => {
    e.stopPropagation(); // Prevent card dragging

    dragState.draggedItem = element;
    dragState.draggedItemKey = itemKey;
    dragState.draggedItemSection = `${sectionId}:${subtitle}`; // Store section and subtitle

    // Add dragging class
    element.classList.add('item-dragging');
    element.style.cursor = 'grabbing';

    // Set drag effect
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', itemKey);

    // Create item drop indicator if it doesn't exist
    if (!dragState.itemDropIndicator) {
      dragState.itemDropIndicator = document.createElement('div');
      dragState.itemDropIndicator.className = 'item-drop-indicator';
      dragState.itemDropIndicator.style.position = 'absolute';
      dragState.itemDropIndicator.style.zIndex = '1001';
      dragState.itemDropIndicator.style.pointerEvents = 'none';
      dragState.itemDropIndicator.innerHTML = '<div class="item-drop-line"></div>';
      document.body.appendChild(dragState.itemDropIndicator);
    }
    dragState.itemDropIndicator.style.display = 'none';
  });

  // Drag end
  element.addEventListener('dragend', (e) => {
    e.stopPropagation();

    // Remove dragging class
    element.classList.remove('item-dragging');
    element.style.cursor = 'grab';

    // Hide drop indicator
    if (dragState.itemDropIndicator) {
      dragState.itemDropIndicator.style.display = 'none';
    }

    // Reset drag state
    dragState.draggedItem = null;
    dragState.draggedItemKey = null;
    dragState.draggedItemSection = null;
  });

  // Drag over - detect where to drop
  element.addEventListener('dragover', (e) => {
    if (!dragState.draggedItem || !editState.enabled) return;

    const draggedSectionSubtitle = dragState.draggedItemSection;
    const currentSectionSubtitle = `${sectionId}:${subtitle}`;

    // Only reorder within same section and subtitle
    if (draggedSectionSubtitle !== currentSectionSubtitle) return;

    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';

    const rect = element.getBoundingClientRect();
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

    // Check if this is the last item in the subtitle collection
    const data = currentData();
    let remindersData;
    if (sectionId === 'reminders') {
      remindersData = data.reminders;
    } else {
      remindersData = data[sectionId];
    }
    const collection = remindersData?.[subtitle] || [];
    const isLastItem = Array.isArray(collection) && collection[collection.length - 1]?.key === itemKey;

    // Reminders have 12px vertical gap (from reminder-subtitle-container)
    const gapSize = 12;
    const halfGap = gapSize / 2;

    // Determine if we're in the top or bottom half
    const isTopHalf = e.clientY < rect.top + rect.height / 2;

    // Show indicator
    if (dragState.itemDropIndicator) {
      dragState.itemDropIndicator.style.display = 'block';

      if (isTopHalf) {
        // Show indicator before this element (centered in gap)
        dragState.itemDropIndicator.style.left = `${rect.left + scrollLeft}px`;
        dragState.itemDropIndicator.style.top = `${rect.top + scrollTop - halfGap - 1.5}px`;
        dragState.itemDropIndicator.style.width = `${rect.width}px`;
        dragState.itemDropIndicator.style.height = '3px';
        dragState.itemDropIndicator.className = 'item-drop-indicator horizontal';
        dragState.itemDropIndicator.dataset.position = 'before';
        dragState.itemDropIndicator.dataset.targetKey = itemKey;
      } else if (isLastItem) {
        // Only show "after" indicator for last item (to place at end)
        dragState.itemDropIndicator.style.left = `${rect.left + scrollLeft}px`;
        dragState.itemDropIndicator.style.top = `${rect.bottom + scrollTop + halfGap - 1.5}px`;
        dragState.itemDropIndicator.style.width = `${rect.width}px`;
        dragState.itemDropIndicator.style.height = '3px';
        dragState.itemDropIndicator.className = 'item-drop-indicator horizontal';
        dragState.itemDropIndicator.dataset.position = 'after';
        dragState.itemDropIndicator.dataset.targetKey = itemKey;
      } else {
        // Hide for bottom half of non-last items (prevents duplicate indicators)
        dragState.itemDropIndicator.style.display = 'none';
      }
    }
  });

  // Drop - reorder the item
  element.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (!dragState.draggedItemKey || !dragState.draggedItemSection) return;

    const draggedSectionSubtitle = dragState.draggedItemSection;
    const currentSectionSubtitle = `${sectionId}:${subtitle}`;

    // Only reorder within same section and subtitle
    if (draggedSectionSubtitle !== currentSectionSubtitle) return;

    const data = currentData();

    // Get the reminders collection for this section and subtitle
    let remindersData;
    if (sectionId === 'reminders') {
      remindersData = data.reminders;
    } else {
      remindersData = data[sectionId];
    }

    if (!remindersData || !remindersData[subtitle]) return;

    const collection = remindersData[subtitle];
    if (!Array.isArray(collection)) return;

    const draggedIndex = collection.findIndex(item => item.key === dragState.draggedItemKey);
    const targetIndex = collection.findIndex(item => item.key === itemKey);

    if (draggedIndex === -1 || targetIndex === -1 || draggedIndex === targetIndex) return;

    const position = dragState.itemDropIndicator?.dataset.position;

    // Calculate where the item will end up BEFORE removal
    let finalIndex;
    if (position === 'before') {
      finalIndex = targetIndex;
    } else {
      // position === 'after'
      finalIndex = targetIndex + 1;
    }

    // Check if this would result in no change (item would end up in same position)
    if (finalIndex === draggedIndex || finalIndex === draggedIndex + 1) return;

    // Remove item from current position
    const [draggedItem] = collection.splice(draggedIndex, 1);

    // Calculate new index after removal (indices shift when we remove)
    let newIndex;
    if (draggedIndex < finalIndex) {
      // Moving forward: indices shift down by 1 after removal
      newIndex = finalIndex - 1;
    } else {
      // Moving backward: indices stay the same
      newIndex = finalIndex;
    }

    // Insert at new position
    collection.splice(newIndex, 0, draggedItem);

    // Update and re-render
    markDirtyAndSave();
    renderAllSections();
    if (editState.enabled) {
      ensureSectionPlusButtons();
      refreshEditingClasses();
    }

    showToast('Reminder moved');
  });
}

// Render all sections dynamically based on the sections array
function renderAllSections() {
  const data = currentData();
  const sections = currentSections(); // Use display-mode-specific sections
  const main = $('.app-main');

  // Clear existing sections (except header)
  const existingSections = main.querySelectorAll('section.card');
  existingSections.forEach(section => section.remove());

  // Clear existing two-col containers
  const existingTwoCol = main.querySelectorAll('.two-col');
  existingTwoCol.forEach(container => container.remove());





  // Render sections based on the sections array
  console.log('Rendering sections:', sections.map(s => ({ id: s.id, type: s.type, twoColumnPair: s.twoColumnPair, pairIndex: s.pairIndex })));
  let i = 0;
  while (i < sections.length) {
    const section = sections[i];
    const nextSection = i + 1 < sections.length ? sections[i + 1] : null;

    // Check if this section is part of a two-column pair
    if (section.twoColumnPair && section.pairIndex === 0 &&
        nextSection && nextSection.twoColumnPair && nextSection.pairIndex === 1) {
      // These form a two-column pair - create two-column container
      const twoColContainer = document.createElement('div');
      twoColContainer.className = 'two-col';

      // Add first section
      const sectionEl1 = createSectionElement(section);
      if (sectionEl1) {
        twoColContainer.appendChild(sectionEl1);
      }

      // Add second section
      const sectionEl2 = createSectionElement(nextSection);
      if (sectionEl2) {
        twoColContainer.appendChild(sectionEl2);
      }

      main.appendChild(twoColContainer);
      i += 2; // Skip both sections
    }
    // Special case for dailyTasks and dailyTools (legacy behavior)
    else if (!section.twoColumnPair && !nextSection?.twoColumnPair &&
             section.type === 'dailyTasks' && nextSection?.type === 'dailyTools') {
      // Create two-column container for legacy dailyTasks/dailyTools pairing
      const twoColContainer = document.createElement('div');
      twoColContainer.className = 'two-col';

      // Add current section (daily tasks)
      const sectionEl1 = createSectionElement(section);
      if (sectionEl1) {
        twoColContainer.appendChild(sectionEl1);
      }

      // Add next section (daily tools)
      const sectionEl2 = createSectionElement(nextSection);
      if (sectionEl2) {
        twoColContainer.appendChild(sectionEl2);
      }

      main.appendChild(twoColContainer);
      i += 2; // Skip both sections
    } else {
      // Single section
      const sectionEl = createSectionElement(section);
      if (sectionEl) {
        main.appendChild(sectionEl);
      }
      i += 1;
    }
  }
  


  // Add edit mode buttons if needed
  if (editState.enabled) {
    addCardButtons();
  } else {
    // Remove gap buttons when not in edit mode
    const existingGapButtons = main.querySelectorAll('.gap-add-btn');
    existingGapButtons.forEach(btn => btn.remove());
  }
}

// Create a section element based on section configuration
function createSectionElement(section) {
  const data = currentData();
  

  
  const sectionEl = document.createElement('section');
  sectionEl.className = 'card';
  sectionEl.id = section.id;
  
  // Apply initial size class for new cards to ensure they start small
  if (section.id.startsWith('new-card-')) {
    sectionEl.classList.add('card-size-small');
  }
  
  // Create title
  const titleEl = document.createElement(section.type === 'reminders' ? 'h2' : 'h3');
  titleEl.className = 'section-title editable';
  titleEl.dataset.section = section.id;
  titleEl.textContent = data.sectionTitles[section.id] || section.title;
  
  // Make title editable in edit mode
  if (editState.enabled) {
    titleEl.style.cursor = 'pointer';
    titleEl.title = 'Click to edit title';
    titleEl.addEventListener('click', (e) => {
      if (!editState.enabled) return;
      e.preventDefault();
      openEditPopover(titleEl, { 
        text: data.sectionTitles[section.id] || section.title, 
        hideUrl: true 
      }, ({ text, accept }) => {
        if (!accept) return;
        console.log('Editing title for section:', section.id, 'from:', section.title, 'to:', text);
        // Update both the section title and sectionTitles
        section.title = text;
        data.sectionTitles[section.id] = text;
        titleEl.textContent = text;
        markDirtyAndSave();
        console.log('Updated sectionTitles:', Object.keys(data.sectionTitles).map(key => `${key}: ${data.sectionTitles[key]}`));
      });
    });
  }
  
  sectionEl.appendChild(titleEl);

  // Create content based on section type
  if (section.type === 'reminders') {
    const remindersList = document.createElement('div');
    remindersList.id = 'reminders-list';
    remindersList.className = 'reminders-container';
    sectionEl.appendChild(remindersList);
    renderRemindersForSection(sectionEl);
  } else if (['dailyTasks', 'dailyTools'].includes(section.type)) {
    const grid = document.createElement('div');
    grid.className = 'icon-grid';
    grid.id = `${section.id}-grid`;
    sectionEl.appendChild(grid);
    renderIconGridForSection(sectionEl, section.id);
  } else if (['contentCreation', 'ads'].includes(section.type)) {
    const row = document.createElement('div');
    row.className = 'icon-row';
    row.id = `${section.id}-row`;
    sectionEl.appendChild(row);
    renderIconRowForSection(sectionEl, section.id);
  } else if (section.type === 'newCard') {
    // Regular new card - same structure as daily tasks/tools
    const grid = document.createElement('div');
    grid.className = 'icon-grid';
    grid.id = `${section.id}-grid`;
    sectionEl.appendChild(grid);
    renderIconGridForSection(sectionEl, section.id);
  } else if (['analytics', 'tools', 'newCardAnalytics'].includes(section.type)) {
    const wrapper = document.createElement('div');
    wrapper.className = 'analytics-wrapper';

    const icon = document.createElement('div');
    icon.className = 'section-icon';
    const iconImg = document.createElement('img');
    if (section.type === 'tools') {
      iconImg.src = 'assets/logos/Tools_1.svg';
    } else if (section.type === 'newCard' || section.type === 'newCardAnalytics') {
      // Create a placeholder icon for new cards
      iconImg.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iNCIgZmlsbD0iI0YzRjRGNiIvPgo8cGF0aCBkPSJNMTYgOEgxNlYyNEgxNloiIGZpbGw9IiM5Q0EzQUYiLz4KPHBhdGggZD0iTTggMTZIMjRWMThIOFYxNloiIGZpbGw9IiM5Q0EzQUYiLz4KPC9zdmc+';
    } else {
      iconImg.src = 'assets/logos/Analytics_1.svg';
    }
    iconImg.alt = section.title;
    icon.appendChild(iconImg);

    // Make the section icon editable for analytics-style new cards
    if (section.type === 'newCardAnalytics' && editState.enabled) {
      icon.classList.add('editable');
      icon.dataset.type = 'sectionIcon';
      icon.dataset.section = section.id;
      icon.addEventListener('click', (e) => {
        if (!editState.enabled) return;
        e.preventDefault();
        openEditPopover(icon, {
          text: section.title,
          url: PLACEHOLDER_URL,
          allowImage: true,
          hideText: true
        }, ({ url, image, accept }) => {
          if (!accept) return;
          // Update the section icon image if provided
          if (image) {
            iconImg.src = image;
          }
        markDirtyAndSave();
          renderAllSections();
        });
      });
    }

    const list = document.createElement('div');
    list.className = 'list-links';
    list.id = `${section.id}-list`;

    wrapper.appendChild(icon);
    wrapper.appendChild(list);
    sectionEl.appendChild(wrapper);
    renderListForSection(sectionEl, section.id, section.type === 'tools');
  } else if (section.type === 'copyPaste') {
    const wrapper = document.createElement('div');
    wrapper.className = 'analytics-wrapper';

    const icon = document.createElement('div');
    icon.className = 'section-icon';
    const iconImg = document.createElement('img');
    iconImg.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjY2IiBoZWlnaHQ9IjY2IiBmaWxsPSJub25lIiBzdHJva2U9IiM2YjcyODAiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj4KICA8cmVjdCB4PSI5IiB5PSI5IiB3aWR0aD0iMTMiIGhlaWdodD0iMTMiIHJ4PSIyIiByeT0iMiI+PC9yZWN0PgogIDxwYXRoIGQ9Ik01IDE1SDRhMiAyIDAgMCAxLTItMlY0YTIgMiAwIDAgMSAyLTJoOWEyIDIgMCAwIDEgMiAydjEiPjwvcGF0aD4KPC9zdmc+';
    iconImg.alt = section.title;
    icon.appendChild(iconImg);

    const list = document.createElement('div');
    list.className = 'copy-paste-list';
    list.id = `${section.id}-list`;

    wrapper.appendChild(icon);
    wrapper.appendChild(list);
    sectionEl.appendChild(wrapper);
    renderCopyPasteForSection(sectionEl, section.id);
  }

  return sectionEl;
}

// Render reminders for a specific section
function renderRemindersForSection(sectionEl) {
  console.log('renderRemindersForSection called');
  const data = currentData();
  
  const remindersList = sectionEl.querySelector('#reminders-list');
  if (!remindersList) {
    console.error('reminders-list element not found in section:', sectionEl);
    return;
  }
  
  remindersList.innerHTML = '';
  
  // Get the section ID to determine which reminders data to use
  const sectionId = sectionEl.id;
  let remindersData;
  
  if (sectionId === 'reminders') {
    // Original reminders section - use data.reminders
    remindersData = data.reminders;
    console.log('Data for original reminders rendering:', remindersData);
  } else {
    // New reminder section - use data[sectionId]
    remindersData = data[sectionId];
    console.log(`Data for new reminders section ${sectionId}:`, remindersData);
  }
  
  // Ensure reminders data exists and is properly formatted
  if (!remindersData || typeof remindersData !== 'object') {
    console.error('No reminders data found or invalid format:', remindersData);
    return;
  }
  
  // Render each subtitle group
  Object.entries(remindersData).forEach(([subtitle, reminders]) => {
    console.log(`Rendering subtitle: ${subtitle} with ${reminders.length} items`);
    // Ensure reminders is an array
    if (!Array.isArray(reminders)) {
      console.error('reminders is not an array for subtitle:', subtitle, 'value:', reminders);
      // Convert to array if it's not already
      remindersData[subtitle] = [];
      reminders = remindersData[subtitle];
    }
    
    // Create subtitle wrapper (contains text and color picker)
    const subtitleWrapper = document.createElement('div');
    subtitleWrapper.className = 'reminder-subtitle-wrapper';

    // Create subtitle element
    const subtitleEl = document.createElement('div');
    subtitleEl.className = 'reminder-subtitle editable';
    subtitleEl.dataset.type = 'reminderSubtitle';
    subtitleEl.dataset.subtitle = subtitle;
    subtitleEl.textContent = subtitle;

    if (editState.enabled) {
      subtitleEl.addEventListener('click', (e) => {
        e.preventDefault();
        openEditPopover(subtitleEl, { text: subtitle, hideUrl: true, allowDelete: true }, ({ text, delete: doDelete, accept }) => {
          if (!accept) return;

          // Get fresh reference to current data to avoid stale closures
          const currentRemindersData = sectionId === 'reminders' ? currentData().reminders : currentData()[sectionId];

          if (doDelete) {
            delete currentRemindersData[subtitle];
            // Also delete the subtitle color
            if (data.subtitleColors) {
              delete data.subtitleColors[`${sectionId}:${subtitle}`];
            }
            markDirtyAndSave();
            renderAllSections();
            return;
          }
          if (text && text !== subtitle) {
            // Rename the subtitle
            currentRemindersData[text] = currentRemindersData[subtitle];
            delete currentRemindersData[subtitle];
            // Also rename the color key
            if (data.subtitleColors && data.subtitleColors[`${sectionId}:${subtitle}`]) {
              data.subtitleColors[`${sectionId}:${text}`] = data.subtitleColors[`${sectionId}:${subtitle}`];
              delete data.subtitleColors[`${sectionId}:${subtitle}`];
            }
            markDirtyAndSave();
            renderAllSections();
          }
        });
      });
    }

    subtitleWrapper.appendChild(subtitleEl);

    // Add color picker button in edit mode
    if (editState.enabled) {
      const colorPickerBtn = document.createElement('button');
      colorPickerBtn.type = 'button';
      colorPickerBtn.className = 'subtitle-color-picker-btn';
      colorPickerBtn.title = 'Change bubble color for this section';
      colorPickerBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="10" r="9" fill="url(#subtitleColorGradient-${sectionId}-${subtitle.replace(/\s+/g, '-')})" stroke="currentColor" stroke-width="1"/>
          <defs>
            <linearGradient id="subtitleColorGradient-${sectionId}-${subtitle.replace(/\s+/g, '-')}" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" style="stop-color:#ff6b6b;stop-opacity:1" />
              <stop offset="25%" style="stop-color:#4ecdc4;stop-opacity:1" />
              <stop offset="50%" style="stop-color:#ffe66d;stop-opacity:1" />
              <stop offset="75%" style="stop-color:#a8dadc;stop-opacity:1" />
              <stop offset="100%" style="stop-color:#f1c0e8;stop-opacity:1" />
            </linearGradient>
          </defs>
        </svg>
      `;
      colorPickerBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openSubtitleColorPicker(sectionId, subtitle);
      });
      subtitleWrapper.appendChild(colorPickerBtn);
    }

    remindersList.appendChild(subtitleWrapper);
    
    // Create a container for this subtitle's items
    const subtitleContainer = document.createElement('div');
    subtitleContainer.className = 'reminder-subtitle-container';
    subtitleContainer.dataset.subtitle = subtitle;
    
    // Render reminders under this subtitle
    // Get subtitle color for this section
    const colorKey = `${sectionId}:${subtitle}`;
    const subtitleColor = data.subtitleColors && data.subtitleColors[colorKey];

    reminders.forEach(rem => {
      const div = document.createElement('div');
      div.className = 'reminder-item editable';
      div.dataset.type = 'reminders';
      div.dataset.key = rem.key;
      div.dataset.subtitle = subtitle;
      div.dataset.section = sectionId;

      // Apply custom subtitle color if set (using mode-specific color)
      if (subtitleColor) {
        const defaultColor = '#f7fafc';
        const effectiveColor = getColorForCurrentMode(subtitleColor, defaultColor);
        div.style.background = effectiveColor;
        div.style.borderColor = darkenColor(effectiveColor);
        div.dataset.customColor = JSON.stringify(subtitleColor);
      }

      const a = document.createElement('a');
      a.href = rem.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.className = 'reminder-title';
      a.textContent = rem.title;

      // In view mode, make the entire bubble clickable
      if (!editState.enabled) {
        a.style.pointerEvents = 'none';
        div.style.cursor = 'pointer';
        div.dataset.url = rem.url;
      }

      div.appendChild(a);
      
      const badge = document.createElement('span');
      badge.className = 'days-badge';
      
      // Check if this is an interval reminder
      if (rem.type === 'interval') {
        const progress = calculateIntervalProgress(rem);
        const formattedNumber = formatIntervalNumber(progress.progress, rem.intervalUnit || 'none');
        const typeText = (rem.intervalType || 'limit') === 'goal' ? 'Before goal' : 'Before limit';
        badge.textContent = `${typeText}: ${formattedNumber}`;
        badge.classList.add(getIntervalColorClass(progress.percentage, rem.intervalType || 'limit'));
      } else {
        // Days mode (default)
        if (rem.schedule) {
          try {
            const next = getNextOccurrence(rem.schedule);

            // Additional null check for the returned date
            if (!next || !(next instanceof Date) || isNaN(next.getTime())) {
              console.warn('Invalid date returned for reminder:', rem.title);
              badge.textContent = 'Not scheduled';
              badge.classList.add('days-badge'); // Neutral gray
            } else {
              const days = daysUntil(next);

              // Debug logging for firstWeekdayOfMonth reminders
              if (rem.schedule.type === 'firstWeekdayOfMonth') {
                console.log('firstWeekdayOfMonth reminder debug:', {
                  reminder: rem.title,
                  schedule: rem.schedule,
                  calculatedNext: next,
                  daysUntil: days,
                  nextDate: next.toISOString(),
                  today: new Date().toISOString()
                });
              }

              badge.textContent = days === 0 ? 'Today' : `${days} day${days === 1 ? '' : 's'} left`;
              badge.classList.add(classForDaysLeft(days));
            }
          } catch (error) {
            console.error('Error calculating days for reminder:', rem, error);
            badge.textContent = 'Error';
            badge.classList.add('days-danger');
          }
        } else {
          badge.textContent = 'Not scheduled';
          badge.classList.add('days-badge'); // Neutral gray
        }
      }
      
      if (editState.enabled) {
        const calendarBtn = document.createElement('button');
        calendarBtn.className = 'calendar-btn';
        calendarBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
          <line x1="16" y1="2" x2="16" y2="6"></line>
          <line x1="8" y1="2" x2="8" y2="6"></line>
          <line x1="3" y1="10" x2="21" y2="10"></line>
        </svg>`;
        calendarBtn.title = 'Edit schedule';
        calendarBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          openCalendarPopover(rem);
        });

        const hashtagBtn = document.createElement('button');
        hashtagBtn.className = 'hashtag-btn';
        hashtagBtn.textContent = '#';
        hashtagBtn.title = rem.type === 'interval' ? 'Edit interval settings' : 'Switch to interval mode';
        hashtagBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          openIntervalPopover(rem);
        });

        // Links button - for managing additional links
        const linksBtn = document.createElement('button');
        linksBtn.className = 'links-btn';
        linksBtn.innerHTML = LINK_ICON_SVG;
        linksBtn.title = 'Manage links';
        linksBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          openLinksModal(rem);
        });

        const rightContainer = document.createElement('div');
        rightContainer.style.cssText = 'display: flex; align-items: center; gap: 4px;';
        rightContainer.appendChild(badge);
        rightContainer.appendChild(calendarBtn);
        rightContainer.appendChild(hashtagBtn);
        rightContainer.appendChild(linksBtn);

        div.append(a, rightContainer);
      } else {
        // View mode - show link icon next to title if links exist
        const leftContainer = document.createElement('div');
        leftContainer.className = 'reminder-left-container';
        leftContainer.appendChild(a);

        if (rem.links && rem.links.length > 0) {
          const linksToggleBtn = document.createElement('button');
          linksToggleBtn.type = 'button';
          linksToggleBtn.className = 'reminder-links-toggle';
          linksToggleBtn.innerHTML = LINK_ICON_SVG;
          linksToggleBtn.title = `${rem.links.length} link${rem.links.length > 1 ? 's' : ''}`;
          linksToggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            toggleReminderLinks(rem.key, subtitle, sectionId, linksToggleBtn);
          });
          leftContainer.appendChild(linksToggleBtn);
        }

        div.append(leftContainer, badge);
      }

      div.addEventListener('click', (e) => {
        if (!editState.enabled) {
          // In view mode, open the URL
          e.preventDefault();
          const url = div.dataset.url;
          if (url && url !== PLACEHOLDER_URL) {
            window.open(url, '_blank', 'noopener,noreferrer');
          }
          return;
        }
        e.preventDefault();
        openEditPopover(div, { text: rem.title, url: rem.url, allowDelete: true }, ({ text, url, delete: doDelete, accept }) => {
          if (!accept) return;
          if (doDelete) {
            const collection = data.reminders[subtitle];
            const idx = collection.findIndex(i => i.key === rem.key);
            if (idx !== -1) collection.splice(idx, 1);
            markDirtyAndSave();
            renderAllSections();
            return;
          }
          rem.title = text || rem.title;
          rem.url = url || PLACEHOLDER_URL;
          markDirtyAndSave();
          renderAllSections();
        });
      });

      // Add drag handlers for reordering reminders in edit mode
      if (editState.enabled) {
        initializeReminderDragHandlers(div, rem.key, subtitle, sectionEl.id);
      }

      subtitleContainer.appendChild(div);
    });
    
    // Add inline add tile for reminders under this subtitle in edit mode
    if (editState.enabled) {
      const addTile = document.createElement('div');
      addTile.className = 'reminder-item add-tile';
      addTile.textContent = '+';
      addTile.title = `Add new reminder to ${subtitle}`;
      addTile.dataset.subtitle = subtitle;
      
      addTile.addEventListener('click', (event) => {
        console.log(`Add tile clicked for subtitle: ${subtitle}`);
        const clickedSubtitle = event.currentTarget.dataset.subtitle; // Get subtitle from dataset
        console.log(`Retrieved subtitle from dataset: ${clickedSubtitle}`);
        onAddItem(sectionEl.id, clickedSubtitle);
      });
      
      subtitleContainer.appendChild(addTile);
    }
    
    // Append the subtitle container after the subtitle element
    remindersList.appendChild(subtitleContainer);
  });
  
  // Add subtitle add tile in edit mode
  if (editState.enabled) {
    const addSubtitleTile = document.createElement('div');
    addSubtitleTile.className = 'reminder-subtitle add-tile';
    addSubtitleTile.textContent = '+ Add Subtitle';
    addSubtitleTile.title = 'Add new subtitle';
    
    addSubtitleTile.addEventListener('click', () => {
      onAddSubtitle(sectionEl.id);
    });
    
    remindersList.appendChild(addSubtitleTile);
  }
}

// Render icon grid for a specific section
function renderIconGridForSection(sectionEl, sectionType) {
  const data = currentData();
  const grid = sectionEl.querySelector('.icon-grid');
  if (!grid) return;
  

  
  grid.innerHTML = '';

  // Map section IDs to data keys
  const dataKey = getSectionDataKey(sectionType);

  const items = data[dataKey] || [];
  items.forEach(item => {
    grid.appendChild(createIconButton(item, dataKey));
  });

  if (editState.enabled) {
    grid.appendChild(createAddTile(dataKey));
    // Initialize container-level drag handlers for better drop coverage
    initializeContainerDragHandlers(grid, dataKey);
  }

  // Apply dynamic sizing for regular cards (not analytics/tools type)
  if (['dailyTasks', 'dailyTools', 'newCard'].includes(dataKey) || sectionType.startsWith('new-card-')) {
    const totalItems = items.length + (editState.enabled ? 1 : 0); // Include add tile if in edit mode
    
    // Remove existing size classes
    sectionEl.classList.remove('card-size-small', 'card-size-medium', 'card-size-large', 'card-size-full');
    
    // Apply appropriate size class based on number of items
    if (totalItems <= 2) {
      sectionEl.classList.add('card-size-small');
    } else if (totalItems <= 4) {
      sectionEl.classList.add('card-size-medium');
    } else if (totalItems <= 8) {
      sectionEl.classList.add('card-size-large');
    } else {
      sectionEl.classList.add('card-size-full');
    }
  }
}

// Render icon row for a specific section
function renderIconRowForSection(sectionEl, sectionType) {
  const data = currentData();
  const row = sectionEl.querySelector('.icon-row');
  if (!row) return;
  
  row.innerHTML = '';

  // Map section IDs to data keys
  const dataKey = getSectionDataKey(sectionType);

  const items = data[dataKey] || [];
  items.forEach(item => {
    if (item.isDivider) {
      const separatorEl = createEditableSeparator(item, dataKey);
      row.appendChild(separatorEl);
    } else {
      row.appendChild(createIconButton(item, dataKey));
    }
  });

  if (editState.enabled) {
    row.appendChild(createAddTile(dataKey));
    // Initialize container-level drag handlers for better drop coverage
    initializeContainerDragHandlers(row, dataKey);
  }
}

// Render list for a specific section
function renderListForSection(sectionEl, sectionId, isTools) {
  const data = currentData();
  const list = sectionEl.querySelector('.list-links');
  if (!list) return;
  
  list.innerHTML = '';

  // Map section IDs to data keys
  const dataKey = getSectionDataKey(sectionId);
  
  const items = data[dataKey] || [];
  items.forEach(item => {
    const div = document.createElement('div');
    div.className = `list-item ${isTools ? 'tools' : ''} editable`;
    div.dataset.type = sectionId;
    div.dataset.key = item.key;

    // Apply custom color if set (using mode-specific color)
    if (data.sectionColors && data.sectionColors[sectionId]) {
      const defaultColor = isTools ? '#e6fff3' : '#fff4e5';
      const effectiveColor = getColorForCurrentMode(data.sectionColors[sectionId], defaultColor);
      div.style.background = effectiveColor;
      div.style.borderColor = darkenColor(effectiveColor);
    }
    const a = document.createElement('a');
    a.href = item.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.textContent = item.text;

    if (editState.enabled) {
      // Edit mode - show text and link button
      const contentWrapper = document.createElement('div');
      contentWrapper.className = 'list-item-content';
      contentWrapper.appendChild(a);

      // Links button - for managing additional links
      const linksBtn = document.createElement('button');
      linksBtn.type = 'button';
      linksBtn.className = 'list-item-links-btn';
      linksBtn.innerHTML = LINK_ICON_SVG;
      linksBtn.title = 'Manage links';
      linksBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        openListItemLinksModal(item, sectionId);
      });

      div.appendChild(contentWrapper);
      div.appendChild(linksBtn);
    } else {
      // View mode - make the entire bubble clickable
      a.style.pointerEvents = 'none';
      div.style.cursor = 'pointer';
      div.dataset.url = item.url;

      // Create left container for text and optional links toggle
      const leftContainer = document.createElement('div');
      leftContainer.className = 'list-item-left-container';
      leftContainer.appendChild(a);

      // Show link toggle button if item has links
      if (item.links && item.links.length > 0) {
        const linksToggleBtn = document.createElement('button');
        linksToggleBtn.type = 'button';
        linksToggleBtn.className = 'list-item-links-toggle';
        linksToggleBtn.innerHTML = LINK_ICON_SVG;
        linksToggleBtn.title = `${item.links.length} link${item.links.length > 1 ? 's' : ''}`;
        linksToggleBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          toggleListItemLinks(item, sectionId, linksToggleBtn);
        });
        leftContainer.appendChild(linksToggleBtn);
      }

      div.appendChild(leftContainer);
    }

    div.addEventListener('click', (e) => {
      if (!editState.enabled) {
        // In view mode, open the URL (but not if clicking on links toggle)
        if (e.target.closest('.list-item-links-toggle')) return;
        e.preventDefault();
        const url = div.dataset.url;
        if (url && url !== PLACEHOLDER_URL) {
          window.open(url, '_blank', 'noopener,noreferrer');
        }
        return;
      }
      // In edit mode, don't open popover if clicking links button
      if (e.target.closest('.list-item-links-btn')) return;
      e.preventDefault();
      openEditPopover(div, { text: item.text, url: item.url, allowDelete: true }, ({ text, url, delete: doDelete, accept }) => {
        if (!accept) return;
        if (doDelete) {
          const collection = currentData()[sectionId];
          const idx = collection.findIndex(i => i.key === item.key);
          if (idx !== -1) collection.splice(idx, 1);
          markDirtyAndSave();
          renderAllSections();
          return;
        }
        item.text = text || item.text;
        item.url = url || PLACEHOLDER_URL;
        markDirtyAndSave();
        renderAllSections();
      });
    });

    // Add drag handlers for reordering in edit mode
    if (editState.enabled) {
      initializeItemDragHandlers(div, item.key, dataKey);
    }

    list.appendChild(div);
  });
  
  if (editState.enabled) {
    const add = document.createElement('button');
    add.type = 'button';
    add.className = `list-item ${isTools ? 'tools' : ''} add-tile`;
    add.textContent = '+';

    // Apply custom color if set (lighter and less saturated than regular bubbles)
    if (data.sectionColors && data.sectionColors[sectionId]) {
      const defaultColor = isTools ? '#e6fff3' : '#fff4e5';
      const baseColor = getColorForCurrentMode(data.sectionColors[sectionId], defaultColor);
      const lighterColor = lightenAndDesaturateColor(baseColor);
      add.style.background = lighterColor;
      add.style.borderColor = darkenColor(lighterColor);
    }

    add.addEventListener('click', () => onAddItem(sectionId));
    list.appendChild(add);
    // Initialize container-level drag handlers for better drop coverage
    initializeContainerDragHandlers(list, dataKey);
  }
}

// Render copy-paste items for a specific section
function renderCopyPasteForSection(sectionEl, sectionId) {
  const data = currentData();
  const list = sectionEl.querySelector('.copy-paste-list');
  if (!list) return;

  list.innerHTML = '';

  const copyPasteData = data[sectionId] || {};

  // Render each subtitle and its items
  Object.entries(copyPasteData).forEach(([subtitle, items]) => {
    if (!Array.isArray(items)) return;

    // Create subtitle wrapper (contains subtitle text and color picker)
    const subtitleWrapper = document.createElement('div');
    subtitleWrapper.className = 'reminder-subtitle-wrapper';

    // Create subtitle header
    const subtitleHeader = document.createElement('div');
    subtitleHeader.className = 'reminder-subtitle';
    subtitleHeader.textContent = subtitle;

    // Make subtitle editable in edit mode
    if (editState.enabled) {
      subtitleHeader.classList.add('editable');
      subtitleHeader.addEventListener('click', (e) => {
        e.stopPropagation();
        openEditPopover(subtitleHeader, { text: subtitle, hideUrl: true, allowDelete: true }, ({ text, delete: doDelete, accept }) => {
          if (!accept) return;
          if (doDelete) {
            // Delete the entire subtitle
            delete copyPasteData[subtitle];
            // Also delete the subtitle color
            if (data.subtitleColors) {
              delete data.subtitleColors[`${sectionId}:${subtitle}`];
            }
            renderAllSections();
            return;
          }
          // Rename subtitle
          if (text && text !== subtitle) {
            copyPasteData[text] = copyPasteData[subtitle];
            delete copyPasteData[subtitle];
            // Also rename the color key
            if (data.subtitleColors && data.subtitleColors[`${sectionId}:${subtitle}`]) {
              data.subtitleColors[`${sectionId}:${text}`] = data.subtitleColors[`${sectionId}:${subtitle}`];
              delete data.subtitleColors[`${sectionId}:${subtitle}`];
            }
            renderAllSections();
          }
        });
      });
    }

    subtitleWrapper.appendChild(subtitleHeader);

    // Add color picker button in edit mode
    if (editState.enabled) {
      const colorPickerBtn = document.createElement('button');
      colorPickerBtn.type = 'button';
      colorPickerBtn.className = 'subtitle-color-picker-btn';
      colorPickerBtn.title = 'Change bubble color for this section';
      colorPickerBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="10" r="9" fill="url(#cpColorGradient-${sectionId}-${subtitle.replace(/\s+/g, '-')})" stroke="currentColor" stroke-width="1"/>
          <defs>
            <linearGradient id="cpColorGradient-${sectionId}-${subtitle.replace(/\s+/g, '-')}" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" style="stop-color:#ff6b6b;stop-opacity:1" />
              <stop offset="25%" style="stop-color:#4ecdc4;stop-opacity:1" />
              <stop offset="50%" style="stop-color:#ffe66d;stop-opacity:1" />
              <stop offset="75%" style="stop-color:#a8dadc;stop-opacity:1" />
              <stop offset="100%" style="stop-color:#f1c0e8;stop-opacity:1" />
            </linearGradient>
          </defs>
        </svg>
      `;
      colorPickerBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openSubtitleColorPicker(sectionId, subtitle);
      });
      subtitleWrapper.appendChild(colorPickerBtn);
    }

    list.appendChild(subtitleWrapper);

    // Create container for items under this subtitle
    const subtitleContainer = document.createElement('div');
    subtitleContainer.className = 'copy-paste-subtitle-container';
    subtitleContainer.dataset.subtitle = subtitle;

    // Get subtitle color for this section
    const colorKey = `${sectionId}:${subtitle}`;
    const subtitleColor = data.subtitleColors && data.subtitleColors[colorKey];

    items.forEach(item => {
      const div = document.createElement('div');
      div.className = 'copy-paste-item editable';
      div.dataset.type = sectionId;
      div.dataset.key = item.key;
      div.dataset.subtitle = subtitle;

      // Apply custom subtitle color if set (using mode-specific color)
      if (subtitleColor) {
        const defaultColor = '#f7fafc';
        const effectiveColor = getColorForCurrentMode(subtitleColor, defaultColor);
        div.style.background = effectiveColor;
        div.style.borderColor = darkenColor(effectiveColor);
        div.dataset.customColor = JSON.stringify(subtitleColor);
      }

      const textSpan = document.createElement('span');
      textSpan.className = 'copy-paste-text';
      textSpan.textContent = item.text;

      // Create copy icon (button in edit mode, span in view mode)
      let copyIcon;
      if (editState.enabled) {
        copyIcon = document.createElement('button');
        copyIcon.type = 'button';
        copyIcon.className = 'copy-paste-icon';
        copyIcon.title = 'Edit copy text';
        copyIcon.addEventListener('click', (e) => {
          e.stopPropagation();
          openCopyTextModal(item, sectionId);
        });
      } else {
        copyIcon = document.createElement('span');
        copyIcon.className = 'copy-paste-icon';
        copyIcon.style.pointerEvents = 'none';
        div.style.cursor = 'pointer';
      }

      copyIcon.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
      `;

      div.appendChild(textSpan);
      div.appendChild(copyIcon);

      // Click handler for the entire div
      div.addEventListener('click', (e) => {
        if (!editState.enabled) {
          // In view mode: copy to clipboard
          e.preventDefault();
          copyToClipboard(item.copyText || item.text);
          return;
        }
        // In edit mode: open edit popover
        e.preventDefault();
        openEditPopover(div, { text: item.text, hideUrl: true, allowDelete: true }, ({ text, delete: doDelete, accept }) => {
          if (!accept) return;
          if (doDelete) {
            const collection = copyPasteData[subtitle];
            const idx = collection.findIndex(i => i.key === item.key);
            if (idx !== -1) collection.splice(idx, 1);
            renderAllSections();
            return;
          }
          item.text = text || item.text;
          renderAllSections();
        });
      });

      // Add drag handlers for reordering in edit mode
      if (editState.enabled) {
        initializeReminderDragHandlers(div, item.key, subtitle, sectionId);
      }

      subtitleContainer.appendChild(div);
    });

    // Add "+" button for this subtitle in edit mode
    if (editState.enabled) {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'copy-paste-item add-tile';
      add.textContent = '+';
      add.addEventListener('click', () => onAddItem(sectionId, subtitle));
      subtitleContainer.appendChild(add);

      // Initialize container-level drag handlers for better drop coverage
      const containerKey = `${sectionId}:${subtitle}`;
      initializeContainerDragHandlers(subtitleContainer, containerKey);
    }

    list.appendChild(subtitleContainer);
  });

  // Add new subtitle button in edit mode
  if (editState.enabled) {
    const addSubtitleBtn = document.createElement('div');
    addSubtitleBtn.className = 'reminder-subtitle add-tile';
    addSubtitleBtn.textContent = '+ Add Subtitle';
    addSubtitleBtn.title = 'Add new subtitle';
    addSubtitleBtn.addEventListener('click', () => onAddSubtitle(sectionId));
    list.appendChild(addSubtitleBtn);
  }
}

// removeDragHandlers moved to js/features/drag-drop.js

// Add card buttons to all sections
function addCardButtons() {
  const data = currentData();
  const sections = currentSections();

  sections.forEach((section, index) => {
    const sectionEl = document.getElementById(section.id);
    if (sectionEl) {
      // Remove existing buttons
      const existingDeleteBtn = sectionEl.querySelector('.card-delete-btn');
      if (existingDeleteBtn) existingDeleteBtn.remove();
      const existingReorderBtns = sectionEl.querySelector('.card-reorder-buttons');
      if (existingReorderBtns) existingReorderBtns.remove();
      const existingSwapBtn = sectionEl.querySelector('.card-swap-btn');
      if (existingSwapBtn) existingSwapBtn.remove();

      // Check if this card is part of a two-column pair
      const isTwoColumnPair = section.twoColumnPair;

      if (isTwoColumnPair) {
        // For two-column paired cards: add swap button instead of individual up/down buttons
        // Don't make individual cards draggable - the container handles dragging
        sectionEl.draggable = false;

        // Add swap button at the bottom of each card
        const swapBtn = createSwapButton(section.id, section.pairIndex);
        sectionEl.appendChild(swapBtn);

        // For the LEFT card (pairIndex 0), add up/down buttons to move the entire pair
        if (section.pairIndex === 0) {
          const reorderButtons = createTwoColReorderButtons(section.id);

          // Disable up button if this pair is at the top
          const reorderBtns = reorderButtons.querySelectorAll('.card-reorder-btn');
          if (index === 0 && reorderBtns[0]) {
            reorderBtns[0].disabled = true; // Up button
          }

          // Disable down button if this pair is at the bottom
          // (check if the right card is the last in the array)
          if (index + 1 >= sections.length - 1 && reorderBtns[1]) {
            reorderBtns[1].disabled = true; // Down button
          }

          sectionEl.appendChild(reorderButtons);
        }

        // Add delete button (still allow deleting individual cards)
        sectionEl.appendChild(createCardDeleteButton(section.id));
      } else {
        // For regular cards: add up/down reorder buttons and drag handlers
        initializeDragHandlers(sectionEl, section.id);

        // Add reorder buttons
        const reorderButtons = createCardReorderButtons(section.id, section.type);

        // Disable up button for first card
        const reorderBtns = reorderButtons.querySelectorAll('.card-reorder-btn');
        if (index === 0 && reorderBtns[0]) {
          reorderBtns[0].disabled = true; // Up button
        }

        // Disable down button for last card
        if (index === sections.length - 1 && reorderBtns[1]) {
          reorderBtns[1].disabled = true; // Down button
        }

        sectionEl.appendChild(reorderButtons);

        // Add delete button
        sectionEl.appendChild(createCardDeleteButton(section.id));
      }
    }
  });

  // Add swap buttons and drag handlers to two-column containers
  addTwoColContainerButtons();

  // Add gap-based add buttons
  addGapButtons();
}

// Create swap button for two-column paired cards
function createSwapButton(sectionId, pairIndex) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'card-swap-btn';
  btn.title = 'Swap with adjacent card';

  // Left chevron for right card (pairIndex 1), right chevron for left card (pairIndex 0)
  if (pairIndex === 0) {
    // Left card - show right chevron (pointing to right card)
    btn.innerHTML = `
      <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"></path>
      </svg>
    `;
    btn.classList.add('swap-right');
  } else {
    // Right card - show left chevron (pointing to left card)
    btn.innerHTML = `
      <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"></path>
      </svg>
    `;
    btn.classList.add('swap-left');
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    swapTwoColumnCards(sectionId);
  });

  return btn;
}

// Swap the positions of two cards in a two-column pair
function swapTwoColumnCards(sectionId) {
  const data = currentData();
  const sections = currentSections();

  const index = sections.findIndex(s => s.id === sectionId);
  if (index === -1) return;

  const currentCard = sections[index];
  if (!currentCard.twoColumnPair) return;

  // Find the pair card
  const pairIndex = currentCard.pairIndex === 0 ? index + 1 : index - 1;
  if (pairIndex < 0 || pairIndex >= sections.length) return;

  const pairCard = sections[pairIndex];
  if (!pairCard || !pairCard.twoColumnPair) return;

  // Swap the pairIndex values
  const tempPairIndex = currentCard.pairIndex;
  currentCard.pairIndex = pairCard.pairIndex;
  pairCard.pairIndex = tempPairIndex;

  // Swap positions in the sections array
  sections[index] = pairCard;
  sections[pairIndex] = currentCard;

  // Re-render
  markDirtyAndSave();
  renderAllSections();
  if (editState.enabled) {
    ensureSectionPlusButtons();
    refreshEditingClasses();
  }

  showToast('Cards swapped');
}

// Move a two-column pair up
function moveTwoColUp(leftCardId) {
  const data = currentData();
  const sections = currentSections();

  // Find the left card (pairIndex 0)
  const leftIndex = sections.findIndex(s => s.id === leftCardId);
  if (leftIndex === -1) return;

  const leftCard = sections[leftIndex];
  if (!leftCard.twoColumnPair || leftCard.pairIndex !== 0) return;

  // Right card should be immediately after
  const rightIndex = leftIndex + 1;
  if (rightIndex >= sections.length) return;

  const rightCard = sections[rightIndex];
  if (!rightCard || !rightCard.twoColumnPair || rightCard.pairIndex !== 1) return;

  // Can't move up if already at the top
  if (leftIndex === 0) return;

  // Store scroll position
  const scrollY = window.scrollY;

  // Check if we're moving into a two-column pair above
  const prevCard = sections[leftIndex - 1];
  if (prevCard.twoColumnPair && prevCard.pairIndex === 1) {
    // Moving up into position where the previous card is the right side of a pair
    // We need to move above the entire pair
    const prevPairLeftIndex = leftIndex - 2;
    if (prevPairLeftIndex < 0) return;

    // Remove both cards from current position
    sections.splice(leftIndex, 2);
    // Insert at the position before the pair (which is now at prevPairLeftIndex)
    sections.splice(prevPairLeftIndex, 0, leftCard, rightCard);
  } else {
    // Normal case: just swap with the single card above
    // Remove both cards from current position
    sections.splice(leftIndex, 2);
    // Insert at position above (leftIndex - 1)
    sections.splice(leftIndex - 1, 0, leftCard, rightCard);
  }

  // Re-render
  markDirtyAndSave();
  renderAllSections();
  if (editState.enabled) {
    ensureSectionPlusButtons();
    refreshEditingClasses();
  }

  // Restore scroll position
  requestAnimationFrame(() => window.scrollTo(0, scrollY));
}

// Move a two-column pair down
function moveTwoColDown(leftCardId) {
  const data = currentData();
  const sections = currentSections();

  // Find the left card (pairIndex 0)
  const leftIndex = sections.findIndex(s => s.id === leftCardId);
  if (leftIndex === -1) return;

  const leftCard = sections[leftIndex];
  if (!leftCard.twoColumnPair || leftCard.pairIndex !== 0) return;

  // Right card should be immediately after
  const rightIndex = leftIndex + 1;
  if (rightIndex >= sections.length) return;

  const rightCard = sections[rightIndex];
  if (!rightCard || !rightCard.twoColumnPair || rightCard.pairIndex !== 1) return;

  // Can't move down if already at the bottom
  if (rightIndex >= sections.length - 1) return;

  // Store scroll position
  const scrollY = window.scrollY;

  // Check if we're moving into a two-column pair below
  const nextCard = sections[rightIndex + 1];
  if (nextCard.twoColumnPair && nextCard.pairIndex === 0) {
    // Moving down into position where the next card is the left side of a pair
    // We need to move below the entire pair
    const nextPairRightIndex = rightIndex + 2;
    if (nextPairRightIndex >= sections.length) {
      // Just move to end after the pair
      sections.splice(leftIndex, 2);
      sections.push(leftCard, rightCard);
    } else {
      // Remove both cards from current position
      sections.splice(leftIndex, 2);
      // Insert after the pair (which shifted positions after removal)
      // The pair is now at leftIndex (left) and leftIndex+1 (right)
      // So we insert at leftIndex + 2
      sections.splice(leftIndex + 2, 0, leftCard, rightCard);
    }
  } else {
    // Normal case: just swap with the single card below
    // Remove both cards from current position
    sections.splice(leftIndex, 2);
    // Insert at position after the next card (which is now at leftIndex after removal)
    sections.splice(leftIndex + 1, 0, leftCard, rightCard);
  }

  // Re-render
  markDirtyAndSave();
  renderAllSections();
  if (editState.enabled) {
    ensureSectionPlusButtons();
    refreshEditingClasses();
  }

  // Restore scroll position
  requestAnimationFrame(() => window.scrollTo(0, scrollY));
}

// Add buttons and drag handlers to two-column containers
function addTwoColContainerButtons() {
  const twoColContainers = document.querySelectorAll('.two-col');

  twoColContainers.forEach(container => {
    // Remove existing container buttons
    const existingReorderBtns = container.querySelector('.two-col-reorder-buttons');
    if (existingReorderBtns) existingReorderBtns.remove();

    // Get the section IDs of cards in this container
    const cards = container.querySelectorAll('.card');
    if (cards.length < 2) return;

    const firstCardId = cards[0].id;
    const secondCardId = cards[1].id;

    // Make the container draggable
    container.draggable = true;
    container.style.cursor = 'move';
    container.dataset.firstCardId = firstCardId;
    container.dataset.secondCardId = secondCardId;

    // Initialize drag handlers for the container
    initializeTwoColDragHandlers(container, firstCardId, secondCardId);
  });
}

// Initialize drag handlers for two-column container
function initializeTwoColDragHandlers(container, firstCardId, secondCardId) {
  if (!container || !editState.enabled) return;

  container.addEventListener('dragstart', (e) => {
    // Prevent dragging if clicking on buttons or interactive elements
    if (e.target.tagName === 'BUTTON' ||
        e.target.closest('button') ||
        e.target.closest('.editable') ||
        e.target.closest('.icon-btn') ||
        e.target.closest('.list-item')) {
      e.preventDefault();
      return;
    }

    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', `twocol:${firstCardId}:${secondCardId}`);

    // Mark as dragging a two-col container
    dragState.draggedElement = container; // Set for handleDragOver compatibility
    dragState.draggedSection = firstCardId;
    dragState.draggedTwoCol = true;
    dragState.draggedSecondSection = secondCardId;

    container.classList.add('dragging');

    // Create drop indicator if it doesn't exist
    if (!dragState.dropIndicator) {
      dragState.dropIndicator = document.createElement('div');
      dragState.dropIndicator.className = 'drop-indicator';
      dragState.dropIndicator.style.position = 'absolute';
      dragState.dropIndicator.style.zIndex = '1000';
      dragState.dropIndicator.style.pointerEvents = 'none';
      dragState.dropIndicator.innerHTML = '<div class="drop-line"></div>';
      document.body.appendChild(dragState.dropIndicator);
    }
    // Make sure indicator starts hidden
    dragState.dropIndicator.style.display = 'none';
  });

  container.addEventListener('dragend', (e) => {
    container.classList.remove('dragging');
    dragState.draggedElement = null;
    dragState.draggedSection = null;
    dragState.draggedTwoCol = false;
    dragState.draggedSecondSection = null;
    dragState.potentialDropZone = null;
    dragState.potentialDropPosition = null;

    if (dragState.dropIndicator) {
      dragState.dropIndicator.style.display = 'none';
    }
  });
}

// ===== TIMER FUNCTIONS =====
// NOTE: These functions have been extracted to js/features/timers.js
// They remain here temporarily until all dependent code is migrated.
// The module exports are available via window.* for external access.

let timerInterval = null;

function formatTime(elapsed, includeMillis = false) {
  // elapsed is in milliseconds when includeMillis is true, otherwise seconds
  let totalSeconds, millis;

  if (includeMillis) {
    totalSeconds = Math.floor(elapsed / 1000);
    millis = Math.floor((elapsed % 1000) / 10); // Convert to centiseconds (hundredths)
  } else {
    totalSeconds = elapsed;
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  } else if (minutes > 0) {
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  } else if (includeMillis && totalSeconds < 60) {
    // Show milliseconds only when below 60 seconds
    return `${secs}.${millis.toString().padStart(2, '0')}`;
  } else {
    return `${secs}`;
  }
}

function getTimerColor(seconds) {
  // 8 hours = 28800 seconds
  const maxSeconds = 28800;
  const ratio = Math.min(seconds / maxSeconds, 1);

  // Calculate color based on ratio (0 = green, 1 = red)
  if (ratio < 0.25) {
    // Green to yellow-green
    const localRatio = ratio / 0.25;
    const r = Math.round(34 + (255 - 34) * localRatio);
    const g = Math.round(197 + (235 - 197) * localRatio);
    const b = Math.round(94 + (59 - 94) * localRatio);
    return `rgb(${r}, ${g}, ${b})`;
  } else if (ratio < 0.5) {
    // Yellow-green to yellow
    const localRatio = (ratio - 0.25) / 0.25;
    const r = 255;
    const g = Math.round(235 + (191 - 235) * localRatio);
    const b = Math.round(59 + (0 - 59) * localRatio);
    return `rgb(${r}, ${g}, ${b})`;
  } else if (ratio < 0.75) {
    // Yellow to orange
    const localRatio = (ratio - 0.5) / 0.25;
    const r = 255;
    const g = Math.round(191 + (152 - 191) * localRatio);
    const b = 0;
    return `rgb(${r}, ${g}, ${b})`;
  } else {
    // Orange to red
    const localRatio = (ratio - 0.75) / 0.25;
    const r = Math.round(255 + (239 - 255) * localRatio);
    const g = Math.round(152 + (68 - 152) * localRatio);
    const b = Math.round(0 + (68 - 0) * localRatio);
    return `rgb(${r}, ${g}, ${b})`;
  }
}

function startTimer(timerId) {
  const data = currentData();
  const timer = data.timers.find(t => t.id === timerId);
  if (!timer) return;

  // Stop any other running timers
  data.timers.forEach(t => {
    if (t.id !== timerId && t.isRunning) {
      t.isRunning = false;
      t.lastTick = null;
    }
  });

  timer.isRunning = true;
  timer.lastTick = Date.now();

  saveModel();
  updateTimerDisplay();
}

function stopTimer(timerId) {
  const data = currentData();
  const timer = data.timers.find(t => t.id === timerId);
  if (!timer) return;

  if (timer.isRunning && timer.lastTick) {
    const now = Date.now();
    const elapsed = Math.floor((now - timer.lastTick) / 1000);
    timer.elapsed += elapsed;
  }

  timer.isRunning = false;
  timer.lastTick = null;

  saveModel();
  updateTimerDisplay();
}

function toggleTimer(timerId) {
  const data = currentData();
  const timer = data.timers.find(t => t.id === timerId);
  if (!timer) return;

  if (timer.isRunning) {
    stopTimer(timerId);
  } else {
    startTimer(timerId);
  }
}

function resetAllTimers() {
  const data = currentData();
  data.timers.forEach(timer => {
    timer.elapsed = 0;
    timer.isRunning = false;
    timer.lastTick = null;
  });
  // Don't save directly in edit mode
  if (!editState.enabled) {
    saveModel();
  }
  renderTimers();
}

function addNewTimer() {
  const data = currentData();
  const newId = `timer-${Date.now()}`;
  data.timers.push({
    id: newId,
    title: `Task ${data.timers.length + 1}`,
    elapsed: 0,
    isRunning: false,
    lastTick: null
  });
  // Don't save directly in edit mode
  if (!editState.enabled) {
    saveModel();
  }
  renderTimers();
}

function deleteTimer(timerId) {
  const data = currentData();
  const index = data.timers.findIndex(t => t.id === timerId);
  if (index !== -1) {
    data.timers.splice(index, 1);
    // Don't save directly in edit mode
    if (!editState.enabled) {
      saveModel();
    }
    renderTimers();
  }
}

function updateTimerDisplay() {
  const data = currentData();

  // Performance optimization: skip updates if no timers are running
  const hasRunningTimers = data.timers.some(t => t.isRunning);
  if (!hasRunningTimers) return;

  // Cache isDarkMode check outside loop for better performance
  const isDarkMode = document.body.dataset.theme === 'dark';

  data.timers.forEach(timer => {
    const circleEl = document.querySelector(`[data-timer-id="${timer.id}"]`);
    if (!circleEl) return;

    let currentElapsedMs = timer.elapsed * 1000; // Convert stored seconds to milliseconds
    if (timer.isRunning && timer.lastTick) {
      const now = Date.now();
      const sessionElapsedMs = now - timer.lastTick;
      currentElapsedMs += sessionElapsedMs;
    }

    const currentElapsedSec = Math.floor(currentElapsedMs / 1000);

    // Update display
    const displayEl = circleEl.querySelector('.timer-display');
    if (displayEl) {
      // Use milliseconds for display when under 60 seconds
      if (currentElapsedSec < 60) {
        displayEl.textContent = formatTime(currentElapsedMs, true);
      } else {
        displayEl.textContent = formatTime(currentElapsedSec, false);
      }
    }

    // Update color - fill the background when active
    const color = getTimerColor(currentElapsedSec);

    if (timer.isRunning) {
      circleEl.style.backgroundColor = color;
      circleEl.style.borderColor = 'transparent';
    } else {
      circleEl.style.backgroundColor = isDarkMode ? 'var(--card)' : 'white';
      circleEl.style.borderColor = color;
    }

    // Update active and paused states
    if (timer.isRunning) {
      circleEl.classList.add('active');
      circleEl.classList.remove('paused');
    } else {
      circleEl.classList.remove('active');
      // Add paused class if timer has elapsed time
      if (currentElapsedSec > 0) {
        circleEl.classList.add('paused');
      } else {
        circleEl.classList.remove('paused');
      }
    }
  });
}

function renderTimers() {
  const data = currentData();
  const container = $('#timer-container');
  if (!container) return;

  container.innerHTML = '';

  data.timers.forEach(timer => {
    const timerEl = document.createElement('div');
    timerEl.className = 'timer-item';

    // Timer title
    const titleEl = document.createElement('div');
    titleEl.className = 'timer-title';
    titleEl.textContent = timer.title;

    if (editState.enabled) {
      titleEl.classList.add('editable');
      titleEl.addEventListener('click', (e) => {
        e.stopPropagation();
        openEditPopover(titleEl, {
          text: timer.title,
          hideUrl: true,
          allowDelete: true
        }, ({ text, accept, delete: doDelete }) => {
          if (!accept) return;
          if (doDelete) {
            deleteTimer(timer.id);
            return;
          }
          // Update the timer in the current data (working copy when in edit mode)
          const currentTimer = data.timers.find(t => t.id === timer.id);
          if (currentTimer) {
            currentTimer.title = text || currentTimer.title;
          }
          // Don't save to model directly - let the global accept handle that
          renderTimers();
        });
      });
    }

    // Timer circle
    const circleEl = document.createElement('div');
    circleEl.className = 'timer-circle';
    circleEl.dataset.timerId = timer.id;

    // Calculate current elapsed time
    let currentElapsedMs = timer.elapsed * 1000;
    if (timer.isRunning && timer.lastTick) {
      const now = Date.now();
      const sessionElapsedMs = now - timer.lastTick;
      currentElapsedMs += sessionElapsedMs;
    }

    const currentElapsedSec = Math.floor(currentElapsedMs / 1000);

    // Set color based on elapsed time
    const color = getTimerColor(currentElapsedSec);
    const isDarkMode = document.body.dataset.theme === 'dark';

    if (timer.isRunning) {
      circleEl.classList.add('active');
      circleEl.style.backgroundColor = color;
      circleEl.style.borderColor = 'transparent';
    } else {
      // Use CSS variable for dark mode instead of hardcoded color
      if (isDarkMode) {
        circleEl.style.backgroundColor = '';  // Clear inline style to use CSS
        circleEl.style.setProperty('background-color', 'var(--card)');
      } else {
        circleEl.style.backgroundColor = 'white';
      }
      circleEl.style.borderColor = color;
      // Add paused class if timer has elapsed time
      if (currentElapsedSec > 0) {
        circleEl.classList.add('paused');
      }
    }

    // Stopwatch icon
    const iconSvg = `
      <svg class="timer-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="14" r="8"></circle>
        <line x1="12" y1="6" x2="12" y2="2"></line>
        <line x1="8" y1="2" x2="16" y2="2"></line>
        <line x1="12" y1="14" x2="12" y2="10"></line>
        <line x1="12" y1="14" x2="15" y2="17"></line>
      </svg>
    `;
    circleEl.innerHTML = iconSvg;

    // Timer display
    const displayEl = document.createElement('div');
    displayEl.className = 'timer-display';
    // Show time appropriately
    if (currentElapsedSec < 60) {
      displayEl.textContent = formatTime(currentElapsedMs, true);
    } else {
      displayEl.textContent = formatTime(currentElapsedSec, false);
    }
    circleEl.appendChild(displayEl);

    // Click handler
    circleEl.addEventListener('click', () => {
      if (!editState.enabled) {
        toggleTimer(timer.id);
      }
    });

    timerEl.appendChild(titleEl);
    timerEl.appendChild(circleEl);
    container.appendChild(timerEl);
  });

  // Show/hide edit mode buttons container
  const buttonsContainer = $('#timer-buttons-container');
  if (buttonsContainer) {
    buttonsContainer.hidden = !editState.enabled;
  }
}

function toggleTimeTracking() {
  const card = $('#time-tracking-card');
  if (!card) return; // Guard against missing element

  const data = currentData();

  data.timeTrackingExpanded = !data.timeTrackingExpanded;

  if (data.timeTrackingExpanded) {
    card.hidden = false;
    setTimeout(() => card.classList.add('active'), ANIMATION_DELAY_MS);
    renderTimers();

    // Ensure buttons are properly hidden if not in edit mode
    const buttonsContainer = $('#timer-buttons-container');
    if (buttonsContainer) {
      buttonsContainer.hidden = !editState.enabled;
    }

    // Start the update interval
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(updateTimerDisplay, TIMER_UPDATE_INTERVAL_MS);
  } else {
    card.classList.remove('active');
    setTimeout(() => card.hidden = true, CARD_HIDE_DELAY_MS);

    // Clear the update interval
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  // Only save directly if not in edit mode
  // In edit mode, the working copy will be saved when user clicks accept
  if (!editState.enabled) {
    saveModel();
  }
}

// ====================
// Display Mode Functions
// ====================

function openDisplayModeModal() {
  const toggleBtn = $('#display-mode-toggle');
  if (!toggleBtn) return;

  // Check if already open - if so, close it
  let container = toggleBtn._displayModeContainer;
  if (container && container.parentNode) {
    closeDisplayModeModal();
    return;
  }

  const data = currentData();

  // Create the bubble container
  container = document.createElement('div');
  container.className = 'display-mode-bubbles';

  // Normal mode option
  const normalBtn = document.createElement('button');
  normalBtn.type = 'button';
  normalBtn.className = 'display-mode-option' + (data.displayMode === 'normal' ? ' active' : '');
  normalBtn.dataset.mode = 'normal';
  normalBtn.title = 'Normal view';
  normalBtn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
    </svg>
  `;
  normalBtn.style.animationDelay = '0ms';
  normalBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setDisplayMode('normal');
    closeDisplayModeModal();
  });

  // Stacked mode option
  const stackedBtn = document.createElement('button');
  stackedBtn.type = 'button';
  stackedBtn.className = 'display-mode-option' + (data.displayMode === 'stacked' ? ' active' : '');
  stackedBtn.dataset.mode = 'stacked';
  stackedBtn.title = 'Stacked view (for large screens)';
  stackedBtn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="2" y="3" width="9" height="18" rx="1" ry="1"/>
      <rect x="13" y="3" width="9" height="8" rx="1" ry="1"/>
      <rect x="13" y="13" width="9" height="8" rx="1" ry="1"/>
    </svg>
  `;
  stackedBtn.style.animationDelay = '50ms';
  stackedBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setDisplayMode('stacked');
    closeDisplayModeModal();
  });

  container.appendChild(normalBtn);
  container.appendChild(stackedBtn);

  // Append to body for fixed positioning
  document.body.appendChild(container);
  toggleBtn._displayModeContainer = container;

  // Position above the toggle button
  const btnRect = toggleBtn.getBoundingClientRect();
  container.style.left = `${btnRect.left + btnRect.width / 2}px`;
  container.style.bottom = `${window.innerHeight - btnRect.top + 10}px`;

  // Trigger animation
  requestAnimationFrame(() => {
    container.classList.add('open');
  });
}

function closeDisplayModeModal() {
  const toggleBtn = $('#display-mode-toggle');
  if (!toggleBtn) return;

  const container = toggleBtn._displayModeContainer;
  if (container && container.parentNode) {
    container.classList.remove('open');
    container.classList.add('closing');
    setTimeout(() => {
      if (container.parentNode) {
        container.remove();
      }
    }, 200);
    toggleBtn._displayModeContainer = null;
  }
}

function setDisplayMode(mode) {
  const data = currentData();
  data.displayMode = mode;

  // Apply the display mode to the body
  applyDisplayMode();

  // Save
  if (!editState.enabled) {
    saveModel();
  }
}

function applyDisplayMode() {
  const data = currentData();
  const mode = data.displayMode || 'normal';

  if (mode === 'stacked') {
    document.body.classList.add('stacked-mode');
  } else {
    document.body.classList.remove('stacked-mode');
  }
}

// ===== QUICK ACCESS FUNCTIONS =====
// NOTE: These functions have been extracted to js/features/quick-access.js
// They remain here temporarily until all dependent code is migrated.
// The module exports are available via window.* for external access.

function toggleQuickAccess() {
  const card = $('#quick-access-card');
  if (!card) return; // Guard against missing element

  const data = currentData();

  data.quickAccessExpanded = !data.quickAccessExpanded;

  if (data.quickAccessExpanded) {
    card.hidden = false;
    setTimeout(() => card.classList.add('active'), ANIMATION_DELAY_MS);
    renderQuickAccess();
  } else {
    card.classList.remove('active');
    setTimeout(() => card.hidden = true, CARD_HIDE_DELAY_MS);

    // Exit selector mode when closing
    if (data.selectorModeActive) {
      toggleSelectorMode();
    }
  }

  // Only save directly if not in edit mode
  if (!editState.enabled) {
    saveModel();
  }
}

function toggleSelectorMode() {
  const data = currentData();
  const btn = $('#selector-mode-toggle');
  if (!btn) return; // Guard against missing element

  data.selectorModeActive = !data.selectorModeActive;

  if (data.selectorModeActive) {
    btn.classList.add('active');
    makeItemsSelectable();
  } else {
    btn.classList.remove('active');
    removeSelectableHandlers();
  }

  if (!editState.enabled) {
    saveModel();
  }
}

function clearQuickAccess() {
  const data = currentData();

  if (data.quickAccessItems.icons.length === 0 && data.quickAccessItems.listItems.length === 0) {
    return; // Nothing to clear
  }

  data.quickAccessItems.icons = [];
  data.quickAccessItems.listItems = [];

  renderQuickAccess();

  if (!editState.enabled) {
    saveModel();
  }
}

function renderQuickAccess() {
  const data = currentData();
  const content = $('#quick-access-content');

  if (!content) return;

  const icons = data.quickAccessItems.icons || [];
  const listItems = data.quickAccessItems.listItems || [];

  if (icons.length === 0 && listItems.length === 0) {
    content.innerHTML = '<div class="quick-access-empty">No items selected. Click the circle button above to enter selector mode.</div>';
    return;
  }

  let html = '';

  // Render icons first (at the top)
  if (icons.length > 0) {
    html += '<div class="quick-access-icons">';
    icons.forEach(item => {
      html += `
        <div class="icon-button quick-access-icon" data-qa-url="${item.url}" style="cursor: pointer;">
          <img src="${item.icon}" alt="${item.title || item.name || ''}" />
        </div>
      `;
    });
    html += '</div>';
  }

  // Render list items below
  if (listItems.length > 0) {
    html += '<div class="quick-access-lists">';
    listItems.forEach(item => {
      // Check if this is a copy-paste item (has copyText property)
      if (item.copyText) {
        // Escape HTML attributes to prevent breaking the markup
        const escapedCopyText = (item.copyText || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        const escapedText = (item.text || item.name || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        // Render as copy-paste item with copy button
        html += `
          <div class="copy-paste-item quick-access-copy-paste" data-qa-copy-text="${escapedCopyText}">
            <span class="copy-paste-text">${escapedText}</span>
            <button type="button" class="copy-paste-icon" title="Copy to clipboard">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
            </button>
          </div>
        `;
      } else {
        // Render as regular list item with URL
        const displayClass = item.sectionType === 'tools' ? 'list-item tools' : 'list-item';
        const escapedUrl = (item.url || '').replace(/"/g, '&quot;');
        const escapedText = (item.text || item.name || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        html += `
          <div class="${displayClass} quick-access-list" data-qa-url="${escapedUrl}">
            <a href="${item.url}" target="_blank" rel="noopener noreferrer">${escapedText}</a>
          </div>
        `;
      }
    });
    html += '</div>';
  }

  content.innerHTML = html;

  // Use event delegation instead of individual listeners (prevents memory leaks)
  // Remove any existing delegated listener first
  const existingHandler = content._quickAccessClickHandler;
  if (existingHandler) {
    content.removeEventListener('click', existingHandler);
  }

  // Create new delegated handler
  const clickHandler = (e) => {
    // Handle copy button clicks for copy-paste items
    const copyBtn = e.target.closest('.copy-paste-icon');
    if (copyBtn) {
      e.preventDefault();
      e.stopPropagation();
      const copyPasteItem = copyBtn.closest('.quick-access-copy-paste');
      if (copyPasteItem) {
        const copyText = copyPasteItem.dataset.qaCopyText;
        if (copyText) copyToClipboard(copyText);
      }
      return;
    }

    // Handle icon clicks
    const icon = e.target.closest('.quick-access-icon');
    if (icon) {
      e.preventDefault();
      const url = icon.dataset.qaUrl;
      if (url) openUrl(url);
    }
  };

  // Store reference for cleanup
  content._quickAccessClickHandler = clickHandler;
  content.addEventListener('click', clickHandler);
}

function makeItemsSelectable() {
  // Add selectable class to all icons and list items (but exclude quick access items)
  const iconButtons = document.querySelectorAll('.icon-button:not(.add-tile):not(.quick-access-icon)');
  const listItems = document.querySelectorAll('.list-item:not(.add-tile):not(.quick-access-list), .copy-paste-item:not(.add-tile)');

  iconButtons.forEach(btn => {
    btn.classList.add('selectable-item');
    btn.dataset.selectableType = 'icon';
  });

  listItems.forEach(item => {
    item.classList.add('selectable-item');
    item.dataset.selectableType = 'list';
  });

  // Mark already selected items
  updateSelectedItemsUI();
}

function removeSelectableHandlers() {
  const selectableItems = document.querySelectorAll('.selectable-item');
  selectableItems.forEach(item => {
    item.classList.remove('selectable-item', 'selected');
    delete item.dataset.selectableType;
  });
}

function updateSelectedItemsUI() {
  const data = currentData();
  const selectableItems = document.querySelectorAll('.selectable-item');

  selectableItems.forEach(item => {
    const itemData = extractItemData(item);
    if (itemData && isItemSelected(itemData, data)) {
      item.classList.add('selected');
    } else {
      item.classList.remove('selected');
    }
  });
}

function extractItemData(element) {
  // Extract data from an icon tile or list item
  const selectableType = element.dataset.selectableType;
  const data = currentData();

  if (selectableType === 'icon') {
    // Icon buttons store their section and key in dataset
    const sectionType = element.dataset.type;
    const itemKey = element.dataset.key;

    if (!sectionType || !itemKey) return null;

    // Look up the item from the data model
    const section = data[sectionType];
    if (!section) return null;

    const item = section.find(i => i.key === itemKey);
    if (!item) return null;

    return {
      type: 'icon',
      icon: item.icon,
      url: item.url,
      title: item.title || itemKey,
      name: itemKey,
    };
  } else if (selectableType === 'list') {
    // List items also store their section and key
    const sectionType = element.dataset.type;
    const itemKey = element.dataset.key;
    const subtitle = element.dataset.subtitle; // For copy-paste items

    if (sectionType && itemKey) {
      // Check if this is a copy-paste item (has subtitle)
      if (subtitle) {
        // Copy-paste item - look up from subtitle data
        const section = data[sectionType];
        if (!section || !section[subtitle]) return null;

        const item = section[subtitle].find(i => i.key === itemKey);
        if (!item) return null;

        return {
          type: 'copyPaste',
          text: item.text,
          copyText: item.copyText || item.text,
          name: itemKey,
          sectionType: sectionType,
        };
      } else {
        // Regular list item - look up from data model
        const section = data[sectionType];
        if (!section) return null;

        const item = section.find(i => i.key === itemKey);
        if (!item) return null;

        return {
          type: 'list',
          text: item.text,
          url: item.url,
          name: itemKey,
          sectionType: sectionType,
        };
      }
    } else {
      // Fallback for items without dataset
      const link = element.querySelector('a');
      const url = link ? link.href : '';
      const text = element.textContent.trim();

      return {
        type: 'list',
        text: text,
        url: url,
      };
    }
  }

  return null;
}

function isItemSelected(itemData, data) {
  if (itemData.type === 'icon') {
    return data.quickAccessItems.icons.some(item =>
      item.icon === itemData.icon && item.url === itemData.url
    );
  } else if (itemData.type === 'list') {
    return data.quickAccessItems.listItems.some(item =>
      item.text === itemData.text && item.url === itemData.url && !item.copyText
    );
  } else if (itemData.type === 'copyPaste') {
    return data.quickAccessItems.listItems.some(item =>
      item.text === itemData.text && item.copyText === itemData.copyText
    );
  }
  return false;
}

function handleItemSelection(event) {
  const data = currentData();

  // Only handle clicks if selector mode is active
  if (!data.selectorModeActive) return;

  // Find the closest selectable item
  const selectableItem = event.target.closest('.selectable-item');
  if (!selectableItem) return;

  // Prevent the default action (opening the URL)
  event.preventDefault();
  event.stopPropagation();

  // Extract item data
  const itemData = extractItemData(selectableItem);
  if (!itemData) return;

  // Toggle selection
  if (isItemSelected(itemData, data)) {
    // Deselect - remove from quick access
    if (itemData.type === 'icon') {
      data.quickAccessItems.icons = data.quickAccessItems.icons.filter(item =>
        !(item.icon === itemData.icon && item.url === itemData.url)
      );
    } else if (itemData.type === 'list') {
      data.quickAccessItems.listItems = data.quickAccessItems.listItems.filter(item =>
        !(item.text === itemData.text && item.url === itemData.url && !item.copyText)
      );
    } else if (itemData.type === 'copyPaste') {
      data.quickAccessItems.listItems = data.quickAccessItems.listItems.filter(item =>
        !(item.text === itemData.text && item.copyText === itemData.copyText)
      );
    }
    selectableItem.classList.remove('selected');
  } else {
    // Select - add to quick access
    if (itemData.type === 'icon') {
      data.quickAccessItems.icons.push(itemData);
    } else if (itemData.type === 'list') {
      data.quickAccessItems.listItems.push(itemData);
    } else if (itemData.type === 'copyPaste') {
      data.quickAccessItems.listItems.push(itemData);
    }
    selectableItem.classList.add('selected');
  }

  // Re-render quick access
  renderQuickAccess();

  // Save if not in edit mode
  if (!editState.enabled) {
    saveModel();
  }
}

async function init() {
  console.log('=== INIT DEBUG ===');
  console.log('Initial model.sections:', model.sections.map(s => ({ id: s.id, type: s.type })));
  console.log('Initial model.reminders:', model.reminders);

  await restoreModel();

  console.log('After restoreModel - model.sections:', model.sections.map(s => ({ id: s.id, type: s.type })));
  console.log('After restoreModel - model.reminders:', model.reminders);

  applyDarkMode();
  applyDisplayMode();
  renderHeaderAndTitles();
  renderAllSections();
  wireUI();
  ensureSectionPlusButtons();
  refreshEditingClasses();

  // Initialize time tracking if it was expanded
  if (model.timeTrackingExpanded) {
    const card = $('#time-tracking-card');
    if (card) {
      card.hidden = false;
      setTimeout(() => card.classList.add('active'), ANIMATION_DELAY_MS);
      renderTimers();
      // Start the update interval
      if (timerInterval) clearInterval(timerInterval);
      timerInterval = setInterval(updateTimerDisplay, TIMER_UPDATE_INTERVAL_MS);
    }
  }

  // Ensure timer buttons are hidden initially if not in edit mode
  const buttonsContainer = $('#timer-buttons-container');
  if (buttonsContainer) {
    buttonsContainer.hidden = !editState.enabled;
  }

  // Initialize Quick Access if it was expanded
  if (model.quickAccessExpanded) {
    const card = $('#quick-access-card');
    if (card) {
      card.hidden = false;
      setTimeout(() => card.classList.add('active'), ANIMATION_DELAY_MS);
      renderQuickAccess();
    }
  }

  // Initialize selector mode if it was active
  if (model.selectorModeActive) {
    const btn = $('#selector-mode-toggle');
    if (btn) {
      btn.classList.add('active');
      // Re-render sections to make items selectable
      setTimeout(() => makeItemsSelectable(), 100);
    }
  }
}

// ---- Media Library UI ----
// NOTE: openMediaLibrary has been extracted to js/features/media-library.js
function openMediaLibrary(onSelect) {
  const modal = $('#media-library');
  const grid = $('#media-grid');
  const upload = $('#media-upload-input');
  const selectBtn = $('#media-select');
  const deleteBtn = $('#media-delete');
  const closeBtn = $('#media-close');
  let selectedId = null;

  function renderGrid() {
    const localItems = loadMediaLibrary();
    grid.innerHTML = '';
    const renderItems = (items) => items.forEach(item => {
      const div = document.createElement('div');
      div.className = 'media-item';
      div.dataset.id = item.id;
      div.innerHTML = `<img src="${item.src}" alt="${item.name}"><div class="name">${item.name}</div>`;
      div.addEventListener('click', () => {
        $$('.media-item', grid).forEach(x => x.classList.remove('selected'));
        div.classList.add('selected');
        selectedId = item.id;
        selectBtn.disabled = false;
        deleteBtn.disabled = !selectedId || selectedId.startsWith('manifest:');
      });
      grid.appendChild(div);
    });
    // render manifest then local
    loadManifestMedia().then(manifestItems => {
      renderItems(manifestItems);
      renderItems(localItems);
    });
  }

  function close() {
    modal.hidden = true;
    upload.value = '';
    selectBtn.disabled = true;
    deleteBtn.disabled = true;
    selectedId = null;
  }

  modal.hidden = false;
  renderGrid();
  selectBtn.disabled = true;
  deleteBtn.disabled = true;

  upload.onchange = async () => {
    if (upload.files && upload.files.length) {
      await addFilesToMediaLibrary(upload.files);
      renderGrid();
    }
  };
  closeBtn.onclick = () => close();
  modal.querySelector('.media-backdrop').onclick = () => close();
  selectBtn.onclick = () => {
    if (!selectedId) return;
    const items = loadMediaLibrary();
    const chosen = items.find(i => i.id === selectedId);
    if (chosen) onSelect(chosen);
    close();
  };
  deleteBtn.onclick = () => {
    if (!selectedId) return;
    // Only delete local items (data-URL entries). Manifest entries are read-only.
    if (selectedId.startsWith('manifest:')) return;
    const items = loadMediaLibrary();
    const updated = items.filter(i => i.id !== selectedId);
    saveMediaLibrary(updated);
    selectedId = null;
    selectBtn.disabled = true;
    deleteBtn.disabled = true;
    renderGrid();
  };
}

document.addEventListener('DOMContentLoaded', init);

// Cleanup timer interval on page unload to prevent memory leak
window.addEventListener('pagehide', () => {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
});

// Add a new subtitle to reminders or copy-paste
function onAddSubtitle(sectionId = null) {
  const data = currentData();

  // If no sectionId provided, try to determine it from the current context
  if (!sectionId) {
    // Try to find the most recently created reminder section
    const reminderSections = data.sections.filter(s => s.type === 'reminders');
    if (reminderSections.length > 1) {
      // Use the most recent one (not the original 'reminders' section)
      const newReminderSections = reminderSections.filter(s => s.id !== 'reminders');
      if (newReminderSections.length > 0) {
        sectionId = newReminderSections[newReminderSections.length - 1].id;
      } else {
        sectionId = 'reminders';
      }
    } else {
      sectionId = 'reminders';
    }
  }

  // Find the section to determine its type
  const section = data.sections.find(s => s.id === sectionId);

  // Determine which data structure to use based on the section
  let sectionData;
  if (sectionId === 'reminders') {
    // Original reminders section
    sectionData = data.reminders;
  } else {
    // New section - use the section's own data
    sectionData = data[sectionId];
  }

  // Ensure data structure exists
  if (!sectionData || typeof sectionData !== 'object') {
    sectionData = {};
    if (sectionId === 'reminders') {
      data.reminders = sectionData;
    } else {
      data[sectionId] = sectionData;
    }
  }

  const subtitleName = `New Subtitle ${Object.keys(sectionData).length + 1}`;
  sectionData[subtitleName] = [];
  renderAllSections();
}

// --- Interval counting functions
function calculateIntervalProgress(reminder) {
  if (reminder.interval === null || reminder.interval === undefined || 
      reminder.currentNumber === null || reminder.currentNumber === undefined) {
    return { target: 0, progress: 0, percentage: 0 };
  }
  
  const target = reminder.interval; // interval now represents the target number
  const current = reminder.currentNumber;
  const distanceToTarget = target - current;
  const totalDistance = Math.abs(target); // Use absolute value for percentage calculation
  const percentage = totalDistance > 0 ? (distanceToTarget / totalDistance) * 100 : 0;
  
  return {
    target,
    progress: distanceToTarget,
    percentage: percentage
  };
}

function getIntervalColorClass(percentage, type = 'limit') {
  if (type === 'goal') {
    // For goals: red -> orange -> yellow -> green (getting better as you get closer)
    if (percentage < 0) return 'green'; // Current number passed target (good!)
    if (percentage >= 75) return 'red'; // 75%-100% distance (far from goal)
    if (percentage >= 50) return 'orange'; // 50%-75% distance
    if (percentage >= 25) return 'yellow'; // 25%-50% distance
    if (percentage >= 0) return 'green'; // 0%-25% distance (close to goal)
    return 'green'; // Fallback
  } else {
    // For limits: green -> yellow -> orange -> red (original logic)
    if (percentage < 0) return 'red'; // Current number passed final number
    if (percentage >= 75) return 'green'; // 75%-100% distance (safe)
    if (percentage >= 50) return 'yellow'; // 50%-75% distance
    if (percentage >= 25) return 'orange'; // 25%-50% distance
    if (percentage >= 0) return 'red'; // 0%-25% distance (close to limit)
    return 'red'; // Fallback
  }
}

function formatIntervalNumber(number, unit = 'none') {
  // Add commas for numbers over 100
  const formattedNumber = Math.abs(number) >= 100 ? number.toLocaleString() : number.toString();
  
  switch (unit) {
    case 'dollar':
      return `$${formattedNumber}`;
    case 'percent':
      return `${formattedNumber}%`;
    default:
      return formattedNumber;
  }
}

function hideIntervalPopover() {
  const popover = $('#interval-popover');
  popover.hidden = true;
  currentBreakdownReminder = null;
}

function openIntervalPopover(reminder) {
  currentBreakdownReminder = reminder; // Store for breakdown button

  const popover = $('#interval-popover');
  const form = $('#interval-form');
  const intervalInput = $('#interval-value');
  const currentInput = $('#interval-current');
  const typeSelect = $('#interval-type');
  const unitSelect = $('#interval-unit');

  // Set current values (rounded to whole numbers)
  intervalInput.value = reminder.interval ? Math.round(reminder.interval) : '';
  currentInput.value = reminder.currentNumber ? Math.round(reminder.currentNumber) : '';
  typeSelect.value = reminder.intervalType || 'limit';
  unitSelect.value = reminder.intervalUnit || 'none';

  // Disable current number field if breakdown is unlocked (sum mode)
  if (reminder.breakdown && !reminder.breakdown.locked) {
    currentInput.disabled = true;
    currentInput.classList.add('disabled-sum-mode');
  } else {
    currentInput.disabled = false;
    currentInput.classList.remove('disabled-sum-mode');
  }

  // Handle form submission
  form.onsubmit = (e) => {
    e.preventDefault();

    // Use Math.round to automatically round decimals to whole numbers
    const targetNumber = Math.round(parseFloat(intervalInput.value));
    const currentNumber = Math.round(parseFloat(currentInput.value));
    const type = typeSelect.value;
    const unit = unitSelect.value;

    if (isNaN(targetNumber) || isNaN(currentNumber)) {
      showToast('Please enter valid numbers');
      return;
    }

    // Update the reminder
    reminder.type = 'interval';
    reminder.interval = targetNumber; // interval now stores the target number
    reminder.currentNumber = currentNumber;
    reminder.intervalType = type;
    reminder.intervalUnit = unit;

    markDirtyAndSave();
    renderAllSections();
    hideIntervalPopover();
  };
  
  // Handle cancel
  $('#interval-cancel').onclick = hideIntervalPopover;
  
  // Show popover
  popover.hidden = false;
}

// Breakdown modal functions
let currentBreakdownReminder = null;

function openBreakdownModal(reminder) {
  currentBreakdownReminder = reminder;

  // Initialize breakdown data if it doesn't exist
  if (!reminder.breakdown) {
    reminder.breakdown = {
      locked: false,
      rows: []
    };
  }

  // Hide interval popover
  const intervalPopover = $('#interval-popover');
  intervalPopover.hidden = true;

  const modal = $('#breakdown-modal');
  const currentInput = $('#breakdown-current');
  const lockCheckbox = $('#breakdown-lock');
  const rowsContainer = $('#breakdown-rows');

  // Set current values (rounded to whole number)
  currentInput.value = Math.round(reminder.currentNumber || 0);
  lockCheckbox.checked = reminder.breakdown.locked || false;
  currentInput.disabled = !reminder.breakdown.locked;

  // Render existing rows
  renderBreakdownRows();

  // Calculate and update sum if unlocked
  if (!reminder.breakdown.locked) {
    updateBreakdownSum();
  }

  // Show modal
  modal.hidden = false;
}

function renderBreakdownRows() {
  const rowsContainer = $('#breakdown-rows');
  rowsContainer.innerHTML = '';

  if (!currentBreakdownReminder.breakdown.rows) {
    currentBreakdownReminder.breakdown.rows = [];
  }

  currentBreakdownReminder.breakdown.rows.forEach((row, index) => {
    const rowDiv = document.createElement('div');
    rowDiv.className = 'breakdown-row';

    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.placeholder = 'Title';
    titleInput.value = row.title || '';
    titleInput.addEventListener('input', (e) => {
      row.title = e.target.value;
    });

    const valueInput = document.createElement('input');
    valueInput.type = 'number';
    valueInput.placeholder = '0';
    valueInput.value = row.value || 0;
    valueInput.addEventListener('input', (e) => {
      row.value = parseFloat(e.target.value) || 0;
      updateBreakdownSum();
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-delete-row';
    deleteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="3 6 5 6 21 6"></polyline>
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
    </svg>`;
    deleteBtn.title = 'Delete row';
    deleteBtn.addEventListener('click', () => {
      currentBreakdownReminder.breakdown.rows.splice(index, 1);
      renderBreakdownRows();
      updateBreakdownSum();
    });

    rowDiv.appendChild(titleInput);
    rowDiv.appendChild(valueInput);
    rowDiv.appendChild(deleteBtn);
    rowsContainer.appendChild(rowDiv);
  });
}

function updateBreakdownSum() {
  if (!currentBreakdownReminder || currentBreakdownReminder.breakdown.locked) return;

  const sum = currentBreakdownReminder.breakdown.rows.reduce((total, row) => {
    return total + (parseFloat(row.value) || 0);
  }, 0);

  // Round the sum to a whole number
  const roundedSum = Math.round(sum);

  const currentInput = $('#breakdown-current');
  currentInput.value = roundedSum;
  currentBreakdownReminder.currentNumber = roundedSum;
}

function hideBreakdownModal() {
  const modal = $('#breakdown-modal');
  modal.hidden = true;
}

function cancelBreakdownModal() {
  hideBreakdownModal();
  // Show interval popover again
  const intervalPopover = $('#interval-popover');
  intervalPopover.hidden = false;
  currentBreakdownReminder = null;
}

function acceptBreakdownModal() {
  if (!currentBreakdownReminder) return;

  const currentInput = $('#breakdown-current');
  const lockCheckbox = $('#breakdown-lock');

  // Update reminder data
  currentBreakdownReminder.breakdown.locked = lockCheckbox.checked;

  // If locked, use the manual input value (rounded to whole number)
  if (lockCheckbox.checked) {
    currentBreakdownReminder.currentNumber = Math.round(parseFloat(currentInput.value) || 0);
  }
  // If unlocked, the sum is already calculated and rounded

  // Update the current number field in interval popover
  const intervalCurrentInput = $('#interval-current');
  intervalCurrentInput.value = currentBreakdownReminder.currentNumber;

  // Update disabled state based on lock status
  if (!currentBreakdownReminder.breakdown.locked) {
    intervalCurrentInput.disabled = true;
    intervalCurrentInput.classList.add('disabled-sum-mode');
  } else {
    intervalCurrentInput.disabled = false;
    intervalCurrentInput.classList.remove('disabled-sum-mode');
  }

  // Hide breakdown and show interval popover again
  hideBreakdownModal();
  const intervalPopover = $('#interval-popover');
  intervalPopover.hidden = false;
}

// LINK_ICON_SVG moved to js/constants.js

// Reminder Links Modal Functions
let currentLinksReminder = null;

function openLinksModal(reminder) {
  currentLinksReminder = reminder;

  // Initialize links array if it doesn't exist
  if (!reminder.links) {
    reminder.links = [];
  }

  // Create modal if it doesn't exist
  let modal = $('#reminder-links-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'reminder-links-modal';
    modal.className = 'reminder-links-modal';
    modal.innerHTML = `
      <div class="reminder-links-dialog">
        <h3>Manage Links</h3>
        <div class="reminder-links-content">
          <div id="reminder-links-list" class="reminder-links-list"></div>
          <button type="button" id="add-reminder-link-btn" class="btn-add-link">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            Add Link
          </button>
        </div>
        <div class="reminder-links-actions">
          <button type="button" id="reminder-links-cancel" class="btn-secondary">Cancel</button>
          <button type="button" id="reminder-links-save" class="btn-primary">Save</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // Wire up event listeners
    $('#add-reminder-link-btn').addEventListener('click', addLinkRow);
    $('#reminder-links-cancel').addEventListener('click', cancelLinksModal);
    $('#reminder-links-save').addEventListener('click', saveLinksModal);

    // Click outside to close
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        cancelLinksModal();
      }
    });
  }

  // Render existing links
  renderLinkRows();

  // Show modal
  modal.hidden = false;
}

function renderLinkRows() {
  const listContainer = $('#reminder-links-list');
  listContainer.innerHTML = '';

  if (!currentLinksReminder.links) {
    currentLinksReminder.links = [];
  }

  currentLinksReminder.links.forEach((link, index) => {
    const rowDiv = document.createElement('div');
    rowDiv.className = 'reminder-link-row';

    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.placeholder = 'Link title';
    titleInput.value = link.title || '';
    titleInput.className = 'link-title-input';
    titleInput.addEventListener('input', (e) => {
      link.title = e.target.value;
    });

    const urlInput = document.createElement('input');
    urlInput.type = 'url';
    urlInput.placeholder = 'https://...';
    urlInput.value = link.url || '';
    urlInput.className = 'link-url-input';
    urlInput.addEventListener('input', (e) => {
      link.url = e.target.value;
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn-delete-link';
    deleteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="3 6 5 6 21 6"></polyline>
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
    </svg>`;
    deleteBtn.title = 'Delete link';
    deleteBtn.addEventListener('click', () => {
      currentLinksReminder.links.splice(index, 1);
      renderLinkRows();
    });

    rowDiv.appendChild(titleInput);
    rowDiv.appendChild(urlInput);
    rowDiv.appendChild(deleteBtn);
    listContainer.appendChild(rowDiv);
  });
}

function addLinkRow() {
  if (!currentLinksReminder.links) {
    currentLinksReminder.links = [];
  }
  currentLinksReminder.links.push({ title: '', url: '' });
  renderLinkRows();

  // Focus the new title input
  const inputs = document.querySelectorAll('#reminder-links-list .link-title-input');
  if (inputs.length > 0) {
    inputs[inputs.length - 1].focus();
  }
}

function cancelLinksModal() {
  const modal = $('#reminder-links-modal');
  if (modal) modal.hidden = true;
  currentLinksReminder = null;
}

function saveLinksModal() {
  if (!currentLinksReminder) return;

  // Filter out empty links (no title and no url)
  currentLinksReminder.links = currentLinksReminder.links.filter(
    link => link.title.trim() || link.url.trim()
  );

  // Save and re-render
  markDirtyAndSave();
  renderAllSections();

  // Close modal
  const modal = $('#reminder-links-modal');
  if (modal) modal.hidden = true;
  currentLinksReminder = null;
}

// Toggle expanded links for a reminder in view mode
function toggleReminderLinks(reminderKey, subtitle, sectionId, buttonEl) {
  const data = currentData();
  const remindersData = sectionId === 'reminders' ? data.reminders : data[sectionId];
  const reminders = remindersData[subtitle];
  const reminder = reminders.find(r => r.key === reminderKey);

  if (!reminder || !reminder.links || reminder.links.length === 0) return;

  // Look for existing links container (stored reference on button)
  let linksContainer = buttonEl._linksContainer;

  if (linksContainer && linksContainer.parentNode) {
    // Close the links - all fade out together
    const bubbles = linksContainer.querySelectorAll('.reminder-link-bubble');
    bubbles.forEach(bubble => {
      bubble.style.animationDelay = '0ms';
    });
    linksContainer.classList.remove('open');
    linksContainer.classList.add('closing');
    setTimeout(() => {
      if (linksContainer.parentNode) {
        linksContainer.remove();
      }
    }, 250);
    buttonEl._linksContainer = null;
  } else {
    // Get the parent reminder item's background color
    const reminderItem = buttonEl.closest('.reminder-item');
    const computedStyle = window.getComputedStyle(reminderItem);
    const parentBgColor = computedStyle.backgroundColor;

    // Convert to lighter version (20% lighter)
    const lighterColor = lightenColorBy20Percent(parentBgColor);

    // Open the links - create and animate in
    linksContainer = document.createElement('div');
    linksContainer.className = 'reminder-links-expanded';

    reminder.links.forEach((link, index) => {
      const linkBubble = document.createElement('a');
      linkBubble.href = link.url || '#';
      linkBubble.target = '_blank';
      linkBubble.rel = 'noopener noreferrer';
      linkBubble.className = 'reminder-link-bubble';
      linkBubble.textContent = link.title || link.url || 'Link';
      linkBubble.style.animationDelay = `${index * 50}ms`;
      linkBubble.style.background = lighterColor;

      linkBubble.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!link.url) e.preventDefault();
      });

      linksContainer.appendChild(linkBubble);
    });

    // Append to body so it's not clipped by card overflow
    document.body.appendChild(linksContainer);
    buttonEl._linksContainer = linksContainer;

    // Position fixed relative to the button (20px to the right)
    const buttonRect = buttonEl.getBoundingClientRect();
    linksContainer.style.left = `${buttonRect.right + 20}px`;
    linksContainer.style.top = `${buttonRect.top + buttonRect.height / 2}px`;
    linksContainer.style.transform = 'translateY(-50%)';

    // Trigger animation
    requestAnimationFrame(() => {
      linksContainer.classList.add('open');
    });
  }
}

// Close all open reminder link bubbles
function closeAllReminderLinks() {
  const openContainers = document.querySelectorAll('.reminder-links-expanded');
  openContainers.forEach(container => {
    // All fade out together
    const bubbles = container.querySelectorAll('.reminder-link-bubble');
    bubbles.forEach(bubble => {
      bubble.style.animationDelay = '0ms';
    });
    container.classList.remove('open');
    container.classList.add('closing');
    setTimeout(() => {
      if (container.parentNode) {
        container.remove();
      }
    }, 250);
  });
  // Clear stored references
  document.querySelectorAll('.reminder-links-toggle').forEach(btn => {
    btn._linksContainer = null;
  });
}

// Helper function to lighten a color by 20%
function lightenColorBy20Percent(color) {
  // Parse rgb/rgba color
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return color;

  let r = parseInt(match[1]);
  let g = parseInt(match[2]);
  let b = parseInt(match[3]);

  // Lighten by 20% (move 20% towards white)
  r = Math.min(255, Math.round(r + (255 - r) * 0.2));
  g = Math.min(255, Math.round(g + (255 - g) * 0.2));
  b = Math.min(255, Math.round(b + (255 - b) * 0.2));

  return `rgb(${r}, ${g}, ${b})`;
}

// ====================
// List Item Links Modal Functions
// ====================
let currentLinksListItem = null;
let currentLinksListItemSectionId = null;

function openListItemLinksModal(item, sectionId) {
  currentLinksListItem = item;
  currentLinksListItemSectionId = sectionId;

  // Initialize links array if it doesn't exist
  if (!item.links) {
    item.links = [];
  }

  // Create modal if it doesn't exist
  let modal = $('#list-item-links-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'list-item-links-modal';
    modal.className = 'reminder-links-modal';
    modal.innerHTML = `
      <div class="reminder-links-dialog">
        <h3>Manage Links</h3>
        <div class="reminder-links-content">
          <div id="list-item-links-list" class="reminder-links-list"></div>
          <button type="button" id="add-list-item-link-btn" class="btn-add-link">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            Add Link
          </button>
        </div>
        <div class="reminder-links-actions">
          <button type="button" id="list-item-links-cancel" class="btn-secondary">Cancel</button>
          <button type="button" id="list-item-links-save" class="btn-primary">Save</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // Wire up event listeners
    $('#add-list-item-link-btn').addEventListener('click', addListItemLinkRow);
    $('#list-item-links-cancel').addEventListener('click', cancelListItemLinksModal);
    $('#list-item-links-save').addEventListener('click', saveListItemLinksModal);

    // Click outside to close
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        cancelListItemLinksModal();
      }
    });
  }

  // Render existing links
  renderListItemLinkRows();

  // Show modal
  modal.hidden = false;
}

function renderListItemLinkRows() {
  const listContainer = $('#list-item-links-list');
  listContainer.innerHTML = '';

  if (!currentLinksListItem.links) {
    currentLinksListItem.links = [];
  }

  currentLinksListItem.links.forEach((link, index) => {
    const rowDiv = document.createElement('div');
    rowDiv.className = 'reminder-link-row';

    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.placeholder = 'Link title';
    titleInput.value = link.title || '';
    titleInput.className = 'link-title-input';
    titleInput.addEventListener('input', (e) => {
      link.title = e.target.value;
    });

    const urlInput = document.createElement('input');
    urlInput.type = 'url';
    urlInput.placeholder = 'https://...';
    urlInput.value = link.url || '';
    urlInput.className = 'link-url-input';
    urlInput.addEventListener('input', (e) => {
      link.url = e.target.value;
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn-delete-link';
    deleteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="3 6 5 6 21 6"></polyline>
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
    </svg>`;
    deleteBtn.title = 'Delete link';
    deleteBtn.addEventListener('click', () => {
      currentLinksListItem.links.splice(index, 1);
      renderListItemLinkRows();
    });

    rowDiv.appendChild(titleInput);
    rowDiv.appendChild(urlInput);
    rowDiv.appendChild(deleteBtn);
    listContainer.appendChild(rowDiv);
  });
}

function addListItemLinkRow() {
  if (!currentLinksListItem.links) {
    currentLinksListItem.links = [];
  }
  currentLinksListItem.links.push({ title: '', url: '' });
  renderListItemLinkRows();

  // Focus the new title input
  const inputs = document.querySelectorAll('#list-item-links-list .link-title-input');
  if (inputs.length > 0) {
    inputs[inputs.length - 1].focus();
  }
}

function cancelListItemLinksModal() {
  const modal = $('#list-item-links-modal');
  if (modal) modal.hidden = true;
  currentLinksListItem = null;
  currentLinksListItemSectionId = null;
}

function saveListItemLinksModal() {
  if (!currentLinksListItem) return;

  // Filter out empty links (no title and no url)
  currentLinksListItem.links = currentLinksListItem.links.filter(
    link => link.title.trim() || link.url.trim()
  );

  // Save and re-render
  markDirtyAndSave();
  renderAllSections();

  // Close modal
  const modal = $('#list-item-links-modal');
  if (modal) modal.hidden = true;
  currentLinksListItem = null;
  currentLinksListItemSectionId = null;
}

// Toggle expanded links for a list item in view mode
function toggleListItemLinks(item, sectionId, buttonEl) {
  if (!item || !item.links || item.links.length === 0) return;

  // Look for existing links container (stored reference on button)
  let linksContainer = buttonEl._linksContainer;

  if (linksContainer && linksContainer.parentNode) {
    // Close the links - all fade out together
    const bubbles = linksContainer.querySelectorAll('.reminder-link-bubble');
    bubbles.forEach(bubble => {
      bubble.style.animationDelay = '0ms';
    });
    linksContainer.classList.remove('open');
    linksContainer.classList.add('closing');
    setTimeout(() => {
      if (linksContainer.parentNode) {
        linksContainer.remove();
      }
    }, 250);
    buttonEl._linksContainer = null;
  } else {
    // Get the parent list item's background color
    const listItem = buttonEl.closest('.list-item');
    const computedStyle = window.getComputedStyle(listItem);
    const parentBgColor = computedStyle.backgroundColor;

    // Convert to lighter version (20% lighter)
    const lighterColor = lightenColorBy20Percent(parentBgColor);

    // Open the links - create and animate in
    linksContainer = document.createElement('div');
    linksContainer.className = 'reminder-links-expanded';

    item.links.forEach((link, index) => {
      const linkBubble = document.createElement('a');
      linkBubble.href = link.url || '#';
      linkBubble.target = '_blank';
      linkBubble.rel = 'noopener noreferrer';
      linkBubble.className = 'reminder-link-bubble';
      linkBubble.textContent = link.title || link.url || 'Link';
      linkBubble.style.animationDelay = `${index * 50}ms`;
      linkBubble.style.background = lighterColor;

      linkBubble.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!link.url) e.preventDefault();
      });

      linksContainer.appendChild(linkBubble);
    });

    // Append to body so it's not clipped by card overflow
    document.body.appendChild(linksContainer);
    buttonEl._linksContainer = linksContainer;

    // Position fixed relative to the button (20px to the right)
    const buttonRect = buttonEl.getBoundingClientRect();
    linksContainer.style.left = `${buttonRect.right + 20}px`;
    linksContainer.style.top = `${buttonRect.top + buttonRect.height / 2}px`;
    linksContainer.style.transform = 'translateY(-50%)';

    // Trigger animation
    requestAnimationFrame(() => {
      linksContainer.classList.add('open');
    });
  }
}

// Close all open list item link bubbles
function closeAllListItemLinks() {
  document.querySelectorAll('.list-item-links-toggle').forEach(btn => {
    if (btn._linksContainer && btn._linksContainer.parentNode) {
      btn._linksContainer.remove();
    }
    btn._linksContainer = null;
  });
}

function addGapButtons() {
  const data = currentData();
  const main = $('.app-main');

  // Remove existing gap buttons
  const existingGapButtons = main.querySelectorAll('.gap-add-btn');
  existingGapButtons.forEach(btn => btn.remove());

  if (!editState.enabled) return;

  // Get all direct children of main (cards and two-col containers)
  const children = Array.from(main.children);
  const sections = currentSections(); // Use display-mode-specific sections

  // Build a mapping of DOM positions to section indices
  let sectionIndex = 0;
  const domToSectionMap = [0]; // First gap is before index 0

  for (let i = 0; i < children.length; i++) {
    const child = children[i];

    if (child.classList.contains('two-col')) {
      // Two-column container - count both sections inside it
      const cards = child.querySelectorAll('.card');
      sectionIndex += cards.length;
    } else if (child.classList.contains('card')) {
      // Regular card - count one section
      sectionIndex += 1;
    }

    // The gap after this element maps to this section index
    domToSectionMap.push(sectionIndex);
  }

  // Add gap buttons with correct section indices
  for (let i = 0; i <= children.length; i++) {
    const targetSectionIndex = domToSectionMap[i];
    const gapBtn = createGapAddButton(targetSectionIndex);

    if (i === 0) {
      // First gap (before first element)
      main.insertBefore(gapBtn, main.firstChild);
    } else if (i === children.length) {
      // Last gap (after last element)
      main.appendChild(gapBtn);
    } else {
      // Gap between elements
      main.insertBefore(gapBtn, children[i]);
    }

    // Show the button since we're in edit mode
    gapBtn.style.display = 'flex';
  }
}

// Gap-based add button system
function createGapAddButton(targetIndex) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'gap-add-btn';
  btn.textContent = '+';
  btn.title = 'Add new card here';
  btn.dataset.targetIndex = targetIndex;
  btn.addEventListener('click', () => openCardTypePopover(targetIndex));
  return btn;
}

function openCardTypePopover(targetIndex) {
  const popover = $('#card-type-popover');
  const options = popover.querySelectorAll('.card-type-option');
  let selectedType = null;

  // Reset selection
  options.forEach(option => option.classList.remove('selected'));

  // Handle option selection - create card immediately when selected
  options.forEach(option => {
    option.addEventListener('click', () => {
      options.forEach(opt => opt.classList.remove('selected'));
      option.classList.add('selected');
      selectedType = option.dataset.type;
      
      // Create card immediately when type is selected
      if (selectedType) {
        createCardByType(selectedType, targetIndex);
        hideCardTypePopover();
      }
    });
  });

  // Handle cancel button
  $('#card-type-cancel').onclick = hideCardTypePopover;

  // Show popover
  popover.hidden = false;
}

function hideCardTypePopover() {
  const popover = $('#card-type-popover');
  popover.hidden = true;
}

function createCardByType(type, targetIndex) {
  const data = currentData();
  const sections = currentSections(); // Use display-mode-specific sections
  let newSection;

  // Use the targetIndex directly as the insertion position
  let actualTargetIndex = targetIndex;

  // Ensure the index is within bounds
  if (actualTargetIndex < 0) {
    actualTargetIndex = 0;
  } else if (actualTargetIndex > sections.length) {
    actualTargetIndex = sections.length;
  }

  console.log('createCardByType - targetIndex:', targetIndex, 'actualTargetIndex:', actualTargetIndex);

  switch (type) {
    case 'single':
      newSection = {
        id: generateSectionId(),
        type: 'newCard',
        title: generateUniqueCardTitle('New Card'),
        structure: 'regular'
      };
      data[newSection.id] = [];
      break;

    case 'two-col':
      // Create first section for two-column layout
      const section1 = {
        id: generateSectionId(),
        type: 'newCard',
        title: generateUniqueCardTitle('New Card'),
        structure: 'regular',
        twoColumnPair: true,
        pairIndex: 0
      };
      
      // Insert first section into current display mode's sections array
      sections.splice(actualTargetIndex, 0, section1);
      // Also add to the other sections array (for when switching modes)
      ensureSectionInBothArrays(section1);
      data[section1.id] = [];
      data.sectionTitles[section1.id] = section1.title;

      // Now create second section with a unique ID
      const section2 = {
        id: generateSectionId(),
        type: 'newCard',
        title: 'New Card 2',
        structure: 'regular',
        twoColumnPair: true,
        pairIndex: 1
      };

      data[section2.id] = [];
      data.sectionTitles[section2.id] = section2.title;

      console.log('About to insert second section at index:', actualTargetIndex + 1);
      console.log('Section1:', section1);
      console.log('Section2:', section2);

      // Insert second section after the first in current display mode's sections array
      sections.splice(actualTargetIndex + 1, 0, section2);
      // Also add to the other sections array
      ensureSectionInBothArrays(section2);
      console.log('Created two-column cards:', {
        section1: { id: section1.id, title: section1.title },
        section2: { id: section2.id, title: section2.title }
      });
      console.log('sectionTitles after creation:', Object.keys(data.sectionTitles).map(key => `${key}: ${data.sectionTitles[key]}`));
      console.log('Sections array after creation:', sections.map(s => ({ id: s.id, title: s.title, type: s.type })));

      renderAllSections();
      return;

    case 'reminders':
      newSection = {
        id: generateSectionId(),
        type: 'reminders',
        title: generateUniqueCardTitle('Reminders')
      };
      // Initialize with one subtitle and one item
      const reminderId = newSection.id;
      const initialReminders = [];
      data[reminderId] = {
        'General': [{
          key: generateKey('reminder', initialReminders),
          title: 'New Reminder',
          url: PLACEHOLDER_URL,
          schedule: null,
          type: 'days'
        }]
      };
      break;

    case 'subtasks':
      newSection = {
        id: generateSectionId(),
        type: 'newCardAnalytics',
        title: generateUniqueCardTitle('New Subtasks'),
        structure: 'analytics-style'
      };
      // Initialize with empty array for subtasks
      data[newSection.id] = [];
      break;

    case 'copyPaste':
      newSection = {
        id: generateSectionId('copy-paste'),
        type: 'copyPaste',
        title: generateUniqueCardTitle('Copy-Paste'),
        structure: 'copy-paste'
      };
      // Initialize with subtitle structure like reminders
      data[newSection.id] = {
        'General': [{
          key: generateKey('copy', []),
          text: 'New Item',
          copyText: ''
        }]
      };
      break;
  }

  // Insert the new section into current display mode's sections array
  sections.splice(actualTargetIndex, 0, newSection);
  // Also add to the other sections array (for when switching modes)
  ensureSectionInBothArrays(newSection);

  // Add to sectionTitles
  data.sectionTitles[newSection.id] = newSection.title;

  renderAllSections();
}

// --- Initialize the application
init();
