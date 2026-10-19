# Personal Dashboard - Documentation

## Overview
A fully customizable personal dashboard built with vanilla JavaScript, HTML5, and CSS3. No frameworks. Data persists in browser localStorage (fast cache) and Cloudflare D1 (durable cloud storage) with JSON import/export backup.

**Hosting**: Public GitHub repo served via GitHub Pages (static site, client-side only)
**Backend**: Cloudflare Workers (API + Viewer), D1 database, R2 file storage; Google Calendar and Google sign-in through the API Worker (see Google Calendar, Authentication & Cloud Sync)
**Phones**: always the mobile shell (a tabbed app frame: Tasks · Today · + · Write · Links), never the grid; installable as an Android app from Chrome, no store (see Mobile Shell → Installable app)

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
    dueTime?, dueTz?,  // 'HH:MM' on the due date + the IANA zone it was set in (due-time.js); only with a dueDate
    dueEndTime?,       // 'HH:MM' when it ends: same day, strictly after dueTime, shares dueTz; only with a dueTime
                       // (updateTask drops both with the date, stamps dueTz when the time is set or changed)
    taskLinks?: [{ type: 'url', value } | { type: 'file', fileId, fileName }],
    description?, subtasks?: [{ id, title, completed, important, description?, dueDate? }],
    projectHighlight?, meetingHighlight?, noteHighlight?,
    categoryId?,  // → taskCategories[].id; unknown/deleted ids read as Uncategorized
    gcal?         // true = mirrored to the "Dashboard tasks" Google calendar (needs dueDate); only === true counts
  }],
  completedTasks: [{ ...task, completed: true, completedAt }],

  // Task categories (Settings → Tasks). A setting: always read/written on `model`
  taskCategories: [{ id, name, slot }],  // slot 1-8 = fixed chart color (--task-cat-N), max 8
  // Subtask templates (task editor save icon; edited in Settings → Tasks). A setting like
  // taskCategories: always read/written on `model`, deliberately not merged by deepMergeModel
  subtaskTemplates: [{ id, name, items: [{ title }] }],

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
├── index.html               # Page + modals; mobile boot script (<script data-mx-boot>), manifest link script (<script data-pwa-manifest>) and the static #mobile-shell skeleton
├── manifest.webmanifest     # Web app manifest (Install app on Android); relative URLs, id /dashboard/
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
│   │   ├── auth.js          # Authentication (login/register/logout/session, the data owner incl. an expired session, Google sign-in calls + the #google-signin return)
│   │   ├── sync.js          # Cloud sync (D1 profiles, per-account copies + first sign-in rules, dirty tracking, 20-min interval, time-log merge)
│   │   ├── time-log.js      # Pure time-log rules: start/stop, totals, merge, import (no DOM, Node-testable)
│   │   ├── rich-text-refs.js # Pure string rules for <img data-r2-file-id> in rich text (no DOM, Node-testable)
│   │   ├── quick-capture-parse.js # Pure quick capture rules: dates, times, !commands, escapes, resolveDue, help list (no DOM, Node-testable)
│   │   ├── due-time.js      # Pure due-time rules: 'HH:MM' keys, settleDueTime (time + end go with the date, a moved start carries the end, zone stamp), 12/24 h labels and ranges, typed-time parsing
│   │   ├── agenda.js        # Pure due rules: what's due today/overdue, meeting recurrences, badge count (no DOM, Node-testable)
│   │   ├── gcal-plan.js     # Pure Google Calendar rules: which tasks are mirrored, their signature, busy-day layout (no DOM, Node-testable)
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
│   │   ├── card-move.js     # Pure card item moves: Move-list targets, moveCardItem (re-key, refs / Quick Access / notes follow), section rename + refs
│   │   └── file-service.js  # R2 file operations, image ref classification, Base64 migration
│   ├── features/
│   │   ├── edit-mode.js     # Toggle, popovers, color pickers, notepad, highlighter, context menu
│   │   ├── drag-drop.js     # Card and item reordering
│   │   ├── time-tracking.js # Pill stopwatches, 1s tick, Time Tracking panel (task list + category donut)
│   │   ├── task-categories.js # Category helpers + Task Settings modal (categories, subtask templates)
│   │   ├── quick-capture.js # N-key bar: @ task / !category: pickers, live preview, ⓘ command list, Open/Undo toast
│   │   ├── item-creator.js  # "Add item" window (card "+" in view mode, "+" tiles in edit mode) + separator placement mode
│   │   ├── drop-light.js    # The glowing drop line: item reorder in edit mode + separator placement
│   │   ├── rich-text-images.js # Paste/drop images → R2 upload; fills in stored images wherever rich text renders
│   │   ├── today.js         # Today view (header button): due today & overdue + Quick Access
│   │   ├── google-calendar.js # Google Calendar: status, connect / disconnect, task calendar sync after uploads, busy cache, the panel
│   │   ├── busy-strip.js    # The busy-time strip (Today on both): one day of Google free/busy, 8 hours in view, scrolls
│   │   ├── quick-access.js  # Quick Access data: long-press toggle, entry repair, reconciliation, quick links
│   │   ├── media-library.js # The image picker: one library per account, uploads to R2, self-cleaning entries
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
│   │   ├── auth-ui.js       # Auth modal UI (+ Continue with Google, the username step), Google sign-in panel, cloud sync triggers
│   │   ├── glass-glow.js    # Samples rendered colors into glow vars; reflected item light on card rims (skips same-value writes)
│   │   ├── glass-fx.js      # FX v2 pointer-caught rim light (paused Web Animations, no element writes) + typing hush (<html data-fx-hush>, holds the pointer light)
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
│   │   │   ├── task-actions.js # placeTaskWithUndo, completeWithUndo (batched), confirmComplete (Mark as complete? sheet), restore, actions sheet
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
│   │   │   ├── time-picker.js # Phone time field (typed, AM | PM, clock) for <input type=time> + the time picker sheet (#mx-time-picker, z 10055)
│   │   │   └── file-sheet.js # openFileMobile + the full-screen file viewer (images; the blocked-popup file card)
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
│   └── icons/app-icon.svg (the "tsks." wordmark, Inter Black outlined to a path, paper #f5f3ee, navy dot #1f3d63) → app-icon-180.png (apple-touch-icon), app-icon-192/-512.png (manifest "any", rounded), app-icon-maskable-192/-512.png (full bleed); PNGs rendered by Reference/mobile/render-app-icon.cjs
└── Reference/               # (gitignored) Backend docs, screenshots, working context
    ├── Backend/             # AI_BACKEND_CONTEXT.md; gcal-worker.js (the Worker's Google Calendar block), gcal-schema.sql, gcal-worker-test.mjs (node:sqlite + fake Google), gcal-integration.md; google-signin-worker.js (the Google sign-in block), google-signin-schema.sql, google-signin-setup.md; build-worker.mjs → api-worker.js, api-worker-test.mjs
    ├── writing/             # Writing engine build spec (SPEC.md), plan, code maps, research digests
    ├── mobile/              # Mobile shell build spec (SPEC.md), unit notes (notes/F0…F6, requests.md), shoot-f*.cjs screenshot tools, baseline/ (tablet + desktop before/after)
    ├── wr/                  # Playwright harness (harness.cjs) + browser suites: smoke-e2e, qa-foundation-e2e, blocks-, input-rules-, menus-, links-, find-, focus-, export-, help-, notes-e2e, gcal-e2e, google-signin-e2e, login-challenge-e2e (mocked Worker, desktop + phone), account-safety-e2e (mocked Worker with several accounts + file storage: what goes into which account, expired sessions, the media library, sticky notes, photo / logo / icon pickers), card-move-e2e (Move list, drag between sections in the Card Edit Modal, notes on Cancel / Confirm); mobile-lib.cjs + mobile-shell-, -tasks-, -create-, -write-, -today-, -links-, -integration-, -app-e2e (the installable app), -move-e2e (Move an item… / Move to… on a phone); mobile-links-e2e sessions phone / touch / files / preview / viewer / shots (the image viewer), mobile-write-e2e sessions incl. time / timeshots (phone time field + picker), mobile-lib `answerComplete(page, yes)`
    ├── writing-commands-test.mjs / writing-rules-test.mjs / writing-templates-test.mjs / markdown-test.mjs # Node tests for the pure writing modules
    ├── pwa-test.mjs         # Node: manifest fields + URLs on the Pages URL, icon PNG sizes, the manifest link script per user agent, no service worker
    ├── mobile-device-test.mjs / mobile-sync-test.mjs / mobile-nav-test.mjs / mobile-common-test.mjs # Node: phone rule + boot-script parity + ?v= specifier check, sync decisions, history plan, shell helpers
    ├── mobile-tasks-test.mjs / mobile-compose-test.mjs / mobile-write-test.mjs / mobile-today-test.mjs / mobile-links-test.mjs # Node: each unit's pure module on the real profile
    ├── collapse-test.mjs    # Node smoke test: collapse display-layout compaction
    ├── time-log-test.mjs    # Node smoke test: time-log start/stop, totals, merge, import, period ranges
    ├── sync-merge-test.mjs  # Node smoke test: cloudSave() time-log merge against a fake API
    ├── rich-text-refs-test.mjs # Node smoke test: rich-text image reference rules
    ├── card-move-test.mjs   # Node smoke test: move targets, moves (re-key, refs, notes), undo, rename
    ├── quick-capture-test.mjs # Node smoke test: quick capture dates, times, commands, escapes
    ├── due-time-test.mjs    # Node smoke test: time keys, settleDueTime (zone stamping), 12/24 h labels
    ├── agenda-test.mjs      # Node smoke test: due states, meeting recurrences, Today ordering, badge count
    └── gcal-plan-test.mjs   # Node smoke test: mirrored tasks, signature, busy layout (merge, all-day, time zones, DST)
```

### Storage & Sync
- **localStorage key**: `personal_dashboard_model_v2` (fast browser cache) = the **signed-out dashboard**; each account has its own copy `pd_user_<username>_model_v2` (+ `…__dirty` = changes not uploaded yet)
- **Whose copy (user decision 2026-10-18: nothing of one dashboard ever goes into another account)**: `getDataOwner()` (auth.js) = the signed-in account, or the account whose session ended (a 401) without a sign-out (`pd_auth_lapsed`); `getActiveStorageKey()` follows it. `saveModel()` writes to the copy `restoreModel()` read (`_modelStorageKey`, storage.js), so a save made while a sign-in / sign-out is still switching stays with the dashboard on screen; `markCloudDirty(key)` flags that copy
  - **Expired session** (any 401 outside the Google routes): signed out, but that account's dashboard stays on screen and every change goes to ITS copy (flagged dirty, never the signed-out dashboard), also after a reload. The sign-in dialog then names it (`#auth-lapsed-note`: username prefilled, "Sign out instead"); signing in as it uploads the waiting changes (syncOnLogin rule 1); signing in as anyone else leaves them waiting in its copy
  - **First sign-in on this browser** (`prepareAccountCopy`, sync.js, before the model is read): the account's copy already here → kept; else the cloud copy when it has one (any saved profile, however sparse); else empty. The signed-out dashboard goes into an account only when that account was created just now here (and even then a saved cloud copy wins; only a failed read falls through to the carry; `created` is taken before the request, and a Google account counts as created only when `/auth/google/register` answers `created: true`) (Create account / a new Google account), only once (`personal_dashboard_model_v2__carried`), and never on a browser where an account was used before this rule (older builds copied it into the first account). A cloud copy that can't be read → the sign-in stops (`abandonSignIn`, the dialog says why) instead of showing a dashboard that isn't the account's
  - The session is saved only once the account's copy is ready (`persistSession`): a reload mid sign-in comes back as before. Sign in / sign out wait for edit mode to end (toast `Save or cancel your edits before signing in|out`): Confirm would merge the working copy into the other dashboard. Switching accounts resets the in-memory sync flag (`resetSyncState`) and the file cache (`resetFileCache`: one account's images are never shown to another); `cloudSave()` drops an upload whose account changed meanwhile
  - **Sticky notes** (`sticky-notes.js`; this browser only, never synced, not on phones): one set per dashboard, like the media library: `personal_dashboard_sticky_notes@<username>` + `personal_dashboard_sticky_color@<username>` for an account (also while its session has ended), the bare keys for the signed-out dashboard. Saves go back to the keys the notes on screen were read from (a note typed while a sign-in is loading stays with the dashboard it was typed on); `refreshStickyNotes()` repaints them after a sign-in (`completeSignIn`) or a sign-out / "Sign out instead" (`showOwnerDashboard`). The notes a browser had before this rule (`…_sticky_notes__split` stamp; ids are `sticky-<ms>`) go to the first account that opens the dashboard there, with the colour chosen then (user decision 2026-10-18; `…__claimed` = that account); until then they show signed out. Notes made signed out since then stay with the signed-out dashboard, also when an account is created here
