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
  schemaVersion: 5,
  darkMode: boolean,
  glassMode: true,              // Always on (glass style)
  glassTheme: 'classic' | 'sunset',
  displayMode: 'normal' | 'stacked',
  sections: [{ id, type: 'unified', title, twoColumnPair?, pairIndex? }],
  sectionsStacked: null | Section[],

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
    linkedItem?, link?, dueDate?, order, pinned: boolean,
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
│   │   ├── tasks.js         # Eisenhower Matrix task management
│   │   ├── projects.js      # Projects module, @ mention autocomplete, highlight management
│   │   ├── meetings.js      # Meetings with dates and recurrence
│   │   ├── calendar.js      # Calendar view, notification badge
│   │   └── auth-ui.js       # Auth modal UI, cloud sync triggers
│   └── components/
│       └── sections.js      # Section rendering (icons, lists, reminders, copy-paste)
├── assets/
└── Reference/               # (gitignored) Backend docs, screenshots, working context
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
- Right-click context menu: Bold, Italic, Underline, Highlight, Remove highlight, Link task

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

### Display Modes
- **Normal**: Single-column centered
- **Stacked**: Two-column masonry grid
- Independent section ordering per mode

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

### Adding Features Checklist
1. Use minimalist SVG icons with currentColor
2. Add dark mode styles (glass mode is always on)
3. Ensure data saves to model correctly
4. Only show edit controls when `editState.enabled`
5. Add confirmation for destructive actions
6. Show toast feedback for actions
7. Handle both URL and R2 file references where applicable
8. Ensure new fields are in saveModel, restoreModel, deepMergeModel, import/export

---

## Version History

### v4.0 (Current)
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
