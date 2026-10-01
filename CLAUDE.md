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
      icons: [{ key, icon, url, title, linkType?, fileId?, fileName?, invertDark? }],
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
    projectHighlight?, meetingHighlight?, noteHighlight?,
    categoryId?   // → taskCategories[].id; unknown/deleted ids read as Uncategorized
  }],
  completedTasks: [{ ...task, completed: true, completedAt }],

  // Task categories (Settings → Tasks). A setting: always read/written on `model`
  taskCategories: [{ id, name, slot }],  // slot 1-8 = fixed chart color (--task-cat-N), max 8

  // Task time log (js/core/time-log.js). Always read/written on `model`, NEVER the
  // edit-mode working copy, and deliberately not merged by deepMergeModel
  timeTracking: {
    active: null | { taskId, start },   // the one running timer (epoch ms)
    changedAt, resetAt,                 // merge bookkeeping (last start/stop; last import)
    tasks: { [taskId]: { title, categoryId, sessions: [[startMs, endMs], ...] } },
    removed: ['taskId@startMs', ...]    // tombstones so a cloud merge can't resurrect deleted sessions
  },

  // Feature data
  projects: [{ id, title, content }],
  meetings: [{ id, title, type, description, links, files?: [{ fileId, fileName }], date?, repeat?, repeatWeeks?, repeatMonthlyType? }],
  ideas: [{ id, title, content }],
  cardNotes: { [sectionId]: [{ key, title, content, color? }] },
  // Listed in the Today view. Entries copy the card item and name it: sectionType (card id),
  // subtitle, name (item key). quickLinks: [{ key, title, url }] added with the link button
  quickAccessItems: { icons: [], listItems: [], quickLinks: [] },
  timers: [],   // legacy standalone timers: no longer shown, kept so old data isn't lost
  header: { profilePhotoSrc, companyLogoSrc, profilePhotoZoom, companyLogoInvertDark, ... }
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
Images inside rich text (descriptions, projects, meetings, ideas, notes) are stored as `<img data-r2-file-id="..." alt="">` with NO src; the page fills src in at render time (see Rich-Text Images below).

### File Structure
```
├── index.html
├── styles.css               # Structural styles
├── glass.css                # Glass visual system (loaded after styles.css)
├── glass-fx.css             # Glass FX v2 layer (loaded after glass.css; scoped under html[data-fx="v2"])
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
│   │   ├── sync.js          # Cloud sync (D1 profiles, dirty tracking, 20-min interval, time-log merge)
│   │   ├── time-log.js      # Pure time-log rules: start/stop, totals, merge, import (no DOM, Node-testable)
│   │   ├── rich-text-refs.js # Pure string rules for <img data-r2-file-id> in rich text (no DOM, Node-testable)
│   │   ├── quick-capture-parse.js # Pure quick capture rules: dates, !commands, escapes, help list (no DOM, Node-testable)
│   │   ├── agenda.js        # Pure due rules: what's due today/overdue, meeting recurrences, badge count (no DOM, Node-testable)
│   │   └── file-service.js  # R2 file operations, image ref classification, Base64 migration
│   ├── features/
│   │   ├── edit-mode.js     # Toggle, popovers, color pickers, notepad, highlighter, context menu
│   │   ├── drag-drop.js     # Card and item reordering
│   │   ├── time-tracking.js # Pill stopwatches, 1s tick, Time Tracking panel (task list + category donut)
│   │   ├── task-categories.js # Category helpers + Task Settings modal
│   │   ├── quick-capture.js # N-key bar: @ task / !category: pickers, live preview, ⓘ command list, Open/Undo toast
│   │   ├── item-creator.js  # "Add item" window (card "+" in view mode, "+" tiles in edit mode) + separator placement mode
│   │   ├── drop-light.js    # The glowing drop line: item reorder in edit mode + separator placement
│   │   ├── rich-text-images.js # Paste/drop images → R2 upload; fills in stored images wherever rich text renders
│   │   ├── today.js         # Today view (header button): due today & overdue + Quick Access
│   │   ├── quick-access.js  # Quick Access data: long-press toggle, entry repair, reconciliation, quick links
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
│   │   ├── calendar.js      # Calendar (opened from the badge) + Due Today/Overdue list, notification badge
│   │   ├── auth-ui.js       # Auth modal UI, cloud sync triggers
│   │   ├── glass-glow.js    # Samples rendered colors into glow vars; reflected item light on card rims
│   │   └── glass-fx.js      # FX v2 pointer-caught rim light (constructed stylesheet, no DOM writes)
│   └── components/
│       └── sections.js      # Section rendering (icons, lists, reminders, copy-paste)
├── assets/
└── Reference/               # (gitignored) Backend docs, screenshots, working context
    ├── migration-test.mjs   # Node smoke test: schema migrations + device-profile round-trip
    ├── collapse-test.mjs    # Node smoke test: collapse display-layout compaction
    ├── time-log-test.mjs    # Node smoke test: time-log start/stop, totals, merge, import, period ranges
    ├── sync-merge-test.mjs  # Node smoke test: cloudSave() time-log merge against a fake API
    ├── rich-text-refs-test.mjs # Node smoke test: rich-text image reference rules
    ├── quick-capture-test.mjs # Node smoke test: quick capture dates, commands, escapes
    └── agenda-test.mjs      # Node smoke test: due states, meeting recurrences, Today ordering, badge count
```

