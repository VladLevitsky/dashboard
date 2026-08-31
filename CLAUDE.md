# Personal Dashboard - Documentation

## Overview
A fully customizable personal dashboard built with vanilla JavaScript, HTML5, and CSS3. No frameworks. Data persists in browser localStorage (fast cache) and Cloudflare D1 (durable cloud storage) with JSON import/export backup.

**Hosting**: Public GitHub repo served via GitHub Pages (static site, client-side only)
**Backend**: Cloudflare Workers (API + Viewer), D1 database, R2 file storage

> **SECURITY**: This is a PUBLIC repository. NEVER include API keys, credentials, private URLs, tokens, or sensitive data. Backend secrets live in Cloudflare Worker secrets, not the repo. See `Reference/Backend/AI_BACKEND_CONTEXT.md` for full backend architecture (gitignored).

---

## Architecture

### Data Model
```javascript
const model = {
  schemaVersion: 8,
  darkMode: boolean,
  glassMode: true,              // Always on (glass style)
  glassTheme: 'classic' | 'sunset',
  lastActiveMode: 'mobile'|'tablet'|'desktop', // which mode the flat grid props represent
  sections: [{
    id, type: 'unified', title,
    gridCol, gridRow, gridColSpan, gridRowSpan,  // ACTIVE working layout (flat props)
    layouts: { mobile?, tablet?, desktop?: { col, row, colSpan, rowSpan } }  // per-device profiles
  }],

  // Card data stored by sectionId:
  [sectionId]: {
    "SubtitleName": {
      icons: [{ key, icon, url, title, linkType?, fileId?, fileName? }],
      reminders: [{ key, title, url, type, schedule?, interval?, currentNumber?, intervalType?, intervalUnit?, breakdown?, links?, linkType?, fileId?, fileName? }],
      subtasks: [{ key, text, url, links?, linkType?, fileId?, fileName? }],
      copyPaste: [{ key, text, copyText }]
    }
  },
  sectionColors: { [sectionId]: { light, dark } },
  subtitleColors: { [sectionId:subtitle]: { light, dark } },

  // Centralized task system (Eisenhower Matrix)
  tasks: [{
    id, title, color: 'blue'|'yellow'|'orange'|'red',
    linkedItems?: [{ type: 'reminder'|'subtask'|'copyPaste'|'icon', key, sectionId, subtitle }],
    linkedItem?,  // legacy single ref, mirrored to linkedItems[0]
    link?, dueDate?, order, pinned: boolean,
    taskLinks?: [{ type: 'url', value } | { type: 'file', fileId, fileName }],
    description?, subtasks?: [{ id, title, completed, important, description?, dueDate? }],
    projectHighlight?, meetingHighlight?, noteHighlight?
  }],
  completedTasks: [{ ...task, completed: true, completedAt }],

  // Feature data
  projects: [{ id, title, content }],
  meetings: [{ id, title, type, description, links, files?: [{ fileId, fileName }], date?, repeat?, repeatWeeks?, repeatMonthlyType? }],
  ideas: [{ id, title, content }],
  cardNotes: { [sectionId]: [{ key, title, content, color? }] },
  quickAccessItems: { icons: [], listItems: [], quickLinks: [] },
  timers: [],
  header: { profilePhotoSrc, companyLogoSrc, profilePhotoZoom, ... }
}
```

### Image References
Images use explicit format objects (or legacy strings for backward compatibility):
```javascript
{ type: 'r2', fileId: '...' }        // R2-stored image (authenticated)
{ type: 'asset', src: 'assets/...' } // Built-in project asset
{ type: 'url', url: 'https://...' }  // External URL
// Legacy: 'data:image/...' (Base64), 'assets/...' (string path) — auto-migrated to R2
```