- **D1**: Durable cloud profile via `PUT /profile` (2MB max)
- **R2**: Private file/image storage via `POST /files` (5MB/file, 100MB/user)
- **Sync model**: localStorage for immediate edits → cloud sync on confirm, every 20 min, and on import
- **Time-log merge**: the profile is saved whole (last write wins), so before every `PUT /profile`, `cloudSave()` fetches the cloud copy and folds its `timeTracking` into the local log (`mergeTimeLogs`): sessions union (deduped by start, earliest stop wins), tombstones win, the newer start/stop decides the running timer, and sessions older than an import only come from the importing side. Other profile data is still last-write-wins
- **Dirty generation**: a save only clears the dirty flag if nothing changed while the upload was in flight
- **Back/forward cache**: init.js `refreshAfterRestore()` on a persisted `pageshow` (e.g. the second Back after a trip to Google lands on the page that started it, restored in its pre-trip state): the stored sign-in (token / username) differs from the page's own → reload (edit mode or an unsaved task / note editor → a "Signed in or out in another window · Reload" offer instead); same account → the Calendar status is read again, and auth-ui.js's pageshow handler resets the Google sign-in panels (`[data-gsi-panel]._gsiRestore`: Link works again, status re-read). Same account, but the saved copy changed elsewhere meanwhile (another page saved after this one last wrote or read it) → reload too (unsaved work → "This dashboard changed in another window · Reload"), on phone, tablet and desktop, so a stale restored page never saves over newer data. The comparison is stamp-free (sync.js `noteStoredCopy(key, raw)` / `storedCopyChangedElsewhere(key)`, storage.js `storedModelChangedElsewhere()`: `_sync` removed, since every load re-stamps), recorded by saveModel, restoreModel (a missing copy too), syncOnLogin's cloud write, prepareAccountCopy and sync-guard adopt
- **Sync stamp**: every `saveModel()` payload carries `_sync: { device, at }` (mobile-sync.js; payload only, never in `model` or an export); `restoreModel` records a foreign stamp as seen; `cloudSave()` stamps an upload that has none (a JSON import) and, between its GET and its PUT, asks `window.__mxPushGate` (installed on phones only; see Mobile Shell → Sync). The desktop has no gate: last write wins there, as before
- **Change event**: every successful `saveModel()` raises one coalesced `window` event `model:saved` per microtask (`detail.seq`, `window.__modelSaveSeq`): the mobile shell's repaint funnel. Node-safe (no window, no event)
- **Upload event**: every successful `PUT /profile` in `cloudSave()` raises `window` event `cloud:saved` (Node-safe): Google Calendar syncs after it, so the calendar mirrors the cloud copy
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
- **Moving items** (`js/core/card-move.js`, pure): the edit popover's Move button (→ list) offers the item's OWN card first ("This card", its other sections; "Top of card" = `_default` when the item is in a named section), then every other card; a card with named sections is a heading with its sections indented beneath on a tree rail, a card without them is one row. A whole section (subtitle popover) moves to other cards only. Dragging an item onto another section of the same card works inside the Card Edit Modal (its card is a drop zone too; dropping on a section title files it there; separators stay in their section). `moveCardItem` keeps item keys unique per type across the card (a taken key is re-keyed) and points linked tasks (active + completed, `linkedItems` + legacy `linkedItem`), the Quick Access entry and a subtask's notes (`subtaskNotes["sectionId:subtitle:key"]`) at the new place. In edit mode the notes move on `model` too, so the item shows them (Cancel moves them back, `revertEditNoteMoves`; an import clears the list), but `saveModel` stores `subtaskNotes` with the pending moves undone (`committedSubtaskNotes`), so storage and the cloud see a move only on Confirm, which takes the working copy's `subtaskNotes` whole (deepMergeModel). A forward subtask move never lands on a key whose destination note id already holds notes (no orphan notes picked up). A section rename keeps its place and refuses a taken name. Drag keys `sectionId:subtitle:itemType` are split at the first and last ':' (`parseItemSectionKey`), so section names may contain ':'. New items get card-wide unique keys (item creator)

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
- Tasks can have: subtasks, descriptions, due dates (with an optional time), multiple links & files, linked items, project/meeting/note highlights
- **Due time**: the editor's "Due Date & Time" row has a time field beside the date (a time picked without a date fills today; × clears it and the end; a time without a date is dropped on save). Stored as `dueTime` + `dueTz`; shown in the Today chip (`Today · 3 PM`), the calendar rows, phone rows (`Today 3 PM`, `Fri, Oct 23 · 9:30 AM`) and Coming up (a day's timed tasks first, by time). Due rules stay day-based (agenda.js)
- **End time** (`dueEndTime`): `#task-editor-end-time` in `#task-editor-end-wrap`, shown once a start exists. Moving the start keeps the length (past midnight the end is emptied with a toast); an end ≤ start gets `aria-invalid` + a red ring and is dropped on save with a toast (a save is never refused: Back = keep on phones). `settleDueTime` (updateTask): no date / time → no end; an untouched end on a task that had no start is dropped; a moved start carries an untouched end by the same delta; only a changed start restamps `dueTz`. Shown as ranges: `Today · 3–4:30 PM`, calendar `3:00–4:30 PM`, phone rows `Today 3–4 PM` / `Wed, Oct 14 · 11 AM – 1 PM`, Coming up, the actions sheet (`formatTimeRange`). Google Calendar blocks start → end (else 30 minutes)
- **Links & Files**: Task editor has a `+` button to add multiple links/files. Clicking `+` shows URL or File choice. URL entries use subtask-style input (editable → confirmed with edit/delete inside). File entries upload to R2.
- `task.taskLinks[]` stores the array; `task.link` is kept for backward compat (first URL)
- **Linked Items (multi)**: `task.linkedItems[]` links a task to card items (reminders, subtasks, copy-paste, icons); legacy `task.linkedItem` mirrors the first ref. `getLinkedItems(task)` normalizes both shapes
- Task editor: "Link to Item (Optional)" sits at the bottom below Subtasks. "Select Item" appends refs; linked items render below it as functional miniatures (order: reminders → subtasks → copy-paste → icons) — click opens the item's link/file (copy-paste copies), × unlinks
- Item "Add Task" button (in the item tasks modal) opens a task PICKER (`#item-task-picker-modal`, styled like the @ mention dropdown: per-color columns red/orange/yellow/blue, pinned first, search filter) to link an EXISTING task to the item — it no longer creates a new task
- Primary (pinned) tasks float to top within their color group
- **Category**: chips below "Link to Item" in the task editor (click the selected chip again to clear) → `task.categoryId`
- **Subtask templates**: the save icon beside the Subtasks `+` stores the editor's subtask titles as a named template (`model.subtaskTemplates`); press and hold the `+` (750ms) for the picker, which appends a template's subtasks. Edited in Settings → Tasks (see Task Categories)
- **Stopwatch**: rightmost control on every pill (`createTaskTimerControl`); see Task Time Tracking
- **Complete**: circle-check button just left of the stopwatch on every pill (matrix and Today view) and on the open-task rows of the Time Tracking panel (`createTaskCompleteButton(task)`, exported from tasks.js; time-tracking.js imports it, a safe import cycle since neither module uses the other at load time). The Time Tracking rows hold both buttons in `.tt-task-actions` (64px; empty on finished rows so columns line up), and completing refreshes the panel (`refreshTimeTrackingUI`), which moves the row to Completed. Click asks "Mark “…” as complete?" (native confirm, `confirmCompleteTask`), then completes it. Dropping a pill on the header checkmark (`#delete-task-drop`) asks the same question. Excluded from the pill's click-to-edit and long-press-to-pin; 20px with negative block margin so the pill height doesn't change; emerald glyph + lens on hover (glass-fx.css 9b)

