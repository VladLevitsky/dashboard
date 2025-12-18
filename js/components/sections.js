// Personal Dashboard - Sections Component
// Handles all section rendering (icons, lists, reminders, copy-paste)

import { editState, currentData, currentSections } from '../state.js';
import { $, $$, openUrl, generateKey, getSectionDataKey, getColorForCurrentMode, darkenColor, lightenAndDesaturateColor } from '../utils.js';
import { PLACEHOLDER_URL, icons, LINK_ICON_SVG } from '../constants.js';
import { markDirtyAndSave, openEditPopover, openSubtitleColorPicker } from '../features/edit-mode.js';
import { initializeDragHandlers, initializeItemDragHandlers, initializeContainerDragHandlers, initializeReminderDragHandlers, handleDragOver, handleDrop } from '../features/drag-drop.js';
import { createCardDeleteButton, createCardReorderButtons, createTwoColReorderButtons } from '../features/cards.js';
import { persistImageFromLibraryEntry } from '../features/media-library.js';

// --- Render all sections
export function renderAllSections() {
  // Preserve scroll position before re-rendering
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;

  const data = currentData();
  const sections = currentSections();
  const main = $('.app-main');

  // Clear existing sections (except header)
  const existingSections = main.querySelectorAll('section.card');
  existingSections.forEach(section => section.remove());

  // Clear existing two-col containers
  const existingTwoCol = main.querySelectorAll('.two-col');
  existingTwoCol.forEach(container => container.remove());

  // Render sections based on the sections array
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

      const sectionEl1 = createSectionElement(section);
      if (sectionEl1) twoColContainer.appendChild(sectionEl1);

      const sectionEl2 = createSectionElement(nextSection);
      if (sectionEl2) twoColContainer.appendChild(sectionEl2);

      main.appendChild(twoColContainer);
      i += 2;
    }
    // Special case for dailyTasks and dailyTools (legacy behavior)
    else if (!section.twoColumnPair && !nextSection?.twoColumnPair &&
             section.type === 'dailyTasks' && nextSection?.type === 'dailyTools') {
      const twoColContainer = document.createElement('div');
      twoColContainer.className = 'two-col';

      const sectionEl1 = createSectionElement(section);
      if (sectionEl1) twoColContainer.appendChild(sectionEl1);

      const sectionEl2 = createSectionElement(nextSection);
      if (sectionEl2) twoColContainer.appendChild(sectionEl2);

      main.appendChild(twoColContainer);
      i += 2;
    } else {
      // Single section
      const sectionEl = createSectionElement(section);
      if (sectionEl) main.appendChild(sectionEl);
      i += 1;
    }
  }

  // Add edit mode buttons if needed
  if (editState.enabled) {
    addCardButtons();
  } else {
    const existingGapButtons = main.querySelectorAll('.gap-add-btn');
    existingGapButtons.forEach(btn => btn.remove());
  }

  // Restore scroll position after re-rendering
  window.scrollTo(scrollX, scrollY);
}