### File Structure
```
├── index.html
├── styles.css
├── CLAUDE.md
├── js/
│   ├── main.js              # Entry point, exports to window.*
│   ├── state.js             # model, editState, dragState, currentData(), currentSections()
│   ├── constants.js          # STORAGE_KEY, API_BASE, TURNSTILE_SITE_KEY, etc.
│   ├── utils.js             # $, $$, deepClone, showToast, moveCursorAfterNode, normalizeDescHtml, escapeAttr
│   ├── core/
│   │   ├── init.js          # App bootstrap, wireUI, header rendering
│   │   ├── storage.js       # localStorage, deepMergeModel, schema migrations
│   │   ├── import-export.js # JSON export/import with migration
│   │   ├── auth.js          # Authentication (login/register/logout/session)
│   │   ├── sync.js          # Cloud sync (D1 profiles, dirty tracking, 20-min interval)
│   │   └── file-service.js  # R2 file operations, image ref classification, Base64 migration
│   ├── features/
│   │   ├── edit-mode.js     # Toggle, popovers, color pickers, notepad, highlighter, context menu
│   │   ├── drag-drop.js     # Card and item reordering
│   │   ├── timers.js
│   │   ├── quick-access.js  # Quick access panel with reconciliation
│   │   ├── media-library.js
│   │   ├── image-editor.js  # Profile/logo positioning
│   │   ├── reminders.js     # Calendar/interval popovers, breakdown modal
│   │   ├── cards.js         # Card CRUD, type selector
│   │   ├── links.js         # Link modals
│   │   ├── grid-engine.js   # THE layout core: cell math, profiles, collisions, migrations v7/v8
│   │   ├── card-modal.js    # Card edit modal (opens from tile view)
│   │   ├── card-resize.js   # 4-edge drag-to-resize (delegates math to grid-engine)
│   │   ├── tasks.js         # Eisenhower Matrix task management
│   │   ├── projects.js      # Projects module, @ mention autocomplete, highlight management
│   │   ├── meetings.js      # Meetings with dates and recurrence
│   │   ├── calendar.js      # Calendar view, notification badge
│   │   └── auth-ui.js       # Auth modal UI, cloud sync triggers
│   └── components/
│       └── sections.js      # Section rendering (icons, lists, reminders, copy-paste)
├── assets/
└── Reference/               # (gitignored) Backend docs, screenshots, working context
    ├── migration-test.mjs   # Node smoke test: schema migrations + device-profile round-trip
    └── collapse-test.mjs    # Node smoke test: collapse display-layout compaction
```

### Storage & Sync
- **localStorage key**: `personal_dashboard_model_v2` (fast browser cache)
- **D1**: Durable cloud profile via `PUT /profile` (2MB max)
- **R2**: Private file/image storage via `POST /files` (5MB/file, 100MB/user)
- **Sync model**: localStorage for immediate edits → cloud sync on confirm, every 20 min, and on import

---

## Core Features

### Edit Mode
- Toggle via pencil button (bottom-right, 62×62px)
- Creates working copy; changes only save on confirm (✓) or discard on cancel (×)
- `currentData()` returns working copy when editing, model otherwise

### Card System (Unified)
All cards are type `'unified'` containing any mix of:
- **Icons**: Horizontal row of clickable image buttons (supports URL or R2 file links via `linkType`/`fileId`)
- **Reminders**: Time/interval tracking with color-coded day badges (supports URL or file links)
- **Subtasks**: 2-column grid of text links (supports URL or file links)
- **Copy-Paste**: 2-column grid, copies text on click

### Eisenhower Matrix Tasks
Central task store in `model.tasks[]` with 4-color priority system:
- **Red**: Urgent & Important
- **Orange**: Urgent & Not Important
- **Yellow**: Not Urgent & Important
- **Blue**: Not Urgent & Not Important
- Tasks can have: subtasks, descriptions, due dates, multiple links & files, linked items, project/meeting/note highlights
- **Links & Files**: Task editor has a `+` button to add multiple links/files. Clicking `+` shows URL or File choice. URL entries use subtask-style input (editable → confirmed with edit/delete inside). File entries upload to R2.
- `task.taskLinks[]` stores the array; `task.link` is kept for backward compat (first URL)
- **Linked Items (multi)**: `task.linkedItems[]` links a task to card items (reminders, subtasks, copy-paste, icons); legacy `task.linkedItem` mirrors the first ref. `getLinkedItems(task)` normalizes both shapes
- Task editor: "Link to Item (Optional)" sits at the bottom below Subtasks. "Select Item" appends refs; linked items render below it as functional miniatures (order: reminders → subtasks → copy-paste → icons) — click opens the item's link/file (copy-paste copies), × unlinks
- Item "Add Task" button (in the item tasks modal) opens a task PICKER (`#item-task-picker-modal`, styled like the @ mention dropdown: per-color columns red/orange/yellow/blue, pinned first, search filter) to link an EXISTING task to the item — it no longer creates a new task
- Primary (pinned) tasks float to top within their color group