### Task Time Tracking (`js/features/time-tracking.js` + `js/core/time-log.js`)
- Pill stopwatch toggles that task's timer; ONE timer runs at a time (starting another stops and records the first, with a toast). While running, the task's total (`0:45` → `12:05` → `1:02:33`) sits to the LEFT of the icon, and the pill never changes height
- Running look = an emerald glass crystal (glass-fx.css 9b): gradient body + specular, shared rim, a steady halo (`::before`) and a rim light arc (`::after`), both static since 2026-10-08 (11d). No transform/filter/backdrop-filter on the button (that would make it a stacking context and pull the halo in front); body is background-image only so glass-glow.js doesn't add its generic glow. `--fx-live-rgb` / `--fx-live-deep` tokens (dark overrides in section 13).
- Every start/stop stores exact epoch-ms `[start, end]` sessions per task in `model.timeTracking` (saved with the profile). Sessions under 1s are dropped. A running timer survives reloads (timestamp-based) and keeps running while the tab is closed
- The 1-second tick only rewrites existing text nodes (`Text.data`), never replaces elements, so glass-glow.js's MutationObservers (childList/attributes) don't re-measure the page every second; it pauses while the tab is hidden and catches up on return
- Completing or deleting a task stops its timer first; its history stays in the log (title/category kept in `timeTracking.tasks[id]`), so deleted tasks still count and show as "Deleted"
- Header stopwatch (`#time-tracking-toggle`) opens the Time Tracking panel (`#time-tracking-card`) and shows a steady green dot while a timer runs. Panel: tasks with time > 0 in the period filter (running first, then by the task sort; completed/deleted in a collapsed "Completed" group; a row's time tooltip says when it was last tracked), each row expands to its sessions (delete one, or "Clear all time"); the Categories donut + legend (legend doubles as the table view) sit in a column LEFT of the task list when the panel is at least 960px wide (container query on `.tt-body`), below it when narrower (phone Time sheet)
- Donut rules (dataviz): ≤6 segments (smallest categories fold into "Other"), 2px gaps, slices in category order, colors from the validated categorical palette per category slot (`--task-cat-1..8`, `--task-cat-none`, `--task-cat-other` in styles.css, light + dark), chart figures in minutes (refresh once a minute)
- **Period filter** (Tasks list + donut): funnel button `#tt-range-btn` on top of the category legend, left-aligned with it (`.tt-legend-col` = button + legend, so it moves with the legend when the chart stacks). Built once in JS (`getRangeButton`) and re-attached on every chart render; in the empty states it sits above the message, and it's left out only when there's no tracked time and no filter. Shows the period; azure when filtered → popover `.tt-range-pop` (fixed, z-index 9000, appended to body): presets Today / This week (Monday start) / Last 14 days (incl. today) / This month / Last month / This year apply on click; Custom range From / To (inclusive local days, either side may be empty = since / until, ends swapped if reversed) + Apply; Clear = all time (the default). Esc / outside click closes. Filters the donut AND the Tasks list: only tasks timed in the period, showing their time inside it (the running row ticks its in-period time via `data-tt-live`, not the pills' `data-live-timer`); an expanded row lists only sessions touching the period plus `N more sessions outside “…”`; "Clear all time" still clears (and quotes) the task's all-time total. Sessions crossing a period edge count only the part inside it; the running session counts up to now
- **Task sort**: `#tt-sort-btn` (static in index.html at the right end of the Tasks heading row `.tt-section-head`, styled as a `.tt-range-btn`) → popover `.tt-range-pop.tt-sort-pop` (shares the period popover's look, its one-at-a-time `openPop` / `mountPopover` wiring and its mobile Back layer): Most time (default) or Most recent (`getTaskLastActive`: the last session end inside the period, clamped to its end; running = now). A running timer always leads. Per browser: localStorage `dashboard_tt_task_sort` (`'recent'`; key removed for the default)
- The filter is per browser: localStorage `dashboard_tt_range_filter` (`{ preset }` or `{ from?, to? }`, not synced, not in the model). Presets are stored by name, so "This week" always means the current week. Range rules are pure in time-log.js (`TIME_RANGE_PRESETS`, `normalizeRangeFilter`, `resolveTimeRange`, `getTaskTotalsInRange`)
- `refreshTimeTrackingUI()` repaints pill controls, header dot and the panel; it also closes a running timer whose task vanished (import, other device, or a task created in a cancelled edit)
- The old standalone timers (timers.js, Reset All / Add Timer) were removed; `model.timers` is kept untouched

### Quick Capture (`js/features/quick-capture.js` + `js/core/quick-capture-parse.js`)
- **N anywhere** (not while typing in a field, no Ctrl/Alt/Meta) opens a one-line bar above everything (`#quick-capture`, z-index 100100); the header bolt `#quick-capture-toggle` does the same and is shown only when the Mobile layout is active (`body[data-device="mobile"]`). Off in edit mode (toast): tasks made there would only live in the working copy. In the mobile shell (header hidden) the + and N open the mobile composer instead, which commits through this module's `createFromPlan` / `updateFromPlan` / `undoCapture`; the bar is only its fallback
- Plain text = new task name (`!task` optional). `@` opens the task list (same look as the @ mention list); a pick becomes a chip and the line then CHANGES that task, with leftover text added as a new subtask. One task + one category chip per line; Backspace at the start of the line removes the last chip
- Commands (anywhere in the line, case-insensitive): `!red !orange !yellow !blue` (`!r !o !y !b`), `!p` / `!nop` (Primary on / off; long: `!priority` / `!nopriority`, `!primary` / `!noprimary`), `!timer` (always STARTS, never toggles; `startTimerForTask`), `!url:telcobridges.com` (https:// added, http/https only, several allowed), `!category:` / `!cat:` (opens the category list on the colon; typed names match exact → starts-with → contains), `!nodate` (date, time and end), `!notime` (the time and its end), `!end:5pm` (also `!end:4:30pm`, `!end:16:30`, `!end:noon`: only the end, on a task that has a time) / `!noend`, `!cal` / `!nocal` (also `!calendar` / `!nocalendar`; the old `!gcal` / `!nogcal` still work but are not listed or suggested: Google Calendar on / off; a new task without one takes the remembered choice while connected; `!cal` without a due date warns)
- Dates, day-first, built from the LOCAL calendar day (never via toISOString): `today` `tomorrow`/`tmr`, `fri` (today if it is Friday) / `next fri` (+7), `3d` `2w` `in 3 days` (lowercase only, so "3D printer" stays text), `eow` `eom`, `Dec 21` / `21st of December 2026` / `December 21st, 2026`, `21/12` `21/12/26` `21-12-2026` `21.12.2026` `2026-12-21`. No year = next occurrence (29/2 waits for a leap year); a "by"/"due" right before the date is dropped from the title. `24/7`, `3-5`, `21.12`, `45/50` stay text
- Times: `3pm` `3 pm` `3:30pm` `3:30 p.m.` `11am` `12am`/`12pm`, 24-hour `15:30` `9:05`, `noon`; an "at"/"by"/"due" right before is dropped. Not times (stay text): a bare number (`at 3`), `13pm`, `25:00`, `16:9`, `45:50`, `2h30`. With a date: that day. Alone: its next occurrence (`impliedDate`: today while still ahead, else tomorrow); changing a task (`@`), a time alone keeps the task's own date. `resolveDue(parsed, target)` → `{ dueDate, dueTime, dueEndTime }` (undefined = leave as is) is the one rule the bar, the composer and `createFromPlan` / `updateFromPlan` share. Warnings: two times, a time that already passed today, a time with `!nodate` (dropped)
- Ranges (start + end): one word (`3-4pm`, `3pm–4pm`, `3:30-4:30pm`, `15:00-16:30`, `noon-1pm`), a spaced dash (`3 - 4pm`) and `to` / `until` / `till` only between two whole times (`2pm to 3:30pm`); one side needs am/pm (or noon), or both h:mm. `3-5`, `10-11`, `9-5 job`, `24/7`, `Move 3 to 4pm` stay text. A missing am/pm is inferred (`11-1pm` = 11–13, `12-1am` = 00–01); `10pm-1am` warns and keeps only the start; a leading at/by/due/from is dropped. A start alone on a task that has an end moves the end (the chip says so); when the moved end would pass midnight it is removed with a warning (`endDropIssue`, quick capture and the composer, as the editor does). In the composer, Set on the time already in effect leaves the line alone (only Clear / No time remove it). Parser fields `dueEndTime`, `clearEnd`, `endSpan`; `endAfter(due, target)`, `endIssue(parsed, due, target, mode)`
- Errors block Enter and shake the bar (unknown command with a "Did you mean" suggestion, impossible date like 31/02, bad link, unknown/ambiguous category, nothing to change); warnings don't (two colors/dates: the last one wins; past date; already linked). A `\` before a word keeps it as text (`\fri`, `\3pm`, `\!red`, `\@marc`); clicking the date or time chip in the preview inserts it
- While a list is open, ↑/↓ move, ←/→ jump to the neighbouring color column in the task list (same row or its last task, wrapping; with one column, and in the category list, they move the caret), Enter/Tab picks (Enter never saves by accident) and Esc closes just the list, leaving the text as typed. The editors' `@` list (projects.js `onMentionKeydown`) has the same ←/→ column jump. Enter saves; Shift+Enter saves and opens the task editor; Esc / backdrop closes
- Saving uses the task editor's own calls (`createTask` then `updateTask`; links via `taskLinks` + legacy `link`; subtasks via `generateSubtaskId`), then `refreshTaskViews()`. Toast `#qc-toast` offers Open / Undo for 7s (hover pauses). Undo only applies if the task is unchanged since: it deletes a new task (and all of its time) or restores the old copy exactly, and `undoTimerStart()` drops the session quick capture started and restarts a timer it switched off
- The live preview is rebuilt only when its chips change shape (`chipShape`); a usual keystroke rewrites chip text in place. `renderPreview` must stay the only writer of `#qc-preview`, and a new `previewChip` option belongs in `chipShape`
- No new model fields. The ⓘ button and "See all commands" (left end of the bar's bottom row; the key hints on its right are hidden on phones) open the command list, which renders `QUICK_CAPTURE_HELP` from the parser module (click an example to insert it), so the reference can't drift from the rules

### Google Calendar (`js/features/google-calendar.js` + `js/features/busy-strip.js` + `js/core/gcal-plan.js`; Worker: `Reference/Backend/gcal-worker.js`)
- **Permissions (user decision)**: `calendar.app.created` (the app's own **Dashboard tasks** calendar, the only place it writes) + `calendar.freebusy` (busy start/end of the user's own calendars, never titles or details) + `openid email`. No event reads, no Gmail. Cost $0
- **Security model**: the API Worker holds the Google connection. The refresh token is AES-256-GCM encrypted in D1 (key in the `GCAL_TOKEN_KEY` secret, bound to user_id); access tokens live in Worker memory only; OAuth state is random, stored hashed, single use, 10 min, plus PKCE; the callback redirects only to the fixed `DASHBOARD_URL`; `GCAL_ALLOWED_USERS` (dashboard usernames) gates every route. The browser never sees a Google token: it calls `/gcal/connect | callback | status | settings | sync | busy | disconnect` with its normal session. Google failures answer 409 / 502, never 401 (auth.js signs out on 401) or 413
- **Task calendar = a mirror of the CLOUD profile**: `POST /gcal/sync` (no body) reads the flagged tasks out of `profiles.profile_json` with D1 `json_each` and makes the calendar match (create / update / delete, `sig` = hash of the event body, deterministic event ids + a 409 take-over / restore path that never makes a second event while one is live, a per-user lease (released only by its holder, connection re-read under it), access tokens cached per stored connection, ≤ 36 Google calls per request and `{ remaining }` for more, a deleted calendar is recreated). The client asks after every successful upload (`cloud:saved`, whose `detail.payload` is what was uploaded), once after start-up / sign-in, and on Sync now (uploads first only when this device has unsynced changes, so an old copy never overwrites newer data; asks the Worker to check the calendar still exists (`{ check: true }`); toasts how it went; a held upload on a phone opens the conflict sheet). On a computer a flagged-task change (`gcalSignature(model)`) uploads silently after ~3 s when it differs from the last uploaded payload and this device has unsynced changes of its own (`hasUnsyncedChanges()`: a copy adopted from the cloud never triggers it); in edit mode or during the initial load it waits and tries again (phones already push after 2.5 s). A sync that fails for a passing reason (network, `gcal_busy`, a 5xx other than `gcal_not_configured`) or ends with work left (`failed > 0`, `remaining`) is retried (`planSyncRetry`): 30 s, 2 min, 10 min (10 min after `rateLimited`), at most 3 tries per cycle; offline it waits for `online` without using a try; the count resets on a clean run, `cloud:saved`, Sync now, an account change and `resetGcalState`. Answers that arrive after a sign-out / account switch are dropped. Worker: `POST /gcal/sync` runs under `ctx.waitUntil` (a closed tab never leaves the lease or the map half written); a D1 error in `/gcal/callback` before the token exchange still redirects (`?gcal=error&reason=failed`)
- **Events**: all-day on the due date (`end` = next day); a task with a due time is a **timed event** from that wall-clock time to its `dueEndTime` (valid and after the start), else **30 minutes** (`start/end.dateTime` + `timeZone` = `task.dueTz`, else the zone the calendar was connected from, else UTC; `GCAL.timedMinutes`). An all-day body is byte for byte what it was before times existed, and a timed body without an end what it was before ends existed, so their sigs never moved (Worker `GCAL_DESIRED_SQL` reads `$.dueEndTime AS end_time` at the same position in both UNION ALL selects). Title (`✓ ` once completed: completing keeps the event, user decision; restore removes the ✓), colour by task colour (red 11, orange 6, yellow 5, blue 7), `transparency: transparent` (never busy), no reminders, `extendedProperties.private.taskId`, no description. Deleting a task (active or completed, Clear all) deletes its event; clearing the date or unticking does too; removing the time makes it all-day again. `gcalSignature` includes `dueTime` (+ `dueTz` with a time, + a valid end), so a time-only or end-only edit uploads and syncs
- **Task flag**: `task.gcal` (only `=== true` counts). Task editor checkbox under Due Date (`#task-editor-gcal-label`, Primary-checkbox look): shown only when this device knows tasks can sync (`isGcalTasksReady()`), so a hidden box never writes the flag; new tasks start from the remembered choice (`getGcalDefault` / `setGcalDefault`, per account + device, saved when a new task is saved or a line says `!cal` / `!nocal`); "needs a due date" hint without a date. The editor's change snapshot includes `dueDate`, `dueTime` and `gcal` (a date-only edit used to be dropped on close / Back). Quick capture `!cal` / `!nocal` (preview chip), the phone composer's tray chip `.mx-tray-gcal` (rewrites the line like the other chips, writing `!cal` / `!nocal`; plans carry `plan.gcal`; while it shows the tray gets `.has-gcal`, mobile-compose.css 9c, so it stays one row at 390 / 360)
- **Busy strip** (`busy-strip.js` `renderBusyStrip(host, dayKey)`): Today on a computer (`#today-daystrip`, above the due list) and first on the phone Today tab (`.mx-today-busy`). One local day on a track `--span` (= the day's hours / 8) scroller widths wide inside `.busy-strip-scroll` (overflow-x, no scrollbar, `overscroll-behavior-x: contain`), so **8 hours show at a time**: the window opens on the hour before now with a 15-minute lead-in (other days: before the first block, else 8 AM), scrolls by swipe / trackpad / mouse drag / keyboard (the scroller is focusable) or ‹ › (4 h a step, smooth), and **Now** (shown while now is out of view) brings it back. It follows the clock (re-anchors once an hour) until scrolled by hand; it keeps its window across a rebuild of the same day and starts from now again whenever it is shown again (a ResizeObserver sees 0 → width). Edge fades (`data-more="start|end|both"`) say there is more. Ticks every real local hour with a label beside each (not midnight; under 420px container width every other hour) and half-hour marks; blocks (merged across calendars) carry their times on a label layer of the same size above the now line (`.busy-strip-block-text`, z 2 over the line's z 1): the range ("9–10:30", no AM/PM, the axis says it) when it fits, else an off-the-hour start, else nothing (container queries by text-length class `r-/s-a…d`). Also a now marker (CSS variable, once a minute), busy times in words, booked total, "Free now until …" / "Next free …". An all-day busy block (≥ 23 h, close to whole days; a multi-day event covering the day) is a **Busy all day** note, never a filled day; all-day events left Free are invisible to free/busy (accepted). Fetched for the day ± 1 day (time-zone-shifted all-day events arrive whole), cached in memory 5 min, never in the model; the host is rebuilt only when `gcalStateKey()` changes; a repaint with the same data does no layout reads. Hidden when not connected or without the busy permission; Reconnect / Try again states. Mouse drag: pointerup / pointercancel listen on window (capture) and a move without a pressed button ends the gesture, so a press released off the bar never turns hovering into scrolling. Static (no animation; only a button's smooth scroll)
- **Manage**: the account popover (`#auth-gcal`, `buildGcalPanel`) on a computer, More → Google Calendar (a sheet with the same panel) on phones: Connect / Reconnect, the account, permissions granted, busy calendars (main + up to 9 pasted Calendar IDs), Sync now, Disconnect (asks inline; optionally deletes the Dashboard tasks calendar; reconnecting the same Google account reuses it). The busy-calendar list is drawn from the live status (add / remove read it at click time); repaints carry over the focused control (`data-gcal-action`) and a Calendar ID being typed, and happen only when the status changed (busy data also notifies). The account popover scrolls (max-height from its position) so Sign Out stays reachable. Not in Settings: Settings is edit mode only, and leaving for Google would drop unsaved edits (connect is refused in edit mode). Coming back: `readGcalReturn()` reads and removes `?gcal=…` first thing in `init()` (`history.replaceState(history.state, …)`), then a toast (none for `reason=invalid` while connected and not `needsReconnect`: a Back into Google's page after the trip came back with the used state; a failed Reconnect still says so)
- The client calls `/gcal/*` through its own `gcalCall` (same shape as `apiCall`) that never signs out on a 401, so a Worker without the routes yet can't end the session (an expired session is caught by the next profile sync)
- Status is cached per account in localStorage `dashboard_gcal_status@<user>`; signing out resets the module (`resetGcalState`). `window.googleCalendar` exposes status / sync / busy helpers for tests and the console
- **Worker setup**: `Reference/Backend/gcal-integration.md` (secrets, schema, the 3 lines of glue, Google Cloud steps)

### Task Categories (`js/features/task-categories.js`)
- Edit mode → Settings → **Tasks** opens the Task Settings modal (reuses the appearance-modal classes, z-index 2100 above Settings): add / rename / delete categories, max 8, colors auto-assigned by the lowest free slot
- Draft + Save/Cancel; saved straight to `model.taskCategories` and `model.subtaskTemplates` (like the theme, outside the edit-mode confirm/cancel). Deleting a category that tasks use asks first; those tasks read as Uncategorized. Cancel / × / Esc ask before dropping a changed draft
- Defaults (fixed ids so devices agree): Content, Campaigns, Analytics, Operational, Strategy
- Two columns (820px dialog): Subtask templates left, Categories right; a container query on the body stacks them (Categories first) under 600px, so phones and the preview get one column
- **Subtask templates** section: one row per template (chevron, name, `N subtasks`, trash); clicking a row opens it (one at a time) to rename it and edit its subtasks: Enter = new subtask below, Backspace on an empty one removes it, Alt+Shift+↑/↓ or the grip (pointer drag, window listeners because moving the row drops a pointer capture) reorders, × removes, "Add subtask" appends. Deleting a template needs no confirm (Cancel undoes it). Save drops blank subtask lines and refuses an empty name or a template with no subtasks (toast + opens it). The body scrolls on short screens; phone rules in mobile-today.css

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
- On the profile photo, always shown: the due count (red; its steady glow is dark-theme only, user decision) or, when nothing is due, a quiet glass lens with a calendar glyph (`.is-clear`)
- Click (or Enter/Space) opens the calendar. `updateNotificationBadge()` also repaints an open calendar and Today view, so call it after changing anything dated

### Today View (`js/features/today.js`, header sun button `#today-toggle`)
- Left: **Due today & overdue**. Tasks in one tinted group per color, red → orange → yellow → blue (the matrix column classes `eisenhower-priority-card-<color>` give the tint and the pill hue), Primary first, oldest first. Then Meetings today, then due Reminders
- Task pills are the matrix's own (`createTaskPillElement`): click opens the editor, the stopwatch runs the timer, long-press pins; no dragging. A chip shows `Today` / `Overdue · Nd`. Pinned pills carry `--fx-t-dur` / `--fx-t-delay` inline (from when the bloom breathed; harmless now that it is static)
- Due subtasks hang below their task on a rail in its color (editor-style `.subtask-bubble` rows): the check completes it (same rule as the editor: done also clears importance and date) with an Undo toast; anywhere else opens the task. When only a subtask is due, the parent pill steps back (`.today-task-context`: dashed outline, quieter, a pinned one loses its bloom) and says "Subtask due" / "N subtasks due"
- Meetings open straight to that meeting (`openMeetingsModal(meetingId)`)
- Reminders and Quick Access items are the real card items (`createCardItemElement` in sections.js) in the card group classes: they open their link/file, copy, show their badges, and long-press takes them in or out of Quick Access
- Above the due list: the Google Calendar **busy strip** when connected (see Google Calendar)
- Right: **Quick Access**: icons, reminders, subtasks, copy-paste (swatches in their own row), then the quick links (link button in the section header; "Clear All Links" asks first)
- Off in edit mode (toast; an open one closes when editing starts). Esc closes it unless something is open on top. z-index 9990: under item bubbles (9999+), calendar (10000), meetings (10001), task editor (10010) and the quick-link dialog (10005), so they all stack above it. The edit pencil (9999) is hidden while it is open; `#toast` sits above every modal (100150)
- `refreshTodayView()` coalesces repaint requests into one render (microtask); it runs from `renderEisenhowerMatrix`, `updateNotificationBadge` and Quick Access changes
- The mobile shell never opens this modal: its Today tab is rebuilt from the same agenda rules (below). While the shell is mounted `window.refreshTodayView` is wrapped to repaint the shell too

### Mobile Shell (`js/features/mobile/` + `js/core/mobile-*.js` + `mobile*.css`)
In the Mobile layout the dashboard is not a shrunken grid but a body-level app frame built for a thumb. Build spec + unit notes: `Reference/mobile/SPEC.md`, `Reference/mobile/notes/` (F0 foundation, F1 Tasks, F2 composer, F3 Write, F4 Today, F5 Links, F6 integration; the code wins where they differ).
- **Frame**: static skeleton `#mobile-shell` in index.html (chrome on the first paint; units render inside its nodes, never replace them). Top bar: avatar + sync dot (→ More) · slot (title, or the Tasks segment) · ⌕ Search · due lens `#mx-due-lens` (`countDueItems(getDueItems())`, badge recipe → calendar). Floating frosted dock `#mx-dock` Tasks · Today · (+) · Write · Links; while a timer runs, the emerald now-playing lane `#mx-live` above it (title, live clock, Stop; body → Time sheet). The desktop header, grid, FABs, matrix, Today / completed modals and sticky notes are `display: none !important`
- **Phone rule + boot script**: phone = screen short side < 600px AND a coarse pointer (`isPhoneScreen`; landscape phones stay phones). Phones always load Mobile and never unmount. `<script data-mx-boot>` (index.html, before any stylesheet) repeats the rule and sets `html[data-shell="mobile"]` + `[data-phone]` (and `viewport-fit=cover`) or `[data-shell-frame="preview"]` (a computer); a small touch-only tablet in Mobile (coarse pointer, no hover, short side < 768: an iPad mini, an unfolded foldable) gets the shell at full width with no frame attribute (`shellFrame()` → `'full'`; otherwise like the preview: no phone paths, Layout in More), so a phone never flashes the desktop; `mobile-device-test.mjs` runs it in a vm against mobile-device.js so they can't drift
- **Preview** (a computer that chose Mobile): the same shell in a 390px column (`--mx-col` / `--mx-inline`, reused modals pinned to it) with `#mx-preview-switch` `[Mobile | Tablet | Desktop]` beside it (hidden under 760px wide: More → Layout). No history; Escape closes the top layer; N = composer, `/` = Search
- **Mount / unmount** (`shell.js` `syncMobileShell(mode)`: mounts for `'mobile'` unless edit mode is on, else unmounts; preview only): mount asserts the `<html>` attributes + a `theme-color` meta, closes desktop panels without writing the model, starts viewport / layers / lifecycle / (phones) the sync guard, wraps `window.refreshTodayView` + `window.renderAuthUI` to repaint the shell too, loads the 5 units, opens on Tasks on a phone (any other tab is a Back entry, and one pushed at load without a tap can be skipped by Chrome, so the first Back would close the installed app; the preview reopens the last tab if the last visit was < 30 min ago; saved tab scroll positions come back either way), renders, sets `#mobile-shell[data-ready="1"]`, emits `'mount'`. Unmount emits `'unmount'` (units clean up), removes wraps, listeners and every `data-mx-*`, and restores `#time-tracking-card` from `timeTrackingExpanded`
- **`renderAllSections` branch** (its first statement): in the Mobile layout → `syncMobileShell('mobile')`, remove grid `section.card`s, `applyCellSize()`, `renderMobileShell('sections')`, `updateNotificationBadge()`, return. Every existing repaint (theme, sign-in, cloud load, import, item creator, Quick Access, `refreshTaskViews`) reaches the shell through it; `renderEisenhowerMatrix` is skipped under the shell
- **Units + tabs**: one entry module per unit (tasks-view, composer (no screen), write-view, today-view, links-view), loaded by versioned `import()`, each registering screens / services / layers through the shell `api` in `init(api)`; consumers handle a missing service, a failed import shows `Couldn’t load this tab · Retry`. Tab switches render once, synchronously, keep each tab's scroll, set `html[data-mx-tab]` and are not history entries (Back on Today / Write / Links → Tasks; on Tasks with nothing open it leaves the app). Dock, + and lane hide while `html[data-mx-kb]` or `[data-mx-compose]`
- **Tasks** (`tasks-view.js` + pure `mobile-tasks.js`): one bucket at a time: segment `Primary N | Secondary N` (= `pinned`) in the top-bar slot × sticky chips `All · red · orange · yellow · blue` (counts, a breathing hot dot when something there is due / overdue; empty chips still take drops). `defaultLens`: the remembered colour if non-empty, else All when the segment holds ≤ 10, else the first busy colour. A colour = one tinted pane (`.mx-pane.eisenhower-priority-card-<c>`), All = 4 panes (empty = dimmed header). Lens per browser, published with `api.setContext({ lens })`. Rows (`createTaskRow`, not the matrix pill): 44px complete ring, 2-line title, meta, the real stopwatch; rebuilt only when `rowSignature` changes; modes `list` / `today` / `search`
- **Gestures** (`task-gestures.js`, `GESTURE`): tap = open read-first · ring = asks "Mark as complete?" (user decision 2026-10-19) · swipe → past 40% (or a fling) = asks too (the row waits slid out over Done; Cancel / Back / scrim glide it back) · swipe ← past 72px reveals `⇣ Secondary` / `⇡ Primary` + `⋯` (never commits) · 24px edge guards · hold 380 ms (or `contextmenu`) = lift → drag onto a gap, a pane header, a colour chip or the other segment (anything else glides back). Released still = **Lift & place** (`html[data-mx-carry]`, carry dock `Moving “…” · Move… · Cancel`, glowing gaps to tap, chips / segment switch the lens; the `carry` layer). Ghost, swipe and beam move through paused Web Animations, renders wait for the finger, `shieldTaps()` drops a double tap's second tap after something opens (trusted events only)
- **Undo + renumbering**: every move toasts Undo (`placeTaskWithUndo`: `planPlacement` → `updateTask` if the colour changes → `applyPlacement` → one save; Undo restores the snapshot unless `colorsSignature` moved on). The index is a position inside the TARGET bucket counted without the task; the target colour (and the source colour when it changed) is renumbered `0..n-1` in display order (Primary first), which heals old gaps and collisions; a group change without an index: demote → top of Secondary, promote → end of Primary; a no-op writes nothing. Completions batch into `N completed · Undo` (exact index back via `restoreCompletedTask`). Also: the actions sheet (`⋯`), the 2×2 Eisenhower **Move sheet** (live quiet moves, ONE summary Undo on close) and the **Completed** pushed screen (Restore with Undo, Delete, Clear all)
- **Composer** (`composer.js` + pure `mobile-compose.js`): the + focuses a keyboard-docked sheet (`bottom: var(--mx-kb)`) in the same tap (DOM built at init, so iOS raises the keyboard). Kinds Task · Note · Idea · Project · Meeting. The line is the desktop quick-capture grammar (dates, times, `!commands`, `\` escapes, `@task` change mode); the tray (colour, Primary, date + time, timer, Google Calendar when connected, category) shows effective values and a tap REWRITES the line (`setTokenField`; Primary writes `!p` / `!nop`, Google Calendar `!cal` / `!nocal`), so the line is the only truth. A due time sits under the date inside the date chip (`.has-time`, so the tray keeps its one row); the date panel adds `Time…` (the shell's time picker → `setTokenField(…, 'time', 'HH:MM')` writes `3pm` / `3:30pm` in 12-hour locales, `15:30` otherwise) and, with a time, `Ends…` (end mode: `setTokenField(…, 'end', v)` makes the line a range like `3-4:30pm`, or `!end:` / `!noend` on a task in change mode), `No end` and `No time` (`!notime` on a task that has one); `No date` drops a time with the date; the tray shows the range under the date (`trayTimeLabel`, ellipsized so the tray keeps one row). Empty fields default from the Tasks lens, else the last commit (`composer.defaults()`). The form `submit` is the only Add path; tasks go through `createFromPlan` / `updateFromPlan`, the composer stays open for rapid entry, and its own line says `✓ Added “…” · Undo · Show` (`undoCapture(record, { silent: true })`). Note / Idea save directly (Expand opens the writer), Project / Meeting open the writer. Closing keeps the draft (`dashboard_mobile_compose`, 24 h); tray controls prevent `pointerdown` so the keyboard stays up
- **Write** (`write-view.js` + pure `mobile-write.js` `collectDocs`): search, sticky filter chips (+ `in: <card> ×` from Links), Continue writing, Recovered drafts, then Projects, Ideas, Meetings and Notes grouped by card in desktop reading order; row `⋯` for rename / delete / pin / copy. **Writer frames** (`writer.js` + `mobile-write.css`): the 7 reused editors (task editor, subtask description, projects, ideas, meetings, notepad sheet, note viewer) keep their code; CSS makes each a full-screen frame fitted to the visual viewport (`--mx-vvh` / `--mx-vv-top`): 52px writer bar (back chevron, title, the primary action), 17/1.6 text, inputs ≥ 16px, the toolbar one sideways-scrolling row on the keyboard. Documents open read-first (no keyboard until you tap in or Edit); meeting jump-in adds a dated `<h2>` (stripped if left untouched); `writing/ui.js positionPopup` clamps menus to the visual viewport
- **Back = keep** (user decision; the task frame commits a time box still being typed in first): Back and the frame's × run one adapter per surface that SAVES a touched document (empty names become `firstLineTitle(…)` / "Untitled …"; an empty note is not saved) and just closes an untouched one; Back never asks `confirm()`, only the explicit Cancel / Discard buttons do. Dirty = baselines from `writingApi.hooks.load`, `taskEditorHasChanges()`, `isNotepadDirty()`. **Drafts**: on page hide every open dirty writer is snapshotted (`writer.keepAll`; projects just save) into `dashboard_mobile_write.drafts` (≤ 10) and offered back (`Unsaved text from 10:42 · Restore · Discard` in the frame, over a read view — a task's description, an idea, a meeting, a note — or in the subtask description frame; a Write row for a never-saved doc). A stored draft is dropped only when this frame session snapshotted it, or the user restored / discarded it: never one the user wasn't shown. A meeting jump-in's untouched heading is removed on Back, other field edits are still kept. Drafts and the composer draft are per account (`api.store(ns, { perAccount: true })` → `dashboard_mobile_<ns>@<username>`). Pull-to-refresh is off while mounted
- **Today / Time / More** (`today-view.js` + pure `mobile-today.js` `buildToday` over `getDueItems()`, so it agrees with the due lens and calendar; today.js untouched): the Google Calendar busy strip first (when connected; fetched on show / `visible` / `day` / a Google status change, never in render; its state is in the screen signature), due & overdue panes per colour (Tasks rows in `today` mode, due subtasks on a rail), meetings today (→ meeting / Notes jump-in), due reminders (real card items), Coming up · next 7 days, `Calendar ›` (full-screen). **Time sheet** (lane, More): the running timer + the desktop `#time-tracking-card` RE-HOSTED (moved in, put back exactly; `toggleTimeTracking()` never called). **More** (avatar): account + sync (Sign in / Sync now / Resolve), Light | Dark and Classic | Sunset (synced, as on desktop), Time tracking, Completed, Task categories, Writing & shortcuts, Cloud files, Google Calendar (a sheet with the account popover's panel), Google sign-in (signed in: the link / unlink panel), Backup, Not on mobile, Layout (preview only), Sign out
- **Links / Search / Files** (`links-view.js`, `card-items.js`, `search-view.js`, `file-sheet.js` + pure `mobile-links.js`): Quick Access, then the cards as an accordion in desktop reading order (`orderCardsForMobile`; open state per browser in `dashboard_mobile_links`, never `collapsedCards`). Bodies hold the REAL items (`createCardItemElement`), icons as a labelled 64px grid (`labelForIcon`); `items.enhance(host)` stops a scroll from toggling Quick Access and turns the link / task toggles into an **item sheet** (no floating bubbles). Card ＋ = item creator (no Separator tab), `Notes n` = Write. Search (⌕, input focused in the tap): `searchAll` → Tasks · Writing · Links · Cards · Completed. `window.openFile` is wrapped while mounted: images open in a full-screen **viewer** (`openViewer`, `.mx-viewer` on `<body>`, z 10050, so it also shows over the task editor, calendar and meetings; fit to screen, pinch / double tap 2.5× / wheel (preview) zoom, pan, swipe down / Back / Escape / × close, a tap toggles the bar; Share (when `navigator.canShare({ files })`) and Download are small extras; its own object URL; layer `file-viewer`, Back entry pushed in the tap; errors with Try again), other files in a window opened inside the tap (HTML through the view-link worker, never a blob: URL), a blocked popup → the viewer's file card (Open / Share / Download), `Sign in to open files` when signed out. **Phone time field** (`time-picker.js`): Chrome on Android can't type into `<input type=time>` and its clock dialog can't be styled, so in the task frame `enhanceTimeInput` puts a typed field (`inputmode=numeric`: `3`, `330`, `1530`, `3pm` via `parseTypedTime`; written into the native input through the prototype setter + input / change, so tasks.js has no phone code), a visible AM | PM switch (12-hour locales; a guessed side is dashed with "Reads as …") and a clock button beside it; `openTimePicker` (`#mx-time-picker`, z 10055, layer `time-picker`): readout with the part being set highlighted, hour then minute grids, ± 1 minute, solid AM | PM; end mode shows the start, quick lengths (15m … 2h) and the length, and disables times ≤ the start
- **Not on mobile** (listed under More → Not on mobile): edit mode and all card layout work, editing / deleting existing card items (adding and moving work: an open card's "Move an item…" or the item sheet's Move to…, same targets as the desktop Move list, saved at once with Undo), separators, sticky notes (`initStickyNotes()` skipped on phones), header photo / logo editing, linking tasks to card items and subtask templates, image resize handles, keyboard shortcuts
- **Change funnel**: `renderMobileShell(reason)` coalesces every request (`model:saved`, the sections branch, the wraps, visible, midnight, `storage`, tab, lens) into one microtask flush: chrome + the active screen, skipped when its `signature(ctx)` is unchanged (`FORCE` reasons always render); inactive screens go stale and render when shown. **Loop guard**: `handledSeq = __modelSaveSeq` at the end of each render, so a save made during a render (getters that repair data) arrives with `seq ≤ handledSeq` and is ignored. A render NEVER calls `renderAllSections`, `updateNotificationBadge`, `refreshTaskViews` or `renderEisenhowerMatrix`; shell actions call the data API (`completeTask`, `updateTask`, …) + `refreshTimeTrackingUI()`. Renders wait while any owner holds `api.setGestureActive(true, owner)`; lists are keyed patches (`api.patchList`); live clocks write `Text.data` only
- **Layers + history** (`layers.js` + pure `mobile-nav.js`): anything Back closes is a layer `{ id, root, isOpen, back, kind: 'shell' | 'reused' }` (last registration wins; built-ins cover every reused modal / popover, F3 replaces the 7 writer layers); top = highest computed z. **Depth model (phones)**: one `{ mx: depth }` entry per open layer + one while a tab other than Tasks shows, pushed by a MutationObserver in the opening tap's microtask (user activation, so never skippable); closes trim with `history.go(-n)` + an ignore counter; `popstate` reads the depth from the entry, closes the top layer / goes home / lets the browser leave, and NEVER pushes. `history.scrollRestoration = 'manual'` on phones while mounted. **Sheets** (`sheet.js`): the chrome behind is `inert`, but `#mx-screens` gets `aria-hidden` + a focusin guard instead (inert on it restyles every row); closing gives the focus back to the opener (the composer too, on a dismiss); a sheet without a title is named by its body's heading. Toasts on `#toast` are read out through `#mx-live-region`
- **Sync on phones** (`sync-guard.js` + pure `mobile-sync.js`): push 2.5 s after a save (retries 4 / 8 / 16 s), on page hide and `online`. "Dirty" is `hasUnsyncedChanges()` (sync.js: the in-memory flag OR the persisted `__dirty` flag), so changes left by a page that started offline still push, show as pending and are never pulled over. The gate `window.__mxPushGate` (Storage & Sync) holds any upload when the cloud copy carries a foreign stamp this browser hasn't seen and local changes exist (`decideSync` → conflict; `cloudSave()` returns `{ ok: false, held: true }`, no toast), so every push path is covered. It fails closed: when that GET failed (5xx, dropped connection; a 404 = no profile yet passes), `cloudSave()` returns the GET failure and the push retries instead of uploading blind. Resume (≥ 60 s hidden, nothing open): `cloudLoad()` → idle (no reload) / push / pull (adopt, time log merged) / **conflict sheet** (Keep this phone's version · Use the other device's version · Decide later). Resume and "Use the other device's version" read the cloud only for the account on screen and drop the answer if it signed out or switched meanwhile (`adopt(profile, owner)` writes `scopedStorageKey(owner)`). A second tab: the `storage` event reloads in place. Avatar dot: none synced, amber waiting, red failed / conflict, grey ring signed out. The desktop has no gate (user decision)
- **z-index plan**: every shell layer < 1000, so every reused modal (lowest 1500) stacks above: sub-bar 880, top bar 900, lane / carry 910, dock 920, + 930, preview switch 935, sheet scrim / sheets 940 / 950 (+2 per stacked sheet, max 958), composer 970 / 980 (its help 985 / 986), drag ghost 990 (`--mx-z-*`, mobile.css §1). Two exceptions on `<body>` (outside `#mobile-shell`, so the zCeiling check stays < 1000): the file viewer 10050 and the time picker 10055 (`--mx-z-time`), above the writer frames (≤ 10012), calendar, meetings and focus mode, below help 10060 and the toasts. **Toast lane** (mobile.css §8): `#toast` / `#qc-toast` sit above the dock, + and lane, on the keyboard (`data-mx-kb`), above the composer (`--mx-compose-h`) or above an open "Mark as complete?" question (`html[data-mx-confirm]` + `--mx-confirm-h`); the composer never uses bottom toasts
- **Versions**: `main.js` imports `shell.js?v=<MOBILE_BUILD>`; every specifier into `js/features/mobile/` carries `?v=<MOBILE_BUILD>` (units: ``import(`./${file}?v=${MOBILE_BUILD}`)``) and NO other specifier has a query (one instance of every shared module and `js/core/mobile-*.js`); optional cross-unit exports use namespace imports. **Bump `MOBILE_BUILD`** (mobile-device.js) with the main.js shell specifier, every intra-folder `?v=`, the six `mobile*.css?v=` and `js/main.js?v=` in index.html; `mobile-device-test.mjs` checks them all
- **CSS**: six static links after writing.css; structural rules under `html[data-shell="mobile"]`, glass under `html[data-fx="v2"][data-shell="mobile"] body[data-style="glass"][data-theme]` (0,5,2, no `!important` needed); classes `mx-`; tokens only, with dark / sunset / a11y guards and a landscape section per file. Each unit restates the phone rules of the reused surfaces it owns under the prefix, so the preview equals a phone. Icons and swatches are never recoloured, filtered or overlaid
- **Installable app (Android)** (notes: `Reference/mobile/notes/pwa.md`): `manifest.webmanifest` (name "Personal Dashboard", short_name "Dashboard", id `/dashboard/`, start_url / scope `./` = `/dashboard/` on Pages, `display: standalone`, background `#f5f3ee` (= the icon's paper, so the splash matches), theme `#cfd0d2` = THEME_COLORS classic-light, icons 192 / 512 "any" + "maskable"). Chrome on Android installs it from the menu (⋮ → Install and create shortcut, older builds Add to home screen → Install; Chrome may also offer it by itself) as a WebAPK: app drawer, own window, Android Back, storage shared with Chrome (no second sign-in). **No service worker** (installing needs none since Chrome 108; offline launch shows Chrome's own offline page). The link is added by `<script data-pwa-manifest>` (index.html, right after the boot script) on everything **except iPhone / iPad** (iOS would make a home-screen bookmark a standalone app with its own storage and no Back: kept as before, no `apple-mobile-web-app-capable`); computers get it too (Chrome can offer Install there; pages unchanged). The status bar follows the shell's mounted `theme-color` meta. Google sign-in / Calendar connect leave the scope in the app's own tab (a custom-tab toolbar shows) and come back to it with `sessionStorage` intact; Google's pages stay in the history behind the dashboard, so a Back into them can come back with the used state: ignored while signed in / connected (see Google sign-in, Google Calendar); the Back after that lands on the page that started the trip, which Chrome may restore in its pre-trip state: it reloads or refreshes (Storage & Sync → Back/forward cache). A dialog that opens by itself during load after a Google return pushes its Back entry without a tap (Chrome may skip it until the user taps; on the device checklist). Icons: `Reference/mobile/render-app-icon.cjs` (explorations in `Reference/mobile/icon-explore/`: `explore*.html` + `shoot.cjs`); a new icon at the same URLs reaches installed apps through Chrome's own update check (about once a day on launch, may ask the user to accept it); keep the manifest stable (each change re-mints the WebAPK)
- **Invariants**: the shell never writes `section.layouts`, the flat grid props, `collapsedCards`, `collapsedSubtitles` or `timeTrackingExpanded`; never gives an element `id === sectionId` (panes are `section.card.mx-card[data-section-id]`); never runs with edit mode on; never puts `transform` / `filter` / `backdrop-filter` / `contain` / `will-change` on `html`, `body`, `#mobile-shell` or `.mx-screens`. State lives in `<html>` attributes (`data-shell`, `data-phone`, `data-shell-frame`, `data-mx-*`), never class / `hidden` / style on `#mobile-shell` (glass-glow ignores `<html>`). Per-browser state only in `dashboard_mobile_<ns>` (`api.store`; unsaved writing per account), never the model. No code branches on `display-mode`: the installed app runs exactly the phone shell
- **Tests**: Node `Reference/mobile-{device,sync,nav,common,tasks,compose,write,today,links}-test.mjs` + `Reference/pwa-test.mjs`. Playwright `Reference/wr/mobile-{shell,tasks,create,write,today,links,integration,app}-e2e.cjs` on `mobile-lib.cjs` (`openPhone` 390×844 isMobile + hasTouch + iPhone UA + clock 2026-10-04 10:00, `openAndroid({ standalone })` 412×915 Pixel UA, standalone = a `matchMedia('(display-mode: standalone)')` shim since CDP can't emulate display-mode (harness `initScripts`), harness `bfcache: true` = the back/forward cache on (Playwright turns it off; the server's no-store keeps pages out), `toastLogScript` / `toastLog` (every toast since load), `restoredMarkerScript`, `pushLogScript` (each pushState + its user activation: page.goBack can't see Chrome skipping unactivated entries), `openPreview` 1440×900, CDP touch hold / drag / swipe, `goBack`, `renderCount`, `snapshotLayouts`): no page errors, no sideways scroll, z < 1000, ≤ 2 renders per action, 0 idle, layouts unchanged. harness.cjs `mode: 'mobile'` defaults `hasTouch` on (a phone-sized session IS the phone frame) and is ready on `#mobile-shell[data-ready="1"]`. Desktop / tablet regression: `smoke-e2e --no-shots`, `Reference/mobile/baseline/shoot-baseline.cjs`

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
- Tasks: opens Task Settings (categories, subtask templates)
- Writing & shortcuts: opens the Shortcuts & commands window (writing preferences live in its Preferences tab)
- JSON File Backup: Download and Upload with overwrite warning (includes `taskCategories` and `timeTracking`; importing a log resets history older than the import)
- The dialog body scrolls on short screens

### Quick Access (listed in the Today view; the old panel and its header button were removed)
- Long-press (750ms) any icon, reminder, subtask or copy-paste item on a card to add it; again to take it out. In view mode its card shows it first, with a steady azure halo
- `getQuickAccessItems()` resolves entries to the live card items (by card + section + key, else by the old text/url identity) and repairs entries on the way: older ones without card/section, renamed items, duplicates. Opening Today also runs `reconcileQuickAccessItems()` (drops entries whose item was deleted)
- `model.quickAccessExpanded` is no longer used (kept so old data loads)

### R2 File Storage Integration
- Images (profile photo, logo, card icons) stored in R2 when authenticated
- Legacy Base64 images auto-migrated to R2 on login (safe, idempotent)
- Edit popover for icons/subtasks/reminders supports URL or File Upload via `allowFileLink` dropdown
- **Media library** (`media-library.js`, the image picker for icons, photo, logo, item creator): one per account (`personal_dashboard_media_library_v1@<username>`; signed out: the original key). Uploads go to R2 when signed in (`Uploading…` on the button; the new image comes back picked); an inline (Base64) entry is uploaded once when picked while signed in, so whatever uses it gets an R2 reference and nothing uploads after the editor closed. The shared pre-split library (`…__split` stamp) is copied once into each account's; an R2 entry that answers 404 for the account (another account's file, a deleted one) drops out the first time it fails to load (`isFileMissing`). Files the library holds count as referenced (`window.mediaLibraryFileIds` in `getAllReferencedFileIds`): replacing an icon or photo never deletes a library image
- **Photo / logo editor** (`image-editor.js`): gets and returns the image AS STORED (`openImageEditor(ref, …)`; the preview shows it through `setImageFromRef`), never the page-only `blob:` address it displays (an older build saved that address, so the photo vanished on Confirm). The header callbacks (`replaceHeaderImage`, init.js) write synchronously and queue a replaced R2 file for deferred cleanup. `setImageFromRef` returns false when a newer call for the same `<img>` took over (a late fetch never overwrites it); the header re-places an already-loaded image after a zoom / position change
- Task editor has multi-link system: `+` button → choose URL or File → subtask-style input with confirm/edit/delete
- Meeting editor has dedicated Files section for R2 attachments
- File-linked items open via authenticated fetch (images/PDFs inline, HTML via isolated viewer)
- Image refs use `classifyImageRef()` → `setImageFromRef()` for rendering
- **Two limits**: the profile JSON (all dashboard data, one D1 row) is capped at 2 MB (`MAX_PROFILE_BYTES`, and D1's own 2 MB row limit); R2 file storage is 100 MB/user (5 MB/file) — what the File Manager bar shows. Anything image-sized belongs in R2
- **File Manager**: Orphaned files (not referenced anywhere in the profile, the edit-mode working copy or this account's media library) on top with Delete All, then Images and Documents. Deleting a file also scrubs its references, including `<img data-r2-file-id>` in rich text

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
- Session token stored in localStorage (30-day expiry), once the account's dashboard copy is ready (`persistSession`, see Storage & Sync)
- Profile syncs to D1 on: confirm edits, import, every 20 min while dirty; phones also 2.5 s after every save, on hide and on resume (Mobile Shell → Sync on phones)
- 401 ends the session but keeps that account's dashboard (and its unsynced changes) in its own copy until it signs in again or someone signs out / in (Storage & Sync → Whose copy). Only a 401 to a call that sent this page's CURRENT token counts, and `clearAuthState` touches the stored token / username / `pd_auth_lapsed` only when the stored token is this page's own: a stale window never wipes another window's session or brings back an account that signed out elsewhere. `login()` / `register()` use `{ keepSession: true }`: a 401 there is a wrong password (the Worker's message shows)
- **One upload at a time**: `cloudSave()` answers `{ ok: false, busy: true }` while one is in flight (`waitForCloudSave()` settles when it is done); `immediateCloudSave(opts)` waits for it and uploads again if still dirty (`opts.quiet` = no toast). **Sign-out** waits for the upload in flight, then uploads whatever `hasUnsyncedChanges()` reports (also a stored `__dirty` from an offline start) before signing out; a failed upload says the changes wait on this browser
- **Dashboard load flag** (sync.js `beginDashboardLoad` / `endDashboardLoad` / `isDashboardLoading`), held by postRestoreAuthSync, completeSignIn, resumeGoogleSignin and the sign-in / register request itself (from Submit on): edit mode refuses to start meanwhile, and completeSignIn stops a sign-in if edit mode is on anyway (toast `Loading your dashboard… try again in a moment`), so a startup sync that adopts a newer cloud copy can't be overwritten by a stale model; postRestoreAuthSync always reaches `startSyncTimer()` and `migrateBase64ToR2()` (which stops as soon as the signed-in account changes). `prepareAccountCopy` writes the whole copy or nothing (storage full → `{ ok: false, error: 'storage' }`, the sign-in is abandoned), reads the cloud for a just-created account too (a saved copy wins), and any exception before `persistSession()` abandons the sign-in
- Sign-in security check: after many attempts on one account from different networks the Worker answers `403 { turnstile_required: true }`; the sign-in form then shows the Turnstile widget (same container as registration) and the next attempt sends `turnstileToken` (`login(username, password, turnstileToken)`). Too many from one network: `429` with a wait. Worker side: Reference/Backend (`api-worker.phase1.js`)
- **Google sign-in** (user decisions 2026-10-17; Worker block `Reference/Backend/google-signin-worker.js`, setup `google-signin-setup.md`): "Continue with Google" (`#auth-google-btn`, Google's white / dark button with the four-colour G) above the form in both Sign In and Create Account. Google is asked for `openid email` only (same OAuth client as Calendar, no calendar access, nothing stored but Google's account id and email). Logins are matched by Google `sub`, never by email
  - Flow: `startGoogleSignin(mode)` makes a random secret, keeps it in sessionStorage `dashboard_google_signin` and sends only its SHA-256 (`proof`) to `POST /auth/google/start` → Google → the Worker's callback → back to `DASHBOARD_URL#google-signin=ok&code=…` (or `=error&reason=…`). The FRAGMENT never reaches a server and holds no session: `readGoogleSigninReturn()` (auth.js) reads and strips it first thing in `init()` (`history.replaceState(history.state, …)`, next to `readGcalReturn()`), and `resumeGoogleSignin(startupSync)` at the end of `init()` POSTs the code + this tab's secret to `/auth/google/finish`. A code without the secret (another tab, a link someone sent) is refused before the Worker
  - Answers: a known Google login → the normal session (same as `/login`) → `completeSignIn(username)` (the shared after-sign-in flow: scoped storage, restore, `syncOnLogin`, re-render, sync timer, toast, `gcalAfterSignIn`). A NEW Google account → the **username step**: the Create Account dialog without the password field (`#auth-password-field` hidden, not required), with `#auth-google-note` ("Signed in to Google as …"), the suggested username and the Turnstile check → `registerWithGoogle()` → `/auth/google/register`. Such an account has no password
  - Linking: account popover `#auth-google` (computer, above `#auth-gcal`) / More → Google sign-in (phone sheet) = `buildGoogleSigninPanel(host, { title, fallback })`: Link Google account (`startGoogleSignin('link')`, the session goes along and must match at the end; refused in edit mode) or the linked email + Unlink (asks inline first; not offered on a Google-only account). One Google login per account and a link never replaces it (409 `already_linked`: "Unlink the current Google account first.", at start and at finish); the password keeps working. A sign-in code works only through the Google login as linked when it is used (an Unlink takes effect at once for codes already handed out); a D1 error in the callback lands on `#google-signin=error&reason=failed`. A trip to Google that never leaves (no pagehide within 8 s) re-enables the form; closing the dialog re-enables Continue with Google. A link's toast waits for the startup sync (its own toast would cover it)
  - The Google routes go through `apiCall(method, path, body, { keepSession: true })`: a 401 there never signs out (an old Worker without the routes answers 404 → "Google sign-in isn't available yet."). Errors come as `{ error, reason }`
  - Leaving for Google drops nothing: the button refuses in edit mode; a Back from Google's page re-enables the form (`pageshow` persisted)
  - Signed in, a failed return is a toast, never the Sign In dialog over the account (`resumeGoogleSignin`); `reason=invalid` without this tab's secret while signed in says nothing (a Back into Google's page after a finished trip, which the installed app keeps in its history, came back with the used state). A fresh code without the secret still says "Finish the Google sign-in in the tab that started it." (toast signed in, the dialog signed out)

### Grid Engine (`js/features/grid-engine.js`) — single source of truth for layout
- **24-column graph-paper grid**: uniform square cells (~36px at 1260px width), computed in JS as px values (never CSS %)
- **One layout engine for both modes**: view AND edit mode use identical fixed square-cell rows (`grid-auto-rows: <px>`). Edit mode is a zoomed (0.7) preview of the exact same layout — WYSIWYG by construction
- **Header** pinned to grid row 1 (auto height via `grid-template-rows: auto`); data cards live in rows 2+; all row math offsets by real header height (`getGridOriginY`)
- Each card stores `gridCol`, `gridRow`, `gridColSpan`, `gridRowSpan` — explicit placement, no CSS auto-flow, cards positioned relative to the grid only
- Cards fill their grid area (`align-items: stretch`); white space lives inside the card
- Key functions: `getCellSize()`, `applyCellSize()`, `applyGridPlacement()`, `mouseToGridCell()`, `computeDropPosition()`, `resolveCollisions()`, `computeGrownLayout()`, `applyShownLayout()`, `autoAssignGridPositions()` (2D bin-packing)
- `computeGrownLayout()` runs after every render (view AND edit mode, through `applyShownLayout()`, which also lays collapse compaction on top in view mode): a card whose content outgrew its area at this screen width is SHOWN taller and the cards below move down, so nothing clips (collapsed cards are excluded from measurement). Display only, on copies: it never writes the flat props or `section.layouts`, so the saved layout changes only through explicit edits (drag, resize, add card). A layout designed on a wide screen therefore survives refreshes on a narrower one (where it just shows taller) — the old `reconcileRowSpans()` saved that growth and squished the wide layout (user report 2026-10-08)
- `ResizeObserver` recomputes cell sizes on container resize (also observes the header for async image loads); in view mode a changed cell size re-runs `applyShownLayout()`, so narrowing the window never clips a card
- The grid container never transitions (`.app-main { transition-property: none }`): glass.css's reduced-motion rule gives every property a 0.01ms transition, which kept the edit-mode zoom (0.7) for one frame, so the exit render measured the zoomed-out grid and clipped cards

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
- The dashboard's current look, layered on top of `glass.css`: static canvas aurora, thicker corner-lit bevels (lit top-right/bottom-left, shaded top-left/bottom-right), layered lift shadows, prismatic lit-corner rims, a steady corner light for the icon link/task indicator (replaces the old glossy bead), feathered colored glows, pointer-caught rim light
- Every rule is scoped under `html[data-fx="v2"] body[data-style="glass"][data-theme]` (`index.html` sets `<html data-fx="v2">`). Keep the prefix on new rules: it also supplies the specificity these rules need over `glass.css`
- New visual work goes in `glass-fx.css`, in its matching section (tokens → canvas → shells → tiles → indicator → quick access → reminders → pills → swatches → matrix → timers → controls → dialogs → pointer light → dark → sunset → keyframes → a11y guards)
- Decoration only: never changes geometry (the grid engine measures content), never touches icon images, and color-swatch copy pills keep their exact `--copy-base` core
- Animations are opacity/transform only on small pseudo layers, with staggered phases; reduced-motion and reduced-transparency guards live at the end of the file
- **Why frames are expensive**: ~90 stacked backdrop-filter layers (header + cards blur 24px saturate 150%, items blur 8/12px, dialogs blur 36px over a full-screen blur 4px scrim). Chrome expands any change inside a blurred layer to that layer's whole area, so one pulsing light redraws most of the screen; on an integrated GPU that is 25-70 ms per frame. So no endless animations on the dashboard, and never animate anything (or rewrite styles per frame) inside the glass without a reason
- **Static lights** (glass-fx.css 11d, user decision 2026-10-08): the lights that used to breathe (indicator pool / core, Quick Access halos and SVG rims, red-reminder ember, pinned-task bloom, running-timer crystal halo / sweep and header live dot, badge glow) shine steady, each held at a lit moment of its old keyframes (`animation: none` + fixed opacity / transform). Their keyframes stay in section 18 (the mobile shell still uses fxBreath / fxPool / fxCore for its own dots). A new light must be static too; drag / drop / placement motion (drop light, separator slots, swap pulse, just-added glow) is fine because it only runs during an action
- **Typing hush** (glass-fx.js): `<html data-fx-hush>` for 1.5 s after a keystroke / input in a text field or a selection change that leaves a non-empty text selection (not under reduced motion; a plain click never hushes). While set, the pointer rim light holds still and catches up on the next move. Never in the mobile shell
- **glass-glow.js** skips attribute records whose value did not change (`attributeOldValue`) and only re-maps reflected light for changes inside / around a card (`movesLight`); phones keep the original rules. So per-keystroke / per-selectionchange code must not rewrite an unchanged class or attribute (each one used to re-measure every card), and must not rely on a same-value write to refresh a glow

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
- `resetFileCache()` - On an account switch: drops cached blob URLs, "not found" answers and late fetches; `isFileMissing(fileId)` - the file answered 404 for this account
- `getAllReferencedFileIds()` - Every fileId the profile (and edit-mode working copy, for rich text, and this account's media library) still uses
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
- time-log.js periods: `TIME_RANGE_PRESETS` / `normalizeRangeFilter(raw)` / `resolveTimeRange(filter, nowMs)` → `{ start, end (exclusive), from, to }` or null / `getTaskTotalsInRange(log, now, range)` / `getTaskTotalInRange(log, taskId, now, range)` / `getTaskLastActive(log, taskId, now, range)` / `sessionInRange(start, end, range)` / `toDayKey` / `dayKeyToDate`

### Google Calendar
- google-calendar.js: `initGoogleCalendar()` / `readGcalReturn()` (init.js) / `afterSignIn()` / `resetGcalState()` (auth-ui.js) / `getGcalStatus()` / `refreshGcalStatus()` / `isGcalTasksReady()` / `isGcalBusyReady()` / `gcalStateKey()` / `onGcalChange(fn)` / `connectGoogleCalendar()` / `disconnectGoogleCalendar({ deleteCalendar })` / `saveBusyCalendars(ids)` / `syncGoogleCalendar({ manual })` / `syncGoogleCalendarNow()` / `getGcalDefault()` / `setGcalDefault(on)` / `dayBounds(dayKey)` / `requestBusyDay(dayKey, { force })` / `getBusyDay(dayKey)` / `buildGcalPanel(host, { title })`
- busy-strip.js: `renderBusyStrip(host, dayKey, { now })` / `ensureBusyDay(dayKey)`
- gcal-plan.js: `isCalendarTask(task)` / `gcalSignature(data)` / `busyDayLayout(calendars, { dayStart, dayEnd, now })` → `{ allDay, blocks, gaps, nextFree, busyMinutes, errors }` / `pctOfDay` / `busyFetchRange`
- Worker (`Reference/Backend/gcal-worker.js`): `handleGcal(request, env, ctx, { getUserId })` → a Response for `/gcal/*`, else null

### Projects & Meetings
- `openProjectsModal()` / `closeProjectsModal()`
- `openMeetingsModal()` / `closeMeetingsModal()`
- `attachTaskMention(editor, onInsert)` - Wire @ autocomplete to an editor
- `attachHighlighterContextMenu(editor, options)` - Wire right-click menu

### Authentication
- auth.js: `login(username, password, turnstileToken?)` / `register` / `logout` / `getDataOwner()` (signed-in or expired-session account, else null) / `getLapsedUsername()` / `persistSession()` / `abandonSignIn()` / `apiCall(method, path, body, { keepSession })` / `readGoogleSigninReturn()` / `takeGoogleSigninReturn()` / `startGoogleSignin('signin' | 'link')` → `{ ok, url }` / `finishGoogleSignin(code, secret)` → `{ kind: 'session' | 'signup' | 'link' }` / `registerWithGoogle(code, secret, username, turnstileToken)` / `getGoogleSigninStatus()` → `{ linked, email, hasPassword }` / `unlinkGoogleSignin()`
- auth-ui.js: `resumeGoogleSignin(startupSync)` (end of `init()`) / `buildGoogleSigninPanel(host, { title, fallback })` / `completeSignIn(username, { created })` (internal: the shared after-sign-in flow: `prepareAccountCopy` → `persistSession` → the account's model)
- sync.js: `getActiveStorageKey()` / `scopedStorageKey(username)` / `prepareAccountCopy(username, { created })` → `{ ok, source: 'local' | 'cloud' | 'carried' | 'empty', cloud }` (or `{ ok: false, error }`) / `syncOnLogin(prefetched?)` / `markCloudDirty(storageKey?)` / `resetSyncState()` / `cloudSave()` (`{ busy: true }` while one is in flight) / `waitForCloudSave()` / `immediateCloudSave(opts)` / `hasUnsyncedChanges()` / `beginDashboardLoad()` / `endDashboardLoad()` / `isDashboardLoading()` / `noteStoredCopy(key, raw)` / `storedCopyChangedElsewhere(key)`

### Calendar, Badge & Today
- `openCalendarView()` / `closeCalendarView()` / `refreshCalendarView()` (re-render if open)
- `updateNotificationBadge()` (also repaints an open calendar + Today) / `wireNotificationBadge()`
- `getDueItems()` (calendar.js) = `collectDueItems(currentData(), { todayKey, reminderDays: reminderDaysLeft })`
- `openTodayView()` / `closeTodayView()` / `toggleTodayView()` / `refreshTodayView()`
- agenda.js: `collectDueItems` / `countDueItems` / `meetingDatesBetween` / `meetingOccursOn` / `dueState` / `daysBetween` / `addDays` / `TASK_COLOR_ORDER`
- `createTaskPillElement(task)` (tasks.js) / `createCardItemElement(type, item, sectionId, subtitle)` (sections.js): the real pill / card item outside its panel
- `getQuickAccessItems()` / `reconcileQuickAccessItems()` / `openQuickLinkModal()` (quick-access.js)

### Card Item Moves
- card-move.js: `buildMoveTargets(data, sections, { sectionId, subtitle, isSubtitle })` → rows `header | section | card` / `moveCardItem(data, src, dst)` → `{ item, from, to, noteMove }` or `{ error }` (dst `index` / `key` = Undo back to the exact place) / `relocateItemRefs` / `relocateSectionRefs` / `renameSection` / `moveNotes` / `revertNoteMove` / `cardItemsOfType` / `moveToastText`
- edit-mode.js: `moveItemInEdit(src, dst)` (Move list + drag) / `renameCardSection(sectionId, from, to)` / `revertEditNoteMoves()` / `clearEditNoteMoves()`; drag-drop.js `parseItemSectionKey(key)`; mobile card-items.js `buildMoveItemsButton(sectionId)`

### Item Creator & Drop Light
- `openItemCreator({ sectionId, subtitle?, cardEl? })` / `closeItemCreator()` / `isItemCreatorOpen()`
- `showDropLight({ x, y, length, vertical })` / `hideDropLight()` (viewport coordinates)
- `resolveIconMedia(chosenMedia)` (sections.js, exported): media-library entry → R2 ref when signed in, else Base64

### Quick Capture
- `initQuickCapture()` (N key + header bolt) / `openQuickCapture()` / `closeQuickCapture()`
- `showActionToast(message, actions)` (exported; the item creator reuses it for Undo)
- quick-capture-parse.js: `parseQuickCapture(text, { now, categories })` (+ `dueTime`, `clearTime`, `timeSpan`, `impliedDate`, `dueEndTime`, `clearEnd`, `endSpan`) / `resolveDue(parsed, target)` / `endAfter` / `endIssue` / `matchCategory()` / `normalizeUrl()` / `toDateKey()` / `fromDateKey()` / `QUICK_CAPTURE_HELP`
- due-time.js: `isTimeKey` / `toTimeKey` / `timeKeyMinutes` / `timeKeyFromInput` / `dueTimeOf(task)` / `localTimeZone()` / `settleDueTime(task, { timeTouched, previousTime, endTouched, previousEnd, tz })` (updateTask) / `dueEndTimeOf(task)` / `minutesToTimeKey` / `shiftTimeKey(key, delta)` / `prefersHour12(locale)` / `formatTimeKey(key, { compact, locale })` / `formatTimeRange(start, end, { compact, locale })` / `parseTypedTime(text, { hour12, meridiem })` → `{ key, meridiem, guessed } | { empty } | { error }` / `shortClock(ms, hour12)`

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
- Services (`api.service(name)`): `taskRow(task, { mode, chip, contextOnly })`; `taskActions` (`openTask`, `completeWithUndo`, `confirmComplete(id, { slot, swiped, onCancel })` (sheet `complete-confirm`; Complete focused, Enter confirms, Escape cancels), `completeSubtaskWithUndo`, `restoreWithUndo`, `placeTaskWithUndo(id, { color, pinned, index }, { quiet })`, `toggleGroupWithUndo`, `setDueWithUndo`, `toggleTimer`, `openActionsSheet`, `openMoveSheet`, `revealTask`, `startCarry`); `completed.open()`; `composer` (`open({ kind, from, prefill })`, `close({ keepDraft })`, `isOpen`, `defaults({ from, lens })`); `writer` (`open(kind, id, opts)`, `create(kind, fields)`, `meetingJumpIn(id)`, `showNotesFor(sectionId)`, `recent`, `searchIndex`, `keepAll`, `anyOpen`); `time.openSheet()`; `more.open()`; `items` (`enhance(host)`, `openItemSheet(type, item, sectionId, subtitle)`, `labelForIcon`); `search.open(query)`; `links.revealCard(sectionId)`
- mobile-tasks.js: `planPlacement(tasks, id, { color, pinned, index })` → `{ from, to, orders, moved, colorChanged, pinnedChanged }` / `applyPlacement` / `boundaryIndex` / `stepIndex` / `snapshotColors` / `colorsSignature` / `restoreSnapshot` / `lensCounts` / `defaultLens` / `lensTasks` / `rowMeta` / `rowSignature` / `GESTURE`
- mobile-compose.js: `setTokenField(text, field, value, opts)` (fields color / pinned / date / time / timer / category / gcal) / `timeToken(key, hour12)` / `composerDefaults` / `effectivePlan` / `buildComposerPlan` (+ `plan.due`) / `lineFor` / `trayDateLabel(key, now, time?)` / `dateChips` / `bodyToHtml` / `draftIsFresh`; mobile-write.js: `collectDocs` / `searchDocs` / `meetingWhenLabel` / `datedHeadingHtml` / `mergeRecent` / `pushDraft` / `draftFor`; mobile-today.js: `buildToday` / `dueSummary` / `comingUp`; mobile-links.js: `labelForIcon` / `iconLabels` / `normalizeGroups` / `cardSummary` / `searchAll`
- mobile-common.js: `orderCardsForMobile` / `cardTitle` / `firstLineTitle` / `phaseFor`; mobile-device.js: `isPhoneDevice` / `isPhoneScreen` / `resolveDeviceMode` / `shellFrame` / `MOBILE_BUILD`; mobile-sync.js: `makeSyncStamp` / `decideSync` / `noteRestoredStamp` / `getDeviceId`; mobile-nav.js: `planHistory` / `pickTopLayer` / `planBack`
- Shell modules: layers.js `registerLayer` / `closeTopLayer` / `historyDepth`; sheet.js `openSheet` / `pushScreen` / `closeAllSheets`; sync-guard.js `pushNow` / `status` / `resolveConflict` (+ `window.__mxPushGate`); task-gestures.js `attachGestures` / `shieldTaps`; file-sheet.js `openFileMobile` / `openViewer({ fileId, fileName, mode: 'image' | 'file', blocked })` / `closeViewer` / `isViewerOpen`; time-picker.js `enhanceTimeInput(input, { label, role, getStart })` / `removeTimeField` / `openTimePicker({ value, mode, start, title, hour12, onPick, onClear, onClose, returnFocus })` / `closeTimePicker` / `isTimePickerOpen`; today-view.js `confirmCompleteTask(taskId, { slot, onCancel, onConfirm })` (the Today fallback rows and the Time sheet's Complete)
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

Legacy toolbar updaters run on every `selectionchange`, so keep them cheap: the task / subtask / ideas updaters share one `queryCommandState` per command per event (`commandStateReader` / `updateToolbarFor` in tasks.js); the task toolbar is refreshed only while the description is being edited (a place that un-hides `#task-desc-editor-wrap` calls `updateTaskToolbarState()`); disabled / dirty states are written only when they change. Subtask row menus attach their outside-click / scroll closers only while open (aborted on re-render), and one document listener closes every highlighter swatch dropdown.

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
12. Performance: code on per-keystroke / per-selectionchange paths writes a class or attribute only when it changes, adds no document listeners per render, and never forces layout in a loop; no endless animation on the dashboard (glass-fx.css 11d keeps the lights static). Measure with `Reference/perf/profile.cjs` (attribution) and `Reference/perf/compare.cjs` (before / after, `PERF_HEADED=1` for real GPU timing)

---

## Version History

### v5.10 (Current)
- **Move items into a card's own sections**: the Move list now offers the item's own card first ("This card", its other sections), cards as headings with their sections indented beneath (a tree rail); dragging an item onto another section of the same card works in the Card Edit Modal (it never did: the modal's card was no drop zone). Linked tasks, subtask notes and Quick Access follow a moved item; keys stay unique across the card; section names with ':' work; a section rename keeps its place and refuses a taken name. **Phones** can move items too: an open card's "Move an item…" or the item sheet's Move to…, with Undo
- **Open images in the app (phones)**: a picture attached to an icon, subtask, reminder, task or meeting opens full screen (pinch / double tap to zoom, swipe down or Back to close, Share / Download as small extras) instead of a sheet with only Share / Download; it also shows over the task editor, calendar and meetings (the old sheet opened hidden behind them)
- **"Mark as complete?" on phones**: the ring, swipe → and the Time sheet's Complete ask first (Cancel / Complete; completions still batch into one Undo; the Undo toast moves above the question). The actions sheet's labelled Done and subtask checks don't ask
- **End times**: a task can end at a set time (task editor end field; `3-4pm`, `2pm to 3:30pm`, `!end:5pm` / `!noend` in quick capture and the phone composer; ranges in Today, the calendar, phone rows and Coming up); moving the start keeps the length. Google Calendar blocks start → end (Worker paste pending; until then 30 minutes)
- **Phone time field**: on phones the due time is typed with the number keyboard (`3`, `330`, `1530`, `3pm`) beside a clear AM | PM switch that says when it guessed; the clock button opens the dashboard's own picker (the part being set highlighted, hour then minute grids, solid AM / PM; for an end: the start, quick lengths and the length). The composer's Time… / Ends… use the same picker (Chrome's native clock dialog hid AM / PM and its typing never opened the keyboard)
- **Fixes from a review of the Calendar / Google sign-in / Android app / account work**: a failed or unfinished Calendar sync is retried (30 s, 2 min, 10 min); a wrong password no longer says "Session expired" or wipes another window's session; a stale window's 401 can't sign out or "lapse" another window's account; signing out waits for an upload in flight and pushes unsynced changes first; a startup sync can't be overwritten by edit mode (edit mode waits for it); a restored (Back) page whose dashboard changed elsewhere reloads instead of saving over newer data; phone resume / conflict adopt only for the account on screen; phone drafts stay with an expired session's account; image migration stops on an account switch; Create Account on a flaky network still carries the signed-out dashboard; a full browser storage abandons a sign-in cleanly; the Google button never stays disabled after a stopped trip; the busy strip no longer scrolls on hover after a drag released off it; the phone app opens on Tasks (a restored tab's Back entry could close the app). Worker: a link never replaces an existing Google login, an Unlink voids codes already handed out, callbacks hit by a D1 error return to the dashboard, the Calendar sync finishes after a closed tab (`ctx.waitUntil`). Paste the rebuilt `Reference/Backend/api-worker.js` (gcal-integration.md / google-signin-setup.md "Update 2026-10-19")
- `MOBILE_BUILD` 2026-10-mobile-7

### v5.9
- **Accounts never mix**: signing in no longer copies this browser's signed-out dashboard (or what an earlier account left in it) into an account. A new account created here still takes the signed-out dashboard, once; an existing account always shows its own copy (the cloud one, even a sparse one; empty when it has none); a cloud copy that can't be read stops the sign-in instead of guessing. Before, an empty or sparse account was overwritten with the signed-out dashboard, and signing in with edit mode open merged its edits into the account
- **Expired sessions**: after a 401 the account's dashboard stays on screen and changes are kept in its own copy (never the signed-out dashboard); signing back in as that account uploads them, another account never sees them. The sign-in dialog names the account (username prefilled, "Sign out instead")
- Sign in / sign out wait for edit mode to end; the session is saved only once the account's copy is ready (a reload mid sign-in comes back as before); a save made while switching stays with the dashboard on screen
- **Media library per account**: each account sees its own uploads (another account's files no longer show up broken); "Uploading…" while it works, and the new image comes back selected; an inline image uploads once when used; a library image is never deleted because an icon or photo stopped using it
- **Sticky notes per account**: each dashboard keeps its own sticky notes and note colour on this browser (still never synced): an account's notes never show for another account or signed out, and are there again when it signs back in (also while its session has expired). The notes a browser already had go to the first account that opens the dashboard there; until then they show signed out
- **Profile photo / logo**: the editor shows stored images (no more broken "Preview"), an adjust keeps the stored file (the photo no longer disappears on Confirm), and a zoom / position change shows right away
- `MOBILE_BUILD` unchanged (no shell file changed)

### v5.8
- **Due times**: a task can have a time on its due date: the task editor's time field (× clears it), `3pm` / `3:30 pm` / `15:30` / `noon` in quick capture and the phone composer (a time alone = its next occurrence; `!notime` removes it), and the composer's date panel (`Time…`). Shown in Today, the calendar, phone rows and Coming up. Stored as `dueTime` + `dueTz` (the zone it was set in)
- **Google Calendar at that time**: a flagged task with a time becomes a 30-minute event at that time instead of an all-day one (Worker update in `Reference/Backend/gcal-integration.md`; until it's pasted, timed tasks stay all-day; existing all-day events are untouched)
- **Busy strip, zoomed in**: 8 hours at a time (from the hour before now), scroll / swipe / drag / ‹ › / Now for the rest of the day; every hour labelled, half-hour marks, blocks show their own times when they fit
- **Shorter commands**: `!cal` / `!nocal` for Google Calendar (the old `!gcal` / `!nogcal` still work), `!p` / `!nop` for Primary (alongside `!priority` / `!nopriority`); the phone tray writes the short forms
- `MOBILE_BUILD` 2026-10-mobile-6

### v5.7
- **Installable Android app**: in Chrome on Android, ⋮ → Install and create shortcut (older Chrome: Add to home screen) → Install puts "Dashboard" in the app drawer: own window, no address bar, Android Back, same storage as Chrome (no second sign-in), status bar in the theme colour. No Play Store, no service worker. Web app manifest + 192 / 512 icons (rounded and maskable) from the existing app icon
- iPhone unchanged (no manifest there, so a home-screen bookmark keeps opening as before); computers may offer Install too, pages unchanged
- Google sign-in and Connect Google Calendar complete inside the installed app; a Back into Google's page afterwards no longer opens the Sign In dialog over a signed-in account or toasts "Couldn't connect" while connected; failures while signed in are toasts; the Back after that shows the current state (a page restored from the back/forward cache after a sign-in elsewhere reloads, or offers to in edit mode; same account, it re-reads Calendar and the Google sign-in panel, whose Link button no longer stays dead after a Back from Google's page)
- **New app icon**: the "tsks." wordmark (black on warm paper, navy dot) replaces the frosted + lens; the splash screen uses the same paper colour
- `MOBILE_BUILD` unchanged (no shell file changed)

### v5.6
- **Continue with Google**: sign in or create an account with a Google account (openid + email only). A new Google account picks its username (suggested from the email) and passes the same security check as Create Account; a known one goes straight in. Works in the sign-in dialog on a computer and on phones
- **Link Google sign-in** to an existing account (account menu on a computer, More → Google sign-in on phones): the password keeps working; Unlink asks first
- **Security**: logins matched by Google's account id, never by email; the session never travels in a URL (a single-use code in the fragment, exchanged by POST); the flow only finishes in the browser tab that started it; attempts rate-limited per network. Worker block, schema, setup and tests in `Reference/Backend/`
- `apiCall` takes `{ keepSession }`; the after-sign-in flow is shared (`completeSignIn`); `MOBILE_BUILD` 2026-10-mobile-5

### v5.5
- **Google Calendar**: connect a Google account (account popover on a computer, More on phones). Tasks with a due date can go to the app's own **Dashboard tasks** calendar (task editor checkbox that remembers the last choice, quick capture `!gcal` / `!nogcal`, a tray chip in the phone composer); completed tasks stay there with a ✓, deleted ones leave. The calendar mirrors the cloud profile (the Worker reads it; syncs after every upload)
- **Busy times**: a strip in Today (computer and phone) shows the whole day's busy blocks from Google free/busy (times only, never what the events are), the booked total and the next free stretch; an all-day busy event is a note, not a filled day
- **Security**: narrowest Google permissions (no event reads, no Gmail), the refresh token encrypted at rest in the Worker, single-use hashed OAuth state + PKCE, an allowlist, Google errors never sign the dashboard out. Worker block, schema and tests in `Reference/Backend/`
- Task editor: a date-only edit is no longer dropped on close / Back (the change snapshot includes the due date)
- `cloudSave()` raises `cloud:saved` after each successful upload
- Grid: leaving edit mode no longer clips cards when the system asks for reduced motion (the grid container no longer transitions), and narrowing the window re-fits cards to their content instead of clipping them (display only, as before)

### v5.4.2
- **Edit subtask templates**: Settings → Tasks lists the saved templates; open one to rename it, edit / add / remove / reorder its subtasks, or delete it (draft, saved with Save). Confirming edit mode no longer reverts a template change made meanwhile (`subtaskTemplates` left out of `deepMergeModel`, like `taskCategories`)
- **Layouts no longer get squished**: content growth at a narrower screen width is display-only (`computeGrownLayout`), so the desktop / tablet layout saved in edit mode is exactly what a wide screen shows after any refresh elsewhere
- **Static lights**: the indicator, Quick Access, reminder, pinned-task, timer and badge glows no longer pulse; they shine steady at a lit value, so an idle dashboard stops redrawing the glass stack every frame (GPU idle instead of saturated on an integrated GPU). The covered-dialog pause is gone (nothing left to pause); the typing hush stays for the pointer light
- Time Tracking: Categories beside Tasks on wide panels; the red badge has no glow in light mode
- Time Tracking Tasks: sort button (Most time / Most recent); the period filter now filters the task list too (tasks timed in the period, their time in it, sessions in it)
- `@` task lists (quick capture, editors, item task picker): the picked task has an azure ring and is brightened, not darkened (it read as "off" in dark mode); ←/→ jump between color columns

### v5.4.1
- **Performance pass (typing and selecting)**: measured on an integrated GPU, a keystroke in an editor took ~450 ms to paint because the endless glow animations kept the GPU redrawing the whole blurred glass stack. The glows now shine steady (static lights, user decision), and the pointer light holds still while typing / selecting
- glass-glow.js no longer re-measures every card on same-value attribute writes or on changes far from any card; every hot path stopped rewriting unchanged classes / attributes (projects save button, convert / link buttons, meetings buttons, quick-capture preview and picker, item creator, search)
- Leaks fixed: subtask row menus added a document click + scroll listener per row on every render; each meetings edit open added a document click listener
- Projects save button switches clean / dirty / saved instantly (its 0.2 s fade redrew the whole screen under the dialog's glass for every frame, starting on the first keystroke; user decision)
- Fewer forced layouts / style passes: shared `queryCommandState` per selectionchange in the task / subtask / ideas toolbars, sticky-note font fit fast path, pointer light reads before it writes, `:has()` rules no longer climb the whole document (glass.css html background, mobile toast lane, help footer)

### v5.4
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
