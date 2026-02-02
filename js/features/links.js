// Personal Dashboard - Links Module
// Handles reminder and list item links modals and toggles

import { currentData, model } from '../state.js';
import { $, lightenColorBy20Percent, getColorForCurrentMode, setColorForCurrentMode } from '../utils.js';
import { markDirtyAndSave } from './edit-mode.js';

// Module state
let currentLinksReminder = null;
let currentLinksListItem = null;
let currentLinksListItemSectionId = null;

// --- Open links modal for reminder
export function openLinksModal(reminder) {
  currentLinksReminder = reminder;

  if (!reminder.links) {
    reminder.links = [];
  }

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

    $('#add-reminder-link-btn').addEventListener('click', addLinkRow);
    $('#reminder-links-cancel').addEventListener('click', cancelLinksModal);
    $('#reminder-links-save').addEventListener('click', saveLinksModal);

    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        cancelLinksModal();
      }
    });
  }

  renderLinkRows();
  modal.hidden = false;
}

// --- Render link rows for reminder
export function renderLinkRows() {
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

// --- Add link row for reminder
export function addLinkRow() {
  if (!currentLinksReminder.links) {
    currentLinksReminder.links = [];
  }
  currentLinksReminder.links.push({ title: '', url: '' });
  renderLinkRows();

  const inputs = document.querySelectorAll('#reminder-links-list .link-title-input');
  if (inputs.length > 0) {
    inputs[inputs.length - 1].focus();
  }
}

// --- Cancel links modal
export function cancelLinksModal() {
  const modal = $('#reminder-links-modal');
  if (modal) modal.hidden = true;
  currentLinksReminder = null;
}

// --- Save links modal
export function saveLinksModal() {
  if (!currentLinksReminder) return;

  currentLinksReminder.links = currentLinksReminder.links.filter(
    link => link.title.trim() || link.url.trim()
  );

  markDirtyAndSave();
  if (window.renderAllSections) window.renderAllSections();

  const modal = $('#reminder-links-modal');
  if (modal) modal.hidden = true;
  currentLinksReminder = null;
}

// --- Toggle reminder links in view mode
export function toggleReminderLinks(reminderKey, subtitle, sectionId, buttonEl) {
  const data = currentData();
  const cardData = data[sectionId];
  if (!cardData || !cardData[subtitle]) return;

  // Unified card structure: cardData[subtitle].reminders is the array
  const subtitleData = cardData[subtitle];
  const remindersArray = subtitleData.reminders || [];
  const reminder = remindersArray.find(r => r.key === reminderKey);

  if (!reminder || !reminder.links || reminder.links.length === 0) return;

  let linksContainer = buttonEl._linksContainer;

  if (linksContainer && linksContainer.parentNode) {
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
    // Support both legacy .reminder-item and unified .unified-reminder-item classes
    const reminderItem = buttonEl.closest('.reminder-item') || buttonEl.closest('.unified-reminder-item');
    if (!reminderItem) return;
    const computedStyle = window.getComputedStyle(reminderItem);
    const parentBgColor = computedStyle.backgroundColor;
    const lighterColor = lightenColorBy20Percent(parentBgColor);

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

    document.body.appendChild(linksContainer);
    buttonEl._linksContainer = linksContainer;

    const buttonRect = buttonEl.getBoundingClientRect();
    // Get scroll offsets for absolute positioning
    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;

    // Calculate position with viewport awareness
    const margin = 20;
    let leftPos = buttonRect.right + margin + scrollX;
    let topPos = buttonRect.top + buttonRect.height / 2 + scrollY;

    // Measure container width after adding to DOM
    requestAnimationFrame(() => {
      const containerWidth = linksContainer.offsetWidth || 150;
      const containerHeight = linksContainer.offsetHeight || 100;

      // Check if it would overflow the right edge of viewport
      if (buttonRect.right + margin + containerWidth > window.innerWidth) {
        // Position to the left of the button instead
        leftPos = buttonRect.left - containerWidth - margin + scrollX;
        // Make sure it doesn't go off the left edge
        if (leftPos < scrollX + margin) {
          leftPos = scrollX + margin;
        }
      }

      // Check vertical overflow
      const halfHeight = containerHeight / 2;
      if (topPos - halfHeight < scrollY + margin) {
        topPos = scrollY + margin + halfHeight;
      } else if (topPos + halfHeight > scrollY + window.innerHeight - margin) {
        topPos = scrollY + window.innerHeight - margin - halfHeight;
      }

      linksContainer.style.left = `${leftPos}px`;
      linksContainer.style.top = `${topPos}px`;
      linksContainer.style.transform = 'translateY(-50%)';

      linksContainer.classList.add('open');
    });
  }
}

// --- Close all open reminder link bubbles
export function closeAllReminderLinks() {
  const openContainers = document.querySelectorAll('.reminder-links-expanded');
  openContainers.forEach(container => {
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
  document.querySelectorAll('.reminder-links-toggle').forEach(btn => {
    btn._linksContainer = null;
  });
}

// --- Open links modal for list item
export function openListItemLinksModal(item, sectionId) {
  currentLinksListItem = item;
  currentLinksListItemSectionId = sectionId;

  if (!item.links) {
    item.links = [];
  }

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

    $('#add-list-item-link-btn').addEventListener('click', addListItemLinkRow);
    $('#list-item-links-cancel').addEventListener('click', cancelListItemLinksModal);
    $('#list-item-links-save').addEventListener('click', saveListItemLinksModal);

    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        cancelListItemLinksModal();
      }
    });
  }

  renderListItemLinkRows();
  modal.hidden = false;
}

