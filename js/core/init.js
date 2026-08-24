// Personal Dashboard - Initialization Module
// Handles application startup, event listeners, and UI wiring

import { model, editState, currentData, currentSections } from '../state.js';
import { $, $$, showToast, generateKey, escapeAttr } from '../utils.js';
import { PLACEHOLDER_URL, ANIMATION_DELAY_MS, CARD_HIDE_DELAY_MS, TIMER_UPDATE_INTERVAL_MS } from '../constants.js';
import { saveModel, restoreModel, exportBackupFile, deepMergeModel, cleanupOldBackups } from './storage.js';
import { setImageFromRef, getDisplaySrc, classifyImageRef, uploadFile, dataURLtoBlob, filenameFromDataUrl } from './file-service.js';
import { isLoggedIn } from './auth.js';
import {
  toggleEditMode,
  hideEditPopover,
  applyDarkMode,
  applyGlassMode,
  applyGlassTheme,
  toggleDarkMode,
  openAppearanceModal,
  wireAppearanceModalEvents,
  refreshEditingClasses,
  markDirtyAndSave,
  openEditPopover,
  wireNotepadEvents,
  wireMoveButtonEvents,
  openNotepad,
  openNoteViewer
} from '../features/edit-mode.js';
import {
  handleDragOver,
  handleDrop
} from '../features/drag-drop.js';
import {
  resetAllTimers,
  addNewTimer,
  updateTimerDisplay,
  renderTimers,
  toggleTimeTracking,
  getTimerInterval,
  setTimerInterval,
  clearTimerInterval
} from '../features/timers.js';
import {
  toggleQuickAccess,
  renderQuickAccess,
  openQuickLinkModal,
  removeQuickLink
} from '../features/quick-access.js';
import {
  loadMediaLibrary,
  saveMediaLibrary,
  addFilesToMediaLibrary,
  persistImageFromLibraryEntry,
  loadManifestMedia,
  openMediaLibrary
} from '../features/media-library.js';
import {
  closeAllReminderLinks,
  closeAllListItemLinks,
  closeAllIconLinks,
  openIconLinksModal
} from '../features/links.js';
import {
  closeAllReminderTasks,
  closeAllListItemTasks,
  openTasksSummaryModal,
  toggleTasksSummary,
  closeTasksSummaryModal,
  openAddTaskModal,
  openIdeasModal
} from '../features/tasks.js';
import {
  openMeetingsModal
} from '../features/meetings.js';
import {
  openProjectsModal
} from '../features/projects.js';
import {
  renderBreakdownRows,
  updateBreakdownSum,
  cancelBreakdownModal,
  acceptBreakdownModal,
  getCurrentBreakdownReminder,
  setCurrentBreakdownReminder
} from '../features/reminders.js';
import { ensureSectionPlusButtons } from '../features/cards.js';
import { initStickyNotes } from '../features/sticky-notes.js';
import { initAuthOnStartup, postRestoreAuthSync } from '../features/auth-ui.js';
import { immediateCloudSave } from '../core/sync.js';

// Module state
let cardsCollapsed = false;

// Copy-text modal state
let currentCopyTextItem = null;
let currentCopyTextSection = null;


// ===== SEARCH FUNCTIONALITY =====

let searchTimeout = null;
let currentSearchQuery = '';
let searchResultsContainer = null;

function initSearch() {
  const searchInput = $('#dashboard-search');
  const clearBtn = $('#search-clear');

  if (!searchInput) return;

  // Create search results container
  createSearchResultsContainer();

  // Debounced search on input
  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    clearBtn.hidden = !query;

    // Debounce search
    if (searchTimeout) clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      performSearch(query);
    }, 150);
  });

  // Clear button
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      searchInput.value = '';
      clearBtn.hidden = true;
      clearSearch();
      searchInput.focus();
    });
  }

  // Escape to clear search
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      searchInput.value = '';
      clearBtn.hidden = true;
      clearSearch();
      searchInput.blur();
    }
  });

  // Global keyboard shortcut: Ctrl+F or / to focus search
  document.addEventListener('keydown', (e) => {
    // Don't trigger if user is typing in an input/textarea/contenteditable
    const activeEl = document.activeElement;
    const isTyping = activeEl.tagName === 'INPUT' ||
                     activeEl.tagName === 'TEXTAREA' ||
                     activeEl.isContentEditable;

    if ((e.key === '/' || (e.ctrlKey && e.key === 'f')) && !isTyping) {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
    }
  });
}

function createSearchResultsContainer() {
  searchResultsContainer = document.createElement('div');
  searchResultsContainer.id = 'search-results';
  searchResultsContainer.className = 'search-results';
  searchResultsContainer.hidden = true;

  // Insert after header, before app-main
  const appMain = $('.app-main');
  if (appMain && appMain.parentNode) {
    appMain.parentNode.insertBefore(searchResultsContainer, appMain);
  }
}

// Extract domain from URL (e.g., "google" from "https://www.google.com/search")
function extractDomain(url) {
  if (!url) return '';
  try {
    // Remove protocol
    let domain = url.replace(/^(https?:\/\/)?(www\.)?/i, '');
    // Get just the domain part before any path or TLD
    domain = domain.split('/')[0]; // Remove path
    domain = domain.split('.')[0]; // Get first part before .com/.org/etc
    return domain.toLowerCase();
  } catch (e) {
    return '';
  }
}

