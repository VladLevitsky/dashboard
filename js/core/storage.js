// Personal Dashboard - Storage Module
// Handles saving and restoring the model to/from localStorage

import { STORAGE_KEY, PLACEHOLDER_URL, APP_VERSION } from '../constants.js';
import { model, currentData } from '../state.js';
import { showToast } from '../utils.js';

// --- Clean up old backup entries to prevent localStorage quota issues
export function cleanupOldBackups() {
  const keys = Object.keys(localStorage);
  const backupKeys = keys.filter(key => key.includes('__backup__'));

  if (backupKeys.length > 0) {
    backupKeys.forEach(key => localStorage.removeItem(key));
  }
}

// --- Save model to localStorage
export function saveModel() {
  // Clean up old backups before saving to prevent quota issues
  cleanupOldBackups();

  // Always save the main model, not the working copy
  const data = model;

  const payload = {
    sections: data.sections,
    sectionsStacked: data.sectionsStacked,
    sectionTitles: data.sectionTitles,
    sectionIcons: data.sectionIcons,
    sectionColors: data.sectionColors,
    subtitleColors: data.subtitleColors,
    header: data.header,
    darkMode: data.darkMode,
    reminders: data.reminders,
    dailyTasks: data.dailyTasks,
    dailyTools: data.dailyTools,
    contentCreation: data.contentCreation,
    ads: data.ads,
    analytics: data.analytics,
    tools: data.tools,
    timers: data.timers,
    timeTrackingExpanded: data.timeTrackingExpanded,
    quickAccessExpanded: data.quickAccessExpanded,
    selectorModeActive: data.selectorModeActive,
    quickAccessItems: data.quickAccessItems,
    displayMode: data.displayMode,
  };

  // Add dynamic sections
  data.sections.forEach(section => {
    if ((section.type === 'newCard' || section.type === 'newCardAnalytics' || section.type === 'copyPaste') && data[section.id]) {
      payload[section.id] = data[section.id];
    }
  });

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    if (error.name === 'QuotaExceededError') {
      try {
        const keys = Object.keys(localStorage);
        const backupKeys = keys.filter(key => key.includes('__backup__'));
        backupKeys.forEach(key => localStorage.removeItem(key));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
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

  return true;
}

// --- Restore model from localStorage
export async function restoreModel() {
  try {
    let raw = localStorage.getItem(STORAGE_KEY);
    let saved = raw ? JSON.parse(raw) : null;

    if (!saved) {
      const rawV1 = localStorage.getItem('personal_dashboard_model_v1');
      if (rawV1) saved = JSON.parse(rawV1);
    }

    if (!saved) {
      return;
    }

    if (saved.sections) {
      model.sections = saved.sections;
    }

    if (saved.sectionsStacked) {
      model.sectionsStacked = saved.sectionsStacked;
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

    if (saved.header) {
      model.header = { ...model.header, ...saved.header };
    }

    if (typeof saved.darkMode === 'boolean') {
      model.darkMode = saved.darkMode;
    }

    if (saved.reminders) {
      if (typeof saved.reminders === 'object' && !Array.isArray(saved.reminders)) {
        model.reminders = saved.reminders;
        Object.values(model.reminders).forEach(reminderArray => {
          if (Array.isArray(reminderArray)) {
            reminderArray.forEach(reminder => {
              if (!reminder.type) {
                reminder.type = 'days';
              }
              if (reminder.schedule && reminder.schedule.date && typeof reminder.schedule.date === 'string') {
                reminder.schedule.date = new Date(reminder.schedule.date);
              }
            });
          }
        });
      } else if (Array.isArray(saved.reminders)) {
        model.reminders = { 'General': saved.reminders };
        model.reminders['General'].forEach(reminder => {
          if (!reminder.type) {
            reminder.type = 'days';
          }
          if (reminder.schedule && reminder.schedule.date && typeof reminder.schedule.date === 'string') {
            reminder.schedule.date = new Date(reminder.schedule.date);
          }
        });
      }
    }

    ['dailyTasks', 'dailyTools', 'contentCreation', 'ads'].forEach(section => {
      if (saved[section] && Array.isArray(saved[section])) {
        model[section] = saved[section];
      }
    });

    ['analytics', 'tools'].forEach(section => {
      if (saved[section] && Array.isArray(saved[section])) {
        model[section] = saved[section];
      }
    });

    // Restore timers
    if (saved.timers && Array.isArray(saved.timers)) {
      model.timers = saved.timers;
      model.timers.forEach(timer => {
        timer.isRunning = false;
        timer.lastTick = null;
      });
    }

    // Restore time tracking state
    if (typeof saved.timeTrackingExpanded === 'boolean') {
      model.timeTrackingExpanded = saved.timeTrackingExpanded;
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

    // Restore display mode
    if (saved.displayMode === 'normal' || saved.displayMode === 'stacked') {
      model.displayMode = saved.displayMode;
    }

    // Restore dynamic sections (new cards)
    if (saved.sections) {
      saved.sections.forEach(section => {
        if ((section.type === 'newCard' || section.type === 'newCardAnalytics') && saved[section.id]) {
          if (Array.isArray(saved[section.id])) {
            model[section.id] = saved[section.id];
          }
        } else if (section.type === 'copyPaste' && saved[section.id]) {
          if (typeof saved[section.id] === 'object' && !Array.isArray(saved[section.id])) {
            model[section.id] = saved[section.id];
          }
        }
      });
    }

    // Security: ensure Ads_5 resets to placeholder URL
    const ads5 = model.ads.find(i => i.key === 'ads_5');
    if (ads5) {
      ads5.url = PLACEHOLDER_URL;
    }

    // Set flags
    window.skipUrlOverrides = true;
    window.localStorageRestored = true;
    window.isInitialLoad = true;
    saveModel();
    window.isInitialLoad = false;

  } catch (error) {
    console.error('Error in restoreModel:', error);
  }
}

// --- Export a timestamped backup of the model into localStorage
export function exportBackupFile() {
  const now = new Date();
  const ts = now.toISOString().replace(/[:.]/g, '-');
  const key = `${STORAGE_KEY}__backup__${ts}`;
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (data) localStorage.setItem(key, data);
  } catch {}
}

// --- Deep merge function to properly merge working copy back to main model
export function deepMergeModel(target, source) {
  // Handle arrays - replace them completely
  if (Array.isArray(source.sections)) {
    target.sections = [...source.sections];
  }
  if (Array.isArray(source.sectionsStacked)) {
    target.sectionsStacked = [...source.sectionsStacked];
  }
  if (Array.isArray(source.dailyTasks)) {
    target.dailyTasks = [...source.dailyTasks];
  }
  if (Array.isArray(source.dailyTools)) {
    target.dailyTools = [...source.dailyTools];
  }
  if (Array.isArray(source.contentCreation)) {
    target.contentCreation = [...source.contentCreation];
  }
  if (Array.isArray(source.ads)) {
    target.ads = [...source.ads];
  }
  if (Array.isArray(source.analytics)) {
    target.analytics = [...source.analytics];
  }
  if (Array.isArray(source.tools)) {
    target.tools = [...source.tools];
  }
  if (Array.isArray(source.timers)) {
    target.timers = [...source.timers];
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
  if (source.header) {
    target.header = { ...target.header, ...source.header };
  }
  if (source.reminders) {
    target.reminders = JSON.parse(JSON.stringify(source.reminders));
  }
  if (source.quickAccessItems) {
    target.quickAccessItems = JSON.parse(JSON.stringify(source.quickAccessItems));
  }

  // Handle simple properties
  if (typeof source.darkMode !== 'undefined') {
    target.darkMode = source.darkMode;
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
  if (typeof source.displayMode !== 'undefined') {
    target.displayMode = source.displayMode;
  }

  // Handle dynamic sections (new cards)
  Object.keys(source).forEach(key => {
    if (key.startsWith('new-card-')) {
      if (Array.isArray(source[key])) {
        target[key] = [...source[key]];
      } else if (typeof source[key] === 'object' && source[key] !== null) {
        target[key] = JSON.parse(JSON.stringify(source[key]));
      }
    }
  });
}
