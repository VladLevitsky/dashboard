// Personal Dashboard - Main Entry Point (ES6 Module)
// This file bootstraps the application and imports all necessary modules

// Import core modules
import { model, editState, dragState, currentData, currentSections, resetModel } from './state.js';
import { PLACEHOLDER_URL, icons, LINK_ICON_SVG, TASKS_ICON_SVG, TIMER_UPDATE_INTERVAL_MS, ANIMATION_DELAY_MS, CARD_HIDE_DELAY_MS, APP_VERSION, STORAGE_KEY, MEDIA_STORAGE_KEY, LINKS_FILE_PATH, MEDIA_MANIFEST_PATH, API_BASE, TURNSTILE_SITE_KEY, AUTH_TOKEN_KEY, AUTH_USERNAME_KEY, SCOPED_KEY_PREFIX, SYNC_INTERVAL_MS } from './constants.js';
import { $, $$, openUrl, deepClone, generateKey, showToast, getColorForCurrentMode, setColorForCurrentMode, lightenAndDesaturateColor, darkenColor, glassCompensateColor, makePriorityGlowColor, convertToDarkModeColor, makeColorMoreVibrant, lightenColorBy20Percent, colorToGlassRgba, isGlassModeActive, getSectionDataKey, generateSectionId, generateUniqueCardTitle, fileToDataURL, copyToClipboard } from './utils.js';
import { saveModel, restoreModel, exportBackupFile, deepMergeModel, cleanupOldBackups, migrateToGridLayout } from './core/storage.js';

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
  openReorderSubtitlesModal,
  openNotepad,
  closeNotepad,
  saveNote,
  enterNotepadEditMode,
  updateNotepadButtonIndicator,
  wireNotepadEvents,
  toggleSavedNotesList,
  openNoteViewer,
  markNoteTaskHighlightCompleted,
  removeNoteTaskHighlight,
  reconcileTaskHighlights,
  closeNoteViewer,
  editNoteFromViewer,
  deleteNoteFromViewer,
  copyNoteFromViewer,
  openNoteColorPicker,
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
  closeQuickAccess,
  toggleQuickAccess,
  openQuickLinkModal,
  removeQuickLink,
  renderQuickAccess,
  isItemSelected,
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
  updateDeviceModeToggleIcon,
  openCopyTextModal,
  hideCopyTextModal,
  acceptCopyTextModal,
  setupCardCollapseExpand,
  renderHeaderAndTitles,
  clearSearch
} from './core/init.js';

import { openCardEditModal, closeCardEditModal } from './features/card-modal.js';
import { initializeResizeHandles, removeResizeHandles, snapshotGridPositions } from './features/card-resize.js';
import { applyCellSize, initResizeObserver, autoAssignGridPositions, getCellSize, switchDeviceMode, getActiveMode, getGridCols, persistActiveLayout } from './features/grid-engine.js';

import {
  renderAllSections,
  renderUnifiedCard,
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
  calculateCalendarProgress,
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
  migrateBase64ToR2,
  openFile,
  deleteR2File,
  cleanupOrphanedR2Files,
  flushPendingR2Deletions,
  clearPendingR2Deletions,
  revokeAllBlobUrls
} from './core/file-service.js';

import {
  openCalendarView,
  closeCalendarView,
  updateNotificationBadge,
  wireNotificationBadge
} from './features/calendar.js';

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
  toggleTasksSummary,
  closeTasksSummaryModal,
  // New Eisenhower Matrix functions
  generateTaskId,
  getAllTasks,
  getTaskById,
  getTasksByColor,
  getTasksForItem,
  createTask,
  updateTask,
  deleteTask,
  moveTaskToColor,
  reorderTaskWithinColor,
  openAddTaskModal,
  openEditTaskModal,
  openItemTasksModal,
  openItemSelectorModal,
  collectLinkableItems,
  navigateToTaskSource,
  toggleIconTasks,
  closeAllIconTasks,
  openIconTasksModal,
  cleanupTasksForItem,
  toggleTaskPinned,
  completeTask,
  getCompletedTasks,
  deleteCompletedTask,
  clearCompletedTasks,
  openAddTaskModalWithCallback
} from './features/tasks.js';

import {
  openMeetingsModal,
  closeMeetingsModal
} from './features/meetings.js';