### Storage & Sync
- **localStorage key**: `personal_dashboard_model_v2` (fast browser cache)
- **D1**: Durable cloud profile via `PUT /profile` (2MB max)
- **R2**: Private file/image storage via `POST /files` (5MB/file, 100MB/user)
- **Sync model**: localStorage for immediate edits → cloud sync on confirm, every 20 min, and on import
- **Time-log merge**: the profile is saved whole (last write wins), so before every `PUT /profile`, `cloudSave()` fetches the cloud copy and folds its `timeTracking` into the local log (`mergeTimeLogs`): sessions union (deduped by start, earliest stop wins), tombstones win, the newer start/stop decides the running timer, and sessions older than an import only come from the importing side. Other profile data is still last-write-wins
- **Dirty generation**: a save only clears the dirty flag if nothing changed while the upload was in flight

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
- In view mode, Quick Access icons move to the front of their own separator-delimited group (separators stay put)

### Item Creator (`js/features/item-creator.js`): add items without blank placeholders
- **View mode**: a "+" on every card's title bar (`.card-add-item-btn`, left of the notes button) opens the window. Shown on card hover / keyboard focus, always on phones (`body[data-device="mobile"]`, `(hover: none)`); hidden on collapsed cards and in edit mode
- **Edit mode**: the "+" tiles inside the Card Edit Modal open the same window with that section preselected (the old `openUnifiedAddItemPopover` / `onAddUnifiedItem` blank-item flow is gone)
- Window (`.ic-overlay`, z-index 3000: above the Card Edit Modal and item popovers, below the media library at 4000): tabs Icon · Subtask · Reminder · Copy-paste · Separator, a Section select (only when the card has named sections), then the fields for that type. Name and link are SHARED fields, so switching tabs keeps them
  - Icon: image (media library or emoji picker, created on first use) + required link/file + optional name (`icon.title`) + "Invert colors in dark mode" (dark only)
  - Subtask: text + optional link/file. Reminder: name + optional link/file + Date (date, repeats weekly 1-3 / monthly same date or first weekday; same schedule shapes as the calendar popover) or Counter (target, current, limit/goal, unit). Copy-paste: optional label (defaults to the first line) + text to copy