function performSearch(query) {
  currentSearchQuery = query.toLowerCase();

  if (!currentSearchQuery) {
    clearSearch();
    return;
  }

  const data = currentData();
  const results = {
    icons: [],
    reminders: [],
    subtasks: [],
    copyPaste: [],
    cardNotes: []
  };

  // Search through all sections
  const sections = currentSections();
  sections.forEach(section => {
    const sectionData = data[section.id];
    const cardTitle = section.title || 'Untitled Card';

    // Search card notes for this section
    if (data.cardNotes && data.cardNotes[section.id]) {
      const notes = data.cardNotes[section.id];
      const notesArray = Array.isArray(notes) ? notes : [];
      notesArray.forEach(note => {
        if (matchesQuery(note.title, currentSearchQuery) ||
            matchesQuery(note.content, currentSearchQuery)) {
          results.cardNotes.push({
            ...note,
            cardTitle,
            sectionId: section.id
          });
        }
      });
    }

    if (!sectionData) return;

    // Iterate through subtitles
    Object.keys(sectionData).forEach(subtitle => {
      const subtitleData = sectionData[subtitle];
      if (!subtitleData) return;

      // Search icons
      if (subtitleData.icons) {
        subtitleData.icons.forEach(icon => {
          if (matchesQuery(icon.title, currentSearchQuery) ||
              matchesQuery(extractDomain(icon.url), currentSearchQuery)) {
            results.icons.push({
              ...icon,
              cardTitle,
              subtitle: subtitle !== '_default' ? subtitle : null,
              sectionId: section.id,
              subtitleRaw: subtitle
            });
          }
        });
      }

      // Search reminders
      if (subtitleData.reminders) {
        subtitleData.reminders.forEach(reminder => {
          if (matchesQuery(reminder.title, currentSearchQuery) ||
              matchesQuery(extractDomain(reminder.url), currentSearchQuery)) {
            results.reminders.push({
              ...reminder,
              cardTitle,
              subtitle: subtitle !== '_default' ? subtitle : null,
              sectionId: section.id,
              subtitleRaw: subtitle
            });
          }
        });
      }

      // Search subtasks
      if (subtitleData.subtasks) {
        subtitleData.subtasks.forEach(subtask => {
          if (matchesQuery(subtask.text, currentSearchQuery) ||
              matchesQuery(extractDomain(subtask.url), currentSearchQuery)) {
            results.subtasks.push({
              ...subtask,
              cardTitle,
              subtitle: subtitle !== '_default' ? subtitle : null,
              sectionId: section.id,
              subtitleRaw: subtitle
            });
          }
        });
      }

      // Search copy-paste items
      if (subtitleData.copyPaste) {
        subtitleData.copyPaste.forEach(item => {
          if (matchesQuery(item.text, currentSearchQuery) ||
              matchesQuery(item.copyText, currentSearchQuery)) {
            results.copyPaste.push({
              ...item,
              cardTitle,
              subtitle: subtitle !== '_default' ? subtitle : null,
              sectionId: section.id,
              subtitleRaw: subtitle
            });
          }
        });
      }
    });
  });

  renderSearchResults(results);
}

function matchesQuery(text, query) {
  if (!text) return false;
  return text.toLowerCase().includes(query);
}

function renderSearchResults(results) {
  const appMain = $('.app-main');
  const totalResults = results.icons.length + results.reminders.length +
                       results.subtasks.length + results.copyPaste.length +
                       results.cardNotes.length;

  if (totalResults === 0) {
    searchResultsContainer.innerHTML = `
      <div class="search-no-results">
        <div class="search-no-results-icon">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
        </div>
        <p>No results found for "<strong>${escapeHtml(currentSearchQuery)}</strong>"</p>
      </div>
    `;
    searchResultsContainer.hidden = false;
    appMain.hidden = true;
    return;
  }

  let html = '';

  // Reminders section
  if (results.reminders.length > 0) {
    html += `<div class="search-category">
      <h3 class="search-category-header">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
          <line x1="16" y1="2" x2="16" y2="6"></line>
          <line x1="8" y1="2" x2="8" y2="6"></line>
          <line x1="3" y1="10" x2="21" y2="10"></line>
        </svg>
        Reminders <span class="search-count">${results.reminders.length}</span>
      </h3>
      <div class="search-items">
        ${results.reminders.map(r => renderSearchReminder(r)).join('')}
      </div>
    </div>`;
  }

  // Icons section
  if (results.icons.length > 0) {
    html += `<div class="search-category">
      <h3 class="search-category-header">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="7" height="7"></rect>
          <rect x="14" y="3" width="7" height="7"></rect>
          <rect x="14" y="14" width="7" height="7"></rect>
          <rect x="3" y="14" width="7" height="7"></rect>
        </svg>
        Icons <span class="search-count">${results.icons.length}</span>
      </h3>
      <div class="search-items search-items-icons">
        ${results.icons.map(i => renderSearchIcon(i)).join('')}
      </div>
    </div>`;
  }

  // Subtasks section
  if (results.subtasks.length > 0) {
    html += `<div class="search-category">
      <h3 class="search-category-header">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="8" y1="6" x2="21" y2="6"></line>
          <line x1="8" y1="12" x2="21" y2="12"></line>
          <line x1="8" y1="18" x2="21" y2="18"></line>
          <line x1="3" y1="6" x2="3.01" y2="6"></line>
          <line x1="3" y1="12" x2="3.01" y2="12"></line>
          <line x1="3" y1="18" x2="3.01" y2="18"></line>
        </svg>
        Links <span class="search-count">${results.subtasks.length}</span>
      </h3>
      <div class="search-items">
        ${results.subtasks.map(s => renderSearchSubtask(s)).join('')}
      </div>
    </div>`;
  }

  // Copy-paste section
  if (results.copyPaste.length > 0) {
    html += `<div class="search-category">
      <h3 class="search-category-header">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
        Copy-Paste <span class="search-count">${results.copyPaste.length}</span>
      </h3>
      <div class="search-items">
        ${results.copyPaste.map(c => renderSearchCopyPaste(c)).join('')}
      </div>
    </div>`;
  }

  // Card Notes section (always at the bottom)
  if (results.cardNotes.length > 0) {
    html += `<div class="search-category">
      <h3 class="search-category-header">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
          <line x1="16" y1="13" x2="8" y2="13"></line>
          <line x1="16" y1="17" x2="8" y2="17"></line>
          <polyline points="10 9 9 9 8 9"></polyline>
        </svg>
        Card Notes <span class="search-count">${results.cardNotes.length}</span>
      </h3>
      <div class="search-items">
        ${results.cardNotes.map(n => renderSearchCardNote(n)).join('')}
      </div>
    </div>`;
  }

  searchResultsContainer.innerHTML = html;
  searchResultsContainer.hidden = false;
  appMain.hidden = true;

  // Attach click handlers
  attachSearchResultHandlers();
}

