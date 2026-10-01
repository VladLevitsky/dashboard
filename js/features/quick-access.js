// Personal Dashboard - Quick Access Module
// Quick Access data: holding a card item (icon, reminder, subtask, copy-paste)
// for a moment adds it here or takes it out, and its card shows it first with
// a pulse. The items are listed in the Today view (js/features/today.js),
// which replaced the old Quick Access panel. Manually added quick links live
// here too.

import { editState, currentData } from '../state.js';
import { $ } from '../utils.js';
import { classifyImageRef } from '../core/file-service.js';
import { saveModel } from '../core/storage.js';

function refreshTodayView() {
  if (window.refreshTodayView) window.refreshTodayView();
}

// --- Open quick link modal
export function openQuickLinkModal() {
  const data = currentData();
  const hasQuickLinks = data.quickAccessItems.quickLinks && data.quickAccessItems.quickLinks.length > 0;

  // Create modal
  const modal = document.createElement('div');
  modal.className = 'quick-link-modal';
  modal.innerHTML = `
    <div class="quick-link-dialog">
      <h3>Add Quick Link</h3>
      <div class="quick-link-form">
        <div class="quick-link-field">
          <label for="quick-link-title">Title</label>
          <input type="text" id="quick-link-title" placeholder="Link title" autocomplete="off">
        </div>
        <div class="quick-link-field">
          <label for="quick-link-url">URL</label>
          <input type="url" id="quick-link-url" placeholder="https://example.com" autocomplete="off">
        </div>
      </div>
      <div class="quick-link-actions">
        <button type="button" id="quick-link-clear-all" class="quick-link-btn danger" ${hasQuickLinks ? '' : 'disabled'}>Clear All Links</button>
        <button type="button" id="quick-link-cancel" class="quick-link-btn secondary">Cancel</button>
        <button type="button" id="quick-link-save" class="quick-link-btn primary">Add Link</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Focus on title input
  setTimeout(() => {
    const titleInput = $('#quick-link-title');
    if (titleInput) titleInput.focus();
  }, 50);

  // Handle save
  const saveBtn = modal.querySelector('#quick-link-save');
  saveBtn.addEventListener('click', () => {
    const title = $('#quick-link-title').value.trim();
    const url = $('#quick-link-url').value.trim();

    if (!title || !url) {
      return;
    }

    const data = currentData();
    if (!data.quickAccessItems.quickLinks) {
      data.quickAccessItems.quickLinks = [];
    }

    data.quickAccessItems.quickLinks.push({
      title,
      url,
      key: `quick-link-${Date.now()}`
    });

    if (!editState.enabled) {
      saveModel();
    }
    refreshTodayView();

    document.body.removeChild(modal);
  });

  // Handle clear all links
  const clearAllBtn = modal.querySelector('#quick-link-clear-all');
  clearAllBtn.addEventListener('click', () => {
    const data = currentData();
    if (data.quickAccessItems.quickLinks && data.quickAccessItems.quickLinks.length > 0) {
      if (!confirm('Remove all quick links?')) return;
      data.quickAccessItems.quickLinks = [];

      if (!editState.enabled) {
        saveModel();
      }
      refreshTodayView();
    }
    document.body.removeChild(modal);
  });

  // Handle cancel
  const cancelBtn = modal.querySelector('#quick-link-cancel');
  cancelBtn.addEventListener('click', () => {
    document.body.removeChild(modal);
  });

  // Close on backdrop click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      document.body.removeChild(modal);
    }
  });

  // Handle Enter key (Esc stays here so it doesn't also close the Today view)
  modal.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      saveBtn.click();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      document.body.removeChild(modal);
    }
  });
}

// --- Remove a single quick link
export function removeQuickLink(linkKey) {
  const data = currentData();
  if (!data.quickAccessItems.quickLinks) return;

  data.quickAccessItems.quickLinks = data.quickAccessItems.quickLinks.filter(
    link => link.key !== linkKey
  );

  if (!editState.enabled) {
    saveModel();
  }
  refreshTodayView();
}

// --- Same-item identity used when an entry's card/section reference doesn't resolve
const iconIdentity = icon => {
  const ref = classifyImageRef(icon.icon);
  return `${ref.type === 'r2' ? `r2:${ref.value}` : String(icon.icon)}::${icon.url}`;
};

// --- Reconcile quick access items against current data (remove stale entries)
export function reconcileQuickAccessItems(data = currentData()) {
  if (!data.quickAccessItems) return;
  let changed = false;

  // Build a set of all existing icons and list items across all sections
  const existingIcons = new Set();
  const existingListItems = new Set();
  const sections = data.sections || [];

  sections.forEach(section => {
    const cardData = data[section.id];
    if (!cardData || typeof cardData !== 'object') return;
    Object.values(cardData).forEach(group => {
      if (!group || typeof group !== 'object') return;
      if (group.icons) {
        group.icons.forEach(icon => {
          if (icon.icon && icon.url) existingIcons.add(iconIdentity(icon));
        });
      }
      if (group.subtasks) {
        group.subtasks.forEach(item => {
          existingListItems.add(`list::${item.text || ''}::${item.url || ''}`);
        });
      }
      if (group.reminders) {
        group.reminders.forEach(item => {
          existingListItems.add(`reminder::${item.title || ''}::${item.url || ''}`);
        });
      }
      if (group.copyPaste) {
        group.copyPaste.forEach(item => {
          existingListItems.add(`copyPaste::${item.text || ''}::${item.copyText || ''}`);
        });
      }
    });
  });

  // Filter icons — keep only those that still exist in a card
  if (data.quickAccessItems.icons) {
    const before = data.quickAccessItems.icons.length;
    data.quickAccessItems.icons = data.quickAccessItems.icons.filter(icon => existingIcons.has(iconIdentity(icon)));
    if (data.quickAccessItems.icons.length < before) changed = true;
  }

  // Filter list items — keep only those that still exist in a card
  if (data.quickAccessItems.listItems) {
    const before = data.quickAccessItems.listItems.length;
    data.quickAccessItems.listItems = data.quickAccessItems.listItems.filter(item => {
      if (item.copyText) {
        return existingListItems.has(`copyPaste::${item.text || ''}::${item.copyText || ''}`);
      } else if (item.type === 'reminder') {
        return existingListItems.has(`reminder::${item.text || ''}::${item.url || ''}`);
      } else {
        return existingListItems.has(`list::${item.text || ''}::${item.url || ''}`);
      }
    });
    if (data.quickAccessItems.listItems.length < before) changed = true;
  }

  if (changed && !editState.enabled) {
    saveModel();
  }
}

// --- Quick Access entries resolved to the live card items they point at, so
// they can be shown working exactly as on their cards (Today view).
// → { icons, reminders, subtasks, copyPaste: [{ item, sectionId, subtitle }], quickLinks }
// Entries are repaired on the way: older ones that don't name their card or
// section (or whose item was renamed) get the live item's references, and
// duplicates are dropped. Holding the item then finds the entry again, both
// in the Today view and on its card.
export function getQuickAccessItems(data = currentData()) {
  const qa = data.quickAccessItems || {};
  const result = { icons: [], reminders: [], subtasks: [], copyPaste: [], quickLinks: (qa.quickLinks || []).filter(l => l && l.url) };
  const seen = new Set();
  let changed = false;

  // Entries name their card (sectionType), section (subtitle) and item key
  // (name); older entries are matched by the same identity reconciliation uses
  const resolve = (entry, kind, sameItem) => {
    const group = entry.sectionType && data[entry.sectionType] && data[entry.sectionType][entry.subtitle];
    const direct = group && Array.isArray(group[kind]) && entry.name ? group[kind].find(i => i.key === entry.name) : null;
    if (direct) return { item: direct, sectionId: entry.sectionType, subtitle: entry.subtitle };
    for (const section of data.sections || []) {
      const cardData = data[section.id];
      if (!cardData || typeof cardData !== 'object') continue;
      for (const [subtitle, g] of Object.entries(cardData)) {
        const found = g && Array.isArray(g[kind]) ? g[kind].find(i => sameItem(i)) : null;
        if (found) return { item: found, sectionId: section.id, subtitle };
      }
    }
    return null;
  };
  // The same fields the card writes when the item is held (sections.js)
  const liveFields = (kind, hit) => {
    const { item, sectionId, subtitle } = hit;
    const base = { name: item.key, sectionType: sectionId, subtitle };
    if (kind === 'icons') return { ...base, type: 'icon', icon: item.icon, url: item.url, title: item.title || item.key };
    if (kind === 'reminders') return { ...base, type: 'reminder', text: item.title, url: item.url };
    if (kind === 'copyPaste') return { ...base, type: 'copyPaste', text: item.text, copyText: item.copyText || item.text };
    return { ...base, type: 'list', text: item.text, url: item.url };
  };
  // Icon refs can be objects ({ type: 'r2', fileId }): compare by value
  const sameValue = (a, b) => a === b ||
    (!!a && !!b && typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b));
  // → keep the entry? Adds the resolved item to `list` once.
  const take = (entry, kind, list, hit) => {
    if (!hit) return true; // unresolved: left for reconcileQuickAccessItems
    const id = `${hit.sectionId}|${hit.subtitle}|${hit.item.key}`;
    if (seen.has(id)) { changed = true; return false; }
    seen.add(id);
    Object.entries(liveFields(kind, hit)).forEach(([field, value]) => {
      if (!sameValue(entry[field], value)) {
        entry[field] = value && typeof value === 'object' ? { ...value } : value;
        changed = true;
      }
    });
    list.push(hit);
    return true;
  };

  const icons = (qa.icons || []).filter(entry => entry &&
    take(entry, 'icons', result.icons, resolve(entry, 'icons', i => !i.isDivider && iconIdentity(i) === iconIdentity(entry))));
  const listItems = (qa.listItems || []).filter(entry => {
    if (!entry) return false;
    if (entry.copyText !== undefined && entry.type !== 'list' && entry.type !== 'reminder') {
      return take(entry, 'copyPaste', result.copyPaste, resolve(entry, 'copyPaste', i => (i.text || '') === (entry.text || '') && (i.copyText || i.text || '') === (entry.copyText || '')));
    }
    if (entry.type === 'reminder') {
      return take(entry, 'reminders', result.reminders, resolve(entry, 'reminders', i => (i.title || '') === (entry.text || '') && (i.url || '') === (entry.url || '')));
    }
    return take(entry, 'subtasks', result.subtasks, resolve(entry, 'subtasks', i => (i.text || '') === (entry.text || '') && (i.url || '') === (entry.url || '')));
  });

  if (changed || icons.length !== (qa.icons || []).length || listItems.length !== (qa.listItems || []).length) {
    data.quickAccessItems = { ...qa, icons, listItems };
    if (!editState.enabled) saveModel();
    result.repaired = true; // cards may now show the Quick Access light on more items
  }
  return result;
}


// --- Check if item is selected
function iconRefsMatch(a, b) {
  if (a === b) return true;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    return a.type === b.type && a.fileId === b.fileId;
  }
  return false;
}

export function isItemSelected(itemData, data) {
  if (itemData.type === 'icon') {
    return data.quickAccessItems.icons.some(item =>
      iconRefsMatch(item.icon, itemData.icon) && item.url === itemData.url &&
      item.sectionType === itemData.sectionType && item.subtitle === itemData.subtitle
    );
  } else if (itemData.type === 'list') {
    return data.quickAccessItems.listItems.some(item =>
      item.type === 'list' && item.sectionType === itemData.sectionType && item.subtitle === itemData.subtitle &&
      item.text === itemData.text && item.url === itemData.url && !item.copyText
    );
  } else if (itemData.type === 'copyPaste') {
    return data.quickAccessItems.listItems.some(item =>
      item.sectionType === itemData.sectionType && item.subtitle === itemData.subtitle &&
      ((item.name && itemData.name && item.name === itemData.name) ||
       (item.text === itemData.text && item.copyText === itemData.copyText))
    );
  } else if (itemData.type === 'reminder') {
    return data.quickAccessItems.listItems.some(item =>
      item.type === 'reminder' && item.sectionType === itemData.sectionType && item.subtitle === itemData.subtitle &&
      item.text === itemData.text && item.url === itemData.url
    );
  }
  return false;
}

// --- Toggle item in quick access (long-press on a card item)
// Returns true if item is now in quick access, false if removed
export function toggleItemQuickAccess(itemData) {
  const data = currentData();

  // Ensure quickAccessItems exists
  if (!data.quickAccessItems) {
    data.quickAccessItems = { icons: [], listItems: [], quickLinks: [] };
  }
  if (!data.quickAccessItems.listItems) {
    data.quickAccessItems.listItems = [];
  }
  if (!data.quickAccessItems.icons) {
    data.quickAccessItems.icons = [];
  }

  const isSelected = isItemSelected(itemData, data);

  if (isSelected) {
    // Remove from quick access
    if (itemData.type === 'icon') {
      data.quickAccessItems.icons = data.quickAccessItems.icons.filter(item =>
        !(iconRefsMatch(item.icon, itemData.icon) && item.url === itemData.url &&
          item.sectionType === itemData.sectionType && item.subtitle === itemData.subtitle)
      );
    } else if (itemData.type === 'list') {
      data.quickAccessItems.listItems = data.quickAccessItems.listItems.filter(item =>
        !(item.type === 'list' && item.sectionType === itemData.sectionType && item.subtitle === itemData.subtitle &&
          item.text === itemData.text && item.url === itemData.url && !item.copyText)
      );
    } else if (itemData.type === 'copyPaste') {
      data.quickAccessItems.listItems = data.quickAccessItems.listItems.filter(item =>
        !(item.sectionType === itemData.sectionType && item.subtitle === itemData.subtitle &&
          ((item.name && itemData.name && item.name === itemData.name) ||
           (item.text === itemData.text && item.copyText === itemData.copyText)))
      );
    } else if (itemData.type === 'reminder') {
      data.quickAccessItems.listItems = data.quickAccessItems.listItems.filter(item =>
        !(item.type === 'reminder' && item.sectionType === itemData.sectionType && item.subtitle === itemData.subtitle &&
          item.text === itemData.text && item.url === itemData.url)
      );
    }
  } else {
    // Add to quick access
    if (itemData.type === 'icon') {
      data.quickAccessItems.icons.push(itemData);
    } else {
      data.quickAccessItems.listItems.push(itemData);
    }
  }

  // Save first: the re-render below also repaints an open Today view
  if (!editState.enabled) {
    saveModel();
  }

  // Re-render sections to update item positions (prioritized items move to top)
  if (window.renderAllSections) {
    window.renderAllSections();
  } else {
    refreshTodayView();
  }

  return !isSelected;
}

// --- Check if item is in quick access (exported for external use)
export function isItemInQuickAccess(itemData) {
  const data = currentData();
  return isItemSelected(itemData, data);
}