- Nothing exists until Add. Validation blocks Add (missing field shown in the footer; Add shakes the window and focuses the field). Files and icon images upload only on Add (link file first; a failure stops before anything else uploads; anything uploaded is cleaned up if the save fails)
- Saving: view mode writes the profile (`markDirtyAndSave`) and pushes it with a silent `cloudSave()` (a failed push stays dirty and retries on the 20-min timer); edit mode writes the working copy (Confirm keeps it, Cancel drops it). Then a toast with Undo (`showActionToast` from quick-capture.js; Undo only applies in the same mode it was made in) and a one-time glow on the new item (`.ic-just-added`)
- Remembers the last type and section per card (in memory); the first open on a card starts on the kind of item it holds most
- **Separator**: picking the tab hides the window and enters placement mode on the card (`.sep-placing`, `html.sep-placing-active` crosshair). Every gap between two icons (not next to an existing separator) in a visible icon row gets a faint breathing marker (`.sep-slot`, absolutely positioned inside its `.unified-icons-group`, so it scrolls with the card); the drop light follows the pointer to the nearest gap; click / tap drops it there. Window-level capture listeners swallow clicks, long-presses and drags so icons don't open while placing. Esc / Cancel (hint bar `.sep-place-hint`) returns to the window unchanged. The group is saved in its ON-SCREEN order before inserting (WYSIWYG with the Quick Access sort). No valid gap → the tab explains instead. A re-render while placing re-attaches to the new card element

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
- **Category**: chips below "Link to Item" in the task editor (click the selected chip again to clear) → `task.categoryId`
- **Stopwatch**: rightmost control on every pill (`createTaskTimerControl`); see Task Time Tracking
- **Complete**: circle-check button just left of the stopwatch on every pill (matrix and Today view) and on the open-task rows of the Time Tracking panel (`createTaskCompleteButton(task)`, exported from tasks.js; time-tracking.js imports it, a safe import cycle since neither module uses the other at load time). The Time Tracking rows hold both buttons in `.tt-task-actions` (64px; empty on finished rows so columns line up), and completing refreshes the panel (`refreshTimeTrackingUI`), which moves the row to Completed. Click asks "Mark “…” as complete?" (native confirm, `confirmCompleteTask`), then completes it. Dropping a pill on the header checkmark (`#delete-task-drop`) asks the same question. Excluded from the pill's click-to-edit and long-press-to-pin; 20px with negative block margin so the pill height doesn't change; emerald glyph + lens on hover (glass-fx.css 9b)

### Task Time Tracking (`js/features/time-tracking.js` + `js/core/time-log.js`)
- Pill stopwatch toggles that task's timer; ONE timer runs at a time (starting another stops and records the first, with a toast). While running, the task's total (`0:45` → `12:05` → `1:02:33`) sits to the LEFT of the icon, and the pill never changes height
- Running look = an emerald glass crystal (glass-fx.css 9b): gradient body + specular, shared rim, breathing halo (`::before`) and a rim light that sweeps like a second hand (`::after`, `fxSweep`). No transform/filter/backdrop-filter on the button (that would make it a stacking context and pull the halo in front); body is background-image only so glass-glow.js doesn't add its generic glow. `--fx-live-rgb` / `--fx-live-deep` tokens (dark overrides in section 13)
- Every start/stop stores exact epoch-ms `[start, end]` sessions per task in `model.timeTracking` (saved with the profile). Sessions under 1s are dropped. A running timer survives reloads (timestamp-based) and keeps running while the tab is closed
- The 1-second tick only rewrites existing text nodes (`Text.data`), never replaces elements, so glass-glow.js's MutationObservers (childList/attributes) don't re-measure the page every second; it pauses while the tab is hidden and catches up on return
- Completing or deleting a task stops its timer first; its history stays in the log (title/category kept in `timeTracking.tasks[id]`), so deleted tasks still count and show as "Deleted"
- Header stopwatch (`#time-tracking-toggle`) opens the Time Tracking panel (`#time-tracking-card`) and shows a live green dot while a timer runs. Panel: tasks with time > 0 (running first, then by total; completed/deleted in a collapsed "Completed" group), each row expands to its sessions (delete one, or "Clear all time"); below the list, the Categories donut + legend (legend doubles as the table view)
- Donut rules (dataviz): ≤6 segments (smallest categories fold into "Other"), 2px gaps, slices in category order, colors from the validated categorical palette per category slot (`--task-cat-1..8`, `--task-cat-none`, `--task-cat-other` in styles.css, light + dark), chart figures in minutes (refresh once a minute)
- **Categories period filter**: funnel button `#tt-range-btn` on top of the category legend, left-aligned with it (`.tt-legend-col` = button + legend, so it moves with the legend when the chart stacks). Built once in JS (`getRangeButton`) and re-attached on every chart render; in the empty states it sits above the message, and it's left out only when there's no tracked time and no filter. Shows the period; azure when filtered → popover `.tt-range-pop` (fixed, z-index 9000, appended to body): presets Today / This week (Monday start) / Last 14 days (incl. today) / This month / Last month / This year apply on click; Custom range From / To (inclusive local days, either side may be empty = since / until, ends swapped if reversed) + Apply; Clear = all time (the default). Esc / outside click closes. Filters ONLY the donut; the Tasks list stays all-time. Sessions crossing a period edge count only the part inside it; the running session counts up to now
- The filter is per browser: localStorage `dashboard_tt_range_filter` (`{ preset }` or `{ from?, to? }`, not synced, not in the model). Presets are stored by name, so "This week" always means the current week. Range rules are pure in time-log.js (`TIME_RANGE_PRESETS`, `normalizeRangeFilter`, `resolveTimeRange`, `getTaskTotalsInRange`)
- `refreshTimeTrackingUI()` repaints pill controls, header dot and the panel; it also closes a running timer whose task vanished (import, other device, or a task created in a cancelled edit)
- The old standalone timers (timers.js, Reset All / Add Timer) were removed; `model.timers` is kept untouched

