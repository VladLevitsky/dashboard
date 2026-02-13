// Personal Dashboard - Main Entry Point (ES6 Module)
// This file bootstraps the application and imports all necessary modules

// Import core modules
import { model, editState, dragState, currentData, currentSections, ensureSectionInBothArrays, removeSectionFromBothArrays } from './state.js';
import { PLACEHOLDER_URL, icons, LINK_ICON_SVG, TASKS_ICON_SVG, TIMER_UPDATE_INTERVAL_MS, ANIMATION_DELAY_MS, CARD_HIDE_DELAY_MS, APP_VERSION, STORAGE_KEY, MEDIA_STORAGE_KEY, LINKS_FILE_PATH, MEDIA_MANIFEST_PATH } from './constants.js';
import { $, $$, openUrl, deepClone, generateKey, showToast, getColorForCurrentMode, setColorForCurrentMode, lightenAndDesaturateColor, darkenColor, convertToDarkModeColor, makeColorMoreVibrant, lightenColorBy20Percent, colorToGlassRgba, isGlassModeActive, getSectionDataKey, generateSectionId, generateUniqueCardTitle, fileToDataURL, copyToClipboard } from './utils.js';
import { saveModel, restoreModel, exportBackupFile, deepMergeModel, cleanupOldBackups } from './core/storage.js';

// Import feature modules
import {
  toggleEditMode,
  hideEditPopover,
  hideCalendarPopover,
  hideIntervalPopover,
  openEditPopover,
  applyDarkMode,
  applyGlassMode,
  applyGlassTheme,
  applyCursorShadow,
  toggleDarkMode,
  setDarkMode,
  setGlassMode,
  setGlassTheme,
  openAppearanceModal,
  closeAppearanceModal,
  acceptAppearanceChanges,
  cancelAppearanceChanges,
  wireAppearanceModalEvents,
  refreshEditingClasses,
  markDirtyAndSave,
  confirmGlobalEdit,
  cancelGlobalEdit,
  openColorPicker,
  openSubtitleColorPicker,
  openNotepad,
  closeNotepad,
  saveNote,
  enterNotepadEditMode,
  updateNotepadButtonIndicator,
  wireNotepadEvents,
  toggleSavedNotesList,
  openNoteViewer,
  closeNoteViewer,
  editNoteFromViewer,
  deleteNoteFromViewer,
  wireMoveButtonEvents
} from './features/edit-mode.js';

import {
  initializeDragHandlers,
  handleDragOver,
  handleDrop,
  initializeItemDragHandlers,
  initializeContainerDragHandlers,
  initializeReminderDragHandlers,
  removeDragHandlers,
  initializeCardDropZone
} from './features/drag-drop.js';

import {
  formatTime,
  getTimerColor,
  startTimer,
  stopTimer,
  toggleTimer,
  resetAllTimers,
  addNewTimer,
  deleteTimer,
  updateTimerDisplay,
  renderTimers,
  toggleTimeTracking,
  getTimerInterval,
  setTimerInterval,
  clearTimerInterval,
  startTimerInterval
} from './features/timers.js';

import {
  toggleQuickAccess,
  toggleSelectorMode,
  clearQuickAccess,
  openQuickLinkModal,
  removeQuickLink,
  renderQuickAccess,
  makeItemsSelectable,
  removeSelectableHandlers,
  updateSelectedItemsUI,
  extractItemData,
  isItemSelected,
  handleItemSelection,
  toggleItemQuickAccess,
  isItemInQuickAccess
} from './features/quick-access.js';

import {
  loadMediaLibrary,
  saveMediaLibrary,
  addFilesToMediaLibrary,
  persistImageFromLibraryEntry,
  loadManifestMedia,
  openMediaLibrary
} from './features/media-library.js';

import {
  extractUrlOverrides,
  downloadTextFile,
  idbOpen,
  idbGet,
  idbSet,
  verifyPermission,
  ensureProjectDirHandle,
  selectProjectFolder,
  writeTextFileToProject,
  persistUrlOverridesToFile,
  applyUrlOverrides
} from './core/import-export.js';