// --- Create a section element based on section configuration
export function createSectionElement(section) {
  const data = currentData();

  const sectionEl = document.createElement('section');
  sectionEl.className = 'card';
  sectionEl.id = section.id;

  // Apply initial size class for new cards
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
        section.title = text;
        data.sectionTitles[section.id] = text;
        titleEl.textContent = text;
        markDirtyAndSave();
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
          if (image) iconImg.src = image;
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

// --- Create icon button
export function createIconButton(item, section) {
  const btn = document.createElement('button');
  btn.className = 'icon-button editable';
  btn.dataset.type = section;
  btn.dataset.key = item.key;
  btn.title = item.title || '';

  const img = document.createElement('img');
  img.src = item.icon;
  img.alt = item.key;
  btn.appendChild(img);

  btn.addEventListener('click', () => {
    if (!editState.enabled) {
      openUrl(item.url);
    } else {
      openEditPopover(btn, { hideText: true, url: item.url, allowImage: true, allowDelete: true }, async ({ text, url, chosenMedia, delete: doDelete, accept }) => {
        if (!accept) return;
        if (doDelete) {
          const collection = currentData()[section];
          const idx = collection.findIndex(i => i.key === item.key);
          if (idx !== -1) collection.splice(idx, 1);
          markDirtyAndSave();
          renderAllSections();
          return;
        }
        item.url = url || PLACEHOLDER_URL;
        if (chosenMedia) item.icon = persistImageFromLibraryEntry(chosenMedia);
        markDirtyAndSave();
        renderAllSections();
      });
    }
  });

  if (editState.enabled) {
    initializeItemDragHandlers(btn, item.key, section);
  }

  return btn;
}

// --- Create editable separator
export function createEditableSeparator(item, section) {
  const separatorEl = document.createElement('img');
  separatorEl.src = item.icon;
  separatorEl.alt = 'divider';
  separatorEl.className = 'icon-separator icon-separator--wide';

  if (editState.enabled) {
    separatorEl.classList.add('editable');
    separatorEl.dataset.type = section;
    separatorEl.dataset.key = item.key;
    separatorEl.style.cursor = 'pointer';
    separatorEl.title = 'Click to edit separator';

    separatorEl.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openEditPopover(separatorEl, {
        hideText: true,
        hideUrl: true,
        allowImage: false,
        allowDelete: true,
        isSeparator: true
      }, async ({ url, chosenMedia, delete: doDelete, accept }) => {
        if (!accept) return;
        if (doDelete) {
          const collection = currentData()[section];
          const idx = collection.findIndex(i => i.key === item.key);
          if (idx !== -1) collection.splice(idx, 1);
          markDirtyAndSave();
          renderAllSections();
          return;
        }
        if (chosenMedia) {
          item.icon = persistImageFromLibraryEntry(chosenMedia);
          separatorEl.src = item.icon;
        }
        markDirtyAndSave();
      });
    });
  }

  return separatorEl;
}

// --- Create add tile
export function createAddTile(sectionKey) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'icon-add-tile';
  el.textContent = '+';
  el.title = 'Add item';
  el.addEventListener('click', (event) => {
    event.preventDefault();
    openAddItemOptions(sectionKey, event);
  });
  return el;
}

// --- Open add item options popover
export function openAddItemOptions(sectionKey, event) {
  const clickX = event ? event.clientX : window.innerWidth / 2;
  const clickY = event ? event.clientY : window.innerHeight / 2;

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

  let separatorIcon;
  if (sectionKey === 'contentCreation') {
    separatorIcon = icons.Content_creation_divider;
  } else if (sectionKey === 'ads') {
    separatorIcon = icons.Ads_divider;
  } else {
    separatorIcon = icons.Content_creation_divider;
  }

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

  popover.querySelector('#add-item-btn').addEventListener('click', (e) => {
    e.preventDefault();
    document.body.removeChild(popover);
    onAddItem(sectionKey);
  });

  const separatorBtn = popover.querySelector('#add-separator-btn');
  if (separatorBtn) {
    separatorBtn.addEventListener('click', (e) => {
      e.preventDefault();
      document.body.removeChild(popover);
      onAddSeparator(sectionKey);
    });
  }

  popover.querySelector('#cancel-btn').addEventListener('click', (e) => {
    e.preventDefault();
    document.body.removeChild(popover);
  });

  // Close on outside click
  const closeOnOutside = (e) => {
    if (!popover.contains(e.target)) {
      document.body.removeChild(popover);
      document.removeEventListener('click', closeOnOutside);
    }
  };
  setTimeout(() => document.addEventListener('click', closeOnOutside), 0);
}

