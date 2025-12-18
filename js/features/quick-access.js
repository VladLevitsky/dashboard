// Personal Dashboard - Quick Access Module
// Handles quick access panel functionality

import { editState, currentData } from '../state.js';
import { $, openUrl, copyToClipboard } from '../utils.js';
import { ANIMATION_DELAY_MS, CARD_HIDE_DELAY_MS } from '../constants.js';
import { saveModel } from '../core/storage.js';

// --- Toggle quick access panel
export function toggleQuickAccess() {
  const card = $('#quick-access-card');
  if (!card) return;

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

  if (!editState.enabled) {
    saveModel();
  }
}

// --- Toggle selector mode
export function toggleSelectorMode() {
  const data = currentData();
  const btn = $('#selector-mode-toggle');
  if (!btn) return;

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

// --- Clear quick access items
export function clearQuickAccess() {
  const data = currentData();

  const hasItems = data.quickAccessItems.icons.length > 0 ||
                   data.quickAccessItems.listItems.length > 0 ||
                   (data.quickAccessItems.quickLinks && data.quickAccessItems.quickLinks.length > 0);

  if (!hasItems) {
    return;
  }

  data.quickAccessItems.icons = [];
  data.quickAccessItems.listItems = [];
  data.quickAccessItems.quickLinks = [];

  renderQuickAccess();

  if (!editState.enabled) {
    saveModel();
  }
}

// --- Open quick link modal
export function openQuickLinkModal() {
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

// --- Render quick access panel
export function renderQuickAccess() {
  const data = currentData();
  const content = $('#quick-access-content');

  if (!content) return;

  const quickLinks = data.quickAccessItems.quickLinks || [];
  const icons = data.quickAccessItems.icons || [];
  const listItems = data.quickAccessItems.listItems || [];

  if (quickLinks.length === 0 && icons.length === 0 && listItems.length === 0) {
    content.innerHTML = '<div class="quick-access-empty">No items selected. Click the circle button above to enter selector mode, or the link button to add quick links.</div>';
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

    // Handle icon click
    const icon = e.target.closest('.quick-access-icon');
    if (icon) {
      e.preventDefault();
      const url = icon.dataset.qaUrl;
      if (url) openUrl(url);
    }
  };

  content._quickAccessClickHandler = clickHandler;
  content.addEventListener('click', clickHandler);
}

// --- Make items selectable
export function makeItemsSelectable() {
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

  updateSelectedItemsUI();
}

// --- Remove selectable handlers
export function removeSelectableHandlers() {
  const selectableItems = document.querySelectorAll('.selectable-item');
  selectableItems.forEach(item => {
    item.classList.remove('selectable-item', 'selected');
    delete item.dataset.selectableType;
  });
}

// --- Update selected items UI
export function updateSelectedItemsUI() {
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

// --- Extract item data from element
export function extractItemData(element) {
  const selectableType = element.dataset.selectableType;
  const data = currentData();

  if (selectableType === 'icon') {
    const sectionType = element.dataset.type;
    const itemKey = element.dataset.key;

    if (!sectionType || !itemKey) return null;

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
    const sectionType = element.dataset.type;
    const itemKey = element.dataset.key;
    const subtitle = element.dataset.subtitle;

    if (sectionType && itemKey) {
      if (subtitle) {
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

// --- Check if item is selected
export function isItemSelected(itemData, data) {
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

// --- Handle item selection click
export function handleItemSelection(event) {
  const data = currentData();

  if (!data.selectorModeActive) return;

  const selectableItem = event.target.closest('.selectable-item');
  if (!selectableItem) return;

  event.preventDefault();
  event.stopPropagation();

  const itemData = extractItemData(selectableItem);
  if (!itemData) return;

  if (isItemSelected(itemData, data)) {
    // Deselect
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
    // Select
    if (itemData.type === 'icon') {
      data.quickAccessItems.icons.push(itemData);
    } else if (itemData.type === 'list') {
      data.quickAccessItems.listItems.push(itemData);
    } else if (itemData.type === 'copyPaste') {
      data.quickAccessItems.listItems.push(itemData);
    }
    selectableItem.classList.add('selected');
  }

  renderQuickAccess();

  if (!editState.enabled) {
    saveModel();
  }
}