import {
  openProjectsModal,
  closeProjectsModal,
  removeProjectTaskHighlight,
  markProjectTaskHighlightCompleted,
  refreshProjectHighlights,
  removeMeetingTaskHighlight,
  markMeetingTaskHighlightCompleted,
  attachTaskMention
} from './features/projects.js';

import {
  openImageEditor,
  closeImageEditor,
  applyProfilePhotoTransform,
  applyLogoTransform
} from './features/image-editor.js';

import {
  initStickyNotes,
  updateStickyButtonVisibility,
  clearAllStickyNotes
} from './features/sticky-notes.js';

import {
  initAuth,
  isLoggedIn,
  getUsername,
  login,
  register,
  logout
} from './core/auth.js';

import {
  getActiveStorageKey,
  migrateToScopedStorage,
  markCloudDirty,
  cloudSave,
  cloudLoad,
  immediateCloudSave,
  syncOnLogin,
  startSyncTimer,
  stopSyncTimer,
  isCloudDirty
} from './core/sync.js';

import {
  renderAuthUI,
  wireAuthEvents,
  initAuthOnStartup,
  postRestoreAuthSync
} from './features/auth-ui.js';

// Make key functions available globally for the transition period
// This allows app.js to still work while we gradually migrate
window.model = model;
window.editState = editState;
window.dragState = dragState;
window.currentData = currentData;
window.currentSections = currentSections;
window.resetModel = resetModel;

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
window.glassCompensateColor = glassCompensateColor;
window.makePriorityGlowColor = makePriorityGlowColor;
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
window.migrateToGridLayout = migrateToGridLayout;

// Edit Mode
window.toggleEditMode = toggleEditMode;
window.hideEditPopover = hideEditPopover;
window.hideCalendarPopover = hideCalendarPopover;
window.hideIntervalPopover = hideIntervalPopover;
window.openEditPopover = openEditPopover;
window.applyDarkMode = applyDarkMode;
window.applyGlassMode = applyGlassMode;
window.applyGlassTheme = applyGlassTheme;
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
window.openReorderSubtitlesModal = openReorderSubtitlesModal;

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
window.closeQuickAccess = closeQuickAccess;
window.toggleQuickAccess = toggleQuickAccess;
window.openQuickLinkModal = openQuickLinkModal;
window.removeQuickLink = removeQuickLink;
window.renderQuickAccess = renderQuickAccess;
window.isItemSelected = isItemSelected;
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
window.openCopyTextModal = openCopyTextModal;
window.hideCopyTextModal = hideCopyTextModal;
window.acceptCopyTextModal = acceptCopyTextModal;
window.setupCardCollapseExpand = setupCardCollapseExpand;
window.renderHeaderAndTitles = renderHeaderAndTitles;
window.clearSearch = clearSearch;

// Card Edit Modal
window.openCardEditModal = openCardEditModal;
window.closeCardEditModal = closeCardEditModal;
window.initializeResizeHandles = initializeResizeHandles;
window.removeResizeHandles = removeResizeHandles;
window.snapshotGridPositions = snapshotGridPositions;
window.applyCellSize = applyCellSize;
window.initResizeObserver = initResizeObserver;
window.autoAssignGridPositions = autoAssignGridPositions;
window.getCellSize = getCellSize;
window.switchDeviceMode = switchDeviceMode;
window.getActiveMode = getActiveMode;
window.updateDeviceModeToggleIcon = updateDeviceModeToggleIcon;
window.getGridCols = getGridCols;
window.persistActiveLayout = persistActiveLayout;

// Sections Component
window.renderAllSections = renderAllSections;
window.renderUnifiedCard = renderUnifiedCard;
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
window.calculateCalendarProgress = calculateCalendarProgress;
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
window.toggleTasksSummary = toggleTasksSummary;
window.closeTasksSummaryModal = closeTasksSummaryModal;
// Eisenhower Matrix task functions
window.generateTaskId = generateTaskId;
window.getAllTasks = getAllTasks;
window.getTaskById = getTaskById;
window.getTasksByColor = getTasksByColor;
window.getTasksForItem = getTasksForItem;
window.createTask = createTask;
window.updateTask = updateTask;
window.deleteTask = deleteTask;
window.moveTaskToColor = moveTaskToColor;
window.reorderTaskWithinColor = reorderTaskWithinColor;
window.openAddTaskModal = openAddTaskModal;
window.openEditTaskModal = openEditTaskModal;
window.openItemTasksModal = openItemTasksModal;
window.openItemSelectorModal = openItemSelectorModal;
window.collectLinkableItems = collectLinkableItems;
window.navigateToTaskSource = navigateToTaskSource;
window.toggleIconTasks = toggleIconTasks;
window.closeAllIconTasks = closeAllIconTasks;
window.openIconTasksModal = openIconTasksModal;
window.cleanupTasksForItem = cleanupTasksForItem;
window.toggleTaskPinned = toggleTaskPinned;
window.completeTask = completeTask;
window.getCompletedTasks = getCompletedTasks;
window.deleteCompletedTask = deleteCompletedTask;
window.clearCompletedTasks = clearCompletedTasks;
window.openAddTaskModalWithCallback = openAddTaskModalWithCallback;

