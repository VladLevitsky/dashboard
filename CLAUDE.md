# Personal Dashboard - Documentation

## Overview
A fully customizable personal dashboard built with vanilla JavaScript, HTML5, and CSS3. No frameworks. All data persists in browser localStorage with optional JSON import/export.

**Hosting**: Public GitHub repo served via GitHub Pages (static site, client-side only)

> **SECURITY**: This is a PUBLIC repository. NEVER include API keys, credentials, private URLs, tokens, or sensitive data. User data lives in localStorage, not the repo.

---

## Architecture

### Data Model
```javascript
const model = {
  schemaVersion: 3,
  darkMode: boolean,
  glassMode: boolean,           // Glassmorphism style toggle
  glassTheme: 'classic' | 'sunset',
  glassCursorShadow: boolean,
  displayMode: 'normal' | 'stacked',
  sections: [{ id, type: 'unified', title, twoColumnPair?, pairIndex? }],
  sectionsStacked: null | Section[],  // Independent order for stacked mode

  // Card data stored by sectionId:
  [sectionId]: {
    "SubtitleName": {
      icons: [{ key, icon, url, title }],
      reminders: [{ key, title, url, type, schedule?, interval?, currentNumber?, intervalType?, intervalUnit?, breakdown?, links?, tasks? }],
      subtasks: [{ key, text, url, links?, tasks? }],
      copyPaste: [{ key, text, copyText }]
    }
  },
  sectionColors: { [sectionId]: { light, dark } },
  subtitleColors: { [sectionId:subtitle]: { light, dark } }
}

const editState = { enabled, working: null | DeepClone<model>, currentElement, currentData }
const dragState = { draggedElement, draggedSection, dropIndicator, potentialDropZone, potentialDropPosition, ... }
```

### File Structure
```
├── index.html           # Main HTML (~350 lines)
├── styles.css           # All CSS with variables (~2500 lines)
├── CLAUDE.md
├── js/
│   ├── main.js          # Entry point, exports to window.*
│   ├── state.js         # model, editState, dragState, currentData(), currentSections()
│   ├── constants.js     # STORAGE_KEY, icons, PLACEHOLDER_URL
│   ├── utils.js         # $, $$, deepClone, showToast, color utils
│   ├── core/
│   │   ├── init.js      # App bootstrap, wireUI, display mode
│   │   ├── storage.js   # localStorage, deepMergeModel, backups
│   │   └── import-export.js
│   ├── features/
│   │   ├── edit-mode.js # Toggle, popovers, color pickers
│   │   ├── drag-drop.js # Card and item reordering
│   │   ├── timers.js
│   │   ├── quick-access.js
│   │   ├── media-library.js
│   │   ├── image-editor.js  # Profile/logo positioning
│   │   ├── reminders.js     # Calendar/interval popovers, breakdown modal
│   │   ├── cards.js         # Card CRUD, type selector
│   │   ├── links.js         # Link modals
│   │   └── tasks.js         # Color-coded tasks
│   └── components/
│       └── sections.js  # Section rendering
└── assets/
```

### Storage
- **Key**: `personal_dashboard_model_v2`
- **Backups**: `personal_dashboard_backup_[timestamp]` (auto-cleaned on startup)

---

## Core Features

### Edit Mode
- Toggle via pencil button (bottom-right, 62×62px)
- Creates working copy; changes only save on confirm (✓) or discard on cancel (×)
- `currentData()` returns working copy when editing, model otherwise

### Card System (v3.0 Unified)
All cards are type `'unified'` containing any mix of:
- **Icons**: Horizontal row of clickable image buttons
- **Reminders**: Time/interval tracking with badges
- **Subtasks**: 2-column grid of text links
- **Copy-Paste**: 2-column grid, copies text on click

**Render order** within each subtitle: Icons → Reminders → Subtasks → Copy-paste

**Subtitles**: Optional grouping; `_default` used when none specified

### Reminders
**Calendar Mode** (📅): Date selection with repeat options (none, weekly 1-3 weeks, monthly)
- Badges: Green (8+ days), Yellow (3-7), Orange (1-2), Red (overdue/today)