### Task Highlight System
Tasks can be linked to text in Projects, Meetings, and Card Notes:
- **@ mention**: Type `@` after a space to autocomplete an existing task name → inserts color-coded pill
- **Right-click → Link task**: Select text, right-click, choose "Link task" from context menu
- **State-based reconciliation**: `reconcileTaskHighlights()` checks actual task status on every display:
  - Active task → correct priority color
  - Completed task → green
  - Deleted task → reverted to plain text (text preserved)

### Projects
Rich-text editor per project with toolbar (bold, italic, underline, lists, highlighter).
Supports task highlighting, hyperlinking, and @ mention autocomplete.

### Meetings
Meetings with two categories: one-time and recurring.
- Edit form layout: name (2/3 width), type, and date on a single row
- Recurrence options for recurring: weekly (1-3 weeks) or monthly
- Links section for adding URL links
- Files section for uploading R2 file attachments (`meeting.files[]`)
- Rich-text description editor (expanded height) with task highlighting

### Calendar View
Full month calendar aggregating all dated items:
- Reminders (from schedule/getNextOccurrence)
- Tasks and subtasks with due dates
- Meetings (including recurring occurrences)
- Red dot + count indicator on days with items
- Click a day to see its items; click an item to open its editor

### Notification Badge
Red badge on profile photo showing count of overdue + due-today items.
Click to see categorized list (Due Today / Overdue) with direct links to items.

### Text Highlighter
Available in all rich-text editors (projects, meetings, tasks, subtasks, ideas, card notes):
- 5 pastel colors (yellow, green, blue, pink, purple) selectable in toolbar
- Right-click context menu: Bold, Italic, Underline, Bullet/Numbered/Checklist, Highlight, Remove highlight, Link task
- Context menu works with or without text selection (highlight/link task require selection)

### Checklists
Available in all rich-text editors via toolbar button, context menu, or `[] ` markdown shortcut:
- Uses `<ul class="checklist">` with CSS `::before` circle checkboxes
- Click circle to toggle: checked items get green text, strikethrough, green filled circle with checkmark
- Enter on checked item creates unchecked new item; Enter on empty item exits list
- Tab/Shift+Tab indents/outdents (nested lists inherit `checklist` class)
- `toggleChecklist()` handles conversion between list types (bullet ↔ numbered ↔ checklist)

### Card Notes (Notepad)
Per-card note system with rich-text editing, color coding, and task linking.
Notes viewer reconciles task highlights on open.

### Settings Modal
Accessible via gear icon in edit mode. Contains:
- Theme: Light / Dark toggle
- Theme: Classic (Grey) / Sunset dropdown
- JSON File Backup: Download and Upload with overwrite warning

### Quick Access
Prioritized items panel with state-based reconciliation — automatically removes items whose source cards/items have been deleted.

### R2 File Storage Integration
- Images (profile photo, logo, card icons) stored in R2 when authenticated
- Legacy Base64 images auto-migrated to R2 on login (safe, idempotent)
- Edit popover for icons/subtasks/reminders supports URL or File Upload via `allowFileLink` dropdown
- Task editor has multi-link system: `+` button → choose URL or File → subtask-style input with confirm/edit/delete
- Meeting editor has dedicated Files section for R2 attachments
- File-linked items open via authenticated fetch (images/PDFs inline, HTML via isolated viewer)
- Image refs use `classifyImageRef()` → `setImageFromRef()` for rendering

### Authentication & Cloud Sync
- Username/password auth via Cloudflare Workers
- Session token stored in localStorage (30-day expiry)
- Profile syncs to D1 on: confirm edits, import, every 20 min while dirty
- 401 invalidates session but preserves local dashboard data

### Grid Engine (`js/features/grid-engine.js`) — single source of truth for layout
- **24-column graph-paper grid**: uniform square cells (~36px at 1260px width), computed in JS as px values (never CSS %)
- **One layout engine for both modes**: view AND edit mode use identical fixed square-cell rows (`grid-auto-rows: <px>`). Edit mode is a zoomed (0.7) preview of the exact same layout — WYSIWYG by construction
- **Header** pinned to grid row 1 (auto height via `grid-template-rows: auto`); data cards live in rows 2+; all row math offsets by real header height (`getGridOriginY`)
- Each card stores `gridCol`, `gridRow`, `gridColSpan`, `gridRowSpan` — explicit placement, no CSS auto-flow, cards positioned relative to the grid only
- Cards fill their grid area (`align-items: stretch`); white space lives inside the card
- Key functions: `getCellSize()`, `applyCellSize()`, `applyGridPlacement()`, `mouseToGridCell()`, `computeDropPosition()`, `resolveCollisions()`, `reconcileRowSpans()`, `autoAssignGridPositions()` (2D bin-packing)
- `reconcileRowSpans()` runs after every render: grows any card whose content outgrew its area, pushes neighbors down, persists — cards can never clip content (collapsed cards are excluded from measurement)
- `ResizeObserver` recomputes cell sizes on container resize (also observes the header for async image loads)