// Projects
window.openProjectsModal = openProjectsModal;
window.closeProjectsModal = closeProjectsModal;
window.removeProjectTaskHighlight = removeProjectTaskHighlight;
window.markProjectTaskHighlightCompleted = markProjectTaskHighlightCompleted;
window.refreshProjectHighlights = refreshProjectHighlights;
window.removeMeetingTaskHighlight = removeMeetingTaskHighlight;
window.markMeetingTaskHighlightCompleted = markMeetingTaskHighlightCompleted;
window.attachTaskMention = attachTaskMention;

// Calendar
window.openCalendarView = openCalendarView;
window.closeCalendarView = closeCalendarView;
window.migrateBase64ToR2 = migrateBase64ToR2;
window.openFile = openFile;
window.revokeAllBlobUrls = revokeAllBlobUrls;
window.deleteR2File = deleteR2File;
window.cleanupOrphanedR2Files = cleanupOrphanedR2Files;
window.flushPendingR2Deletions = flushPendingR2Deletions;
window.clearPendingR2Deletions = clearPendingR2Deletions;
window.updateNotificationBadge = updateNotificationBadge;
window.wireNotificationBadge = wireNotificationBadge;

// Meetings
window.openMeetingsModal = openMeetingsModal;
window.closeMeetingsModal = closeMeetingsModal;

// Image Editor
window.openImageEditor = openImageEditor;
window.closeImageEditor = closeImageEditor;
window.applyProfilePhotoTransform = applyProfilePhotoTransform;
window.applyLogoTransform = applyLogoTransform;

// Sticky Notes
window.initStickyNotes = initStickyNotes;
window.updateStickyButtonVisibility = updateStickyButtonVisibility;
window.clearAllStickyNotes = clearAllStickyNotes;

// Auth
window.initAuth = initAuth;
window.isLoggedIn = isLoggedIn;
window.getUsername = getUsername;
window.login = login;
window.register = register;
window.logout = logout;

// Cloud Sync
window.getActiveStorageKey = getActiveStorageKey;
window.migrateToScopedStorage = migrateToScopedStorage;
window.markCloudDirty = markCloudDirty;
window.cloudSave = cloudSave;
window.cloudLoad = cloudLoad;
window.immediateCloudSave = immediateCloudSave;
window.syncOnLogin = syncOnLogin;
window.startSyncTimer = startSyncTimer;
window.stopSyncTimer = stopSyncTimer;
window.isCloudDirty = isCloudDirty;

// Auth UI
window.renderAuthUI = renderAuthUI;
window.wireAuthEvents = wireAuthEvents;
window.initAuthOnStartup = initAuthOnStartup;
window.postRestoreAuthSync = postRestoreAuthSync;

// Notepad
window.openNotepad = openNotepad;
window.closeNotepad = closeNotepad;
window.saveNote = saveNote;
window.enterNotepadEditMode = enterNotepadEditMode;
window.updateNotepadButtonIndicator = updateNotepadButtonIndicator;
window.wireNotepadEvents = wireNotepadEvents;
window.toggleSavedNotesList = toggleSavedNotesList;
window.markNoteTaskHighlightCompleted = markNoteTaskHighlightCompleted;
window.removeNoteTaskHighlight = removeNoteTaskHighlight;
window.reconcileTaskHighlights = reconcileTaskHighlights;
window.openNoteViewer = openNoteViewer;
window.closeNoteViewer = closeNoteViewer;
window.editNoteFromViewer = editNoteFromViewer;
window.deleteNoteFromViewer = deleteNoteFromViewer;
window.copyNoteFromViewer = copyNoteFromViewer;
window.openNoteColorPicker = openNoteColorPicker;
window.wireMoveButtonEvents = wireMoveButtonEvents;