// --- Add item to section
export function onAddItem(sectionKey, subtitle = null) {
  const data = currentData();

  if (['dailyTasks', 'dailyTools', 'contentCreation', 'ads'].includes(sectionKey)) {
    const collection = data[sectionKey];
    const key = generateKey('item', collection);
    collection.push({ key, icon: 'assets/logos/Tools_1.svg', url: PLACEHOLDER_URL, title: '' });
    markDirtyAndSave();
    renderAllSections();
  } else if (['analytics', 'tools'].includes(sectionKey)) {
    const collection = data[sectionKey];
    const key = generateKey('link', collection);
    collection.push({ key, text: 'New Link', url: PLACEHOLDER_URL });
    markDirtyAndSave();
    renderAllSections();
  } else if (sectionKey === 'reminders' || (data.sections.find(s => s.id === sectionKey) && data.sections.find(s => s.id === sectionKey).type === 'reminders')) {
    let remindersData;
    if (sectionKey === 'reminders') {
      remindersData = data.reminders;
    } else {
      remindersData = data[sectionKey];
    }

    if (!remindersData || typeof remindersData !== 'object') {
      remindersData = {};
      if (sectionKey === 'reminders') {
        data.reminders = remindersData;
      } else {
        data[sectionKey] = remindersData;
      }
    }

    if (!subtitle) {
      const subtitles = Object.keys(remindersData);
      if (subtitles.length === 0) {
        remindersData['General'] = [];
        subtitle = 'General';
      } else {
        subtitle = subtitles[0];
      }
    }

    if (!remindersData[subtitle]) {
      remindersData[subtitle] = [];
    } else if (!Array.isArray(remindersData[subtitle])) {
      remindersData[subtitle] = [];
    }

    const collection = remindersData[subtitle];
    const key = generateKey('reminder', collection);
    collection.push({
      key,
      title: 'New Reminder',
      url: PLACEHOLDER_URL,
      schedule: null,
      type: 'days'
    });
    markDirtyAndSave();
    renderAllSections();
  } else {
    const section = data.sections.find(s => s.id === sectionKey);

    if (section && section.type === 'copyPaste') {
      const copyPasteData = data[sectionKey] || {};
      if (typeof copyPasteData !== 'object' || Array.isArray(copyPasteData)) {
        data[sectionKey] = {};
      }

      if (!subtitle) {
        const subtitles = Object.keys(data[sectionKey]);
        if (subtitles.length === 0) {
          data[sectionKey]['General'] = [];
          subtitle = 'General';
        } else {
          subtitle = subtitles[0];
        }
      }

      if (!data[sectionKey][subtitle]) {
        data[sectionKey][subtitle] = [];
      }

      const collection = data[sectionKey][subtitle];
      const key = generateKey('copy', collection);
      collection.push({ key, text: 'New Item', copyText: '' });
      renderAllSections();
    } else {
      const collection = data[sectionKey] || [];
      const key = generateKey('link', collection);

      if (section && section.type === 'newCard') {
        collection.push({ key, title: 'New Item', url: PLACEHOLDER_URL, icon: 'assets/icons/UI_wrench.svg' });
      } else if (section && section.type === 'newCardAnalytics') {
        collection.push({ key, text: 'New Link', url: PLACEHOLDER_URL });
      } else {
        collection.push({ key, text: 'New Link', url: PLACEHOLDER_URL });
      }
      renderAllSections();
    }
  }
}

// --- Add separator to section
export function onAddSeparator(sectionKey) {
  const data = currentData();
  const collection = data[sectionKey];
  if (!collection) return;

  const key = generateKey('sep', collection);
  let separatorIcon;
  if (sectionKey === 'contentCreation') {
    separatorIcon = icons.Content_creation_divider;
  } else if (sectionKey === 'ads') {
    separatorIcon = icons.Ads_divider;
  } else {
    separatorIcon = icons.Content_creation_divider;
  }

  collection.push({
    key,
    isDivider: true,
    icon: separatorIcon
  });

  markDirtyAndSave();
  renderAllSections();
}

// --- Add subtitle
export function onAddSubtitle(sectionId = null) {
  const data = currentData();

  // Determine which data object to modify
  let targetData;
  let sectionType = 'reminders';

  if (sectionId === 'reminders' || sectionId === null) {
    targetData = data.reminders;
    sectionId = 'reminders';
  } else {
    const section = data.sections.find(s => s.id === sectionId);
    if (section) {
      sectionType = section.type;
      targetData = data[sectionId];
    } else {
      return;
    }
  }

  if (!targetData || typeof targetData !== 'object') {
    targetData = {};
    if (sectionId === 'reminders') {
      data.reminders = targetData;
    } else {
      data[sectionId] = targetData;
    }
  }

  // Generate unique subtitle name
  let subtitleNum = 1;
  let newSubtitle = 'New Section';
  while (targetData[newSubtitle]) {
    subtitleNum++;
    newSubtitle = `New Section ${subtitleNum}`;
  }

  targetData[newSubtitle] = [];
  markDirtyAndSave();
  renderAllSections();
}