function renderSearchReminder(reminder) {
  const domain = extractDomain(reminder.url);
  const locationText = reminder.subtitle ?
    `${reminder.cardTitle} › ${reminder.subtitle}` : reminder.cardTitle;

  // Add links toggle if reminder has links
  const hasLinks = reminder.links && reminder.links.length > 0;
  const linksToggle = hasLinks ?
    `<button type="button" class="search-links-toggle" data-key="${escapeAttr(reminder.key)}" data-section-id="${escapeAttr(reminder.sectionId)}" data-subtitle="${escapeAttr(reminder.subtitleRaw)}" data-type="reminder" title="${reminder.links.length} link${reminder.links.length > 1 ? 's' : ''}">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
      </svg>
    </button>` : '';

  return `
    <div class="search-item search-item-reminder${hasLinks ? ' has-links' : ''}" data-url="${escapeAttr(reminder.url || '')}">
      <div class="search-item-left">
        <div class="search-item-content">
          <span class="search-item-title">${highlightMatch(reminder.title || 'Untitled', currentSearchQuery)}</span>
          ${domain ? `<span class="search-item-domain">${highlightMatch(domain, currentSearchQuery)}</span>` : ''}
        </div>
        ${linksToggle}
      </div>
      <span class="search-item-location">${escapeHtml(locationText)}</span>
    </div>
  `;
}

function renderSearchIcon(icon) {
  const domain = extractDomain(icon.url);
  const locationText = icon.subtitle ?
    `${icon.cardTitle} › ${icon.subtitle}` : icon.cardTitle;

  // Check if icon is emoji or image
  const isEmoji = icon.icon && !icon.icon.includes('/') && !icon.icon.includes('.') &&
                  !icon.icon.startsWith('http') && !icon.icon.startsWith('data:') &&
                  icon.icon.length <= 10;

  const iconHtml = isEmoji ?
    `<span class="search-icon-emoji">${icon.icon}</span>` :
    `<img class="search-icon-img" src="${escapeAttr(icon.icon)}" alt="" />`;

  // Add links toggle if icon has links (same style as reminders/subtasks)
  const hasLinks = icon.links && icon.links.length > 0;
  const linksToggle = hasLinks ?
    `<button type="button" class="search-links-toggle" data-key="${escapeAttr(icon.key)}" data-section-id="${escapeAttr(icon.sectionId)}" data-subtitle="${escapeAttr(icon.subtitleRaw)}" data-type="icon" title="${icon.links.length} link${icon.links.length > 1 ? 's' : ''}">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
      </svg>
    </button>` : '';

  return `
    <div class="search-item search-item-icon${hasLinks ? ' has-links' : ''}" data-url="${escapeAttr(icon.url || '')}">
      <div class="search-icon-preview">${iconHtml}</div>
      <div class="search-item-content">
        <span class="search-item-title">${highlightMatch(icon.title || domain || 'Untitled', currentSearchQuery)}</span>
        ${domain && icon.title ? `<span class="search-item-domain">${highlightMatch(domain, currentSearchQuery)}</span>` : ''}
        <span class="search-item-location">${escapeHtml(locationText)}</span>
      </div>
      ${linksToggle}
    </div>
  `;
}

