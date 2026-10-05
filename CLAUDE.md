# Personal Dashboard - Documentation

## Overview
A fully customizable personal dashboard built with vanilla JavaScript, HTML5, and CSS3. No frameworks. Data persists in browser localStorage (fast cache) and Cloudflare D1 (durable cloud storage) with JSON import/export backup.

**Hosting**: Public GitHub repo served via GitHub Pages (static site, client-side only)
**Backend**: Cloudflare Workers (API + Viewer), D1 database, R2 file storage
**Phones**: always the mobile shell (a tabbed app frame: Tasks · Today · + · Write · Links), never the grid; see Mobile Shell

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
  ideas: [{ id, title, description }],   // rich text lives in `description` (not `content`)
  // pinned: true or key deleted; createdAt / updatedAt epoch ms (updatedAt moves only on a real change).
  // subtaskNotes["sectionId:subtitle:itemKey"] holds the same shape for subtask notes
  cardNotes: { [sectionId]: [{ key, title, content, color?, pinned?, createdAt?, updatedAt? }] },
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
├── index.html               # Page + modals; mobile boot script (<script data-mx-boot>) and the static #mobile-shell skeleton
├── styles.css               # Structural styles
├── glass.css                # Glass visual system (loaded after styles.css)
├── glass-fx.css             # Glass FX v2 layer (loaded after glass.css; scoped under html[data-fx="v2"])
├── writing.css              # Writing engine styles (one numbered section per writing module)
├── mobile.css               # Mobile shell frame (loaded after writing.css): hidden desktop chrome, tokens, top bar, dock, +, lane, sheets, preview, toast lane
├── mobile-tasks.css         # Mobile Tasks tab: chips, panes, rows, swipe / drag / carry, actions + Move sheets, Completed
├── mobile-compose.css       # Mobile composer (the +): kinds, line, tray, panels
├── mobile-write.css         # Write tab + the writer frame the 7 reused editors become
├── mobile-today.css         # Today tab, Time sheet, More sheet; reused calendar / auth / task settings / file manager on a phone
├── mobile-links.css         # Links tab, icon grid, item sheet, Search, File sheet; reused item creator / media library on a phone
│                            # (every mobile*.css rule is scoped under html[data-shell="mobile"])
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
│   │   ├── writing-commands.js # Pure writing registry: every command, its keys / markdown / slash aliases / tiers, key matching, help builder
│   │   ├── writing-rules.js # Pure typing rules: block + inline markdown triggers, smart typography, autolink, safe URLs, help rows
│   │   ├── writing-templates.js # Pure built-in templates (canonical HTML with {{date}} {{time}} {{title}})
│   │   ├── markdown.js      # Pure HTML parser, HTML↔Markdown, allowlist sanitizer, plain text, word stats (no DOM, Node-testable)
│   │   ├── mobile-device.js # Pure phone rule (short side < 600px + coarse pointer), MOBILE_BUILD, device mode, ms to midnight (mirrors the boot script)
│   │   ├── mobile-sync.js   # Pure sync stamps: device id, makeSyncStamp, decideSync (idle / push / pull / conflict), seen stamps
│   │   ├── mobile-nav.js    # Pure history depth model: planHistory, pickTopLayer, planBack
│   │   ├── mobile-common.js # Pure shell helpers: orderCardsForMobile, cardTitle, firstLineTitle, shortDay, relativeTime, phaseFor
│   │   ├── mobile-tasks.js  # Pure Tasks rules: lens counts, default lens, planPlacement / applyPlacement, snapshots, row meta, GESTURE
│   │   ├── mobile-compose.js # Pure composer rules: setTokenField, defaults, buildComposerPlan, line text, date chips, notes
│   │   ├── mobile-write.js  # Pure Write data: collectDocs, searchDocs, snippets, meeting labels, recent + drafts lists
│   │   ├── mobile-today.js  # Pure Today shaping: buildToday (lanes from collectDueItems), dueSummary, comingUp
│   │   ├── mobile-links.js  # Pure Links rules: normalizeGroups, cardSummary, icon labels, searchAll, summary fitting
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
│   │   ├── glass-fx.js      # FX v2 pointer-caught rim light (constructed stylesheet, no DOM writes)
│   │   ├── mobile/          # The mobile shell (see Mobile Shell below); intra-folder imports carry ?v=<MOBILE_BUILD>
│   │   │   ├── shell.js     # Mount/unmount, render scheduler + loop guard, screen/service registries, unit loader, chrome, lifecycle, the api
│   │   │   ├── layers.js    # Layer registry, built-in layers, history depth model (phones), Escape (preview)
│   │   │   ├── sheet.js     # openSheet / pushScreen: z 940-958, inert background, drag to close
│   │   │   ├── ui.js        # patchList, createMover, animate, haptic, store, segmented, chip
│   │   │   ├── viewport.js  # --mx-vvh / --mx-vv-top / --mx-kb and html[data-mx-kb] from the visual viewport
│   │   │   ├── sync-guard.js # Phone push (2.5s debounce + retries), hide flush, resume check, push gate, conflict sheet, other-tab reload
│   │   │   ├── tasks-view.js # Tasks tab (entry): segment + colour chips, panes, Lift & place; services taskRow / taskActions / completed
│   │   │   ├── task-row.js  # createTaskRow: ring, 2-line title, meta, the real stopwatch; modes list / today / search
│   │   │   ├── task-gestures.js # The touch controller: press / swipe / lift / drag / carry, tap shield
│   │   │   ├── task-actions.js # placeTaskWithUndo, completeWithUndo (batched), restore, actions sheet
│   │   │   ├── move-sheet.js # 2×2 Eisenhower Move sheet
│   │   │   ├── completed-view.js # Completed pushed screen
│   │   │   ├── composer.js  # The + composer (entry): kinds, line + tray, panels, commit / Undo, draft; service composer
│   │   │   ├── write-view.js # Write tab (entry); service writer
│   │   │   ├── writer.js    # The 7 reused editors as writer frames: open / create / jump-in, Back = keep, drafts, writer-bar extras
│   │   │   ├── today-view.js # Today tab (entry); services time, more
│   │   │   ├── time-sheet.js # Time sheet (running timer + the re-hosted #time-tracking-card)
│   │   │   ├── more-sheet.js # More sheet (avatar): account, sync, theme, settings entry points, backup, Not on mobile
│   │   │   ├── links-view.js # Links tab (entry); services items / search / links; window.openFile wrapper
│   │   │   ├── card-items.js # Real card items on touch (enhance), item sheet, labelled icon grid builders
│   │   │   ├── search-view.js # Search pushed screen
│   │   │   └── file-sheet.js # openFileMobile + File sheet
│   │   └── writing/         # The writing engine (see Writing Engine below)
│   │       ├── editor.js    # attachWritingFeatures / attachWritingView, api, key dispatch, toolbar additions, basic commands, prefs
│   │       ├── dom.js       # Selection/range/block helpers, undo-safe exec wrappers, cleanEditorHtml, isEffectivelyEmpty
│   │       ├── ui.js        # Popups: anchored menus, caret-anchored lists, popovers, icons, kbd rendering
│   │       ├── blocks.js    # Headings/quote/callouts/toggles/code blocks/tables/dividers, Enter/Tab/Backspace in blocks, table tools, move/duplicate
│   │       ├── input-rules.js # Markdown-as-you-type, inline marks, smart typography, escapes, Backspace-undo of a conversion
│   │       ├── menus.js     # "/" slash menu, "@" date rows, "[[" doc picker, ":" emoji
│   │       ├── refs.js      # Date + doc-ref chips: labels, title refresh, clicks
│   │       ├── links.js     # Ctrl+K link popover, link card, autolink, paste URL over selection
│   │       ├── paste.js     # Clean HTML paste, Markdown paste (+ Undo toast), Ctrl+Shift+V plain paste
│   │       ├── find.js      # Find & replace bar (CSS Custom Highlight API)
│   │       ├── doc-tools.js # Status line (words/chars/read time/checklist) + outline popover
│   │       ├── focus.js     # Focus mode (full-screen sheet, typewriter scrolling, outline rail)
│   │       ├── export.js    # Export menu: .md, PDF (print iframe), copy Markdown / formatted; templates menu + empty hint
│   │       └── help.js      # Shortcuts & commands window, writing preferences, Settings entry, global "?"
│   └── components/
│       └── sections.js      # Section rendering (icons, lists, reminders, copy-paste)
├── assets/
│   └── icons/app-icon.svg, app-icon-180.png # apple-touch-icon (PNG rendered by Reference/mobile/render-app-icon.cjs)
└── Reference/               # (gitignored) Backend docs, screenshots, working context
    ├── writing/             # Writing engine build spec (SPEC.md), plan, code maps, research digests
    ├── mobile/              # Mobile shell build spec (SPEC.md), unit notes (notes/F0…F6, requests.md), shoot-f*.cjs screenshot tools, baseline/ (tablet + desktop before/after)
    ├── wr/                  # Playwright harness (harness.cjs) + browser suites: smoke-e2e, qa-foundation-e2e, blocks-, input-rules-, menus-, links-, find-, focus-, export-, help-, notes-e2e; mobile-lib.cjs + mobile-shell-, -tasks-, -create-, -write-, -today-, -links-, -integration-e2e
    ├── writing-commands-test.mjs / writing-rules-test.mjs / writing-templates-test.mjs / markdown-test.mjs # Node tests for the pure writing modules
    ├── mobile-device-test.mjs / mobile-sync-test.mjs / mobile-nav-test.mjs / mobile-common-test.mjs # Node: phone rule + boot-script parity + ?v= specifier check, sync decisions, history plan, shell helpers
    ├── mobile-tasks-test.mjs / mobile-compose-test.mjs / mobile-write-test.mjs / mobile-today-test.mjs / mobile-links-test.mjs # Node: each unit's pure module on the real profile
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
- **Sync stamp**: every `saveModel()` payload carries `_sync: { device, at }` (mobile-sync.js; payload only, never in `model` or an export); `restoreModel` records a foreign stamp as seen; `cloudSave()` stamps an upload that has none (a JSON import) and, between its GET and its PUT, asks `window.__mxPushGate` (installed on phones only; see Mobile Shell → Sync). The desktop has no gate: last write wins there, as before
- **Change event**: every successful `saveModel()` raises one coalesced `window` event `model:saved` per microtask (`detail.seq`, `window.__modelSaveSeq`): the mobile shell's repaint funnel. Node-safe (no window, no event)
- **Rich text is sanitized on the way in**: `sanitizeStoredRichText()` (storage.js) runs in `restoreModel` (covers cloud profiles, which arrive via localStorage + reload) and on JSON import; it passes project/meeting/idea/task/subtask/note HTML through markdown.js `sanitizeStoredHtml` only when it holds something dangerous (script, on* handlers, javascript: links, overlay classes), leaving clean fields untouched. The editors' render sites also guard before `innerHTML`