// --- Render icon grid for a section
export function renderIconGridForSection(sectionEl, sectionType) {
  const data = currentData();
  const grid = sectionEl.querySelector('.icon-grid');
  if (!grid) return;

  grid.innerHTML = '';
  const dataKey = getSectionDataKey(sectionType);
  const items = data[dataKey] || [];

  items.forEach(item => {
    grid.appendChild(createIconButton(item, dataKey));
  });

  if (editState.enabled) {
    grid.appendChild(createAddTile(dataKey));
    initializeContainerDragHandlers(grid, dataKey);
  }

  // Apply dynamic sizing
  if (['dailyTasks', 'dailyTools', 'newCard'].includes(dataKey) || sectionType.startsWith('new-card-')) {
    const totalItems = items.length + (editState.enabled ? 1 : 0);
    sectionEl.classList.remove('card-size-small', 'card-size-medium', 'card-size-large', 'card-size-full');

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

// --- Render icon row for a section
export function renderIconRowForSection(sectionEl, sectionType) {
  const data = currentData();
  const row = sectionEl.querySelector('.icon-row');
  if (!row) return;

  row.innerHTML = '';
  const dataKey = getSectionDataKey(sectionType);
  const items = data[dataKey] || [];

  items.forEach(item => {
    if (item.isDivider) {
      row.appendChild(createEditableSeparator(item, dataKey));
    } else {
      row.appendChild(createIconButton(item, dataKey));
    }
  });

  if (editState.enabled) {
    row.appendChild(createAddTile(dataKey));
    initializeContainerDragHandlers(row, dataKey);
  }
}

// --- Render list for a section
export function renderListForSection(sectionEl, sectionId, isTools) {
  const data = currentData();
  const list = sectionEl.querySelector('.list-links');
  if (!list) return;

  list.innerHTML = '';
  const dataKey = getSectionDataKey(sectionId);
  const items = data[dataKey] || [];

  items.forEach(item => {
    const div = document.createElement('div');
    div.className = `list-item ${isTools ? 'tools' : ''} editable`;
    div.dataset.type = sectionId;
    div.dataset.key = item.key;

    // Apply custom color if set
    if (data.sectionColors && data.sectionColors[sectionId]) {
      const defaultColorLight = isTools ? '#e6fff3' : '#fff4e5';
      const defaultColorDark = isTools ? '#1e3a3a' : '#334155';
      const effectiveColor = getColorForCurrentMode(data.sectionColors[sectionId], defaultColorLight, defaultColorDark);
      div.style.background = effectiveColor;
      div.style.borderColor = darkenColor(effectiveColor);
    }

    const a = document.createElement('a');
    a.href = item.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = item.text;

    if (editState.enabled) {
      const contentWrapper = document.createElement('div');
      contentWrapper.className = 'list-item-content';
      contentWrapper.appendChild(a);

      const linksBtn = document.createElement('button');
      linksBtn.type = 'button';
      linksBtn.className = 'list-item-links-btn';
      linksBtn.innerHTML = LINK_ICON_SVG;
      linksBtn.title = 'Manage links';
      linksBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        // openListItemLinksModal will be called from app.js
        if (window.openListItemLinksModal) {
          window.openListItemLinksModal(item, sectionId);
        }
      });

      div.appendChild(contentWrapper);
      div.appendChild(linksBtn);
    } else {
      a.style.pointerEvents = 'none';
      div.style.cursor = 'pointer';
      div.dataset.url = item.url;

      const leftContainer = document.createElement('div');
      leftContainer.className = 'list-item-left-container';
      leftContainer.appendChild(a);

      if (item.links && item.links.length > 0) {
        const linksToggleBtn = document.createElement('button');
        linksToggleBtn.type = 'button';
        linksToggleBtn.className = 'list-item-links-toggle';
        linksToggleBtn.innerHTML = LINK_ICON_SVG;
        linksToggleBtn.title = `${item.links.length} link${item.links.length > 1 ? 's' : ''}`;
        linksToggleBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          if (window.toggleListItemLinks) {
            window.toggleListItemLinks(item, sectionId, linksToggleBtn);
          }
        });
        leftContainer.appendChild(linksToggleBtn);
      }

      div.appendChild(leftContainer);
    }

    div.addEventListener('click', (e) => {
      if (!editState.enabled) {
        if (e.target.closest('.list-item-links-toggle')) return;
        e.preventDefault();
        const url = div.dataset.url;
        if (url && url !== PLACEHOLDER_URL) {
          window.open(url, '_blank', 'noopener,noreferrer');
        }
        return;
      }
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

    if (data.sectionColors && data.sectionColors[sectionId]) {
      const defaultColorLight = isTools ? '#e6fff3' : '#fff4e5';
      const defaultColorDark = isTools ? '#1e3a3a' : '#334155';
      const baseColor = getColorForCurrentMode(data.sectionColors[sectionId], defaultColorLight, defaultColorDark);
      const lighterColor = lightenAndDesaturateColor(baseColor);
      add.style.background = lighterColor;
      add.style.borderColor = darkenColor(lighterColor);
    }

    add.addEventListener('click', (e) => {
      e.preventDefault();
      onAddItem(sectionId);
    });
    list.appendChild(add);
    initializeContainerDragHandlers(list, dataKey);
  }
}

// --- Render reminders for a section
export function renderRemindersForSection(sectionEl) {
  const data = currentData();
  const remindersList = sectionEl.querySelector('#reminders-list');
  if (!remindersList) return;

  remindersList.innerHTML = '';
  const sectionId = sectionEl.id;

  let remindersData;
  if (sectionId === 'reminders') {
    remindersData = data.reminders;
  } else {
    remindersData = data[sectionId];
  }

  if (!remindersData || typeof remindersData !== 'object') return;

  Object.entries(remindersData).forEach(([subtitle, reminders]) => {
    if (!Array.isArray(reminders)) {
      remindersData[subtitle] = [];
      reminders = remindersData[subtitle];
    }

    // Create subtitle wrapper
    const subtitleWrapper = document.createElement('div');
    subtitleWrapper.className = 'reminder-subtitle-wrapper';

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
          const currentRemindersData = sectionId === 'reminders' ? currentData().reminders : currentData()[sectionId];

          if (doDelete) {
            delete currentRemindersData[subtitle];
            if (data.subtitleColors) {
              delete data.subtitleColors[`${sectionId}:${subtitle}`];
            }
            markDirtyAndSave();
            renderAllSections();
            return;
          }
          if (text && text !== subtitle) {
            currentRemindersData[text] = currentRemindersData[subtitle];
            delete currentRemindersData[subtitle];
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

    // Create container for this subtitle's items
    const subtitleContainer = document.createElement('div');
    subtitleContainer.className = 'reminder-subtitle-container';
    subtitleContainer.dataset.subtitle = subtitle;

    const colorKey = `${sectionId}:${subtitle}`;
    const subtitleColor = data.subtitleColors && data.subtitleColors[colorKey];

    reminders.forEach(rem => {
      const div = document.createElement('div');
      div.className = 'reminder-item editable';
      div.dataset.type = 'reminders';
      div.dataset.key = rem.key;
      div.dataset.subtitle = subtitle;
      div.dataset.section = sectionId;

      if (subtitleColor) {
        const defaultColorLight = '#f7fafc';
        const defaultColorDark = '#334155';
        const effectiveColor = getColorForCurrentMode(subtitleColor, defaultColorLight, defaultColorDark);
        div.style.background = effectiveColor;
        div.style.borderColor = darkenColor(effectiveColor);
        div.dataset.customColor = JSON.stringify(subtitleColor);
      }

      const a = document.createElement('a');
      a.href = rem.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.className = 'reminder-title';
      a.textContent = rem.title;

      if (!editState.enabled) {
        a.style.pointerEvents = 'none';
        div.style.cursor = 'pointer';
        div.dataset.url = rem.url;
      }

      div.appendChild(a);

      const badge = document.createElement('span');
      badge.className = 'days-badge';

      // Calculate badge display - delegate to app.js helper functions
      if (rem.type === 'interval') {
        if (window.calculateIntervalProgress && window.formatIntervalNumber && window.getIntervalColorClass) {
          const progress = window.calculateIntervalProgress(rem);
          const formattedNumber = window.formatIntervalNumber(progress.progress, rem.intervalUnit || 'none');
          const typeText = (rem.intervalType || 'limit') === 'goal' ? 'Before goal' : 'Before limit';
          badge.textContent = `${typeText}: ${formattedNumber}`;
          badge.classList.add(window.getIntervalColorClass(progress.percentage, rem.intervalType || 'limit'));
        }
      } else {
        if (rem.schedule && window.getNextOccurrence && window.daysUntil && window.classForDaysLeft) {
          try {
            const next = window.getNextOccurrence(rem.schedule);
            if (!next || !(next instanceof Date) || isNaN(next.getTime())) {
              badge.textContent = 'Not scheduled';
            } else {
              const days = window.daysUntil(next);
              badge.textContent = days === 0 ? 'Today' : `${days} day${days === 1 ? '' : 's'} left`;
              badge.classList.add(window.classForDaysLeft(days));
            }
          } catch (error) {
            badge.textContent = 'Error';
            badge.classList.add('days-danger');
          }
        } else {
          badge.textContent = 'Not scheduled';
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
          if (window.openCalendarPopover) {
            window.openCalendarPopover(rem, e);
          }
        });

        const hashtagBtn = document.createElement('button');
        hashtagBtn.className = 'hashtag-btn';
        hashtagBtn.textContent = '#';
        hashtagBtn.title = rem.type === 'interval' ? 'Edit interval settings' : 'Switch to interval mode';
        hashtagBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (window.openIntervalPopover) {
            window.openIntervalPopover(rem);
          }
        });

        const linksBtn = document.createElement('button');
        linksBtn.className = 'links-btn';
        linksBtn.innerHTML = LINK_ICON_SVG;
        linksBtn.title = 'Manage links';
        linksBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          if (window.openLinksModal) {
            window.openLinksModal(rem);
          }
        });

        const rightContainer = document.createElement('div');
        rightContainer.style.cssText = 'display: flex; align-items: center; gap: 4px;';
        rightContainer.appendChild(badge);
        rightContainer.appendChild(calendarBtn);
        rightContainer.appendChild(hashtagBtn);
        rightContainer.appendChild(linksBtn);

        div.append(a, rightContainer);
      } else {
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
            if (window.toggleReminderLinks) {
              window.toggleReminderLinks(rem.key, subtitle, sectionId, linksToggleBtn);
            }
          });
          leftContainer.appendChild(linksToggleBtn);
        }

        div.append(leftContainer, badge);
      }

      div.addEventListener('click', (e) => {
        if (!editState.enabled) {
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

      if (editState.enabled) {
        initializeReminderDragHandlers(div, rem.key, subtitle, sectionEl.id);
      }

      subtitleContainer.appendChild(div);
    });

    // Add inline add tile for reminders
    if (editState.enabled) {
      const addTile = document.createElement('div');
      addTile.className = 'reminder-item add-tile';
      addTile.textContent = '+';
      addTile.title = `Add new reminder to ${subtitle}`;
      addTile.dataset.subtitle = subtitle;

      addTile.addEventListener('click', (event) => {
        event.preventDefault();
        const clickedSubtitle = event.currentTarget.dataset.subtitle;
        onAddItem(sectionEl.id, clickedSubtitle);
      });

      subtitleContainer.appendChild(addTile);
    }

    remindersList.appendChild(subtitleContainer);
  });

  // Add subtitle add tile in edit mode
  if (editState.enabled) {
    const addSubtitleTile = document.createElement('div');
    addSubtitleTile.className = 'reminder-subtitle add-tile';
    addSubtitleTile.textContent = '+ Add Subtitle';
    addSubtitleTile.title = 'Add new subtitle';

    addSubtitleTile.addEventListener('click', (e) => {
      e.preventDefault();
      onAddSubtitle(sectionEl.id);
    });

    remindersList.appendChild(addSubtitleTile);
  }
}