function renderSearchSubtask(subtask) {
  const domain = extractDomain(subtask.url);
  const locationText = subtask.subtitle ?
    `${subtask.cardTitle} › ${subtask.subtitle}` : subtask.cardTitle;

  // Add links toggle if subtask has links
  const hasLinks = subtask.links && subtask.links.length > 0;
  const linksToggle = hasLinks ?
    `<button type="button" class="search-links-toggle" data-key="${escapeAttr(subtask.key)}" data-section-id="${escapeAttr(subtask.sectionId)}" data-subtitle="${escapeAttr(subtask.subtitleRaw)}" data-type="subtask" title="${subtask.links.length} link${subtask.links.length > 1 ? 's' : ''}">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
      </svg>
    </button>` : '';

  return `
    <div class="search-item search-item-subtask${hasLinks ? ' has-links' : ''}" data-url="${escapeAttr(subtask.url || '')}">
      <div class="search-item-left">
        <div class="search-item-content">
          <span class="search-item-title">${highlightMatch(subtask.text || 'Untitled', currentSearchQuery)}</span>
          ${domain ? `<span class="search-item-domain">${highlightMatch(domain, currentSearchQuery)}</span>` : ''}
        </div>
        ${linksToggle}
      </div>
      <span class="search-item-location">${escapeHtml(locationText)}</span>
    </div>
  `;
}

function renderSearchCopyPaste(item) {
  const locationText = item.subtitle ?
    `${item.cardTitle} › ${item.subtitle}` : item.cardTitle;

  return `
    <div class="search-item search-item-copypaste" data-copy-text="${escapeAttr(item.copyText || item.text || '')}">
      <div class="search-item-content">
        <span class="search-item-title">${highlightMatch(item.text || 'Untitled', currentSearchQuery)}</span>
        <span class="search-item-preview">${escapeHtml((item.copyText || '').substring(0, 50))}${(item.copyText || '').length > 50 ? '...' : ''}</span>
      </div>
      <span class="search-item-location">${escapeHtml(locationText)}</span>
    </div>
  `;
}

function renderSearchCardNote(note) {
  // Show a preview of the content (first 80 chars), stripping HTML tags
  const plainContent = note.content ? note.content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : '';
  const contentPreview = plainContent.substring(0, 80) + (plainContent.length > 80 ? '...' : '');

  return `
    <div class="search-item search-item-cardnote" data-section-id="${escapeAttr(note.sectionId)}" data-note-key="${escapeAttr(note.key)}">
      <div class="search-item-content">
        <span class="search-item-title">${highlightMatch(note.title || 'Untitled Note', currentSearchQuery)}</span>
        <span class="search-item-preview">${highlightMatch(contentPreview, currentSearchQuery)}</span>
      </div>
      <span class="search-item-location">${escapeHtml(note.cardTitle)}</span>
    </div>
  `;
}

function highlightMatch(text, query) {
  if (!text) return '';
  const lowerText = text.toLowerCase();
  const index = lowerText.indexOf(query);
  if (index === -1) return escapeHtml(text);

  const before = text.substring(0, index);
  const match = text.substring(index, index + query.length);
  const after = text.substring(index + query.length);

  return escapeHtml(before) +
    '<mark class="search-highlight">' + escapeHtml(match) + '</mark>' +
    escapeHtml(after);
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function attachSearchResultHandlers() {
  // Handle clicks on link toggles for icons, reminders, and subtasks
  const linkToggles = searchResultsContainer.querySelectorAll('.search-links-toggle');
  linkToggles.forEach(toggle => {
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = toggle.dataset.key;
      const sectionId = toggle.dataset.sectionId;
      const subtitle = toggle.dataset.subtitle;
      const type = toggle.dataset.type;

      if (type === 'icon' && window.toggleIconLinks) {
        window.toggleIconLinks(key, subtitle, sectionId, toggle);
      } else if (type === 'reminder' && window.toggleReminderLinks) {
        window.toggleReminderLinks(key, subtitle, sectionId, toggle);
      } else if (type === 'subtask' && window.toggleListItemLinks) {
        // Look up the actual item from the data
        const data = currentData();
        const cardData = data[sectionId];
        if (cardData && cardData[subtitle] && cardData[subtitle].subtasks) {
          const item = cardData[subtitle].subtasks.find(s => s.key === key);
          if (item) {
            window.toggleListItemLinks(item, sectionId, toggle);
          }
        }
      }
    });
  });

  // Handle clicks on search items
  const items = searchResultsContainer.querySelectorAll('.search-item');
  items.forEach(item => {
    item.addEventListener('click', (e) => {
      // Don't navigate if clicking on link toggle
      if (e.target.closest('.search-links-toggle')) {
        return;
      }

      const url = item.dataset.url;
      const copyText = item.dataset.copyText;
      const sectionId = item.dataset.sectionId;

      // Handle card note clicks - open the notepad modal and the specific note viewer
      if (item.classList.contains('search-item-cardnote') && sectionId) {
        const targetSectionId = sectionId;
        const noteKey = item.dataset.noteKey;
        const searchInput = $('#dashboard-search');
        if (searchInput) {
          searchInput.value = '';
          const clearBtn = $('#search-clear');
          if (clearBtn) clearBtn.hidden = true;
        }
        clearSearch();
        // Open the notepad modal for this card, then open the specific note viewer
        setTimeout(() => {
          openNotepad(targetSectionId);
          // Open the specific note viewer on top
          if (noteKey) {
            setTimeout(() => {
              openNoteViewer(noteKey);
            }, 50);
          }
        }, 100);
        return;
      }

      if (copyText !== undefined) {
        // Copy to clipboard
        navigator.clipboard.writeText(copyText).then(() => {
          showToast('Copied to clipboard');
        }).catch(() => {
          showToast('Failed to copy');
        });
      } else if (url) {
        // Open URL
        window.open(url, '_blank');
      }
    });
  });
}