import {
  init,
  wireUI,
  applyDisplayMode,
  openDisplayModeModal,
  closeDisplayModeModal,
  setDisplayMode,
  openCopyTextModal,
  hideCopyTextModal,
  acceptCopyTextModal,
  setupCardCollapseExpand,
  collapseAllCards,
  expandAllCards,
  renderHeaderAndTitles
} from './core/init.js';

import {
  renderAllSections,
  createSectionElement,
  createIconButton,
  createEditableSeparator,
  createAddTile,
  openAddItemOptions,
  onAddItem,
  onAddSeparator,
  onAddSubtitle,
  renderIconGridForSection,
  renderIconRowForSection,
  renderListForSection,
  renderRemindersForSection,
  renderCopyPasteForSection,
  addCardButtons,
  toggleCardCollapse
} from './components/sections.js';

import {
  daysUntil,
  getNextOccurrence,
  classForDaysLeft,
  calculateIntervalProgress,
  getIntervalColorClass,
  formatIntervalNumber,
  openCalendarPopover,
  openIntervalPopover,
  openBreakdownModal,
  renderBreakdownRows,
  updateBreakdownSum,
  hideBreakdownModal,
  cancelBreakdownModal,
  acceptBreakdownModal,
  addBreakdownRow,
  toggleBreakdownLock,
  getCurrentBreakdownReminder,
  setCurrentBreakdownReminder
} from './features/reminders.js';

import {
  onAddCard,
  onDeleteCard,
  moveCardUp,
  moveCardDown,
  createCardAddButton,
  createCardDeleteButton,
  createCardReorderButtons,
  ensureSectionPlusButtons,
  addGapButtons,
  createGapAddButton,
  createCard
} from './features/cards.js';

import {
  openLinksModal,
  renderLinkRows,
  addLinkRow,
  cancelLinksModal,
  saveLinksModal,
  toggleReminderLinks,
  closeAllReminderLinks,
  openListItemLinksModal,
  renderListItemLinkRows,
  addListItemLinkRow,
  cancelListItemLinksModal,
  saveListItemLinksModal,
  toggleListItemLinks,
  closeAllListItemLinks,
  openIconLinksModal,
  renderIconLinkRows,
  addIconLinkRow,
  cancelIconLinksModal,
  saveIconLinksModal,
  toggleIconLinks,
  closeAllIconLinks
} from './features/links.js';

import {
  openTasksModal,
  renderTaskRows,
  addTaskRow,
  cancelTasksModal,
  saveTasksModal,
  toggleReminderTasks,
  closeAllReminderTasks,
  openListItemTasksModal,
  renderListItemTaskRows,
  addListItemTaskRow,
  cancelListItemTasksModal,
  saveListItemTasksModal,
  toggleListItemTasks,
  closeAllListItemTasks,
  openTasksSummaryModal,
  closeTasksSummaryModal
} from './features/tasks.js';

import {
  openImageEditor,
  closeImageEditor,
  applyProfilePhotoTransform,
  applyLogoTransform
} from './features/image-editor.js';

// Make key functions available globally for the transition period
// This allows app.js to still work while we gradually migrate
window.model = model;
window.editState = editState;
window.dragState = dragState;
window.currentData = currentData;
window.currentSections = currentSections;
window.ensureSectionInBothArrays = ensureSectionInBothArrays;
window.removeSectionFromBothArrays = removeSectionFromBothArrays;

// Constants
window.PLACEHOLDER_URL = PLACEHOLDER_URL;
window.icons = icons;
window.LINK_ICON_SVG = LINK_ICON_SVG;
window.TASKS_ICON_SVG = TASKS_ICON_SVG;
window.TIMER_UPDATE_INTERVAL_MS = TIMER_UPDATE_INTERVAL_MS;
window.ANIMATION_DELAY_MS = ANIMATION_DELAY_MS;
window.CARD_HIDE_DELAY_MS = CARD_HIDE_DELAY_MS;
window.APP_VERSION = APP_VERSION;
window.STORAGE_KEY = STORAGE_KEY;
window.MEDIA_STORAGE_KEY = MEDIA_STORAGE_KEY;
window.LINKS_FILE_PATH = LINKS_FILE_PATH;
window.MEDIA_MANIFEST_PATH = MEDIA_MANIFEST_PATH;

