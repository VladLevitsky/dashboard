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
  // Schema version for data migration (3 = unified card with reminders)
  schemaVersion: 3,
  // Track the order and structure of sections for normal (single-column) mode
  // Empty by default - users add cards via the + button
  sections: [],
  // Separate section order for stacked (two-column) mode - initialized from sections on first use
  sectionsStacked: null,
  timers: [
    { id: 'timer-1', title: 'Task 1', elapsed: 0, isRunning: false, lastTick: null },
    { id: 'timer-2', title: 'Task 2', elapsed: 0, isRunning: false, lastTick: null },
  ],
  timeTrackingExpanded: false,
  quickAccessExpanded: false,
  selectorModeActive: false,
  displayMode: 'normal', // 'normal' or 'stacked'
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
};

// --- Drag State for card and item reordering
export const dragState = {
  draggedElement: null,
  draggedSection: null,
  draggedTwoCol: false, // Whether dragging a two-column container
  draggedSecondSection: null, // Second card ID when dragging two-col
  dropIndicator: null,
  potentialDropZone: null,
  potentialDropPosition: null,
  lastDragOverTime: 0,
  // Item-level dragging
  draggedItem: null,
  draggedItemKey: null,
  draggedItemSection: null,
  itemDropIndicator: null
};

// --- Helper to get current active data (working copy in edit mode, or main model)
export function currentData() {
  return editState.working || model;
}

// --- Helper to get sections for current display mode
export function currentSections() {
  const data = currentData();
  const displayMode = data.displayMode || 'normal';

  if (displayMode === 'stacked') {
    // Initialize sectionsStacked from sections if not already done
    if (!data.sectionsStacked) {
      // Deep copy sections but strip twoColumnPair/pairIndex since each mode has independent layout
      data.sectionsStacked = data.sections.map(section => {
        const copy = JSON.parse(JSON.stringify(section));
        delete copy.twoColumnPair;
        delete copy.pairIndex;
        return copy;
      });
    }
    return data.sectionsStacked;
  }

  return data.sections;
}

// --- Helper to ensure a section exists in both arrays (normal and stacked)
export function ensureSectionInBothArrays(section) {
  const data = currentData();
  const displayMode = data.displayMode || 'normal';

  // Create a clean copy without layout-specific properties for the OTHER mode
  const cleanCopy = () => {
    const copy = JSON.parse(JSON.stringify(section));
    delete copy.twoColumnPair;
    delete copy.pairIndex;
    return copy;
  };

  // Add to sections (normal mode) if not exists
  if (!data.sections.find(s => s.id === section.id)) {
    // If we're in stacked mode, add clean copy to normal mode
    if (displayMode === 'stacked') {
      data.sections.push(cleanCopy());
    } else {
      // We're in normal mode, add the section as-is (it was created here)
      data.sections.push(JSON.parse(JSON.stringify(section)));
    }
  }

  // Add to sectionsStacked if it exists and section not in it
  if (data.sectionsStacked && !data.sectionsStacked.find(s => s.id === section.id)) {
    // If we're in normal mode, add clean copy to stacked mode
    if (displayMode === 'normal') {
      data.sectionsStacked.push(cleanCopy());
    } else {
      // We're in stacked mode, add the section as-is (it was created here)
      data.sectionsStacked.push(JSON.parse(JSON.stringify(section)));
    }
  }
}

// --- Helper to remove a section from both arrays
export function removeSectionFromBothArrays(sectionId) {
  const data = currentData();

  // Remove from sections (normal mode)
  data.sections = data.sections.filter(s => s.id !== sectionId);

  // Remove from sectionsStacked if it exists
  if (data.sectionsStacked) {
    data.sectionsStacked = data.sectionsStacked.filter(s => s.id !== sectionId);
  }
}