### Card Collapse (view mode)
- Chevron collapses a card to title-bar height; `computeDisplayLayout()` derives a DISPLAY layout where cards below rise by exactly the freed rows — per column, so intentional white space elsewhere is preserved
- Rise allowance = MAX freed across the card's columns; the blocker-settle pass lands it on whatever is still expanded. Nothing ever sinks below its designed position; stored layout is never modified, so expanding restores exactly
- `getCollapsedRowSpan()` computes title-bar rows per device mode (~72px)
- Edit mode always shows the full designed layout (chevrons hidden there)
- Old "click empty space → collapse all / navigate" feature was REMOVED; `setupCardCollapseExpand()` in init.js now only closes open link/task bubbles on outside click

### Responsive Card Content (container queries, end of styles.css)
- Item grids use `repeat(N, minmax(0, 1fr))` — plain `1fr` would let long pills force column overflow (clipped by the card edge)
- Breakpoints on card content width: ≥900px → 3 columns, 431–899px → 2, ≤430px → 1; inner text ellipsizes, badges/buttons never shrink
- Icons NEVER shrink — the flex-wrap icon row just adds more rows in narrow cards

### Per-Device Layout Profiles (mobile / tablet / desktop)
- `DEVICE_MODES` in grid-engine.js: mobile (4 cols, 520px, single-column stack), tablet (24 cols, 1260px), desktop (24 cols, 2280px)
- The flat `gridCol/gridRow/gridColSpan/gridRowSpan` props are the ACTIVE mode's working layout — all engine/drag/resize code operates on them unchanged
- `persistActiveLayout()` (hooked into `markDirtyAndSave`) keeps `section.layouts[activeMode]` in sync; `hydrateLayout()` swaps a profile in (lazy-seeds missing profiles as a full-width stack at content height)
- `switchDeviceMode(mode)` — works in view mode AND mid-edit (operates on working copy; cancel reverts all profiles)
- Active mode: per-browser localStorage `dashboard_device_mode`, auto-detected by screen width on first visit (<768 mobile, <1600 tablet, else desktop); `model.lastActiveMode` (synced) records which mode the flat props represent for cross-device restore
- Device picker: `#device-mode-toggle` right of the search bar shows the ACTIVE mode's icon (`updateDeviceModeToggleIcon`) → bubble with 3 options (`openDeviceModeModal` in init.js)
- Mobile is single-column: drop forces col 1/full width, both horizontal resize handles hidden/guarded

### Edit Mode - Tile View & Drag/Drop
- Entering edit mode adds `edit-mode-tiles` class (zoom 0.7) + graph-paper overlay aligned via `--grid-pad-left` / `--grid-origin-y`
- Cards render view-mode content (no edit controls); click opens Card Edit Modal
- **Drag**: anchor offset recorded at dragstart (grab point within card); ghost shows the exact final resting position via `computeDropPosition()` (clamp → auto-shrink width to fit → slide-under)
- **Slide-under rule**: overlapping a card that starts ABOVE snaps the dragged card below it; only cards at/below the drop get pushed down (`resolveCollisions`)
- **SWAP**: dragging so the CURSOR is inside another card arms a swap — both cards pulse (`.card-swap-glow`, `filter: drop-shadow` animation since glass box-shadows would drown a box-shadow pulse; dragged card opacity lifted from 0.4). Drop exchanges positions; each card keeps its own size; overlaps settle downward
- **Resize on ALL FOUR edges**: right/bottom move that edge; left/top move the edge while anchoring the opposite one (adjust `gridCol`+`gridColSpan` / `gridRow`+`gridRowSpan` together). Snaps to any cell; height can never shrink below content (`getMinRowSpan` via `measureContentHeight`, which ignores absolutely-positioned children); top can't rise past row 2
- Single "Add Card" FAB button (blue +) in the fab-left stack directly above Settings