// Utilities
window.$ = $;
window.$$ = $$;
window.openUrl = openUrl;
window.deepClone = deepClone;
window.generateKey = generateKey;
window.showToast = showToast;
window.getColorForCurrentMode = getColorForCurrentMode;
window.setColorForCurrentMode = setColorForCurrentMode;
window.lightenAndDesaturateColor = lightenAndDesaturateColor;
window.darkenColor = darkenColor;
window.convertToDarkModeColor = convertToDarkModeColor;
window.lightenColorBy20Percent = lightenColorBy20Percent;
window.makeColorMoreVibrant = makeColorMoreVibrant;
window.colorToGlassRgba = colorToGlassRgba;
window.isGlassModeActive = isGlassModeActive;
window.getSectionDataKey = getSectionDataKey;
window.generateSectionId = generateSectionId;
window.generateUniqueCardTitle = generateUniqueCardTitle;
window.fileToDataURL = fileToDataURL;
window.copyToClipboard = copyToClipboard;

// Storage
window.saveModel = saveModel;
window.restoreModel = restoreModel;
window.exportBackupFile = exportBackupFile;
window.deepMergeModel = deepMergeModel;
window.cleanupOldBackups = cleanupOldBackups;

// Edit Mode
window.toggleEditMode = toggleEditMode;
window.hideEditPopover = hideEditPopover;
window.hideCalendarPopover = hideCalendarPopover;
window.hideIntervalPopover = hideIntervalPopover;
window.openEditPopover = openEditPopover;
window.applyDarkMode = applyDarkMode;
window.applyGlassMode = applyGlassMode;
window.applyGlassTheme = applyGlassTheme;
window.applyCursorShadow = applyCursorShadow;
window.toggleDarkMode = toggleDarkMode;
window.setDarkMode = setDarkMode;
window.setGlassTheme = setGlassTheme;
window.setGlassMode = setGlassMode;
window.openAppearanceModal = openAppearanceModal;
window.closeAppearanceModal = closeAppearanceModal;
window.acceptAppearanceChanges = acceptAppearanceChanges;
window.cancelAppearanceChanges = cancelAppearanceChanges;
window.wireAppearanceModalEvents = wireAppearanceModalEvents;
window.refreshEditingClasses = refreshEditingClasses;
window.markDirtyAndSave = markDirtyAndSave;
window.confirmGlobalEdit = confirmGlobalEdit;
window.cancelGlobalEdit = cancelGlobalEdit;
window.openColorPicker = openColorPicker;
window.openSubtitleColorPicker = openSubtitleColorPicker;

// Drag and Drop
window.initializeDragHandlers = initializeDragHandlers;
window.handleDragOver = handleDragOver;
window.handleDrop = handleDrop;
window.initializeItemDragHandlers = initializeItemDragHandlers;
window.initializeContainerDragHandlers = initializeContainerDragHandlers;
window.initializeReminderDragHandlers = initializeReminderDragHandlers;
window.removeDragHandlers = removeDragHandlers;
window.initializeCardDropZone = initializeCardDropZone;

// Timers
window.formatTime = formatTime;
window.getTimerColor = getTimerColor;
window.startTimer = startTimer;
window.stopTimer = stopTimer;
window.toggleTimer = toggleTimer;
window.resetAllTimers = resetAllTimers;
window.addNewTimer = addNewTimer;
window.deleteTimer = deleteTimer;
window.updateTimerDisplay = updateTimerDisplay;
window.renderTimers = renderTimers;
window.toggleTimeTracking = toggleTimeTracking;
window.getTimerInterval = getTimerInterval;
window.setTimerInterval = setTimerInterval;
window.clearTimerInterval = clearTimerInterval;
window.startTimerInterval = startTimerInterval;