// --- Render copy-paste for a section
export function renderCopyPasteForSection(sectionEl, sectionId) {
  const data = currentData();
  const list = sectionEl.querySelector('.copy-paste-list');
  if (!list) return;

  list.innerHTML = '';
  const copyPasteData = data[sectionId] || {};

  Object.entries(copyPasteData).forEach(([subtitle, items]) => {
    if (!Array.isArray(items)) return;

    const subtitleWrapper = document.createElement('div');
    subtitleWrapper.className = 'reminder-subtitle-wrapper';

    const subtitleHeader = document.createElement('div');
    subtitleHeader.className = 'reminder-subtitle';
    subtitleHeader.textContent = subtitle;

    if (editState.enabled) {
      subtitleHeader.classList.add('editable');
      subtitleHeader.addEventListener('click', (e) => {
        e.stopPropagation();
        openEditPopover(subtitleHeader, { text: subtitle, hideUrl: true, allowDelete: true }, ({ text, delete: doDelete, accept }) => {
          if (!accept) return;
          if (doDelete) {
            delete copyPasteData[subtitle];
            if (data.subtitleColors) {
              delete data.subtitleColors[`${sectionId}:${subtitle}`];
            }
            renderAllSections();
            return;
          }
          if (text && text !== subtitle) {
            copyPasteData[text] = copyPasteData[subtitle];
            delete copyPasteData[subtitle];
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

    const subtitleContainer = document.createElement('div');
    subtitleContainer.className = 'copy-paste-subtitle-container';
    subtitleContainer.dataset.subtitle = subtitle;

    const colorKey = `${sectionId}:${subtitle}`;
    const subtitleColor = data.subtitleColors && data.subtitleColors[colorKey];

    items.forEach(item => {
      const div = document.createElement('div');
      div.className = 'copy-paste-item editable';
      div.dataset.type = sectionId;
      div.dataset.key = item.key;
      div.dataset.subtitle = subtitle;

      if (subtitleColor) {
        const defaultColorLight = '#f7fafc';
        const defaultColorDark = '#334155';
        const effectiveColor = getColorForCurrentMode(subtitleColor, defaultColorLight, defaultColorDark);
        div.style.background = effectiveColor;
        div.style.borderColor = darkenColor(effectiveColor);
      }

      const textSpan = document.createElement('span');
      textSpan.className = 'copy-paste-text';
      textSpan.textContent = item.text;

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'copy-paste-icon';
      copyBtn.title = 'Copy to clipboard';
      copyBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>`;

      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const textToCopy = item.copyText || item.text;
        navigator.clipboard.writeText(textToCopy).then(() => {
          if (window.showToast) {
            window.showToast('Copied to clipboard!');
          }
        });
      });

      div.appendChild(textSpan);
      div.appendChild(copyBtn);

      if (editState.enabled) {
        div.addEventListener('click', (e) => {
          if (e.target.closest('.copy-paste-icon')) return;
          e.preventDefault();
          openEditPopover(div, {
            text: item.text,
            url: item.copyText || '',
            urlLabel: 'Copy Text',
            allowDelete: true
          }, ({ text, url, delete: doDelete, accept }) => {
            if (!accept) return;
            if (doDelete) {
              const idx = items.findIndex(i => i.key === item.key);
              if (idx !== -1) items.splice(idx, 1);
              markDirtyAndSave();
              renderAllSections();
              return;
            }
            item.text = text || item.text;
            item.copyText = url || '';
            markDirtyAndSave();
            renderAllSections();
          });
        });

        // Use composite key for copy-paste items (sectionId:subtitle)
        initializeItemDragHandlers(div, item.key, `${sectionId}:${subtitle}`);
      }

      subtitleContainer.appendChild(div);
    });

    // Add tile for this subtitle
    if (editState.enabled) {
      const addTile = document.createElement('div');
      addTile.className = 'copy-paste-item add-tile';
      addTile.textContent = '+';
      addTile.title = `Add new item to ${subtitle}`;
      addTile.dataset.subtitle = subtitle;

      addTile.addEventListener('click', (event) => {
        event.preventDefault();
        const clickedSubtitle = event.currentTarget.dataset.subtitle;
        onAddItem(sectionId, clickedSubtitle);
      });

      subtitleContainer.appendChild(addTile);

      // Initialize container drag handlers for copy-paste items
      initializeContainerDragHandlers(subtitleContainer, `${sectionId}:${subtitle}`);
    }

    list.appendChild(subtitleContainer);
  });

  // Add subtitle add tile
  if (editState.enabled) {
    const addSubtitleTile = document.createElement('div');
    addSubtitleTile.className = 'reminder-subtitle add-tile';
    addSubtitleTile.textContent = '+ Add Subtitle';
    addSubtitleTile.title = 'Add new subtitle';

    addSubtitleTile.addEventListener('click', (e) => {
      e.preventDefault();
      onAddSubtitle(sectionId);
    });

    list.appendChild(addSubtitleTile);
  }
}

// --- Add card buttons between sections
export function addCardButtons() {
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
      const existingColorPicker = sectionEl.querySelector('.color-picker-btn');
      if (existingColorPicker) existingColorPicker.remove();

      // Check if this card is part of a two-column pair
      const isTwoColumnPair = section.twoColumnPair;

      // Add color picker button for list-type cards (regardless of two-column pair status)
      if (['analytics', 'tools', 'newCardAnalytics'].includes(section.type)) {
        const colorPickerBtn = document.createElement('button');
        colorPickerBtn.type = 'button';
        colorPickerBtn.className = 'color-picker-btn';
        colorPickerBtn.title = 'Change bubble color';
        colorPickerBtn.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none">
            <circle cx="10" cy="10" r="9" fill="url(#colorGradient-${section.id})" stroke="currentColor" stroke-width="1"/>
            <defs>
              <linearGradient id="colorGradient-${section.id}" x1="0%" y1="0%" x2="100%" y2="100%">
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
          openColorPicker(section.id, section.type);
        });
        sectionEl.appendChild(colorPickerBtn);
      }

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

// --- Create swap button for two-column paired cards
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

// --- Swap the positions of two cards in a two-column pair
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
    if (window.ensureSectionPlusButtons) window.ensureSectionPlusButtons();
    if (window.refreshEditingClasses) window.refreshEditingClasses();
  }

  if (window.showToast) window.showToast('Cards swapped');
}

// --- Add buttons and drag handlers to two-column containers
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

// --- Initialize drag handlers for two-column container
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
    if (window.dragState) {
      window.dragState.draggedElement = container;
      window.dragState.draggedSection = firstCardId;
      window.dragState.draggedTwoCol = true;
      window.dragState.draggedSecondSection = secondCardId;
    }

    container.classList.add('dragging');

    // Create drop indicator if it doesn't exist
    if (window.dragState && !window.dragState.dropIndicator) {
      window.dragState.dropIndicator = document.createElement('div');
      window.dragState.dropIndicator.className = 'drop-indicator';
      window.dragState.dropIndicator.style.position = 'absolute';
      window.dragState.dropIndicator.style.zIndex = '1000';
      window.dragState.dropIndicator.style.pointerEvents = 'none';
      window.dragState.dropIndicator.innerHTML = '<div class="drop-line"></div>';
      document.body.appendChild(window.dragState.dropIndicator);
    }
    if (window.dragState && window.dragState.dropIndicator) {
      window.dragState.dropIndicator.style.display = 'none';
    }
  });

  container.addEventListener('dragend', (e) => {
    container.classList.remove('dragging');

    if (window.dragState) {
      if (window.dragState.dropIndicator) {
        window.dragState.dropIndicator.style.display = 'none';
      }

      window.dragState.draggedElement = null;
      window.dragState.draggedSection = null;
      window.dragState.draggedTwoCol = false;
      window.dragState.draggedSecondSection = null;
      window.dragState.potentialDropZone = null;
      window.dragState.potentialDropPosition = null;
    }
  });
}

// --- Add gap-based add buttons
function addGapButtons() {
  const main = $('.app-main');
  if (!main) return;

  // Remove existing gap buttons
  const existingGapButtons = main.querySelectorAll('.gap-add-btn');
  existingGapButtons.forEach(btn => btn.remove());

  if (!editState.enabled) return;

  // Get all direct children of main (cards and two-col containers)
  const children = Array.from(main.children).filter(
    child => child.classList.contains('card') || child.classList.contains('two-col')
  );
  const sections = currentSections();

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
    const gapBtn = document.createElement('button');
    gapBtn.type = 'button';
    gapBtn.className = 'gap-add-btn';
    gapBtn.textContent = '+';
    gapBtn.title = 'Add new card here';
    gapBtn.dataset.targetIndex = targetSectionIndex;
    gapBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (window.openCardTypePopover) window.openCardTypePopover(targetSectionIndex);
    });

    if (i === 0) {
      // First gap (before first element)
      if (children.length > 0) {
        main.insertBefore(gapBtn, children[0]);
      } else {
        main.appendChild(gapBtn);
      }
    } else if (i === children.length) {
      // Last gap (after last element)
      main.appendChild(gapBtn);
    } else {
      // Gap between elements - insert before the current child
      // We need to find the actual position accounting for previously inserted buttons
      const allChildren = Array.from(main.children);
      const targetChild = children[i];
      const targetIndex = allChildren.indexOf(targetChild);
      if (targetIndex !== -1) {
        main.insertBefore(gapBtn, targetChild);
      }
    }

    // Show the button since we're in edit mode
    gapBtn.style.display = 'flex';
  }
}
