// Personal Dashboard - Global State Management
// Central state objects that are shared across all modules

// --- Data Model
// All text + URLs live in one object to support edit mode.
// Default state is blank - users add their own content via edit mode
//
// UNIFIED CARD STRUCTURE (schemaVersion 3):
// Cards with type 'unified' store data as:
//   model[sectionId] = {
//     "SubtitleName": {
//       icons: [{ key, icon, url, title }],
//       reminders: [{ key, title, url, type, schedule?, interval?, currentNumber?, ... }],
//       subtasks: [{ key, text, url, links? }],
//       copyPaste: [{ key, text, copyText }]
//     },
//     "_default": { ... }  // Used when no subtitles
//   }
// Render order: Icons → Reminders → Subtasks → Copy-paste
//
export const model = {
  // Schema version for data migration (8 = per-device layout profiles)
  schemaVersion: 8,
  // Which device mode the flat grid props currently represent (synced)
  lastActiveMode: 'tablet',
  // Track the order and structure of sections
  // Empty by default - users add cards via the + button
  sections: [],
  timers: [
    { id: 'timer-1', title: 'Task 1', elapsed: 0, isRunning: false, lastTick: null },
    { id: 'timer-2', title: 'Task 2', elapsed: 0, isRunning: false, lastTick: null },
  ],
  timeTrackingExpanded: false,
  quickAccessExpanded: false,
  selectorModeActive: false,
  quickAccessItems: {
    icons: [],
    listItems: [],
    quickLinks: []
  },
  sectionTitles: {},
  sectionIcons: {},  // Custom icons for list-type sections (analytics, tools, etc.)
  sectionColors: {},  // Custom colors for sections (per light/dark mode)
  subtitleColors: {},  // Custom colors for subtitles within sections (per light/dark mode)
  collapsedSubtitles: {},  // Track collapsed state of subtitles: { "sectionId:subtitle": true }
  cardNotes: {},  // Notes for each card: { "sectionId": "note text" }
  collapsedCards: {},  // Track collapsed state of cards: { "sectionId": true }
  // Centralized task storage (Eisenhower Matrix)
  // Each task: { id, title, color: 'blue'|'yellow'|'orange'|'red', linkedItems: [{ type, key, sectionId, subtitle }], order }
  // (legacy `linkedItem` = single ref, mirrored to first entry of linkedItems for backward compat)
  tasks: [],
  ideas: [],
  meetings: [],
  header: {
    companyLogoSrc: 'assets/icons/placeholder-logo.svg',
    companyLogoZoom: 1,
    companyLogoXPercent: 0,
    companyLogoYPercent: 0,
    profilePhotoSrc: 'assets/icons/placeholder-profile.svg',
    profileName: 'Your Name',
    profileTitle: 'Your Title',
    // Profile photo position/zoom settings
    profilePhotoZoom: 1,      // 1.0 = 100%, 1.5 = 150%
    profilePhotoXPercent: 0,  // Position as percentage of frame
    profilePhotoYPercent: 0,
  },
  darkMode: false,
  glassMode: true,   // Glass mode is always on
  glassTheme: 'classic',  // 'classic' (grey) or 'sunset' (orange/purple gradient)
  reminders: {},

  dailyTasks: [],

  dailyTools: [],

  contentCreation: [],

  ads: [],

  analytics: [],

  tools: [],
};

// --- Edit State
export const editState = {
  enabled: false,
  currentTarget: null,
  working: null,
  dirty: false,
  projectDirHandle: null,
  chosenMedia: null,
  chosenEmoji: null,  // Emoji character chosen from emoji picker
  currentCalendarTarget: null,
  pendingR2Deletions: [],  // fileIds queued for R2 deletion during edit mode
};

// --- Drag State for card and item reordering
export const dragState = {
  draggedElement: null,
  draggedSection: null,
  dropIndicator: null,
  lastDragOverTime: 0,
  // Grid drag (card-level): ghost + snapped drop target in cell coordinates
  gridGhost: null,
  potentialDropCol: null,
  potentialDropRow: null,
  potentialDropColSpan: null,
  dragOffsetCol: 0,   // cell offset within the card where the drag was grabbed
  dragOffsetRow: 0,
  dragOriginCol: null, // card's position at dragstart (given to the partner on swap)
  dragOriginRow: null,
  swapTargetId: null,  // card the cursor is hovering inside → drop becomes a swap
  // Item-level dragging
  draggedItem: null,
  draggedItemKey: null,
  draggedItemSection: null,
  itemDropIndicator: null,
  targetSubtitle: null  // Subtitle detected during cross-card drag
};

// --- Known static keys on the model (everything else is dynamic section data)
const MODEL_STATIC_KEYS = new Set([
  'schemaVersion', 'sections', 'timers', 'lastActiveMode',
  'timeTrackingExpanded', 'quickAccessExpanded', 'selectorModeActive',
  'quickAccessItems', 'sectionTitles', 'sectionIcons',
  'sectionColors', 'subtitleColors', 'collapsedSubtitles', 'cardNotes',
  'collapsedCards', 'tasks', 'ideas', 'meetings', 'completedTasks', 'projects',
  'header', 'darkMode', 'glassMode', 'glassTheme',
  'reminders', 'dailyTasks', 'dailyTools', 'contentCreation', 'ads',
  'analytics', 'tools'
]);

// --- Reset model to clean state (removes all dynamic section data)
// Called before restoreModel to prevent data leaking between users
export function resetModel() {
  // Remove dynamic section data keys (user cards like 'new-card-1234')
  for (const key of Object.keys(model)) {
    if (!MODEL_STATIC_KEYS.has(key)) {
      delete model[key];
    }
  }
  // Reset collection properties to defaults
  model.sections = [];
  model.lastActiveMode = 'tablet';
  model.sectionTitles = {};
  model.sectionIcons = {};
  model.sectionColors = {};
  model.subtitleColors = {};
  model.collapsedSubtitles = {};
  model.cardNotes = {};
  model.collapsedCards = {};
  model.tasks = [];
  model.ideas = [];
  model.meetings = [];
  model.completedTasks = [];
  model.projects = [];
  model.quickAccessItems = { icons: [], listItems: [], quickLinks: [] };
  model.timers = [
    { id: 'timer-1', title: 'Task 1', elapsed: 0, isRunning: false, lastTick: null },
    { id: 'timer-2', title: 'Task 2', elapsed: 0, isRunning: false, lastTick: null },
  ];
  model.header = {
    companyLogoSrc: 'assets/icons/placeholder-logo.svg',
    companyLogoZoom: 1, companyLogoXPercent: 0, companyLogoYPercent: 0,
    profilePhotoSrc: 'assets/icons/placeholder-profile.svg',
    profileName: 'Your Name', profileTitle: 'Your Title',
    profilePhotoZoom: 1, profilePhotoXPercent: 0, profilePhotoYPercent: 0,
  };
}

// --- Helper to get current active data (working copy in edit mode, or main model)
export function currentData() {
  return editState.working || model;
}

// --- Helper to get sections array
export function currentSections() {
  return currentData().sections;
}