// Quick Access
window.toggleQuickAccess = toggleQuickAccess;
window.toggleSelectorMode = toggleSelectorMode;
window.clearQuickAccess = clearQuickAccess;
window.openQuickLinkModal = openQuickLinkModal;
window.removeQuickLink = removeQuickLink;
window.renderQuickAccess = renderQuickAccess;
window.makeItemsSelectable = makeItemsSelectable;
window.removeSelectableHandlers = removeSelectableHandlers;
window.updateSelectedItemsUI = updateSelectedItemsUI;
window.extractItemData = extractItemData;
window.isItemSelected = isItemSelected;
window.handleItemSelection = handleItemSelection;
window.toggleItemQuickAccess = toggleItemQuickAccess;
window.isItemInQuickAccess = isItemInQuickAccess;

// Media Library
window.loadMediaLibrary = loadMediaLibrary;
window.saveMediaLibrary = saveMediaLibrary;
window.addFilesToMediaLibrary = addFilesToMediaLibrary;
window.persistImageFromLibraryEntry = persistImageFromLibraryEntry;
window.loadManifestMedia = loadManifestMedia;
window.openMediaLibrary = openMediaLibrary;

// Import/Export
window.extractUrlOverrides = extractUrlOverrides;
window.downloadTextFile = downloadTextFile;
window.idbOpen = idbOpen;
window.idbGet = idbGet;
window.idbSet = idbSet;
window.verifyPermission = verifyPermission;
window.ensureProjectDirHandle = ensureProjectDirHandle;
window.selectProjectFolder = selectProjectFolder;
window.writeTextFileToProject = writeTextFileToProject;
window.persistUrlOverridesToFile = persistUrlOverridesToFile;
window.applyUrlOverrides = applyUrlOverrides;

// Initialization
window.init = init;
window.wireUI = wireUI;
window.applyDisplayMode = applyDisplayMode;
window.openDisplayModeModal = openDisplayModeModal;
window.closeDisplayModeModal = closeDisplayModeModal;
window.setDisplayMode = setDisplayMode;
window.openCopyTextModal = openCopyTextModal;
window.hideCopyTextModal = hideCopyTextModal;
window.acceptCopyTextModal = acceptCopyTextModal;
window.setupCardCollapseExpand = setupCardCollapseExpand;
window.collapseAllCards = collapseAllCards;
window.expandAllCards = expandAllCards;
window.renderHeaderAndTitles = renderHeaderAndTitles;

// Sections Component
window.renderAllSections = renderAllSections;
window.createSectionElement = createSectionElement;
window.createIconButton = createIconButton;
window.createEditableSeparator = createEditableSeparator;
window.createAddTile = createAddTile;
window.openAddItemOptions = openAddItemOptions;
window.onAddItem = onAddItem;
window.onAddSeparator = onAddSeparator;
window.onAddSubtitle = onAddSubtitle;
window.renderIconGridForSection = renderIconGridForSection;
window.renderIconRowForSection = renderIconRowForSection;
window.renderListForSection = renderListForSection;
window.renderRemindersForSection = renderRemindersForSection;
window.renderCopyPasteForSection = renderCopyPasteForSection;
window.addCardButtons = addCardButtons;
window.toggleCardCollapse = toggleCardCollapse;

// Reminders
window.daysUntil = daysUntil;
window.getNextOccurrence = getNextOccurrence;
window.classForDaysLeft = classForDaysLeft;
window.calculateIntervalProgress = calculateIntervalProgress;
window.getIntervalColorClass = getIntervalColorClass;
window.formatIntervalNumber = formatIntervalNumber;
window.openCalendarPopover = openCalendarPopover;
window.openIntervalPopover = openIntervalPopover;
window.openBreakdownModal = openBreakdownModal;
window.renderBreakdownRows = renderBreakdownRows;
window.updateBreakdownSum = updateBreakdownSum;
window.hideBreakdownModal = hideBreakdownModal;
window.cancelBreakdownModal = cancelBreakdownModal;
window.acceptBreakdownModal = acceptBreakdownModal;
window.addBreakdownRow = addBreakdownRow;
window.toggleBreakdownLock = toggleBreakdownLock;
window.getCurrentBreakdownReminder = getCurrentBreakdownReminder;
window.setCurrentBreakdownReminder = setCurrentBreakdownReminder;