**Interval Mode** (#): Target/current numbers with goal/limit type and unit (none, $, %)
- **Breakdown**: Grid icon opens modal; locked (#) = manual entry, unlocked (Σ) = auto-sum from rows

**Links**: Chain icon opens modal to add title+URL pairs; view mode shows expandable bubbles

**Tasks**: Workflow icon opens modal for red/yellow/green tasks; view mode allows click-to-cycle color and drag-to-reorder

### Display Modes
- **Normal**: Single-column centered
- **Stacked**: Two-column masonry grid
- Each mode maintains independent section ordering
- Toggle via monitor icon in header

### Two-Column Layout
Container for side-by-side cards with `twoColumnPair: true` and `pairIndex: 0|1`

### Dark Mode
- Toggle in bottom-left (only visible in edit mode)
- Colors stored as `{ light, dark }` objects for independent theming

### Image Editor
- **Profile**: 90×90px circle, cover fit, zoom 100-150%
- **Logo**: 216×126px rectangle, fit mode, zoom 100-300%
- `openImageEditor(src, zoom, x, y, onSave, type)` / `applyProfilePhotoTransform()` / `applyLogoTransform()`

### Import/Export
- Export: JSON file with all sections, settings, metadata
- Import: Upload JSON, confirmation before overwrite

---

## Key Functions

### Core
- `init()` - Bootstrap app
- `saveModel()` / `restoreModel()` - localStorage persistence
- `toggleEditMode()` / `confirmGlobalEdit()` / `cancelGlobalEdit()`
- `renderAllSections()` / `createSectionElement(section)`

### Edit Operations
- `openEditPopover(element, data, type)`
- `openCalendarPopover(reminder)` / `openIntervalPopover(reminder)`
- `openBreakdownModal(reminder)`
- `openLinksModal(reminder, subtitle, sectionId)` / `openListItemLinksModal(item, sectionId)`
- `openTasksModal(reminder)` / `openListItemTasksModal(item, sectionId)`
- `openColorPicker(sectionId, sectionType)` / `openSubtitleColorPicker(sectionId, subtitle)`
- `onAddCard(afterSectionId)` / `onDeleteCard(sectionId)`

### State Helpers
- `currentData()` - Get active data (working or model)
- `currentSections()` - Get sections for current display mode
- `ensureSectionInBothArrays(section)` / `removeSectionFromBothArrays(sectionId)`
- `getColorForCurrentMode(colorData, default)` / `setColorForCurrentMode(colorData, color)`

### Toggle Functions
- `toggleReminderLinks()` / `toggleListItemLinks()` / `closeAllReminderLinks()` / `closeAllListItemLinks()`
- `toggleReminderTasks()` / `toggleListItemTasks()` / `closeAllReminderTasks()` / `closeAllListItemTasks()`

---

## CSS Architecture

### Variables
```css
:root {
  --bg: #f5f6f8; --card: #ffffff; --text: #1f2937; --muted: #6b7280;
  --brand: #2c7be5; --accent: #22c55e; --danger: #ef4444; --warn: #f59e0b;
  --shadow: 0 10px 30px rgba(0,0,0,0.08); --radius: 16px;
}
[data-theme="dark"] {
  --bg: #0f172a; --card: #1e293b; --text: #f1f5f9; --muted: #94a3b8;
  --brand: #3b82f6; --accent: #10b981; --shadow: 0 10px 30px rgba(0,0,0,0.3);
}
```

### Key Classes
- `.card` / `.card.editing` - Card container
- `.fab` / `.fab-accept` / `.fab-cancel` - Floating action buttons
- `.editable` / `.add-tile` / `.gap-add-btn` - Interactive elements
- `.reminder-item` / `.days-badge` - Reminder styling
- `.reminder-links-toggle` / `.reminder-link-bubble` - Link bubbles
- `.reminder-tasks-toggle` / `.reminder-task-bubble` / `.task-bubble-red/yellow/green` - Task bubbles
- `.edit-popover` / `.calendar-popover` / `.interval-popover` / `.breakdown-modal` - Modals

### Key IDs
`#edit-toggle`, `#edit-accept-global`, `#edit-cancel-global`, `#dark-mode-toggle`, `#display-mode-toggle`, `#card-type-popover`, `#reminder-links-modal`, `#reminder-tasks-modal`

---

## Design Guidelines

### Icons
- Minimalist SVG with `stroke="currentColor"` or `fill="currentColor"`
- Consistent 2px stroke weight
- Sizes: 16-20px (buttons), 32px (cards), 48-90px (profile/logo)
- No emoji icons in UI

### Spacing
- 16px between elements, 40px between cards
- Buttons: equal spacing from edges

### User Preferences
- No visual borders in edit mode
- Edit button: 62×62px
- Dark mode toggle only in edit mode
- Add tiles show "+" only (not "+ Add")
- Auto-round decimals to whole numbers

---

## Patterns

### State Management
```javascript
// Always use currentData() for active state
const data = currentData();
// Check edit state before showing controls
if (editState.enabled) { /* show edit controls */ }
// Deep clone for working copy
editState.working = deepClone(model);
```

### Display Mode Handling
- `currentSections()` returns `sections` or `sectionsStacked` based on mode
- New sections added to BOTH arrays via `ensureSectionInBothArrays()`
- Reordering only affects current mode's array
- `setDisplayMode(mode)` updates both model and working copy

### Adding Features Checklist
1. Use minimalist SVG icons with currentColor
2. Add dark mode styles
3. Ensure data saves to model correctly
4. Only show edit controls when `editState.enabled`
5. Add confirmation for destructive actions
6. Show toast feedback for actions
7. Use two-layer saves for complex operations

---

## Troubleshooting

| Issue | Check |
|-------|-------|
| Dark mode not persisting | `saveModel()` includes `darkMode`, `toggleDarkMode()` updates both model and working |
| Delete button misaligned | Parent card has `position: relative` |
| Icons not theming | SVG uses `currentColor`, parent has `color: var(--text)` |
| Changes not saving | `confirmGlobalEdit()` called (not just `saveModel()`), working copy cloned properly |
| Decimal rounding | Use `Math.round(parseFloat(value))` before save |

---

## Version History

### v3.0 (Current)
- Unified card system: icons, reminders, subtasks, copy-paste coexist
- Reminders as item type within cards (not separate card type)
- Schema version 3 with auto-migration
- Tasks feature (color-coded red/yellow/green with click-to-cycle and drag-to-reorder)
- Independent light/dark mode colors
- Display modes (normal/stacked) with independent ordering
- Full drag-drop support for cards and items
- ES6 module architecture

### v2.x
- ES6 module migration from monolithic app.js
- Independent display mode sections
- Drag-drop improvements
- Fixed color independence between light/dark modes

### v1.x
- Initial features: edit mode, reminders, dark mode, import/export
- Media library, breakdown modal
- Reminder links feature