function clearSearch() {
  currentSearchQuery = '';

  const appMain = $('.app-main');
  if (appMain) appMain.hidden = false;

  if (searchResultsContainer) {
    searchResultsContainer.hidden = true;
    searchResultsContainer.innerHTML = '';
  }
}

// Export for external use
export { clearSearch };

// ===== INITIALIZATION =====

export async function init() {
  // Initialize auth state BEFORE restoreModel so scoped storage key is set correctly
  const wasLoggedIn = await initAuthOnStartup();

  await restoreModel();

  applyDarkMode();
  applyGlassMode();
  applyGlassTheme();
  applyDisplayMode();
  if (window.renderHeaderAndTitles) window.renderHeaderAndTitles();
  if (window.renderAllSections) window.renderAllSections();
  wireUI();
  wireNotepadEvents();
  wireMoveButtonEvents();
  wireAppearanceModalEvents();
  ensureSectionPlusButtons();
  refreshEditingClasses();
  initStickyNotes();
  initSearch();

  // Initialize time tracking if it was expanded
  if (model.timeTrackingExpanded) {
    const card = $('#time-tracking-card');
    if (card) {
      card.hidden = false;
      setTimeout(() => card.classList.add('active'), ANIMATION_DELAY_MS);
      renderTimers();
      // Start the update interval
      const timerInterval = getTimerInterval();
      if (timerInterval) clearInterval(timerInterval);
      setTimerInterval(setInterval(updateTimerDisplay, TIMER_UPDATE_INTERVAL_MS));
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

  // Cloud sync: reconcile with server after local render (async, non-blocking)
  if (wasLoggedIn) {
    postRestoreAuthSync();
  }
}

// ===== DISPLAY MODE =====

export function applyDisplayMode() {
  const data = currentData();
  const mode = data.displayMode || 'normal';

  if (mode === 'stacked') {
    document.body.classList.add('stacked-mode');
  } else {
    document.body.classList.remove('stacked-mode');
  }
}

export function openDisplayModeModal() {
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

  // Position below the toggle button
  const btnRect = toggleBtn.getBoundingClientRect();
  container.style.left = `${btnRect.left + btnRect.width / 2}px`;
  container.style.top = `${btnRect.bottom + 10}px`;
  container.style.bottom = 'auto';

  // Trigger animation
  requestAnimationFrame(() => {
    container.classList.add('open');
  });
}

export function closeDisplayModeModal() {
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

export function setDisplayMode(mode) {
  // Always update both model and working copy to ensure display mode persists
  // Display mode is a UI preference, not content that should be "undoable"
  model.displayMode = mode;
  if (editState.working) {
    editState.working.displayMode = mode;
  }

  // Apply the display mode to the body
  applyDisplayMode();

  // Re-render sections with the new mode's section order
  if (window.renderAllSections) window.renderAllSections();

  // Re-apply edit mode UI if active
  if (editState.enabled) {
    if (window.ensureSectionPlusButtons) window.ensureSectionPlusButtons();
    if (window.refreshEditingClasses) window.refreshEditingClasses();
  }

  // Save to localStorage
  saveModel();
}

// ===== COPY-PASTE MODAL =====

export function openCopyTextModal(item, sectionId) {
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

export function hideCopyTextModal() {
  const modal = $('#copy-text-modal');
  modal.hidden = true;
  currentCopyTextItem = null;
  currentCopyTextSection = null;
}

export function acceptCopyTextModal() {
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
  if (window.renderAllSections) window.renderAllSections();
  hideCopyTextModal();
  showToast('Copy text updated');
}

// ===== CARD COLLAPSE/EXPAND =====

export function setupCardCollapseExpand() {
  // Use event delegation on the main container
  const main = $('.app-main');
  if (!main) return;

  main.addEventListener('click', (e) => {
    // Only work when NOT in edit mode
    if (editState.enabled) return;

    // Check if there are any open link containers (reminder, list item, or icon links)
    const openLinkContainers = document.querySelectorAll('.reminder-links-expanded, .list-item-links-expanded, .icon-links-expanded');
    if (openLinkContainers.length > 0) {
      // If click is inside a link container or on a link toggle button, let it handle itself
      const isInsideLinks = e.target.closest('.reminder-links-expanded, .list-item-links-expanded, .icon-links-expanded, .reminder-links-toggle, .list-item-links-toggle, .icon-link-indicator');
      if (!isInsideLinks) {
        // Close all open link containers and prevent card collapse
        closeAllReminderLinks();
        closeAllListItemLinks();
        closeAllIconLinks();
        return;
      }
    }

    // Check if there are any open task containers (reminder or list item tasks)
    const openTaskContainers = document.querySelectorAll('.reminder-tasks-expanded');
    if (openTaskContainers.length > 0) {
      // If click is inside a task container or on a task toggle button, let it handle itself
      const isInsideTasks = e.target.closest('.reminder-tasks-expanded, .reminder-tasks-toggle, .list-item-tasks-toggle');
      if (!isInsideTasks) {
        // Close all open task containers and prevent card collapse
        closeAllReminderTasks();
        closeAllListItemTasks();
        return;
      }
    }

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

export function collapseAllCards() {
  const cards = $$('.app-main .card');
  const twoColContainers = $$('.app-main .two-col');

  cards.forEach(card => card.classList.add('collapsed'));
  twoColContainers.forEach(container => container.classList.add('collapsed'));

  cardsCollapsed = true;
}

export function expandAllCards() {
  const cards = $$('.app-main .card');
  const twoColContainers = $$('.app-main .two-col');

  cards.forEach(card => card.classList.remove('collapsed'));
  twoColContainers.forEach(container => container.classList.remove('collapsed'));

  cardsCollapsed = false;
}

// ===== HEADER AND TITLES =====

export function renderHeaderAndTitles() {
  const data = currentData();
  const logoEl = $('.company-logo');
  if (logoEl) {
    // Apply logo transform if set
    const logoZoom = data.header.companyLogoZoom || 1;
    const logoXPercent = data.header.companyLogoXPercent || 0;
    const logoYPercent = data.header.companyLogoYPercent || 0;

    const applyLogoTransformFn = () => {
      if (window.applyLogoTransform) {
        window.applyLogoTransform(logoEl, logoZoom, logoXPercent, logoYPercent);
      }
    };

    // Always set onload handler first, then set/refresh src
    logoEl.onload = applyLogoTransformFn;
    const logoRef = classifyImageRef(data.header.companyLogoSrc);
    setImageFromRef(logoEl, data.header.companyLogoSrc, 'assets/icons/placeholder-logo.svg');

    // If image is already complete (cached), manually trigger transform
    // Skip for R2 refs — transform fires via onload when async fetch completes
    if (logoRef.type !== 'r2' && logoEl.complete && logoEl.naturalWidth) {
      applyLogoTransformFn();
    }
  }
  const profileEl = $('.profile-photo');
  if (profileEl) {
    // Apply transform if set
    const zoom = data.header.profilePhotoZoom || 1;
    const xPercent = data.header.profilePhotoXPercent || 0;
    const yPercent = data.header.profilePhotoYPercent || 0;

    // Set up onload handler BEFORE setting src to ensure transform is applied
    // whether image is cached or needs to load
    const applyTransform = () => {
      if (window.applyProfilePhotoTransform) {
        window.applyProfilePhotoTransform(profileEl, zoom, xPercent, yPercent);
      }
    };

    // Always set onload handler first, then set/refresh src
    // This ensures transform is applied whether image is cached or newly loaded
    profileEl.onload = applyTransform;
    const profileRef = classifyImageRef(data.header.profilePhotoSrc);
    setImageFromRef(profileEl, data.header.profilePhotoSrc, 'assets/icons/placeholder-profile.svg');

    // If image is already complete (cached), manually trigger transform
    // Skip for R2 refs — transform fires via onload when async fetch completes
    if (profileRef.type !== 'r2' && profileEl.complete && profileEl.naturalWidth) {
      applyTransform();
    }
  }
  const nameEl = $('.profile-name');
  if (nameEl) nameEl.textContent = data.header.profileName;
  const titleEl = $('.profile-title');
  if (titleEl) titleEl.textContent = data.header.profileTitle;
  $$('.section-title').forEach(h => {
    const key = h.dataset.section;
    if (key && data.sectionTitles[key]) h.textContent = data.sectionTitles[key];
  });
}

// ===== WIRE UI =====

export function wireUI() {
  $('#edit-toggle').addEventListener('click', toggleEditMode);
  $('#appearance-toggle').addEventListener('click', openAppearanceModal);

  // Time tracking event handlers
  $('#time-tracking-toggle').addEventListener('click', toggleTimeTracking);
  $('#reset-all-timers').addEventListener('click', resetAllTimers);
  $('#add-timer-btn').addEventListener('click', addNewTimer);

  // Display mode toggle
  $('#display-mode-toggle').addEventListener('click', openDisplayModeModal);

  // Meetings toggle
  const calendarViewToggle = $('#calendar-view-toggle');
  if (calendarViewToggle) {
    calendarViewToggle.addEventListener('click', () => {
      if (window.openCalendarView) window.openCalendarView();
    });
  }

  // Wire notification badge on profile photo
  if (window.wireNotificationBadge) window.wireNotificationBadge();

  const meetingsToggle = $('#meetings-toggle');
  if (meetingsToggle) {
    meetingsToggle.addEventListener('click', openMeetingsModal);
  }

  // Tasks summary toggle (Eisenhower Matrix slide-out card)
  const tasksSummaryToggle = $('#tasks-summary-toggle');
  if (tasksSummaryToggle) {
    tasksSummaryToggle.addEventListener('click', toggleTasksSummary);
  }

  // Add task button in Eisenhower card header
  const addTaskBtn = $('#add-task-btn');
  if (addTaskBtn) {
    addTaskBtn.addEventListener('click', () => openAddTaskModal());
  }

  // Ideas button in Eisenhower card header
  const ideasBtn = $('#ideas-btn');
  if (ideasBtn) {
    ideasBtn.addEventListener('click', openIdeasModal);
  }

  // Projects button in Eisenhower card header
  const projectsBtn = $('#projects-btn');
  if (projectsBtn) {
    projectsBtn.addEventListener('click', openProjectsModal);
  }

  // Quick access event handlers
  $('#quick-access-toggle').addEventListener('click', toggleQuickAccess);
  $('#quick-links-add').addEventListener('click', openQuickLinkModal);

  // Global drag and drop event listeners
  document.addEventListener('dragover', handleDragOver);
  document.addEventListener('drop', handleDrop);

  // Close reminder and list item link bubbles when clicking outside
  document.addEventListener('click', (e) => {
    const clickedOnReminderToggle = e.target.closest('.reminder-links-toggle');
    const clickedOnListItemToggle = e.target.closest('.list-item-links-toggle');
    const clickedOnIconIndicator = e.target.closest('.icon-link-indicator');
    const clickedOnBubble = e.target.closest('.reminder-link-bubble');
    if (!clickedOnReminderToggle && !clickedOnBubble) {
      closeAllReminderLinks();
    }
    if (!clickedOnListItemToggle && !clickedOnBubble) {
      closeAllListItemLinks();
    }
    if (!clickedOnIconIndicator && !clickedOnBubble) {
      closeAllIconLinks();
    }
    // Close reminder and list item task bubbles when clicking outside
    const clickedOnReminderTasksToggle = e.target.closest('.reminder-tasks-toggle');
    const clickedOnListItemTasksToggle = e.target.closest('.list-item-tasks-toggle');
    const clickedOnTaskBubble = e.target.closest('.reminder-task-bubble');
    if (!clickedOnReminderTasksToggle && !clickedOnTaskBubble) {
      closeAllReminderTasks();
    }
    if (!clickedOnListItemTasksToggle && !clickedOnTaskBubble) {
      closeAllListItemTasks();
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

  $('#edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const copyTextarea = $('#edit-copytext');
    const copyText = copyTextarea ? copyTextarea.value : '';
    const linkTypeSelect = $('#edit-link-type');
    const linkType = linkTypeSelect ? linkTypeSelect.value : 'url';

    const payload = {
      text: $('#edit-text').value.trim(),
      url: $('#edit-url').value.trim(),
      copyText: copyText,
      chosenMedia: editState.chosenMedia || null,
      chosenEmoji: editState.chosenEmoji || null,
      linkType: linkType,
      accept: true
    };

    // Handle file upload if file type selected
    if (linkType === 'file') {
      if (editState.chosenFile) {
        const result = await uploadFile(editState.chosenFile, editState.chosenFile.name);
        if (result.ok && result.fileId) {
          payload.fileId = result.fileId;
          payload.fileName = editState.chosenFile.name;
        } else {
          showToast('File upload failed: ' + (result.error || 'Unknown error'));
          return;
        }
      } else if (editState.chosenFileId) {
        payload.fileId = editState.chosenFileId;
        payload.fileName = $('#edit-file-name')?.textContent || '';
      }
    }

    if (editState.currentTarget) editState.currentTarget.onDone(payload);
    hideEditPopover();
    if (window.renderAllSections) window.renderAllSections();
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

      // Immediate cloud save on edit confirm (async, non-blocking)
      // cloudSave automatically flushes queued R2 deletions on D1 success
      immediateCloudSave();
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
    // Discard queued R2 deletions — items are being restored
    if (window.clearPendingR2Deletions) window.clearPendingR2Deletions();
    toggleEditMode();
  });

  // Manually connect project folder (works on file:// if browser supports FS Access)
  const connectBtn = $('#connect-folder');
  connectBtn.addEventListener('click', async () => {
    const handle = await (window.selectProjectFolder ? window.selectProjectFolder() : null);
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

  // Header editable fields - Logo with image editor
  const logoContainer = $('.company-logo-container');
  if (logoContainer) {
    logoContainer.addEventListener('click', (e) => {
      if (!editState.enabled) return;
      const data = currentData();
      // Open image editor for logo
      if (window.openImageEditor) {
        // Convert stored percentages back to pixel offsets for editor (180px frame)
        const editorFrameSize = 180;
        const xPixels = (data.header.companyLogoXPercent || 0) * editorFrameSize;
        const yPixels = (data.header.companyLogoYPercent || 0) * editorFrameSize;

        // Resolve R2 ref to displayable src for the image editor
        getDisplaySrc(data.header.companyLogoSrc, 'assets/icons/placeholder-logo.svg').then(editorSrc => {
          window.openImageEditor(
            editorSrc,
            data.header.companyLogoZoom || 1,
            xPixels,
            yPixels,
            async ({ src, zoom, xPercent, yPercent }) => {
              let newSrc = src;
              // Upload to R2 if authenticated and src is a data URL
              if (isLoggedIn() && typeof src === 'string' && src.startsWith('data:') && !src.startsWith('data:image/svg')) {
                const blob = dataURLtoBlob(src);
                const fileName = filenameFromDataUrl(src, 'company-logo');
                const result = await uploadFile(blob, fileName);
                if (result.ok && result.fileId) {
                  // Queue old R2 file for cleanup (deleted after D1 save confirms)
                  const oldRef = classifyImageRef(data.header.companyLogoSrc);
                  if (oldRef.type === 'r2' && window.cleanupOrphanedR2Files) {
                    window.cleanupOrphanedR2Files([oldRef.value]);
                  }
                  newSrc = { type: 'r2', fileId: result.fileId };
                }
              }
              data.header.companyLogoSrc = newSrc;
              data.header.companyLogoZoom = zoom;
              data.header.companyLogoXPercent = xPercent;
              data.header.companyLogoYPercent = yPercent;
              markDirtyAndSave();
              renderHeaderAndTitles();
            },
            'logo'
          );
        });
      }
    });
  }

  // Use container for click to ensure it works with transformed image
  const profileContainer = $('.profile-photo-container');
  if (profileContainer) {
    profileContainer.addEventListener('click', (e) => {
      if (!editState.enabled) return;
      const data = currentData();
      // Open image editor for profile photo
      if (window.openImageEditor) {
        // Convert stored percentages back to pixel offsets for editor (180px frame)
        const editorFrameSize = 180;
        const xPixels = (data.header.profilePhotoXPercent || 0) * editorFrameSize;
        const yPixels = (data.header.profilePhotoYPercent || 0) * editorFrameSize;

        getDisplaySrc(data.header.profilePhotoSrc, 'assets/icons/placeholder-profile.svg').then(editorSrc => {
          window.openImageEditor(
            editorSrc,
            data.header.profilePhotoZoom || 1,
            xPixels,
            yPixels,
            async ({ src, zoom, xPercent, yPercent }) => {
              let newSrc = src;
              if (isLoggedIn() && typeof src === 'string' && src.startsWith('data:') && !src.startsWith('data:image/svg')) {
                const blob = dataURLtoBlob(src);
                const fileName = filenameFromDataUrl(src, 'profile-photo');
                const result = await uploadFile(blob, fileName);
                if (result.ok && result.fileId) {
                  // Queue old R2 file for cleanup (deleted after D1 save confirms)
                  const oldRef = classifyImageRef(data.header.profilePhotoSrc);
                  if (oldRef.type === 'r2' && window.cleanupOrphanedR2Files) {
                    window.cleanupOrphanedR2Files([oldRef.value]);
                  }
                  newSrc = { type: 'r2', fileId: result.fileId };
                }
              }
              data.header.profilePhotoSrc = newSrc;
              data.header.profilePhotoZoom = zoom;
              data.header.profilePhotoXPercent = xPercent;
              data.header.profilePhotoYPercent = yPercent;
              markDirtyAndSave();
              renderHeaderAndTitles();
            },
            'profile'
          );
        });
      }
    });
  }

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

  // Hook up "Choose Image..." to open media library
  $('#choose-from-library').addEventListener('click', () => {
    // Hide emoji picker if open
    $('#emoji-picker-container').hidden = true;
    openMediaLibrary((chosen) => {
      editState.chosenMedia = chosen;
      editState.chosenEmoji = null;  // Clear emoji when image is chosen
      $('#chosen-image-name').textContent = chosen.name;
    });
  });

  // Hook up "Choose Emoji" button to toggle emoji picker
  $('#choose-emoji').addEventListener('click', () => {
    const container = $('#emoji-picker-container');
    container.hidden = !container.hidden;
  });

  // Handle emoji selection from emoji picker
  const emojiPicker = document.querySelector('emoji-picker');
  if (emojiPicker) {
    emojiPicker.addEventListener('emoji-click', (event) => {
      const emoji = event.detail.unicode;
      editState.chosenEmoji = emoji;
      editState.chosenMedia = null;  // Clear image when emoji is chosen
      $('#chosen-image-name').textContent = `Emoji: ${emoji}`;
      $('#emoji-picker-container').hidden = true;
    });
  }

  // Hook up "Icon Links" button to open icon links modal
  const iconLinksBtn = $('#edit-icon-links');
  if (iconLinksBtn) {
    iconLinksBtn.addEventListener('click', () => {
      if (editState.currentIconRef && editState.currentIconSectionId && editState.currentIconSubtitle) {
        openIconLinksModal(
          editState.currentIconRef,
          editState.currentIconSectionId,
          editState.currentIconSubtitle
        );
      }
    });
  }

  // Hook up "Icon Tasks" button to open add task modal with icon pre-selected
  const iconTasksBtn = $('#edit-icon-tasks');
  if (iconTasksBtn) {
    iconTasksBtn.addEventListener('click', () => {
      if (editState.currentIconRef && editState.currentIconSectionId && editState.currentIconSubtitle) {
        if (window.openIconTasksModal) {
          window.openIconTasksModal(
            editState.currentIconRef,
            editState.currentIconSectionId,
            editState.currentIconSubtitle
          );
        }
      }
    });
  }

  // Breakdown modal event listeners
  $('#breakdown-add-row').addEventListener('click', () => {
    const currentBreakdownReminder = getCurrentBreakdownReminder();
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
    const currentBreakdownReminder = getCurrentBreakdownReminder();
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
    const currentBreakdownReminder = getCurrentBreakdownReminder();
    if (currentBreakdownReminder) {
      if (window.openBreakdownModal) window.openBreakdownModal(currentBreakdownReminder);
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

// Cleanup on page unload
window.addEventListener('pagehide', () => {
  const timerInterval = getTimerInterval();
  if (timerInterval) {
    clearInterval(timerInterval);
    clearTimerInterval();
  }
});

// When coming back online, sync any pending changes
window.addEventListener('online', () => {
  if (isLoggedIn()) {
    immediateCloudSave();
  }
});

// Run initialization when DOM is ready
document.addEventListener('DOMContentLoaded', init);
