// Personal Dashboard - Quick Access Module
// Handles quick access panel functionality

import { editState, currentData } from '../state.js';
import { $, openUrl, copyToClipboard } from '../utils.js';
import { ANIMATION_DELAY_MS, CARD_HIDE_DELAY_MS } from '../constants.js';
import { saveModel } from '../core/storage.js';

// --- Close quick access panel (without toggle)
export function closeQuickAccess() {
  const card = $('#quick-access-card');
  if (!card) return;
  const data = currentData();
  if (!data.quickAccessExpanded) return;

  data.quickAccessExpanded = false;
  card.classList.remove('active');
  setTimeout(() => card.hidden = true, CARD_HIDE_DELAY_MS);

  if (!editState.enabled) {
    saveModel();
  }
}

// --- Toggle quick access panel
export function toggleQuickAccess() {
  const card = $('#quick-access-card');
  if (!card) return;

  const data = currentData();

  // If opening, close other slide-out panels first (abort if user cancels)
  if (!data.quickAccessExpanded) {
    if (window.closeTasksSummaryModal) window.closeTasksSummaryModal();
    if (window.closeMeetingsModal) {
      window.closeMeetingsModal();
      // If meetings modal didn't close (user cancelled unsaved changes), abort
      const meetingsModal = document.querySelector('#meetings-modal');
      if (meetingsModal && !meetingsModal.hidden) return;
    }
  }

  data.quickAccessExpanded = !data.quickAccessExpanded;

  if (data.quickAccessExpanded) {
    card.hidden = false;
    setTimeout(() => card.classList.add('active'), ANIMATION_DELAY_MS);
    renderQuickAccess();
  } else {
    card.classList.remove('active');
    setTimeout(() => card.hidden = true, CARD_HIDE_DELAY_MS);
  }

  if (!editState.enabled) {
    saveModel();
  }
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

    renderQuickAccess();

    if (!editState.enabled) {
      saveModel();
    }

    document.body.removeChild(modal);
  });

  // Handle clear all links
  const clearAllBtn = modal.querySelector('#quick-link-clear-all');
  clearAllBtn.addEventListener('click', () => {
    const data = currentData();
    if (data.quickAccessItems.quickLinks && data.quickAccessItems.quickLinks.length > 0) {
      data.quickAccessItems.quickLinks = [];
      renderQuickAccess();

      if (!editState.enabled) {
        saveModel();
      }
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

  // Handle Enter key
  modal.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      saveBtn.click();
    } else if (e.key === 'Escape') {
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

  renderQuickAccess();

  if (!editState.enabled) {
    saveModel();
  }
}

// --- Reconcile quick access items against current data (remove stale entries)
function reconcileQuickAccessItems(data) {
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
          if (icon.icon && icon.url) existingIcons.add(`${icon.icon}::${icon.url}`);
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
    data.quickAccessItems.icons = data.quickAccessItems.icons.filter(icon =>
      existingIcons.has(`${icon.icon}::${icon.url}`)
    );
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

// --- Render quick access panel
export function renderQuickAccess() {
  const data = currentData();
  const content = $('#quick-access-content');

  if (!content) return;

  // Reconcile against current data — remove stale items (only when panel is freshly opened)
  if (data.quickAccessExpanded) {
    reconcileQuickAccessItems(data);
  }

  const quickLinks = data.quickAccessItems.quickLinks || [];
  const icons = data.quickAccessItems.icons || [];
  // Deduplicate list items by name/key
  const allListItems = data.quickAccessItems.listItems || [];
  const seenKeys = new Set();
  const dedupedListItems = allListItems.filter(item => {
    const key = item.name || `${item.text}::${item.copyText || ''}`;
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  });
  // Update source array if duplicates were removed
  if (dedupedListItems.length < allListItems.length) {
    data.quickAccessItems.listItems = dedupedListItems;
    if (!editState.enabled) saveModel();
  }
  const listItems = dedupedListItems;

  if (quickLinks.length === 0 && icons.length === 0 && listItems.length === 0) {
    content.innerHTML = '<div class="quick-access-empty">No quick links yet. Click the link button above to add quick links.</div>';
    return;
  }

  let html = '';

  // Render quick links first (at the very top, as list-style bubbles)
  if (quickLinks.length > 0) {
    html += '<div class="quick-access-quick-links">';
    quickLinks.forEach(link => {
      const escapedUrl = (link.url || '').replace(/"/g, '&quot;');
      const escapedTitle = (link.title || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      html += `
        <div class="quick-access-list quick-link-item" data-qa-url="${escapedUrl}" data-qa-key="${link.key}">
          <a href="${escapedUrl}" target="_blank" rel="noopener noreferrer">${escapedTitle}</a>
        </div>
      `;
    });
    html += '</div>';
  }

  // Render icons second
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
      if (item.copyText) {
        const escapedCopyText = (item.copyText || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        const escapedText = (item.text || item.name || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');

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

  // Use event delegation
  const existingHandler = content._quickAccessClickHandler;
  if (existingHandler) {
    content.removeEventListener('click', existingHandler);
  }

  const clickHandler = (e) => {
    // Handle copy button
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

    // Handle copy-paste item click (clicking anywhere on the item copies text)
    const copyPasteItem = e.target.closest('.quick-access-copy-paste');
    if (copyPasteItem) {
      e.preventDefault();
      const copyText = copyPasteItem.dataset.qaCopyText;
      if (copyText) copyToClipboard(copyText);
      return;
    }

    // Handle icon click
    const icon = e.target.closest('.quick-access-icon');
    if (icon) {
      e.preventDefault();
      const url = icon.dataset.qaUrl;
      if (url) openUrl(url);
      return;
    }

    // Handle list item click (subtask links)
    const listItem = e.target.closest('.quick-access-list:not(.quick-link-item)');
    if (listItem) {
      e.preventDefault();
      const url = listItem.dataset.qaUrl;
      if (url) openUrl(url);
      return;
    }

  };

  content._quickAccessClickHandler = clickHandler;
  content.addEventListener('click', clickHandler);
}


// --- Check if item is selected
export function isItemSelected(itemData, data) {
  if (itemData.type === 'icon') {
    return data.quickAccessItems.icons.some(item =>
      item.icon === itemData.icon && item.url === itemData.url
    );
  } else if (itemData.type === 'list') {
    return data.quickAccessItems.listItems.some(item =>
      item.type === 'list' && item.text === itemData.text && item.url === itemData.url && !item.copyText
    );
  } else if (itemData.type === 'copyPaste') {
    return data.quickAccessItems.listItems.some(item =>
      (item.name && itemData.name && item.name === itemData.name) ||
      (item.text === itemData.text && item.copyText === itemData.copyText)
    );
  } else if (itemData.type === 'reminder') {
    return data.quickAccessItems.listItems.some(item =>
      item.type === 'reminder' && item.text === itemData.text && item.url === itemData.url
    );
  }
  return false;
}

// --- Toggle item in quick access (for priority button)
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
        !(item.icon === itemData.icon && item.url === itemData.url)
      );
    } else if (itemData.type === 'list') {
      data.quickAccessItems.listItems = data.quickAccessItems.listItems.filter(item =>
        !(item.type === 'list' && item.text === itemData.text && item.url === itemData.url && !item.copyText)
      );
    } else if (itemData.type === 'copyPaste') {
      data.quickAccessItems.listItems = data.quickAccessItems.listItems.filter(item =>
        !((item.name && itemData.name && item.name === itemData.name) ||
          (item.text === itemData.text && item.copyText === itemData.copyText))
      );
    } else if (itemData.type === 'reminder') {
      data.quickAccessItems.listItems = data.quickAccessItems.listItems.filter(item =>
        !(item.type === 'reminder' && item.text === itemData.text && item.url === itemData.url)
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

  // Re-render quick access if panel is open
  if (data.quickAccessExpanded) {
    renderQuickAccess();
  }

  // Re-render sections to update item positions (prioritized items move to top)
  if (window.renderAllSections) {
    window.renderAllSections();
  }

  // Save
  if (!editState.enabled) {
    saveModel();
  }

  return !isSelected;
}

// --- Check if item is in quick access (exported for external use)
export function isItemInQuickAccess(itemData) {
  const data = currentData();
  return isItemSelected(itemData, data);
}

