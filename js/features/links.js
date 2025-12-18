// Personal Dashboard - Links Module
// Handles reminder and list item links modals and toggles

import { currentData } from '../state.js';
import { $, lightenColorBy20Percent } from '../utils.js';
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
  const remindersData = sectionId === 'reminders' ? data.reminders : data[sectionId];
  const reminders = remindersData[subtitle];
  const reminder = reminders.find(r => r.key === reminderKey);

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
    const reminderItem = buttonEl.closest('.reminder-item');
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
    linksContainer.style.left = `${buttonRect.right + 20}px`;
    linksContainer.style.top = `${buttonRect.top + buttonRect.height / 2}px`;
    linksContainer.style.transform = 'translateY(-50%)';

    requestAnimationFrame(() => {
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
    const listItem = buttonEl.closest('.list-item');
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
    linksContainer.style.left = `${buttonRect.right + 20}px`;
    linksContainer.style.top = `${buttonRect.top + buttonRect.height / 2}px`;
    linksContainer.style.transform = 'translateY(-50%)';

    requestAnimationFrame(() => {
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