// --- Render link rows for list item
export function renderListItemLinkRows() {
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

// --- Add link row for list item
export function addListItemLinkRow() {
  if (!currentLinksListItem.links) {
    currentLinksListItem.links = [];
  }
  currentLinksListItem.links.push({ title: '', url: '' });
  renderListItemLinkRows();

  const inputs = document.querySelectorAll('#list-item-links-list .link-title-input');
  if (inputs.length > 0) {
    inputs[inputs.length - 1].focus();
  }
}

// --- Cancel list item links modal
export function cancelListItemLinksModal() {
  const modal = $('#list-item-links-modal');
  if (modal) modal.hidden = true;
  currentLinksListItem = null;
  currentLinksListItemSectionId = null;
}

// --- Save list item links modal
export function saveListItemLinksModal() {
  if (!currentLinksListItem) return;

  currentLinksListItem.links = currentLinksListItem.links.filter(
    link => link.title.trim() || link.url.trim()
  );

  markDirtyAndSave();
  if (window.renderAllSections) window.renderAllSections();

  const modal = $('#list-item-links-modal');
  if (modal) modal.hidden = true;
  currentLinksListItem = null;
  currentLinksListItemSectionId = null;
}

// --- Toggle list item links in view mode
export function toggleListItemLinks(item, sectionId, buttonEl) {
  if (!item || !item.links || item.links.length === 0) return;

  let linksContainer = buttonEl._linksContainer;

  if (linksContainer && linksContainer.parentNode) {
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
    // Support both legacy .list-item and unified .unified-subtask-item classes
    const listItem = buttonEl.closest('.list-item') || buttonEl.closest('.unified-subtask-item');
    if (!listItem) return;
    const computedStyle = window.getComputedStyle(listItem);
    const parentBgColor = computedStyle.backgroundColor;
    const lighterColor = lightenColorBy20Percent(parentBgColor);

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

    document.body.appendChild(linksContainer);
    buttonEl._linksContainer = linksContainer;

    const buttonRect = buttonEl.getBoundingClientRect();
    // Get scroll offsets for absolute positioning
    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;

    // Calculate position with viewport awareness
    const margin = 20;
    let leftPos = buttonRect.right + margin + scrollX;
    let topPos = buttonRect.top + buttonRect.height / 2 + scrollY;

    // Measure container width after adding to DOM
    requestAnimationFrame(() => {
      const containerWidth = linksContainer.offsetWidth || 150;
      const containerHeight = linksContainer.offsetHeight || 100;

      // Check if it would overflow the right edge of viewport
      if (buttonRect.right + margin + containerWidth > window.innerWidth) {
        // Position to the left of the button instead
        leftPos = buttonRect.left - containerWidth - margin + scrollX;
        // Make sure it doesn't go off the left edge
        if (leftPos < scrollX + margin) {
          leftPos = scrollX + margin;
        }
      }

      // Check vertical overflow
      const halfHeight = containerHeight / 2;
      if (topPos - halfHeight < scrollY + margin) {
        topPos = scrollY + margin + halfHeight;
      } else if (topPos + halfHeight > scrollY + window.innerHeight - margin) {
        topPos = scrollY + window.innerHeight - margin - halfHeight;
      }

      linksContainer.style.left = `${leftPos}px`;
      linksContainer.style.top = `${topPos}px`;
      linksContainer.style.transform = 'translateY(-50%)';

      linksContainer.classList.add('open');
    });
  }
}

// --- Close all open list item link bubbles
export function closeAllListItemLinks() {
  document.querySelectorAll('.list-item-links-toggle').forEach(btn => {
    if (btn._linksContainer && btn._linksContainer.parentNode) {
      btn._linksContainer.remove();
    }
    btn._linksContainer = null;
  });
}

// ========== Icon Links Feature ==========

// Module state for icon links
let currentLinksIcon = null;
let currentLinksIconSectionId = null;
let currentLinksIconSubtitle = null;

// --- Open links modal for icon
export function openIconLinksModal(icon, sectionId, subtitle) {
  currentLinksIcon = icon;
  currentLinksIconSectionId = sectionId;
  currentLinksIconSubtitle = subtitle;

  if (!icon.links) {
    icon.links = [];
  }

  let modal = $('#icon-links-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'icon-links-modal';
    modal.className = 'reminder-links-modal';
    modal.innerHTML = `
      <div class="reminder-links-dialog icon-links-dialog">
        <h3>Manage Links</h3>
        <p class="icon-links-mode-hint">Setting colors for: <strong id="icon-links-mode-label">Light</strong> mode</p>
        <div class="reminder-links-content">
          <div id="icon-links-list" class="reminder-links-list"></div>
          <button type="button" id="add-icon-link-btn" class="btn-add-link">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            Add Link
          </button>
        </div>
        <div class="reminder-links-actions">
          <button type="button" id="icon-links-cancel" class="btn-secondary">Cancel</button>
          <button type="button" id="icon-links-save" class="btn-primary">Save</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    $('#add-icon-link-btn').addEventListener('click', addIconLinkRow);
    $('#icon-links-cancel').addEventListener('click', cancelIconLinksModal);
    $('#icon-links-save').addEventListener('click', saveIconLinksModal);

    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        cancelIconLinksModal();
      }
    });
  }

  // Update mode label
  const modeLabel = model.darkMode ? 'Dark' : 'Light';
  $('#icon-links-mode-label').textContent = modeLabel;

  renderIconLinkRows();
  modal.hidden = false;
}

// --- Render link rows for icon
export function renderIconLinkRows() {
  const listContainer = $('#icon-links-list');
  listContainer.innerHTML = '';

  if (!currentLinksIcon.links) {
    currentLinksIcon.links = [];
  }

  const defaultColorLight = '#f7fafc';
  const defaultColorDark = '#475569';

  currentLinksIcon.links.forEach((link, index) => {
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

    // Color circle button - opens color picker popover
    const colorBtn = document.createElement('button');
    colorBtn.type = 'button';
    colorBtn.className = 'icon-link-color-btn';
    const currentColor = getColorForCurrentMode(link.color, defaultColorLight, defaultColorDark);
    colorBtn.style.background = currentColor;
    colorBtn.title = 'Choose bubble color';
    colorBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openLinkColorPicker(link, colorBtn);
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
      currentLinksIcon.links.splice(index, 1);
      renderIconLinkRows();
    });

    rowDiv.appendChild(titleInput);
    rowDiv.appendChild(urlInput);
    rowDiv.appendChild(colorBtn);
    rowDiv.appendChild(deleteBtn);
    listContainer.appendChild(rowDiv);
  });
}

// --- Open color picker popover for a link
function openLinkColorPicker(link, colorBtn) {
  // Close any existing color picker popover
  const existingPopover = document.querySelector('.link-color-popover');
  if (existingPopover) {
    existingPopover.remove();
  }

  const defaultColorLight = '#f7fafc';
  const defaultColorDark = '#475569';
  const currentColor = getColorForCurrentMode(link.color, defaultColorLight, defaultColorDark);
  const modeLabel = model.darkMode ? 'Dark' : 'Light';

  const popover = document.createElement('div');
  popover.className = 'link-color-popover';
  popover.innerHTML = `
    <div class="link-color-popover-header">
      <span>Bubble Color (${modeLabel})</span>
    </div>
    <div class="link-color-popover-content">
      <input type="color" class="link-color-input" value="${currentColor}">
      <div class="link-color-presets">
        <button type="button" class="color-preset-small" data-color="#f7fafc" style="background: #f7fafc;" title="Gray"></button>
        <button type="button" class="color-preset-small" data-color="#fff4e5" style="background: #fff4e5;" title="Yellow"></button>
        <button type="button" class="color-preset-small" data-color="#e6fff3" style="background: #e6fff3;" title="Green"></button>
        <button type="button" class="color-preset-small" data-color="#ffe6f0" style="background: #ffe6f0;" title="Pink"></button>
        <button type="button" class="color-preset-small" data-color="#e6f3ff" style="background: #e6f3ff;" title="Blue"></button>
        <button type="button" class="color-preset-small" data-color="#f3e6ff" style="background: #f3e6ff;" title="Purple"></button>
        <button type="button" class="color-preset-small" data-color="#fff6e6" style="background: #fff6e6;" title="Orange"></button>
        <button type="button" class="color-preset-small" data-color="#ffe6e6" style="background: #ffe6e6;" title="Red"></button>
      </div>
    </div>
  `;

  document.body.appendChild(popover);

  // Position popover near the color button
  const btnRect = colorBtn.getBoundingClientRect();
  const popoverWidth = 200;
  const popoverHeight = popover.offsetHeight || 120;
  const margin = 8;

  let left = btnRect.left;
  let top = btnRect.bottom + margin;

  // Adjust if overflowing right
  if (left + popoverWidth > window.innerWidth - margin) {
    left = window.innerWidth - popoverWidth - margin;
  }

  // Adjust if overflowing bottom - show above instead
  if (top + popoverHeight > window.innerHeight - margin) {
    top = btnRect.top - popoverHeight - margin;
  }

  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;

  // Handle color input change
  const colorInput = popover.querySelector('.link-color-input');
  colorInput.addEventListener('input', (e) => {
    const newColor = e.target.value;
    link.color = setColorForCurrentMode(link.color, newColor);
    colorBtn.style.background = newColor;
  });

  // Handle preset clicks
  popover.querySelectorAll('.color-preset-small').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const newColor = btn.dataset.color;
      colorInput.value = newColor;
      link.color = setColorForCurrentMode(link.color, newColor);
      colorBtn.style.background = newColor;
    });
  });

  // Close on click outside
  const closePopover = (e) => {
    if (!popover.contains(e.target) && e.target !== colorBtn) {
      popover.remove();
      document.removeEventListener('click', closePopover);
    }
  };
  setTimeout(() => document.addEventListener('click', closePopover), 0);
}

// --- Add link row for icon
export function addIconLinkRow() {
  if (!currentLinksIcon.links) {
    currentLinksIcon.links = [];
  }
  // Initialize with default color for current mode
  const defaultColor = model.darkMode ? '#475569' : '#f7fafc';
  currentLinksIcon.links.push({ title: '', url: '', color: { light: '#f7fafc', dark: '#475569' } });
  renderIconLinkRows();

  const inputs = document.querySelectorAll('#icon-links-list .link-title-input');
  if (inputs.length > 0) {
    inputs[inputs.length - 1].focus();
  }
}

// --- Cancel icon links modal
export function cancelIconLinksModal() {
  const modal = $('#icon-links-modal');
  if (modal) modal.hidden = true;
  currentLinksIcon = null;
  currentLinksIconSectionId = null;
  currentLinksIconSubtitle = null;
}

// --- Save icon links modal
export function saveIconLinksModal() {
  if (!currentLinksIcon) return;

  // Filter out empty links (colors are saved per-link in real-time)
  currentLinksIcon.links = currentLinksIcon.links.filter(
    link => link.title.trim() || link.url.trim()
  );

  markDirtyAndSave();
  if (window.renderAllSections) window.renderAllSections();

  const modal = $('#icon-links-modal');
  if (modal) modal.hidden = true;
  currentLinksIcon = null;
  currentLinksIconSectionId = null;
  currentLinksIconSubtitle = null;
}

// --- Toggle icon links in view mode
export function toggleIconLinks(iconKey, subtitle, sectionId, indicatorEl) {
  const data = currentData();
  const cardData = data[sectionId];
  if (!cardData || !cardData[subtitle]) return;

  const subtitleData = cardData[subtitle];
  const iconsArray = subtitleData.icons || [];
  const icon = iconsArray.find(i => i.key === iconKey);

  if (!icon || !icon.links || icon.links.length === 0) return;

  let linksContainer = indicatorEl._linksContainer;

  if (linksContainer && linksContainer.parentNode) {
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
    indicatorEl._linksContainer = null;
  } else {
    // Default colors for fallback
    const defaultColorLight = '#f7fafc';
    const defaultColorDark = '#475569';

    // Compute fallback color from icon button background (used if link has no custom color)
    let fallbackColor;
    const iconBtn = indicatorEl.closest('.icon-button');
    if (iconBtn) {
      const computedStyle = window.getComputedStyle(iconBtn);
      const parentBgColor = computedStyle.backgroundColor;
      fallbackColor = lightenColorBy20Percent(parentBgColor);
    } else {
      fallbackColor = model.darkMode ? defaultColorDark : defaultColorLight;
    }

    linksContainer = document.createElement('div');
    linksContainer.className = 'reminder-links-expanded icon-links-expanded';

    icon.links.forEach((link, index) => {
      // Each link can have its own color
      let bubbleColor;
      if (link.color) {
        bubbleColor = getColorForCurrentMode(link.color, defaultColorLight, defaultColorDark);
      } else {
        bubbleColor = fallbackColor;
      }

      const linkBubble = document.createElement('a');
      linkBubble.href = link.url || '#';
      linkBubble.target = '_blank';
      linkBubble.rel = 'noopener noreferrer';
      linkBubble.className = 'reminder-link-bubble';
      linkBubble.textContent = link.title || link.url || 'Link';
      linkBubble.style.animationDelay = `${index * 50}ms`;
      linkBubble.style.background = bubbleColor;

      linkBubble.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!link.url) e.preventDefault();
      });

      linksContainer.appendChild(linkBubble);
    });

    document.body.appendChild(linksContainer);
    indicatorEl._linksContainer = linksContainer;

    const indicatorRect = indicatorEl.getBoundingClientRect();
    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;

    const margin = 20;
    let leftPos = indicatorRect.right + margin + scrollX;
    let topPos = indicatorRect.top + indicatorRect.height / 2 + scrollY;

    requestAnimationFrame(() => {
      const containerWidth = linksContainer.offsetWidth || 150;
      const containerHeight = linksContainer.offsetHeight || 100;

      // Check if it would overflow the right edge of viewport
      if (indicatorRect.right + margin + containerWidth > window.innerWidth) {
        leftPos = indicatorRect.left - containerWidth - margin + scrollX;
        if (leftPos < scrollX + margin) {
          leftPos = scrollX + margin;
        }
      }

      // Check vertical overflow
      const halfHeight = containerHeight / 2;
      if (topPos - halfHeight < scrollY + margin) {
        topPos = scrollY + margin + halfHeight;
      } else if (topPos + halfHeight > scrollY + window.innerHeight - margin) {
        topPos = scrollY + window.innerHeight - margin - halfHeight;
      }

      linksContainer.style.left = `${leftPos}px`;
      linksContainer.style.top = `${topPos}px`;
      linksContainer.style.transform = 'translateY(-50%)';

      linksContainer.classList.add('open');
    });
  }
}

// --- Close all open icon link bubbles
export function closeAllIconLinks() {
  const openContainers = document.querySelectorAll('.icon-links-expanded');
  openContainers.forEach(container => {
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
  document.querySelectorAll('.icon-link-indicator').forEach(indicator => {
    indicator._linksContainer = null;
  });
}