### Card Edit Modal (`js/features/card-modal.js`)
- `openCardEditModal(sectionId)` / `closeCardEditModal()`
- The real card element rendered full-size on a backdrop (no modal chrome); width matches the card's grid width; hidden scrollbar + bottom fade gradient when content overflows
- All edit controls (add/edit/delete items, colors, subtitles, delete card) live on the card itself; header buttons are [trash][X] top-right (`.card-modal-close-btn`)
- Closing (X / backdrop / Escape) also closes any open item editors (`hideEditPopover`/`hideCalendarPopover`/`hideIntervalPopover`)
- Item popovers (`.edit-popover`, `.calendar-popover`, `.interval-popover`, `.reminder-links-modal`) are z-index 2500 — MUST stay above the modal's 2000 or they render behind it

### Dark Mode
- Toggle in Settings modal
- Colors stored as `{ light, dark }` objects for independent theming
- Glass mode always active with Classic or Sunset theme

---

## Key Functions

### Core
- `init()` - Bootstrap app
- `saveModel()` / `restoreModel()` - localStorage persistence
- `toggleEditMode()` / `confirmGlobalEdit()` / `cancelGlobalEdit()`
- `renderAllSections()` / `renderHeaderAndTitles()`

### File Service (`js/core/file-service.js`)
- `uploadFile(blob, fileName)` - Authenticated R2 upload
- `fetchFileBlobUrl(fileId)` - Fetch file → cached blob URL
- `openFile(fileId, fileName)` - Open file (HTML via viewer, others via blob)
- `setImageFromRef(img, ref, placeholder)` - Resolve any image ref to img.src
- `classifyImageRef(ref)` - Detect r2/asset/url/base64/none
- `migrateBase64ToR2()` - Auto-migrate legacy Base64 images
- `reconcileTaskHighlights(container)` - State-based highlight reconciliation

### Tasks
- `createTask()` / `updateTask()` / `deleteTask()` / `completeTask()`
- `getTasksByColor(color)` / `getAllTasks()` / `getCompletedTasks()`
- `openAddTaskModal()` / `openEditTaskModal(taskId)`
- `openItemTasksModal(type, key, sectionId, subtitle)`

### Projects & Meetings
- `openProjectsModal()` / `closeProjectsModal()`
- `openMeetingsModal()` / `closeMeetingsModal()`
- `attachTaskMention(editor, onInsert)` - Wire @ autocomplete to an editor
- `attachHighlighterContextMenu(editor, options)` - Wire right-click menu

### Calendar & Notifications
- `openCalendarView()` / `closeCalendarView()`
- `updateNotificationBadge()` / `wireNotificationBadge()`