### Quick Capture (`js/features/quick-capture.js` + `js/core/quick-capture-parse.js`)
- **N anywhere** (not while typing in a field, no Ctrl/Alt/Meta) opens a one-line bar above everything (`#quick-capture`, z-index 100100); the header bolt `#quick-capture-toggle` does the same and is shown only when the Mobile layout is active (`body[data-device="mobile"]`). Off in edit mode (toast): tasks made there would only live in the working copy
- Plain text = new task name (`!task` optional). `@` opens the task list (same look as the @ mention list); a pick becomes a chip and the line then CHANGES that task, with leftover text added as a new subtask. One task + one category chip per line; Backspace at the start of the line removes the last chip
- Commands (anywhere in the line, case-insensitive): `!red !orange !yellow !blue` (`!r !o !y !b`), `!priority` / `!nopriority` (Primary), `!timer` (always STARTS, never toggles; `startTimerForTask`), `!url:telcobridges.com` (https:// added, http/https only, several allowed), `!category:` / `!cat:` (opens the category list on the colon; typed names match exact → starts-with → contains), `!nodate`
- Dates, day-first, built from the LOCAL calendar day (never via toISOString): `today` `tomorrow`/`tmr`, `fri` (today if it is Friday) / `next fri` (+7), `3d` `2w` `in 3 days` (lowercase only, so "3D printer" stays text), `eow` `eom`, `Dec 21` / `21st of December 2026` / `December 21st, 2026`, `21/12` `21/12/26` `21-12-2026` `21.12.2026` `2026-12-21`. No year = next occurrence (29/2 waits for a leap year); a "by"/"due" right before the date is dropped from the title. `24/7`, `3-5`, `21.12`, `45/50` stay text
- Errors block Enter and shake the bar (unknown command with a "Did you mean" suggestion, impossible date like 31/02, bad link, unknown/ambiguous category, nothing to change); warnings don't (two colors/dates: the last one wins; past date; already linked). A `\` before a word keeps it as text (`\fri`, `\!red`, `\@marc`); clicking the date chip in the preview inserts it
- While a list is open, Enter/Tab picks (Enter never saves by accident) and Esc closes just the list, leaving the text as typed. Enter saves; Shift+Enter saves and opens the task editor; Esc / backdrop closes
- Saving uses the task editor's own calls (`createTask` then `updateTask`; links via `taskLinks` + legacy `link`; subtasks via `generateSubtaskId`), then `refreshTaskViews()`. Toast `#qc-toast` offers Open / Undo for 7s (hover pauses). Undo only applies if the task is unchanged since: it deletes a new task (and all of its time) or restores the old copy exactly, and `undoTimerStart()` drops the session quick capture started and restarts a timer it switched off
- No new model fields. The ⓘ button and "See all commands" (left end of the bar's bottom row; the key hints on its right are hidden on phones) open the command list, which renders `QUICK_CAPTURE_HELP` from the parser module (click an example to insert it), so the reference can't drift from the rules

### Task Categories (`js/features/task-categories.js`)
- Edit mode → Settings → **Tasks** opens the Task Settings modal (reuses the appearance-modal classes, z-index 2100 above Settings): add / rename / delete categories, max 8, colors auto-assigned by the lowest free slot
- Draft + Save/Cancel; saved straight to `model.taskCategories` (like the theme, outside the edit-mode confirm/cancel). Deleting a category that tasks use asks first; those tasks read as Uncategorized
- Defaults (fixed ids so devices agree): Content, Campaigns, Analytics, Operational, Strategy

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

### What Counts as Due (`js/core/agenda.js`)
One set of rules for the Today view, the calendar and the badge, so they always agree:
- Tasks and subtasks: `dueDate` on or before today (local day keys, never `toISOString`). A task is listed when it is due itself or one of its open subtasks is
- Meetings: a one-time meeting only on its own date (a past one is never "overdue"); recurring ones on every occurrence from their start date (`meetingDatesBetween`: weekly every 1-3 weeks, monthly same day — skipped in short months — or first weekday)
- Reminders: dated ones whose next date (as the card badge counts it) is today or earlier. Counter (interval) reminders have no date, even if an old schedule is still stored
- Badge count = tasks due + subtasks due + meetings today + reminders due (`countDueItems`)

### Calendar View (opened from the notification badge)
- Month grid on the left; the **Due Today** + **Overdue** list (oldest first, `Nd` chip) on the right. Stacks on phones (≤760px)
- Opens with no day picked; click a day for its items under the grid. The month label returns to today
- Grid dots: reminders (next date), tasks and subtasks with due dates, meetings (every occurrence in the visible range)
- Rows: task/subtask → task editor, meeting → that meeting, reminder → its link or file
- Esc closes it unless something is open on top (`ownsEscape`, shared with the Today view)

### Notification Badge
- On the profile photo, always shown: the due count (red) or, when nothing is due, a quiet glass lens with a calendar glyph (`.is-clear`)
- Click (or Enter/Space) opens the calendar. `updateNotificationBadge()` also repaints an open calendar and Today view, so call it after changing anything dated

### Today View (`js/features/today.js`, header sun button `#today-toggle`)
- Left: **Due today & overdue**. Tasks in one tinted group per color, red → orange → yellow → blue (the matrix column classes `eisenhower-priority-card-<color>` give the tint and the pill hue), Primary first, oldest first. Then Meetings today, then due Reminders
- Task pills are the matrix's own (`createTaskPillElement`): click opens the editor, the stopwatch runs the timer, long-press pins; no dragging. A chip shows `Today` / `Overdue · Nd`. Pinned pills get their own breathing phase inline (`--fx-t-dur` / `--fx-t-delay`), since every pill is the first child of its entry
- Due subtasks hang below their task on a rail in its color (editor-style `.subtask-bubble` rows): the check completes it (same rule as the editor: done also clears importance and date) with an Undo toast; anywhere else opens the task. When only a subtask is due, the parent pill steps back (`.today-task-context`: dashed outline, quieter, a pinned one stops breathing) and says "Subtask due" / "N subtasks due"
- Meetings open straight to that meeting (`openMeetingsModal(meetingId)`)
- Reminders and Quick Access items are the real card items (`createCardItemElement` in sections.js) in the card group classes: they open their link/file, copy, show their badges, and long-press takes them in or out of Quick Access
- Right: **Quick Access**: icons, reminders, subtasks, copy-paste (swatches in their own row), then the quick links (link button in the section header; "Clear All Links" asks first)
- Off in edit mode (toast; an open one closes when editing starts). Esc closes it unless something is open on top. z-index 9990: under item bubbles (9999+), calendar (10000), meetings (10001), task editor (10010) and the quick-link dialog (10005), so they all stack above it. The edit pencil (9999) is hidden while it is open; `#toast` sits above every modal (100150)
- `refreshTodayView()` coalesces repaint requests into one render (microtask); it runs from `renderEisenhowerMatrix`, `updateNotificationBadge` and Quick Access changes

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
- Tasks: opens Task Settings (categories)
- JSON File Backup: Download and Upload with overwrite warning (includes `taskCategories` and `timeTracking`; importing a log resets history older than the import)

### Quick Access (listed in the Today view; the old panel and its header button were removed)
- Long-press (750ms) any icon, reminder, subtask or copy-paste item on a card to add it; again to take it out. In view mode its card shows it first, with the azure pulse
- `getQuickAccessItems()` resolves entries to the live card items (by card + section + key, else by the old text/url identity) and repairs entries on the way: older ones without card/section, renamed items, duplicates. Opening Today also runs `reconcileQuickAccessItems()` (drops entries whose item was deleted)
- `model.quickAccessExpanded` is no longer used (kept so old data loads)

### R2 File Storage Integration
- Images (profile photo, logo, card icons) stored in R2 when authenticated
- Legacy Base64 images auto-migrated to R2 on login (safe, idempotent)
- Edit popover for icons/subtasks/reminders supports URL or File Upload via `allowFileLink` dropdown
- Task editor has multi-link system: `+` button → choose URL or File → subtask-style input with confirm/edit/delete
- Meeting editor has dedicated Files section for R2 attachments
- File-linked items open via authenticated fetch (images/PDFs inline, HTML via isolated viewer)
- Image refs use `classifyImageRef()` → `setImageFromRef()` for rendering
- **Two limits**: the profile JSON (all dashboard data, one D1 row) is capped at 2 MB (`MAX_PROFILE_BYTES`, and D1's own 2 MB row limit); R2 file storage is 100 MB/user (5 MB/file) — what the File Manager bar shows. Anything image-sized belongs in R2
- **File Manager**: Orphaned files (not referenced anywhere in the profile or the edit-mode working copy) on top with Delete All, then Images and Documents. Deleting a file also scrubs its references, including `<img data-r2-file-id>` in rich text

### Rich-Text Images (`js/features/rich-text-images.js` + `js/core/rich-text-refs.js`)
- Pasting or dropping an image into any of the 6 rich-text editors uploads it to R2 (`attachImageUpload(editor, { label, getTitle })`, attached next to `attachImageResizeHandler`). Files are named after where they were pasted: `Task - <title> 2026-09-29 10.32.15.png` (dropped files keep their own name)
- Flow: instant local preview → `data:` copy (so a note saved mid-upload keeps the picture) marked `data-r2-uploading="<token>"` → on upload the token becomes `data-r2-file-id` in the live DOM AND in any saved copy in the model / working copy. Signed out or upload failed → the image stays inline (Base64) with a toast. Non-PNG/JPG/GIF/WebP images are re-encoded to PNG; over 5 MB they're tried as WebP, else refused
- Text pasted with images (Word, web pages): the browser pastes, then any embedded `data:` images are uploaded the same way
- Showing: a document-wide MutationObserver (`startRichTextImages()`, init.js) fills in src for every `img[data-r2-file-id]` added anywhere, from the blob cache or one authenticated fetch per file. It drops a stale saved src first (no broken-image flash); a `:not([src])` CSS frame shows while loading / signed out / deleted
- Saved HTML stays canonical: `normalizeDescHtml()` (utils.js) and the notepad's `sanitizeHtml()` strip the session-only src; projects and meetings wrap their direct `editor.innerHTML` saves in `stripHydratedImageSrc()`. A leftover stale src is harmless (the observer replaces it)
- Existing Base64 images in rich text are moved to R2 by `migrateBase64ToR2()` on the next signed-in load (deduped by data URL, named after the item)
- Removing an image from a note does NOT delete the file automatically (cut/paste between notes would lose it); unused images appear under Orphaned Files in the File Manager

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
- **Item reorder drop light** (`js/features/drop-light.js`): while dragging an icon / pill inside the Card Edit Modal, a glowing azure beam sits in the real gap where it will land (vertical between icons, horizontal above/below pills; gap read from the group's `column-gap` / `row-gap`). One fixed element at z-index 2450 (above the modal's 2000 — the old `.item-drop-indicator` sat at 1001, behind the modal, so it never showed). It moves through a paused Web Animation (no style/attribute writes per dragover, so glass-glow.js's observers stay asleep), glides between gaps, and goes out when the drag leaves the group or targets another section. Look: glass-fx.css 11b (tapered white-hot core, breathing halo, travelling spark)

### Card Edit Modal (`js/features/card-modal.js`)
- `openCardEditModal(sectionId)` / `closeCardEditModal()`
- The real card element rendered full-size on a backdrop (no modal chrome); width matches the card's grid width; hidden scrollbar + bottom fade gradient when content overflows
- All edit controls (add/edit/delete items, colors, subtitles, delete card) live on the card itself; header buttons are [trash][X] top-right (`.card-modal-close-btn`)
- Closing (X / backdrop / Escape) also closes any open item editors (`hideEditPopover`/`hideCalendarPopover`/`hideIntervalPopover`)
- Item popovers (`.edit-popover`, `.calendar-popover`, `.interval-popover`, `.reminder-links-modal`) are z-index 2500 — MUST stay above the modal's 2000 or they render behind it

### Glass FX v2 Layer (`glass-fx.css` + `js/features/glass-fx.js`)
- The dashboard's current look, layered on top of `glass.css`: static canvas aurora, thicker corner-lit bevels (lit top-right/bottom-left, shaded top-left/bottom-right), layered lift shadows, prismatic lit-corner rims, a fluid pulsing light for the icon link/task indicator (replaces the old glossy bead), feathered colored glows, staggered "breathing" pulses, pointer-caught rim light
- Every rule is scoped under `html[data-fx="v2"] body[data-style="glass"][data-theme]` (`index.html` sets `<html data-fx="v2">`). Keep the prefix on new rules: it also supplies the specificity these rules need over `glass.css`
- New visual work goes in `glass-fx.css`, in its matching section (tokens → canvas → shells → tiles → indicator → quick access → reminders → pills → swatches → matrix → timers → controls → dialogs → pointer light → dark → sunset → keyframes → a11y guards)
- Decoration only: never changes geometry (the grid engine measures content), never touches icon images, and color-swatch copy pills keep their exact `--copy-base` core
- Animations are opacity/transform only on small pseudo layers, with staggered phases; reduced-motion and reduced-transparency guards live at the end of the file

### Dark Mode
- Toggle in Settings modal
- Colors stored as `{ light, dark }` objects for independent theming
- **Invert colors in dark mode** (for dark logos): a toggle in the icon edit popover (`icon.invertDark`, key deleted when off) and in the logo image editor (`header.companyLogoInvertDark`, explicit boolean because header objects merge key-by-key). Both toggles are shown only in dark mode; hidden, they leave the saved value unchanged. Renderers add `.invert-dark` to the image; `body[data-theme="dark"] .invert-dark` applies the inline SVG filter `#invert-dark-filter` (index.html): each pixel keeps the brighter of itself and its hue-preserving inverse (invert → hueRotate 180 → feBlend lighten), so dark greys flip toward white proportionally, dark colours lift to their light tone, bright pixels stay. Applied to card icons, the header logo, Quick Access copies (matched to the source icon by image + url), search results and task linked-item minis. `invertDark` is in the JSON export/import icon whitelist
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
- `migrateBase64ToR2()` - Auto-migrate legacy Base64 images (header, icons, and images embedded in rich text)
- `cacheFileBlob(fileId, blob)` - Seed the blob cache with bytes already in hand (just-uploaded images)
- `getAllReferencedFileIds()` - Every fileId the profile (and edit-mode working copy, for rich text) still uses
- `reconcileTaskHighlights(container)` - State-based highlight reconciliation

### Tasks
- `createTask()` / `updateTask()` / `deleteTask()` / `completeTask()`
- `getTasksByColor(color)` / `getAllTasks()` / `getCompletedTasks()`
- `openAddTaskModal()` / `openEditTaskModal(taskId)`
- `openItemTasksModal(type, key, sectionId, subtitle)`
- `refreshTaskViews()` - Repaint the matrix, item tasks modal, cards/badge and an open calendar after a change made outside the editor
- `generateSubtaskId()`

### Time Tracking & Categories
- `toggleTaskTimer(taskId)` / `stopTaskTimer()` / `isTaskTimerRunning(taskId)`
- `startTimerForTask(taskId)` (start only, returns `{ started, start, switchedFrom }`) / `undoTimerStart(info)` (quick capture Undo)
- `stopTimerForTask(taskId)` (before complete/delete) / `syncTaskTimeMeta(task)` (after title/category edits)
- `toggleTimeTracking()` / `renderTimeTrackingPanel()` / `refreshTimeTrackingUI()`
- `getTaskCategories()` / `getTaskCategory(id)` / `categoryColor(category)` / `openTaskSettingsModal()`
- time-log.js: `startTaskTimer` / `stopActiveTimer` / `getTaskTotalMs` / `getTaskTotals` / `removeSession` / `clearTaskTime` / `mergeTimeLogs` / `prepareImportedTimeLog`
- time-log.js periods: `TIME_RANGE_PRESETS` / `normalizeRangeFilter(raw)` / `resolveTimeRange(filter, nowMs)` → `{ start, end (exclusive), from, to }` or null / `getTaskTotalsInRange(log, now, range)` / `toDayKey` / `dayKeyToDate`

### Projects & Meetings
- `openProjectsModal()` / `closeProjectsModal()`
- `openMeetingsModal()` / `closeMeetingsModal()`
- `attachTaskMention(editor, onInsert)` - Wire @ autocomplete to an editor
- `attachHighlighterContextMenu(editor, options)` - Wire right-click menu

### Calendar, Badge & Today
- `openCalendarView()` / `closeCalendarView()` / `refreshCalendarView()` (re-render if open)
- `updateNotificationBadge()` (also repaints an open calendar + Today) / `wireNotificationBadge()`
- `getDueItems()` (calendar.js) = `collectDueItems(currentData(), { todayKey, reminderDays: reminderDaysLeft })`
- `openTodayView()` / `closeTodayView()` / `toggleTodayView()` / `refreshTodayView()`
- agenda.js: `collectDueItems` / `countDueItems` / `meetingDatesBetween` / `meetingOccursOn` / `dueState` / `daysBetween` / `addDays` / `TASK_COLOR_ORDER`
- `createTaskPillElement(task)` (tasks.js) / `createCardItemElement(type, item, sectionId, subtitle)` (sections.js): the real pill / card item outside its panel
- `getQuickAccessItems()` / `reconcileQuickAccessItems()` / `openQuickLinkModal()` (quick-access.js)

### Item Creator & Drop Light
- `openItemCreator({ sectionId, subtitle?, cardEl? })` / `closeItemCreator()` / `isItemCreatorOpen()`
- `showDropLight({ x, y, length, vertical })` / `hideDropLight()` (viewport coordinates)
- `resolveIconMedia(chosenMedia)` (sections.js, exported): media-library entry → R2 ref when signed in, else Base64

### Quick Capture
- `initQuickCapture()` (N key + header bolt) / `openQuickCapture()` / `closeQuickCapture()`
- `showActionToast(message, actions)` (exported; the item creator reuses it for Undo)
- quick-capture-parse.js: `parseQuickCapture(text, { now, categories })` / `matchCategory()` / `normalizeUrl()` / `toDateKey()` / `fromDateKey()` / `QUICK_CAPTURE_HELP`

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

Each editor needs: toolbar HTML buttons, click handlers, `attachHighlighterContextMenu()`, `attachChecklistHandler()`, `attachImageResizeHandler()` + `attachImageUpload()` (pasted images → R2), toolbar state update with checklist support, `handleEditorInput`/`handleEditorKeydown` wiring. Save the editor's HTML through `normalizeDescHtml()` / `stripHydratedImageSrc()` so stored images keep only their file reference.

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

### v5.2 (Current)
- **Task time tracking**: stopwatch on every task pill, exact start/end sessions saved with the profile, Time Tracking panel (tracked tasks + sessions, category donut) replaces the old standalone timers
- **Task categories**: category chips in the task editor; Settings → Tasks → Task Settings to manage them
- **Categories period filter**: funnel button above the category legend: Today, This week, Last 14 days, This month, Last month, This year, or a custom From/To range; Clear returns to all time. Remembered per browser
- **Complete button on task pills and Time Tracking rows**: circle check left of the stopwatch; asks, then completes the task. Dragging a task onto the header checkmark now asks the same question
- Cloud sync merges the time log before each upload (multi-device safe for time data) and no longer drops changes made during an upload
- **Pasted images go to R2 file storage** (not the 2 MB profile): paste/drop in any rich-text editor uploads, the note keeps `<img data-r2-file-id>`, existing embedded images migrate on sign-in; File Manager groups Images / Documents and its delete no longer double-fires
- **Quick capture**: N anywhere (or the Mobile-layout header bolt) → one line with dates, `!commands`, `@task` and `!category:` pickers, live preview, ⓘ command list, Open/Undo toast
- Task editor: the Linked Project/Meeting row is hidden again for tasks without one (`.task-editor-field[hidden]`)
- **Quick-add in view mode**: "+" on each card's title bar opens one "add item" window (icon / subtask / reminder / copy-paste / separator); saved straight to the profile, with Undo. Edit mode's "+" tiles use the same window, so new items are never blank placeholders
- **Separator placement**: pick where a separator goes; markers in every gap between icons, a glowing beam follows the pointer, click / tap to drop
- **Reorder drop light**: the glowing beam now shows where a dragged item lands inside the Card Edit Modal (the old line rendered behind the modal)
- **Today view** (header sun button, replaces the Quick Access panel): due today & overdue tasks by color with their due subtasks (complete with Undo), meetings today, due reminders, and Quick Access, all as the real working items
- **Calendar from the badge**: the badge is always shown (count, or a quiet calendar lens) and opens the calendar, now with the Due Today + Overdue list beside the month (the old badge popover is gone)
- Shared due rules (`core/agenda.js`): past one-time meetings no longer count as overdue, recurring meetings count without opening the calendar first, counter reminders never count
- File-linked subtasks and reminders open their file when clicked in view mode (they did nothing before); old Quick Access entries are repaired so holding the item removes it

### v5.1
- **Glass FX v2** overlay (`glass-fx.css`, `glass-fx.js`): more lift and 3D, fluid pulsing indicator light, feathered colored glows, playful transparency

### v5.0
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