---

## Core Features

### Edit Mode
- Toggle via pencil button (bottom-right, 62×62px)
- Creates working copy; changes only save on confirm (✓) or discard on cancel (×)
- `currentData()` returns working copy when editing, model otherwise
- Not in the Mobile layout: `toggleEditMode()` refuses to enter there (toast `Card editing is on the tablet and desktop layouts`); leaving always works. Layout switches are refused while editing

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
- **N anywhere** (not while typing in a field, no Ctrl/Alt/Meta) opens a one-line bar above everything (`#quick-capture`, z-index 100100); the header bolt `#quick-capture-toggle` does the same and is shown only when the Mobile layout is active (`body[data-device="mobile"]`). Off in edit mode (toast): tasks made there would only live in the working copy. In the mobile shell (header hidden) the + and N open the mobile composer instead, which commits through this module's `createFromPlan` / `updateFromPlan` / `undoCapture`; the bar is only its fallback
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
- The mobile shell never opens this modal: its Today tab is rebuilt from the same agenda rules (below). While the shell is mounted `window.refreshTodayView` is wrapped to repaint the shell too

### Mobile Shell (`js/features/mobile/` + `js/core/mobile-*.js` + `mobile*.css`)
In the Mobile layout the dashboard is not a shrunken grid but a body-level app frame built for a thumb. Build spec + unit notes: `Reference/mobile/SPEC.md`, `Reference/mobile/notes/` (F0 foundation, F1 Tasks, F2 composer, F3 Write, F4 Today, F5 Links, F6 integration; the code wins where they differ).
- **Frame**: static skeleton `#mobile-shell` in index.html (chrome on the first paint; units render inside its nodes, never replace them). Top bar: avatar + sync dot (→ More) · slot (title, or the Tasks segment) · ⌕ Search · due lens `#mx-due-lens` (`countDueItems(getDueItems())`, badge recipe → calendar). Floating frosted dock `#mx-dock` Tasks · Today · (+) · Write · Links; while a timer runs, the emerald now-playing lane `#mx-live` above it (title, live clock, Stop; body → Time sheet). The desktop header, grid, FABs, matrix, Today / completed modals and sticky notes are `display: none !important`
- **Phone rule + boot script**: phone = screen short side < 600px AND a coarse pointer (`isPhoneScreen`; landscape phones stay phones). Phones always load Mobile and never unmount. `<script data-mx-boot>` (index.html, before any stylesheet) repeats the rule and sets `html[data-shell="mobile"]` + `[data-phone]` (and `viewport-fit=cover`) or `[data-shell-frame="preview"]` (a computer); a small touch-only tablet in Mobile (coarse pointer, no hover, short side < 768: an iPad mini, an unfolded foldable) gets the shell at full width with no frame attribute (`shellFrame()` → `'full'`; otherwise like the preview: no phone paths, Layout in More), so a phone never flashes the desktop; `mobile-device-test.mjs` runs it in a vm against mobile-device.js so they can't drift
- **Preview** (a computer that chose Mobile): the same shell in a 390px column (`--mx-col` / `--mx-inline`, reused modals pinned to it) with `#mx-preview-switch` `[Mobile | Tablet | Desktop]` beside it (hidden under 760px wide: More → Layout). No history; Escape closes the top layer; N = composer, `/` = Search
- **Mount / unmount** (`shell.js` `syncMobileShell(mode)`: mounts for `'mobile'` unless edit mode is on, else unmounts; preview only): mount asserts the `<html>` attributes + a `theme-color` meta, closes desktop panels without writing the model, starts viewport / layers / lifecycle / (phones) the sync guard, wraps `window.refreshTodayView` + `window.renderAuthUI` to repaint the shell too, loads the 5 units, opens the last tab (if the last visit was < 30 min ago, else Tasks), renders, sets `#mobile-shell[data-ready="1"]`, emits `'mount'`. Unmount emits `'unmount'` (units clean up), removes wraps, listeners and every `data-mx-*`, and restores `#time-tracking-card` from `timeTrackingExpanded`
- **`renderAllSections` branch** (its first statement): in the Mobile layout → `syncMobileShell('mobile')`, remove grid `section.card`s, `applyCellSize()`, `renderMobileShell('sections')`, `updateNotificationBadge()`, return. Every existing repaint (theme, sign-in, cloud load, import, item creator, Quick Access, `refreshTaskViews`) reaches the shell through it; `renderEisenhowerMatrix` is skipped under the shell
- **Units + tabs**: one entry module per unit (tasks-view, composer (no screen), write-view, today-view, links-view), loaded by versioned `import()`, each registering screens / services / layers through the shell `api` in `init(api)`; consumers handle a missing service, a failed import shows `Couldn’t load this tab · Retry`. Tab switches render once, synchronously, keep each tab's scroll, set `html[data-mx-tab]` and are not history entries (Back on Today / Write / Links → Tasks; on Tasks with nothing open it leaves the app). Dock, + and lane hide while `html[data-mx-kb]` or `[data-mx-compose]`
- **Tasks** (`tasks-view.js` + pure `mobile-tasks.js`): one bucket at a time: segment `Primary N | Secondary N` (= `pinned`) in the top-bar slot × sticky chips `All · red · orange · yellow · blue` (counts, a breathing hot dot when something there is due / overdue; empty chips still take drops). `defaultLens`: the remembered colour if non-empty, else All when the segment holds ≤ 10, else the first busy colour. A colour = one tinted pane (`.mx-pane.eisenhower-priority-card-<c>`), All = 4 panes (empty = dimmed header). Lens per browser, published with `api.setContext({ lens })`. Rows (`createTaskRow`, not the matrix pill): 44px complete ring, 2-line title, meta, the real stopwatch; rebuilt only when `rowSignature` changes; modes `list` / `today` / `search`
- **Gestures** (`task-gestures.js`, `GESTURE`): tap = open read-first · ring = complete · swipe → past 40% (or a fling) = complete · swipe ← past 72px reveals `⇣ Secondary` / `⇡ Primary` + `⋯` (never commits) · 24px edge guards · hold 380 ms (or `contextmenu`) = lift → drag onto a gap, a pane header, a colour chip or the other segment (anything else glides back). Released still = **Lift & place** (`html[data-mx-carry]`, carry dock `Moving “…” · Move… · Cancel`, glowing gaps to tap, chips / segment switch the lens; the `carry` layer). Ghost, swipe and beam move through paused Web Animations, renders wait for the finger, `shieldTaps()` drops a double tap's second tap after something opens (trusted events only)
- **Undo + renumbering**: every move toasts Undo (`placeTaskWithUndo`: `planPlacement` → `updateTask` if the colour changes → `applyPlacement` → one save; Undo restores the snapshot unless `colorsSignature` moved on). The index is a position inside the TARGET bucket counted without the task; the target colour (and the source colour when it changed) is renumbered `0..n-1` in display order (Primary first), which heals old gaps and collisions; a group change without an index: demote → top of Secondary, promote → end of Primary; a no-op writes nothing. Completions batch into `N completed · Undo` (exact index back via `restoreCompletedTask`). Also: the actions sheet (`⋯`), the 2×2 Eisenhower **Move sheet** (live quiet moves, ONE summary Undo on close) and the **Completed** pushed screen (Restore with Undo, Delete, Clear all)
- **Composer** (`composer.js` + pure `mobile-compose.js`): the + focuses a keyboard-docked sheet (`bottom: var(--mx-kb)`) in the same tap (DOM built at init, so iOS raises the keyboard). Kinds Task · Note · Idea · Project · Meeting. The line is the desktop quick-capture grammar (dates, `!commands`, `\` escapes, `@task` change mode); the tray (colour, Primary, date, timer, category) shows effective values and a tap REWRITES the line (`setTokenField`), so the line is the only truth. Empty fields default from the Tasks lens, else the last commit (`composer.defaults()`). The form `submit` is the only Add path; tasks go through `createFromPlan` / `updateFromPlan`, the composer stays open for rapid entry, and its own line says `✓ Added “…” · Undo · Show` (`undoCapture(record, { silent: true })`). Note / Idea save directly (Expand opens the writer), Project / Meeting open the writer. Closing keeps the draft (`dashboard_mobile_compose`, 24 h); tray controls prevent `pointerdown` so the keyboard stays up
- **Write** (`write-view.js` + pure `mobile-write.js` `collectDocs`): search, sticky filter chips (+ `in: <card> ×` from Links), Continue writing, Recovered drafts, then Projects, Ideas, Meetings and Notes grouped by card in desktop reading order; row `⋯` for rename / delete / pin / copy. **Writer frames** (`writer.js` + `mobile-write.css`): the 7 reused editors (task editor, subtask description, projects, ideas, meetings, notepad sheet, note viewer) keep their code; CSS makes each a full-screen frame fitted to the visual viewport (`--mx-vvh` / `--mx-vv-top`): 52px writer bar (back chevron, title, the primary action), 17/1.6 text, inputs ≥ 16px, the toolbar one sideways-scrolling row on the keyboard. Documents open read-first (no keyboard until you tap in or Edit); meeting jump-in adds a dated `<h2>` (stripped if left untouched); `writing/ui.js positionPopup` clamps menus to the visual viewport
- **Back = keep** (user decision): Back and the frame's × run one adapter per surface that SAVES a touched document (empty names become `firstLineTitle(…)` / "Untitled …"; an empty note is not saved) and just closes an untouched one; Back never asks `confirm()`, only the explicit Cancel / Discard buttons do. Dirty = baselines from `writingApi.hooks.load`, `taskEditorHasChanges()`, `isNotepadDirty()`. **Drafts**: on page hide every open dirty writer is snapshotted (`writer.keepAll`; projects just save) into `dashboard_mobile_write.drafts` (≤ 10) and offered back (`Unsaved text from 10:42 · Restore · Discard` in the frame, over a read view — a task's description, an idea, a meeting, a note — or in the subtask description frame; a Write row for a never-saved doc). A stored draft is dropped only when this frame session snapshotted it, or the user restored / discarded it: never one the user wasn't shown. A meeting jump-in's untouched heading is removed on Back, other field edits are still kept. Drafts and the composer draft are per account (`api.store(ns, { perAccount: true })` → `dashboard_mobile_<ns>@<username>`). Pull-to-refresh is off while mounted
- **Today / Time / More** (`today-view.js` + pure `mobile-today.js` `buildToday` over `getDueItems()`, so it agrees with the due lens and calendar; today.js untouched): due & overdue panes per colour (Tasks rows in `today` mode, due subtasks on a rail), meetings today (→ meeting / Notes jump-in), due reminders (real card items), Coming up · next 7 days, `Calendar ›` (full-screen). **Time sheet** (lane, More): the running timer + the desktop `#time-tracking-card` RE-HOSTED (moved in, put back exactly; `toggleTimeTracking()` never called). **More** (avatar): account + sync (Sign in / Sync now / Resolve), Light | Dark and Classic | Sunset (synced, as on desktop), Time tracking, Completed, Task categories, Writing & shortcuts, Cloud files, Backup, Not on mobile, Layout (preview only), Sign out
- **Links / Search / Files** (`links-view.js`, `card-items.js`, `search-view.js`, `file-sheet.js` + pure `mobile-links.js`): Quick Access, then the cards as an accordion in desktop reading order (`orderCardsForMobile`; open state per browser in `dashboard_mobile_links`, never `collapsedCards`). Bodies hold the REAL items (`createCardItemElement`), icons as a labelled 64px grid (`labelForIcon`); `items.enhance(host)` stops a scroll from toggling Quick Access and turns the link / task toggles into an **item sheet** (no floating bubbles). Card ＋ = item creator (no Separator tab), `Notes n` = Write. Search (⌕, input focused in the tap): `searchAll` → Tasks · Writing · Links · Cards · Completed. `window.openFile` is wrapped while mounted: images in a File sheet, other files in a window opened inside the tap, `Sign in to open files` when signed out
- **Not on mobile** (listed under More → Not on mobile): edit mode and all card layout work, editing / deleting existing card items (adding works), separators, sticky notes (`initStickyNotes()` skipped on phones), header photo / logo editing, linking tasks to card items and subtask templates, image resize handles, keyboard shortcuts
- **Change funnel**: `renderMobileShell(reason)` coalesces every request (`model:saved`, the sections branch, the wraps, visible, midnight, `storage`, tab, lens) into one microtask flush: chrome + the active screen, skipped when its `signature(ctx)` is unchanged (`FORCE` reasons always render); inactive screens go stale and render when shown. **Loop guard**: `handledSeq = __modelSaveSeq` at the end of each render, so a save made during a render (getters that repair data) arrives with `seq ≤ handledSeq` and is ignored. A render NEVER calls `renderAllSections`, `updateNotificationBadge`, `refreshTaskViews` or `renderEisenhowerMatrix`; shell actions call the data API (`completeTask`, `updateTask`, …) + `refreshTimeTrackingUI()`. Renders wait while any owner holds `api.setGestureActive(true, owner)`; lists are keyed patches (`api.patchList`); live clocks write `Text.data` only
- **Layers + history** (`layers.js` + pure `mobile-nav.js`): anything Back closes is a layer `{ id, root, isOpen, back, kind: 'shell' | 'reused' }` (last registration wins; built-ins cover every reused modal / popover, F3 replaces the 7 writer layers); top = highest computed z. **Depth model (phones)**: one `{ mx: depth }` entry per open layer + one while a tab other than Tasks shows, pushed by a MutationObserver in the opening tap's microtask (user activation, so never skippable); closes trim with `history.go(-n)` + an ignore counter; `popstate` reads the depth from the entry, closes the top layer / goes home / lets the browser leave, and NEVER pushes. `history.scrollRestoration = 'manual'` on phones while mounted. **Sheets** (`sheet.js`): the chrome behind is `inert`, but `#mx-screens` gets `aria-hidden` + a focusin guard instead (inert on it restyles every row); closing gives the focus back to the opener (the composer too, on a dismiss); a sheet without a title is named by its body's heading. Toasts on `#toast` are read out through `#mx-live-region`
- **Sync on phones** (`sync-guard.js` + pure `mobile-sync.js`): push 2.5 s after a save (retries 4 / 8 / 16 s), on page hide and `online`. "Dirty" is `hasUnsyncedChanges()` (sync.js: the in-memory flag OR the persisted `__dirty` flag), so changes left by a page that started offline still push, show as pending and are never pulled over. The gate `window.__mxPushGate` (Storage & Sync) holds any upload when the cloud copy carries a foreign stamp this browser hasn't seen and local changes exist (`decideSync` → conflict; `cloudSave()` returns `{ ok: false, held: true }`, no toast), so every push path is covered. It fails closed: when that GET failed (5xx, dropped connection; a 404 = no profile yet passes), `cloudSave()` returns the GET failure and the push retries instead of uploading blind. Resume (≥ 60 s hidden, nothing open): `cloudLoad()` → idle (no reload) / push / pull (adopt, time log merged) / **conflict sheet** (Keep this phone's version · Use the other device's version · Decide later). A second tab: the `storage` event reloads in place. Avatar dot: none synced, amber waiting, red failed / conflict, grey ring signed out. The desktop has no gate (user decision)
- **z-index plan**: every shell layer < 1000, so every reused modal (lowest 1500) stacks above: sub-bar 880, top bar 900, lane / carry 910, dock 920, + 930, preview switch 935, sheet scrim / sheets 940 / 950 (+2 per stacked sheet, max 958), composer 970 / 980 (its help 985 / 986), drag ghost 990 (`--mx-z-*`, mobile.css §1). **Toast lane** (mobile.css §8): `#toast` / `#qc-toast` sit above the dock, + and lane, on the keyboard (`data-mx-kb`) or above the composer (`--mx-compose-h`); the composer never uses bottom toasts
- **Versions**: `main.js` imports `shell.js?v=<MOBILE_BUILD>`; every specifier into `js/features/mobile/` carries `?v=<MOBILE_BUILD>` (units: ``import(`./${file}?v=${MOBILE_BUILD}`)``) and NO other specifier has a query (one instance of every shared module and `js/core/mobile-*.js`); optional cross-unit exports use namespace imports. **Bump `MOBILE_BUILD`** (mobile-device.js) with the main.js shell specifier, every intra-folder `?v=`, the six `mobile*.css?v=` and `js/main.js?v=` in index.html; `mobile-device-test.mjs` checks them all
- **CSS**: six static links after writing.css; structural rules under `html[data-shell="mobile"]`, glass under `html[data-fx="v2"][data-shell="mobile"] body[data-style="glass"][data-theme]` (0,5,2, no `!important` needed); classes `mx-`; tokens only, with dark / sunset / a11y guards and a landscape section per file. Each unit restates the phone rules of the reused surfaces it owns under the prefix, so the preview equals a phone. Icons and swatches are never recoloured, filtered or overlaid
- **Invariants**: the shell never writes `section.layouts`, the flat grid props, `collapsedCards`, `collapsedSubtitles` or `timeTrackingExpanded`; never gives an element `id === sectionId` (panes are `section.card.mx-card[data-section-id]`); never runs with edit mode on; never puts `transform` / `filter` / `backdrop-filter` / `contain` / `will-change` on `html`, `body`, `#mobile-shell` or `.mx-screens`. State lives in `<html>` attributes (`data-shell`, `data-phone`, `data-shell-frame`, `data-mx-*`), never class / `hidden` / style on `#mobile-shell` (glass-glow ignores `<html>`). Per-browser state only in `dashboard_mobile_<ns>` (`api.store`; unsaved writing per account), never the model. No manifest / standalone mode (just `apple-touch-icon` + the mounted `theme-color`)
- **Tests**: Node `Reference/mobile-{device,sync,nav,common,tasks,compose,write,today,links}-test.mjs`. Playwright `Reference/wr/mobile-{shell,tasks,create,write,today,links,integration}-e2e.cjs` on `mobile-lib.cjs` (`openPhone` 390×844 isMobile + hasTouch + iPhone UA + clock 2026-10-04 10:00, `openPreview` 1440×900, CDP touch hold / drag / swipe, `goBack`, `renderCount`, `snapshotLayouts`): no page errors, no sideways scroll, z < 1000, ≤ 2 renders per action, 0 idle, layouts unchanged. harness.cjs `mode: 'mobile'` defaults `hasTouch` on (a phone-sized session IS the phone frame) and is ready on `#mobile-shell[data-ready="1"]`. Desktop / tablet regression: `smoke-e2e --no-shots`, `Reference/mobile/baseline/shoot-baseline.cjs`

### Writing Engine (`js/features/writing/` + `js/core/writing-*.js` + `js/core/markdown.js` + `writing.css`)
One engine powers all 6 rich-text editors, in two tiers. Build spec + research: `Reference/writing/` (SPEC.md is the design reference; version history in it was dropped on request).
- **Tiers**: LITE = Card Notes (typing power only: markdown, shortcuts, a short `/` list; toolbar gains just Link and `?`). FULL = task description, subtask description, ideas, projects, meetings (everything below)
- **Attach**: each editor calls `attachWritingFeatures(editor, opts)` where it is set up (meetings re-attaches on every edit open; attach is idempotent and leak-free). opts: `{ id, tier, toolbar, getTitle, getDocMeta, getDocId, onChange, onSave, linkTask, makeTask, addSubtask }`. Every editor calls `editor._wr.loaded()` after (re)loading content, BEFORE taking its unsaved-changes baseline. Read-only views (`#task-desc-view-content`, `#ideas-view-content`, `.meetings-view-content`, `#note-viewer-content`) call `attachWritingView(viewEl, { id, getTitle, getDocMeta, actionsHost })` after every render (safe link clicks, toggle/copy/chip clicks, Export menu). Editors and views get class `wr-doc`
- **One registry** (`js/core/writing-commands.js` `WRITING_COMMANDS`): id, label, group, keys, markdown, slash aliases, tiers, editors. It drives the key dispatcher, slash menu, toolbar tooltips, context-menu hints and the help window, so they can't drift. Modules implement commands with `api.registerCommand(id, { run, isActive?, isAvailable? })`; a key whose command isn't registered (or returns false) goes to the browser
- **Core flow** (editor.js): capture-phase keydown → module hooks in install order (menus, blocks, input-rules, links, paste, find, doc-tools, focus, export, help, refs) → registry key match → command. Hooks: `api.hooks.{keydown,input,beforeinput,selection,click,paste,composition,load,change}`; returning true consumes the event. Plain click on a link places the caret (link card); Ctrl/⌘+click opens it
- **Shortcuts** (Mod = Ctrl / ⌘; NEVER Ctrl+Alt: on Windows it is AltGr and Canadian French AltGr+2 types `@`; digits match `e.code`, events with AltGraph or IME composition are ignored): Ctrl+Shift+0/1/2/3 text/H1-H3, Ctrl+Shift+7/8/9 numbered/bullets/checklist, Ctrl+Shift+. quote, Ctrl+Enter check item / open-close toggle, Ctrl+Shift+X (or S) strike, Ctrl+E inline code, Ctrl+Shift+H highlight, Ctrl+\ clear formatting, Ctrl+K link, Alt+Shift+↑/↓ move block, Ctrl+D duplicate, Ctrl+S save, Ctrl+F / Ctrl+H find / replace, Ctrl+P export PDF, Ctrl+Shift+F focus mode, Ctrl+/ help, Ctrl+Shift+V plain paste. Ctrl+F/H/P/Shift+F only inside FULL editors
- **Typing rules** (input-rules.js + pure `writing-rules.js`): `# ## ###`, `- *`, `1.`, `[] [ ] [x]`, `>`, `---` (both tiers); FULL only: ```` ``` ````/```` ```js ```` code, `!!` callout, `<>` decision, `+` toggle. Inline `**b** *i* _i_ ~~s~~ \`c\` ==h== [t](url)`. Smart typography `-> <- <-> => != <= >= +- (c) --` (pref). Backslash keeps a marker literal. Backspace (or Ctrl+Z) right after a conversion restores exactly what was typed. All conversions go through execCommand (undo-safe); never inside code or during IME composition. The legacy `handleEditorInput` rules are a no-op for attached editors
- **Canonical HTML** (compact, no whitespace between tags; `wr-` prefix): headings `h1-h3`; `<blockquote><div>`; `<hr>`; callout `div.wr-callout[data-kind=note|tip|decision|warning|caution]` (icon + label via `::before`, gutter click cycles kind); toggle `div.wr-toggle[data-open]` > `.wr-toggle-title` + `.wr-toggle-body` (open state is saved; toggling in a VIEW uses `data-wr-open`, never saved); code `pre.wr-code[data-lang]>code` with real `\n`; table `table.wr-table>tbody` (optional th header row); `<s>`, `<code>`; highlight `mark.text-highlight[data-highlight-color]` (colors from CSS, theme-aware, no inline style); date chip `span.wr-date[data-date=YYYY-MM-DD][contenteditable=false]`; doc ref `span.wr-ref[data-ref-type=project|meeting|idea][data-ref-id]` (title refreshed from live data, deleted target → plain text). Never put `<button>` inside content (glass-glow styles every button); UI inside an editor carries `data-wr-ephemeral` and is stripped by `cleanEditorHtml()` (dom.js), which also unwraps the image-resize wrapper. `isEffectivelyEmpty()` decides emptiness (used by `normalizeDescHtml`, notes, projects)
- **Menus**: `/` slash menu (line start / after a space; grouped, aliases, recent picks first in localStorage `dashboard_writing_recent`, `/table 4x3` sizes); `@` adds a Date section to the task mention list when the query reads as a date (quick-capture date rules; dates-only list in editors without task mentions); `[[` links a project, meeting or idea; `:smile` emoji (emoji-picker-element database, lazy). Toolbar (FULL): `Text ▾` block style, strike / code / link after U, `+` Insert menu, right group Find · Outline · Focus · Export ▾ · ?, folding into `⋯` when narrow
- **Blocks** (blocks.js): turn-into wraps the current block(s); Enter on an empty last line exits a callout/quote/toggle; Backspace at a block start unwraps it; code: Enter = newline, Tab = 2 spaces, Enter on a blank last line or ArrowDown exits; tables: Tab / Shift+Tab move cells (Tab on the last cell adds a row), floating table tools bar under the table (rows, columns, header, delete)
- **Links & paste**: Ctrl+K popover (text + URL, Remove), link card (Open / Edit / Copy / Remove), autolink on Space/Enter (pref), paste a URL over a selection = link; only http(s)/mailto/#. Paste: HTML → `sanitizeRichHtml` allowlist (markdown.js); plain text that looks like Markdown → formatted, with an Undo toast (pref); image files still go through `attachImageUpload`
- **Doc tools**: find & replace bar (CSS Custom Highlight API, case / whole word, Replace all with toast Undo); status line under FULL editors (words · characters · read time · checklist done/total, pref); outline popover (H1-H3, click jumps); focus mode (full-screen sheet, optional typewriter scrolling pref, outline rail ≥1100px, Esc exits and restores layout + caret)
- **Export** (export.js): Export ▾ in FULL toolbars and in the 4 views: Download Markdown (`<Kind> - <title> <date>.md`, images → `[image: name]`, callouts → GitHub alerts, toggles → `<details>`), Export PDF (hidden same-origin print iframe; choose "Save as PDF"), Copy as Markdown, Copy formatted (inline-styled HTML for email). Templates (`writing-templates.js`, 12 built-ins incl. Meeting notes, 1:1, Project brief, Decision record, Weekly review, Retrospective, Task brief) via `/template` or the Insert menu; empty projects/meetings/task editors show a "Start with a template" hint
- **Help** (help.js): "Shortcuts & commands" window (`#wr-help`, z 10060) with tabs Writing / Card notes / Markdown & typing / Quick capture / Dashboard / Preferences, live search, ⌘ on Mac. Opened by Ctrl+/, the `?` toolbar button, the `?` key anywhere when not typing, Settings → Writing & shortcuts, and the slash menu footer. `window.openWritingHelp(tab)`. Rows come only from the registry, `MARKDOWN_RULES_HELP` and `QUICK_CAPTURE_HELP`
- **Preferences** (per browser, localStorage `dashboard_writing_prefs`): smartTypography, autolink, markdownPaste, statusBar (on by default), typewriter (off)
- **z-index**: writing menus/popovers 100004 (above context menu 100002 / link picker 100003), focus sheet 10040 (or just above its window), help 10060; notepad 9995, note viewer 9996
- **Tests**: `Reference/wr/harness.cjs` (Playwright: real profile import, `openEditor(page, id)` for all 6 editors, `save`, `getModelValue`, `shot`) + one browser suite per module; Node tests for the pure modules

### Text Highlighter
Available in all rich-text editors (projects, meetings, tasks, subtasks, ideas, card notes):
- 5 pastel colors (yellow, green, blue, pink, purple). Clicking the pen with text selected applies the current color; the color dot (or a click without a selection) opens the swatches. Ctrl+Shift+H and typing `==text==` apply it too
- Colors come from CSS keyed on `data-highlight-color` (light + dark palettes, `!important` so old inline-colored highlights follow the theme too)
- Right-click context menu: Bold, Italic, Underline, Strikethrough, Inline code, Link…, Bullet/Numbered/Checklist, Highlight, Remove highlight, Link task, Turn into task (where available), Add as subtask (task description), each with its shortcut hint; Esc or typing closes it

### Checklists
Available in all rich-text editors via toolbar button, context menu, Ctrl+Shift+9, or `[] ` / `[ ] ` / `[x] ` markdown:
- Uses `<ul class="checklist">` with CSS `::before` circle checkboxes
- Click circle (or Ctrl+Enter) to toggle: checked items get green text, strikethrough, green filled circle with checkmark
- Enter on checked item creates unchecked new item; Enter on empty item exits list
- Tab/Shift+Tab indents/outdents (nested lists inherit `checklist` class)
- `toggleChecklist(editor)` handles conversion between list types (bullet ↔ numbered ↔ checklist); always pass the editor

### Card Notes (Notepad)
Per-card (and per-subtask) note system, LITE writing tier, color coding, and task linking.
- Saved notes list: pinned first (pin glyph), then most recently edited; chips show checklist progress (`2/5`) and an "Edited …" tooltip
- Viewer: "Edited …" meta, Pin / Unpin, Export menu (Copy as Markdown, Download .md, Export PDF), checklist items can be ticked right there (saved), links open safely in a new tab; delete offers Undo
- Esc closes the notepad (asks first if unsaved, as do × and Cancel); Ctrl+S saves; on phones it opens as a sheet
- Search (header bar) matches note TEXT (`htmlToPlainText`), covers subtask notes too, and shows a snippet around the match
- Notes viewer reconciles task highlights on open

### Settings Modal
Accessible via gear icon in edit mode. Contains:
- Theme: Light / Dark toggle
- Theme: Classic (Grey) / Sunset dropdown
- Tasks: opens Task Settings (categories)
- Writing & shortcuts: opens the Shortcuts & commands window (writing preferences live in its Preferences tab)
- JSON File Backup: Download and Upload with overwrite warning (includes `taskCategories` and `timeTracking`; importing a log resets history older than the import)
- The dialog body scrolls on short screens

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
- Profile syncs to D1 on: confirm edits, import, every 20 min while dirty; phones also 2.5 s after every save, on hide and on resume (Mobile Shell → Sync on phones)
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
- `DEVICE_MODES` in grid-engine.js: tablet (24 cols, 1260px), desktop (24 cols, 2280px). `mobile` (4 cols, 520px) is still a mode, but it renders the **mobile shell** instead of the grid (`renderAllSections` hands over; see Mobile Shell)
- The flat `gridCol/gridRow/gridColSpan/gridRowSpan` props are the ACTIVE mode's working layout — all engine/drag/resize code operates on them unchanged
- `persistActiveLayout()` (hooked into `markDirtyAndSave`) keeps `section.layouts[activeMode]` in sync; `hydrateLayout()` swaps a profile in (lazy-seeds missing profiles as a full-width stack at content height)
- **Mobile layout profiles are no longer edited**: edit mode refuses to enter in the Mobile layout and the shell never writes `layouts`, the flat props or the collapse fields, so `layouts.mobile` just keeps what it holds (the engine's single-column drop / resize guards are unreachable now). Mobile cards are ordered by the desktop layout instead (`orderCardsForMobile`)
- **Phones always load Mobile** (`isPhoneDevice()`: screen short side < 600px + coarse pointer): `getActiveMode()` returns `'mobile'`, a stored `dashboard_device_mode` is ignored there and never rewritten, and `switchDeviceMode()` refuses any other mode
- Anything else keeps the old rule: per-browser localStorage `dashboard_device_mode`, auto-detected by screen width on first visit (<768 mobile, <1600 tablet, else desktop). Choosing Mobile there shows the shell as a 390px **preview** column with a `[Mobile | Tablet | Desktop]` switch beside it (and More → Layout)
- `model.lastActiveMode` (synced) records which mode the flat props represent for cross-device restore
- `switchDeviceMode(mode)`: refused while editing (toast `Save or cancel your edits before switching layouts`); mounts / unmounts the shell (`window.syncMobileShell`) BEFORE `hydrateLayout` + `applyCellSize` measure `.app-main`
- Device picker: `#device-mode-toggle` right of the search bar shows the ACTIVE mode's icon (`updateDeviceModeToggleIcon`) → bubble with 3 options (`openDeviceModeModal` in init.js). Hidden with the header in the Mobile layout (the preview switch replaces it)

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
- `restoreCompletedTask(taskId, { color?, pinned? })` - Back from `completedTasks` to the end of its colour (linked items get the task back); the mobile Undo / Restore
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

### Writing Engine
- `attachWritingFeatures(editor, opts)` / `attachWritingView(viewEl, opts)` (editor.js; also on `window`); `editor._wr.loaded()` after loading content
- `api` (`window.writingApi`): `registerCommand`, `runCommand`, `hasCommand`, `context(editor)`, `activeEditor`, `notifyChange`, `hooks`, `prefs`, `ui`, `dom`, `registry`
- dom.js: `cleanEditorHtml(htmlOrEl)`, `isEffectivelyEmpty(html)`, `exec` / `insertHTML` / `insertText` (re-entrancy guarded), `replaceRangeHtml`, `unwrapInline`, `caretRect`, `safeUrl`, `openSafe`
- writing-commands.js: `WRITING_COMMANDS`, `matchKeyEvent(ev, mac)`, `formatKeys`, `commandsFor(tier, editorId)`, `slashItemsFor`, `buildWritingHelp(mac)`
- markdown.js: `htmlToMarkdown(html, { imageName })`, `markdownToHtml(md)`, `sanitizeRichHtml(html)`, `sanitizeStoredHtml(html)`, `htmlToPlainText(html)`, `textStats(text)`, `looksLikeMarkdown(text)`
- writing-rules.js: `matchBlockTrigger`, `matchInlineTrigger`, `matchTypography`, `matchAutolink`, `isSafeUrl`, `normalizeLinkUrl`, `MARKDOWN_RULES_HELP`
- writing-templates.js: `WRITING_TEMPLATES`, `templatesFor(editorId)`, `renderTemplate(tpl, vars)`, `templateVars({ now, title })`
- `window.openWritingHelp(tab)`; storage.js `sanitizeStoredRichText(data)`

### Mobile Shell
- shell.js: `syncMobileShell(mode)` (mounts for `'mobile'`, unmounts otherwise; true while mounted) / `renderMobileShell(reason)` / `isShellMounted()`. On `window`: `syncMobileShell`, `renderMobileShell`, `isMobileShellMounted`, `mobileShell` (`{ api, state(), openTestSheet() }`, tests), `__mxRenderCount`
- `api` (each unit's `init(api)`): `registerScreen({ id, title, mount(host), render(ctx, reasons), signature?, show?, hide?, topbar?, reveal? })`, `navigate(tab, { reveal: { taskId | sectionId } })`, `provide` / `service`, `use(unit)`, `registerLayer({ id, root, isOpen, back, kind })`, `syncHistory()`, `openSheet({ id, title, size, keyboardAware, build(body, sheet) })` / `pushScreen`, `toast(msg, actions?)`, `setGestureActive(on, owner)`, `on` / `emit` (`mount` `unmount` `hide` `visible` `day` `tab`), `render(reason)`, `getContext` / `setContext`, `store(ns, { perAccount })`, `patchList(container, items, { key, sig, create, update })`, `createMover(el)`, `animate`, `haptic`, `sync.{ status, syncNow, resolveConflict }`
- Services (`api.service(name)`): `taskRow(task, { mode, chip, contextOnly })`; `taskActions` (`openTask`, `completeWithUndo`, `completeSubtaskWithUndo`, `restoreWithUndo`, `placeTaskWithUndo(id, { color, pinned, index }, { quiet })`, `toggleGroupWithUndo`, `setDueWithUndo`, `toggleTimer`, `openActionsSheet`, `openMoveSheet`, `revealTask`, `startCarry`); `completed.open()`; `composer` (`open({ kind, from, prefill })`, `close({ keepDraft })`, `isOpen`, `defaults({ from, lens })`); `writer` (`open(kind, id, opts)`, `create(kind, fields)`, `meetingJumpIn(id)`, `showNotesFor(sectionId)`, `recent`, `searchIndex`, `keepAll`, `anyOpen`); `time.openSheet()`; `more.open()`; `items` (`enhance(host)`, `openItemSheet(type, item, sectionId, subtitle)`, `labelForIcon`); `search.open(query)`; `links.revealCard(sectionId)`
- mobile-tasks.js: `planPlacement(tasks, id, { color, pinned, index })` → `{ from, to, orders, moved, colorChanged, pinnedChanged }` / `applyPlacement` / `boundaryIndex` / `stepIndex` / `snapshotColors` / `colorsSignature` / `restoreSnapshot` / `lensCounts` / `defaultLens` / `lensTasks` / `rowMeta` / `rowSignature` / `GESTURE`
- mobile-compose.js: `setTokenField(text, field, value, opts)` / `composerDefaults` / `effectivePlan` / `buildComposerPlan` / `lineFor` / `dateChips` / `bodyToHtml` / `draftIsFresh`; mobile-write.js: `collectDocs` / `searchDocs` / `meetingWhenLabel` / `datedHeadingHtml` / `mergeRecent` / `pushDraft` / `draftFor`; mobile-today.js: `buildToday` / `dueSummary` / `comingUp`; mobile-links.js: `labelForIcon` / `iconLabels` / `normalizeGroups` / `cardSummary` / `searchAll`
- mobile-common.js: `orderCardsForMobile` / `cardTitle` / `firstLineTitle` / `phaseFor`; mobile-device.js: `isPhoneDevice` / `isPhoneScreen` / `resolveDeviceMode` / `shellFrame` / `MOBILE_BUILD`; mobile-sync.js: `makeSyncStamp` / `decideSync` / `noteRestoredStamp` / `getDeviceId`; mobile-nav.js: `planHistory` / `pickTopLayer` / `planBack`
- Shell modules: layers.js `registerLayer` / `closeTopLayer` / `historyDepth`; sheet.js `openSheet` / `pushScreen` / `closeAllSheets`; sync-guard.js `pushNow` / `status` / `resolveConflict` (+ `window.__mxPushGate`); task-gestures.js `attachGestures` / `shieldTaps`; file-sheet.js `openFileMobile`
- Exports added to shared modules for the shell: tasks.js `restoreCompletedTask`, `taskEditorHasChanges`, `closeTaskEditorModal`, `getAllIdeas` / `createIdea` / `updateIdea` / `deleteIdea`; quick-capture.js `createFromPlan` / `updateFromPlan` / `undoCapture(record, { silent })`; projects.js `getAllProjects` / `createProject` / `updateProject` / `deleteProject`; edit-mode.js `isNotepadDirty()`

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

Each editor needs: toolbar HTML buttons, click handlers, `attachHighlighterContextMenu()`, `attachChecklistHandler()`, `attachImageResizeHandler()` + `attachImageUpload()` (pasted images → R2), toolbar state update with checklist support, `handleEditorInput`/`handleEditorKeydown` wiring, and `attachWritingFeatures()` (+ `attachWritingView()` on its read-only view). Save the editor's HTML through `normalizeDescHtml()` / `cleanEditorHtml()` so stored images keep only their file reference and no writing UI is saved.

Shared logic lives in `edit-mode.js`: `handleEditorKeydown`, `handleEditorInput`, `toggleChecklist`, `isInChecklist`, `attachChecklistHandler`, `attachHighlighterContextMenu`, `createHighlighterButton`. **New writing features belong in the writing engine, not per editor**: add the command to `WRITING_COMMANDS` (keys / markdown / slash / tiers), implement it with `api.registerCommand` in the matching `js/features/writing/` module, style it in that module's `writing.css` section, and it appears in every editor, the slash menu, tooltips and the help window at once.

On phones the modals holding these editors (and the note viewer) are the mobile writer frames: `mobile-write.css` restyles them and `writer.js` wraps their close (Back = keep). A new control in an editor's header, toolbar or actions row needs a look at the frame at 390px.

### Adding Features Checklist
1. Use minimalist SVG icons with currentColor
2. Add dark mode styles (glass mode is always on)
3. Ensure data saves to model correctly
4. Only show edit controls when `editState.enabled`
5. Add confirmation for destructive actions
6. Show toast feedback for actions
7. Handle both URL and R2 file references where applicable
8. Ensure new fields are in saveModel, restoreModel, deepMergeModel, import/export
9. For rich-text editor features: go through the writing engine (registry + module), never hand-wire 6 editors
10. Keyboard shortcuts: never Ctrl+Alt (AltGr on Windows); add them to the registry so the help window lists them
11. Phones run the mobile shell: a feature reached from the header or the grid needs a way in there (a screen, sheet or More row) or a line in More → Not on mobile; a reused modal needs its phone rules under `html[data-shell="mobile"]` and a layer so Back closes it; the shell never writes layout or collapse fields

---

## Version History

### v5.4 (Current)
- **Mobile redesign**: phones get the mobile shell, a tabbed app instead of a shrunken grid: top bar (avatar → More, Search, due lens → calendar), frosted dock Tasks · Today · + · Write · Links, emerald now-playing lane while a timer runs. Phones always load it; on a computer, Mobile shows it as a 390px preview with a Mobile / Tablet / Desktop switch
- **Tasks**: one bucket at a time (Primary | Secondary × colour chips with counts and an overdue dot); tap opens read-first, the ring or a swipe → completes (batched Undo), swipe ← reveals Secondary / ⋯, hold lifts a task to drag onto a gap, a colour chip or the other segment, or let go and tap a glowing gap (Lift & place); 2×2 Move sheet, actions sheet, Completed screen with Restore. Every move has Undo and renumbers the colour cleanly
- **Composer**: the + opens a keyboard-docked line in one tap (Task · Note · Idea · Project · Meeting) with the full quick-capture grammar, a tray that rewrites the line, defaults from the Tasks lens, rapid entry with inline Undo / Show and a kept draft
- **Write**: hub with search, filter chips, Continue writing, recovered drafts and notes by card; the 7 editors become full-screen writer frames with the toolbar on the keyboard; documents open read-first; Back = keep (never a discard prompt); drafts snapshotted on page hide and offered back
- **Today, Time, More**: due & overdue by colour with subtask rails, meetings today, due reminders, coming up 7 days; the Time sheet re-hosts the Time Tracking panel; More holds account and sync, theme, completed tasks, categories, writing help, cloud files, backup and Not on mobile
- **Links & Search**: Quick Access and the cards as an accordion with labelled icons and an item sheet instead of the bubbles; one Search over tasks, writing, links, cards and completed; files open in a sheet or a window opened inside the tap
- **Phone sync**: pushes 2.5 s after a change, on hide and on resume; a device stamp in every save plus a gate inside `cloudSave()` so a phone never uploads over another device's unseen change; a conflict sheet when both changed. The Back button / edge swipe closes the top layer (history depth model)
- Tablet and desktop look and behave as before. Small shared changes: switching layouts mid-edit is refused (toast); dropping a task on the header checkmark asks once (the drop zone no longer piles up listeners); saves raise `model:saved`

### v5.3
- **Writing power-up**: one writing engine for all 6 rich-text editors (LITE card notes, FULL task / subtask / ideas / projects / meetings), driven by a single command registry
- Markdown as you type (block + inline), smart typography, Backspace-to-undo a conversion, backslash escapes
- Keyboard shortcuts for headings, lists, quote, strike, code, highlight, link, move / duplicate block, save, find, focus, PDF, help (no Ctrl+Alt anywhere)
- `/` slash menu, `@` date chips, `[[` links between projects / meetings / ideas, `:` emoji
- Callouts (note / tip / decision / warning / caution), toggles, code blocks with copy, tables with a tools bar, dividers
- Ctrl+K link popover + link card, autolink, clean HTML paste, Markdown paste, plain paste
- Find & replace, status line, outline, focus mode
- Export: Markdown, PDF, copy Markdown / formatted; 12 templates
- Shortcuts & commands window (Ctrl+/, `?`, Settings → Writing & shortcuts) with writing preferences
- Card notes: pin, sort by edit date, checklist progress, viewer export / tick items, Esc, plain-text search incl. subtask notes
- Highlighter pen applies the color; highlights follow the theme; rich text from storage / imports is sanitized; empty editors save as empty; task editor and meetings ask before discarding unsaved writing; phone layouts for the task description and meetings form

### v5.2
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