### Shared Utilities (`js/utils.js`)
- `moveCursorAfterNode(node)` - Move cursor after a contenteditable node
- `normalizeDescHtml(html)` - Strip empty descriptions
- `escapeAttr(str)` - Safe HTML attribute escaping (4 chars: &, ", <, >)

---

## Schema Migrations

| Version | Migration | Function |
|---------|-----------|----------|
| 3 | Unified card format | `migrateToUnifiedCards()` |
| 4 | Half-width cards | `migrateToHalfWidthCards()` |
| 5 | Centralized Eisenhower tasks | `migrateToEisenhowerTasks()` |
| 6 | Grid layout (12-col) | `migrateToGridLayout()` |
| 7 | 24-column grid | `migrateToGrid24()` |
| 8 | Per-device layout profiles | `migrateToDeviceLayouts()` |

Migrations run automatically in `restoreModel()` and are idempotent.

---

## Patterns

### State Management
```javascript
const data = currentData(); // Working copy in edit mode, model otherwise
if (editState.enabled) { /* show edit controls */ }
editState.working = deepClone(model);
```

### Image Handling
```javascript
// Rendering: handles R2, asset, URL, Base64, null
setImageFromRef(imgElement, data.header.profilePhotoSrc, 'assets/icons/placeholder-profile.svg');

// Upload: store R2 ref when authenticated, Base64 fallback otherwise
if (isLoggedIn() && src.startsWith('data:')) {
  const blob = dataURLtoBlob(src);
  const result = await uploadFile(blob, 'image.png');
  if (result.ok) newSrc = { type: 'r2', fileId: result.fileId };
}
```

### Task Highlight Lifecycle
```javascript
// Creating: @ mention or right-click "Link task" inserts <span class="project-task-highlight">
// Completing: reconcileTaskHighlights() or markXxxHighlightCompleted() → green
// Deleting: reconcileTaskHighlights() or removeXxxHighlight() → plain text (preserved)
// All three surfaces (projects, meetings, card notes) follow the same pattern
```

### Rich-Text Editors (must be kept in sync)
All 6 editors share the same toolbar features and must be updated together:

| Editor | File | Element ID | Toolbar Btn Class | State Update Fn |
|--------|------|-----------|-------------------|-----------------|
| Projects | `projects.js` | `#project-editor` | `.projects-toolbar-btn` | `updateProjectsToolbarState()` |
| Task Description | `tasks.js` | `#task-desc-editor` | `.task-desc-toolbar-btn` | `updateTaskToolbarState()` |
| Subtask Description | `tasks.js` | `#subtask-desc-editor` | `.subtask-toolbar-btn` | `updateSubtaskToolbarState()` |
| Ideas | `tasks.js` | `#ideas-editor` | `.ideas-toolbar-btn` | `updateIdeasToolbarState()` |
| Meetings | `meetings.js` | `#meetings-inline-desc-editor` | `.meetings-inline-toolbar-btn` | `updateInlineToolbarState()` |
| Card Notes | `edit-mode.js` + `index.html` | `#notepad-editor` | `.notepad-toolbar-btn` | `updateToolbarState()` |

Each editor needs: toolbar HTML buttons, click handlers, `attachHighlighterContextMenu()`, `attachChecklistHandler()`, toolbar state update with checklist support, `handleEditorInput`/`handleEditorKeydown` wiring.

Shared logic lives in `edit-mode.js`: `handleEditorKeydown`, `handleEditorInput`, `toggleChecklist`, `isInChecklist`, `attachChecklistHandler`, `attachHighlighterContextMenu`, `createHighlighterButton`.

### Adding Features Checklist
1. Use minimalist SVG icons with currentColor
2. Add dark mode styles (glass mode is always on)
3. Ensure data saves to model correctly
4. Only show edit controls when `editState.enabled`
5. Add confirmation for destructive actions
6. Show toast feedback for actions
7. Handle both URL and R2 file references where applicable
8. Ensure new fields are in saveModel, restoreModel, deepMergeModel, import/export
9. For rich-text editor features: update all 6 editors listed above

---

## Version History

### v5.0 (Current)
- **Grid Engine** (schemaVersion 7): 24-column graph-paper layout, explicit cell placement, JS-computed px cell sizes, WYSIWYG edit/view parity, slide-under drop snapping, collision cascade
- **Per-device layout profiles** (schemaVersion 8): independent mobile/tablet/desktop arrangements, device picker beside search bar, auto-detect + per-browser override, profiles sync to D1
- Edit mode = zoomed miniature tiles; click opens the Card Edit Modal (the real card on a backdrop)
- 4-edge card resize; card SWAP by dropping onto another card (pulsing glow indicator)
- Card collapse reclaims space in view mode (per-column display-layout compaction)
- Checklists in all rich-text editors (toolbar, context menu, `[] ` shortcut)
- Context menus work without text selection; subtask due dates clear on completion
- Responsive card content via container queries (3/2/1 item columns); icons never shrink
- Removed: normal/stacked display modes, gap add-buttons, collapse-all navigation
- Node smoke tests in Reference/ for migrations, profile round-trips, collapse math

### v4.0
- Eisenhower Matrix task system (schemaVersion 5)
- Projects and Meetings modules with rich-text editors
- Calendar view with notification badge
- @ task mention autocomplete and right-click context menu
- Text highlighter (5 pastel colors)
- State-based task highlight reconciliation
- R2 file storage integration with Base64 auto-migration
- URL vs File upload on icons
- Settings modal with JSON backup (replaces old FAB buttons)
- Glass mode always on (solid style removed)
- Card notes with task linking
- Quick Access reconciliation
- Authentication and cloud sync (D1/R2)
- Task and subtask due dates
- Meeting dates with recurrence options

### v3.0
- Unified card system: icons, reminders, subtasks, copy-paste coexist
- Schema version 3 with auto-migration
- Independent light/dark mode colors
- Display modes (normal/stacked) with independent ordering
- Full drag-drop support for cards and items
- ES6 module architecture

### v2.x
- ES6 module migration from monolithic app.js
- Independent display mode sections

### v1.x
- Initial features: edit mode, reminders, dark mode, import/export
- Media library, breakdown modal