// Cards
window.onAddCard = onAddCard;
window.onDeleteCard = onDeleteCard;
window.moveCardUp = moveCardUp;
window.moveCardDown = moveCardDown;
window.createCardAddButton = createCardAddButton;
window.createCardDeleteButton = createCardDeleteButton;
window.createCardReorderButtons = createCardReorderButtons;
window.ensureSectionPlusButtons = ensureSectionPlusButtons;
window.addGapButtons = addGapButtons;
window.createGapAddButton = createGapAddButton;
window.createCard = createCard;

// Links
window.openLinksModal = openLinksModal;
window.renderLinkRows = renderLinkRows;
window.addLinkRow = addLinkRow;
window.cancelLinksModal = cancelLinksModal;
window.saveLinksModal = saveLinksModal;
window.toggleReminderLinks = toggleReminderLinks;
window.closeAllReminderLinks = closeAllReminderLinks;
window.openListItemLinksModal = openListItemLinksModal;
window.renderListItemLinkRows = renderListItemLinkRows;
window.addListItemLinkRow = addListItemLinkRow;
window.cancelListItemLinksModal = cancelListItemLinksModal;
window.saveListItemLinksModal = saveListItemLinksModal;
window.toggleListItemLinks = toggleListItemLinks;
window.closeAllListItemLinks = closeAllListItemLinks;
window.openIconLinksModal = openIconLinksModal;
window.renderIconLinkRows = renderIconLinkRows;
window.addIconLinkRow = addIconLinkRow;
window.cancelIconLinksModal = cancelIconLinksModal;
window.saveIconLinksModal = saveIconLinksModal;
window.toggleIconLinks = toggleIconLinks;
window.closeAllIconLinks = closeAllIconLinks;

// Tasks
window.openTasksModal = openTasksModal;
window.renderTaskRows = renderTaskRows;
window.addTaskRow = addTaskRow;
window.cancelTasksModal = cancelTasksModal;
window.saveTasksModal = saveTasksModal;
window.toggleReminderTasks = toggleReminderTasks;
window.closeAllReminderTasks = closeAllReminderTasks;
window.openListItemTasksModal = openListItemTasksModal;
window.renderListItemTaskRows = renderListItemTaskRows;
window.addListItemTaskRow = addListItemTaskRow;
window.cancelListItemTasksModal = cancelListItemTasksModal;
window.saveListItemTasksModal = saveListItemTasksModal;
window.toggleListItemTasks = toggleListItemTasks;
window.closeAllListItemTasks = closeAllListItemTasks;
window.openTasksSummaryModal = openTasksSummaryModal;
window.closeTasksSummaryModal = closeTasksSummaryModal;

// Image Editor
window.openImageEditor = openImageEditor;
window.closeImageEditor = closeImageEditor;
window.applyProfilePhotoTransform = applyProfilePhotoTransform;
window.applyLogoTransform = applyLogoTransform;

// Notepad
window.openNotepad = openNotepad;
window.closeNotepad = closeNotepad;
window.saveNote = saveNote;
window.enterNotepadEditMode = enterNotepadEditMode;
window.updateNotepadButtonIndicator = updateNotepadButtonIndicator;
window.wireNotepadEvents = wireNotepadEvents;
window.toggleSavedNotesList = toggleSavedNotesList;
window.openNoteViewer = openNoteViewer;
window.closeNoteViewer = closeNoteViewer;
window.editNoteFromViewer = editNoteFromViewer;
window.deleteNoteFromViewer = deleteNoteFromViewer;
window.wireMoveButtonEvents = wireMoveButtonEvents;

