# Personal Dashboard - Complete Documentation

## Project Overview

### Purpose
A fully customizable personal work dashboard that centralizes all daily tasks, tools, reminders, and links in one interface. Built for productivity-focused professionals who need quick access to their most-used resources and want complete control over their workspace organization.

### Key Characteristics
- **No Framework Dependencies**: Pure vanilla JavaScript, HTML5, and CSS3
- **Fully Customizable**: Every element can be edited, moved, added, or removed
- **Persistent Storage**: All changes saved to browser LocalStorage
- **Theme Support**: Built-in light and dark mode with seamless switching
- **Responsive Design**: Clean, card-based layout with flexible sizing
- **Zero Backend**: Runs entirely client-side with optional JSON import/export

### Hosting & Deployment
- **Public Repository**: This application is hosted on GitHub as a public repository and served via GitHub Pages
- **Static Site**: No server-side processing - all functionality runs in the browser

### Security Considerations
> **IMPORTANT**: This is a PUBLIC repository. All code changes are visible to anyone.

When making changes to this codebase, **NEVER** include:
- API keys or secrets
- Personal credentials or passwords
- Private URLs or internal endpoints
- Sensitive personal information
- Authentication tokens
- Database connection strings
- Any data that should not be publicly accessible

User-specific data (links, reminders, settings) is stored in the browser's LocalStorage and is NOT part of the repository. The JSON import/export feature is for user convenience and should only contain non-sensitive configuration data.

---

## Core Functionalities

### 1. Edit Mode System
- **Toggle**: Pencil icon button (bottom-right) activates/deactivates edit mode
- **Visual Indicators**: Editable elements become interactive when edit mode is active
- **Dual State Management**:
  - `model`: Permanent data state
  - `editState.working`: Temporary working copy during edits
  - Changes only saved when user confirms
- **Global Actions**: Accept (✓) or Cancel (×) buttons appear when in edit mode

### 2. Card Types

#### Single Card
- Standard card layout for icon grids or content
- Examples: Content Creation, Ads sections
- 4-column icon grid by default
- Dynamic sizing: small, medium, large, full

#### Two-Column Layout
- Special container for side-by-side cards
- Examples: Daily Tasks + Daily Tools
- Each card maintains independent content
- Shared container handles spacing

#### Reminders Card
- Specialized for time-based and interval-based tracking
- **Features**:
  - Calendar scheduling with repeat options (weekly, monthly)
  - Interval tracking with current/target numbers
  - Color-coded status badges (green/yellow/orange/red)
  - Subtitle organization for grouping reminders
  - Breakdown system for detailed number tracking

#### Subtasks/List Card
- Vertical list layout with icons and labels
- Examples: Analytics, Tools sections
- Rounded pill-shaped items
- Different background colors for visual distinction (yellow for Analytics, green for Tools)
- **Links Feature**: Add multiple links to any list item
  - **Edit Mode**: Click link icon (chain) next to item to open links modal
  - **View Mode**: If item has links, link icon appears next to text
  - Links appear as animated bubbles (same as reminder links)

### 3. Reminder System

#### Calendar Mode
- Click 📅 icon to schedule
- **Options**:
  - Specific date selection
  - No repeat
  - Weekly repeat (every 1, 2, or 3 weeks)
  - Monthly repeat (same day or first weekday)
- Displays "X days left" or "Overdue by X days"
- Color-coded badges:
  - Green: 8+ days remaining
  - Yellow: 3-7 days remaining
  - Orange: 1-2 days remaining
  - Red: Overdue or today

#### Interval Mode
- Click # icon to set numeric goals/limits
- **Fields**:
  - Target Number
  - Current Number
  - Type: Goal or Limit
  - Unit: None, $, or %
- Automatic color calculation based on progress
- Current number can be manually set or sum from breakdown

#### Breakdown System
- Click grid icon (📊) in interval editor
- **Two Modes**:
  - **Locked (#)**: Manual entry of current number
  - **Unlocked (Σ)**: Auto-sum from breakdown rows
- Add unlimited breakdown rows with label + value
- Values auto-round to whole numbers
- Two-layer save: Accept breakdown → Save interval

#### Reminder Links
- Add multiple links to any reminder for quick access to related resources
- **Edit Mode**: Click link icon (chain) next to interval icon to open links modal
  - Add unlimited title + URL pairs
  - Reorder or delete links as needed
- **View Mode**: If reminder has links, link icon appears next to title
  - Click icon to expand/collapse link bubbles
  - Links appear as pill-shaped bubbles to the right of the icon
  - **Animation**: Bubbles fly in with staggered timing (top to bottom), fade out simultaneously
  - Link bubbles inherit parent reminder color but 20% lighter with stronger shadow
  - Click any bubble to open URL in new tab
  - Click outside to close expanded links

### 4. Media Library
- Store and manage images for customization
- Upload multiple images at once
- Select images for use in editable elements
- Delete unused images
- Images stored in browser storage

### 5. Image Editor
- Adjust profile photo and logo positioning and scaling
- **Profile Photo Mode**: Circular frame (90x90px) with cover fit (image fills frame)
  - Zoom range: 100% to 150%
  - Click and drag to reposition image within frame
  - Used for header profile photo
- **Logo Mode**: Rectangular frame (216x126px) with fit mode (entire image visible)
  - Zoom range: 100% to 300%
  - Click and drag to reposition image within frame
  - Used for company/personal logo
- **Features**:
  - Real-time preview with zoom slider
  - Touch support for mobile devices
  - Choose different image from media library
  - Position saved as percentage (scales correctly to different frame sizes)
  - Transform calculations handle aspect ratios automatically
- **Exported Functions**:
  - `openImageEditor(currentSrc, currentZoom, currentX, currentY, onSave, type)` - Opens modal for editing
    - `type`: 'profile' (circle frame, cover fit) or 'logo' (square frame, fit mode)
    - `onSave`: Callback receives `{ src, zoom, xPercent, yPercent }`
  - `closeImageEditor()` - Closes the editor modal
  - `applyProfilePhotoTransform(imgElement, zoom, xPercent, yPercent)` - Applies transform to 90x90 profile photo
  - `applyLogoTransform(imgElement, zoom, xPercent, yPercent)` - Applies transform to 216x126 logo frame

### 6. Import/Export System

#### Export (Save Icon)
- Saves current configuration to JSON file
- Includes all sections, links, reminders, and settings
- Preserves structure and metadata

#### Import (⬆ Icon)
- Upload JSON file to restore/override configuration
- Confirmation dialog before overwriting

#### Structure Example
```json
{
  "sections": [...],
  "reminders": {...},
  "dailyTasks": {...},
  "darkMode": false,
  "_metadata": {...}
}
```

### 7. Dark Mode
- Toggle button in bottom-left (🌙/☀️)
- Only visible in edit mode
- Persists across sessions
- Theme applied via CSS custom properties
- Affects all UI elements including popovers and modals

### 8. Independent Light/Dark Mode Colors
- Custom colors can be set independently for light and dark modes
- Applies to:
  - **Subtasks/List cards**: Click color picker icon next to section title
  - **Reminder subtitles**: Click color picker icon next to subtitle name
  - **Copy-Paste subtitles**: Click color picker icon next to subtitle name
- Color picker shows which mode is being edited ("Setting color for: Light Mode" or "Dark Mode")
- **Storage Format**: Colors stored as `{ light: '#...', dark: '#...' }` objects
- **Backward Compatible**: Legacy single-color strings automatically supported
- Switching themes displays the appropriate color for each mode

### 9. Display Mode
- Toggle button in header (monitor icon, left of Quick Access icon)
- Click to open animated bubble selector with two view options:
  - **Normal Mode**: Single-column centered layout (default)
  - **Stacked Mode**: Two-column masonry layout for large screens
- Stacked mode removes side padding and arranges cards in a 2-column grid
- Full-width cards and two-column containers span both columns
- Persists across sessions
- Content inside cards maintains proportional sizing
- **Independent Section Ordering**: Each display mode maintains its own card order
  - Reordering cards in normal mode only affects normal mode
  - Reordering cards in stacked mode only affects stacked mode
  - Both orderings are saved to localStorage and JSON export/import
  - Edit mode renders the current display mode's layout

### 10. Dynamic Card Management
- **Add Cards**: Green + button between sections (edit mode only)
- **Delete Cards**: Red × button in top-right corner of each card
- **Card Type Selection**: Modal with 4 options when adding new card
- **Reordering**: Cards can be moved via gap buttons

---

## Technical Architecture

### Data Model Structure

#### Main Model
```javascript
const model = {
  darkMode: boolean,
  displayMode: 'normal' | 'stacked',
  sections: [
    {
      id: string,
      type: 'icon' | 'list' | 'reminders' | 'newCard',
      title: string,
      twoColumnPair?: boolean,
      pairIndex?: 0 | 1
    }
  ],
  // Separate section order for stacked mode (initialized from sections on first use)
  sectionsStacked: null | Section[],
  reminders: {
    [subtitleKey]: [
      {
        name: string,
        mode: 'calendar' | 'interval',
        // Calendar fields
        scheduledDate?: Date,
        repeat?: 'none' | 'weekly' | 'monthly',
        weeklyInterval?: 1 | 2 | 3,
        monthlyType?: 'sameDay' | 'firstWeekday',
        // Interval fields
        targetNumber?: number,
        currentNumber?: number,
        intervalType?: 'goal' | 'limit',
        unit?: 'none' | 'dollar' | 'percent',
        breakdown?: {
          locked: boolean,
          rows: [{ label: string, value: number }]
        },
        // Links (optional)
        links?: [{ title: string, url: string }]
      }
    ]
  },
  // Section colors (mode-specific)
  sectionColors: {
    [sectionId]: {
      light: string | null,  // e.g., '#fff4e5'
      dark: string | null    // e.g., '#3d2a1a'
    }
  },
  // Subtitle colors for reminders and copy-paste cards (mode-specific)
  subtitleColors: {
    [sectionId:subtitleName]: {
      light: string | null,
      dark: string | null
    }
  },
  [sectionId]: {
    title: string,
    items: [
      {
        name: string,
        url: string,
        icon: string,
        // Links (optional) - for subtasks/list cards
        links?: [{ title: string, url: string }]
      }
    ]
  }
}
```

#### Edit State
```javascript
const editState = {
  enabled: boolean,
  working: null | DeepClone<model>,
  currentElement: HTMLElement | null,
  currentData: object | null
}
```

### Storage
- **Key**: `personal_dashboard_model_v2`
- **Method**: `localStorage.setItem/getItem`
- **Format**: JSON stringified
- **Backup**: Previous state saved to `personal_dashboard_backup_[timestamp]`
- **Auto-cleanup**: Old backups cleaned on app startup

### File Structure

```
Personal Dashboard/
├── index.html              # Main HTML structure (~350 lines)
├── styles.css              # All styling with CSS variables (~2500 lines)
├── CLAUDE.md               # This documentation file
├── js/                     # ES6 Modules (main codebase)
│   ├── main.js             # Entry point - imports all modules, exports to window.*
│   ├── state.js            # Global state (model, editState, dragState, currentData, currentSections)
│   ├── constants.js        # App constants (STORAGE_KEY, icons, PLACEHOLDER_URL, etc.)
│   ├── utils.js            # Utility functions ($, $$, deepClone, showToast, color utils)
│   ├── core/
│   │   ├── init.js         # App initialization, wireUI, display mode, card collapse
│   │   ├── storage.js      # localStorage save/restore, deepMergeModel, backups
│   │   └── import-export.js # JSON import/export, IndexedDB helpers, file system access
│   ├── features/
│   │   ├── edit-mode.js    # Edit mode toggle, popovers, color pickers
│   │   ├── drag-drop.js    # Card and item drag-drop reordering
│   │   ├── timers.js       # Time tracking functionality
│   │   ├── quick-access.js # Quick access panel and selector mode
│   │   ├── media-library.js # Image upload and management
│   │   ├── image-editor.js # Profile photo and logo positioning/scaling editor
│   │   ├── reminders.js    # Reminder rendering, calendar/interval popovers, breakdown modal
│   │   ├── cards.js        # Card CRUD, reorder buttons, card type selector
│   │   └── links.js        # Reminder and list item links modals
│   └── components/
│       └── sections.js     # Section rendering (icons, lists, reminders, copy-paste)
├── data/
│   └── user_links.json     # Example data structure
└── assets/
    ├── logo.svg            # Company/personal logo
    ├── profile.svg         # Profile photo
    └── icons/
        └── Link.svg        # Link icon for reminder links
```

### ES6 Module Architecture

The application uses ES6 modules with a clear separation of concerns:

#### Entry Point (`js/main.js`)
- Imports all modules and re-exports functions to `window.*` for backward compatibility
- No business logic - purely orchestration

#### State Management (`js/state.js`)
- `model`: Main data store with all sections, reminders, settings
- `editState`: Edit mode state (enabled, working copy, dirty flag)
- `dragState`: Drag-drop state for cards and items
- `currentData()`: Returns working copy in edit mode, model otherwise
- `currentSections()`: Returns sections array for current display mode
- `ensureSectionInBothArrays()`: Syncs new sections to both display modes
- `removeSectionFromBothArrays()`: Removes sections from both display modes

#### Core Modules (`js/core/`)
- **init.js**: Application bootstrap, event wiring, display mode handling
- **storage.js**: localStorage persistence, model restoration, deep merge
- **import-export.js**: JSON export/import, IndexedDB for file handles

#### Feature Modules (`js/features/`)
- **edit-mode.js**: Toggle edit mode, show/hide popovers, color pickers
- **drag-drop.js**: Card reordering, item reordering within sections
- **timers.js**: Time tracking with start/stop/reset
- **quick-access.js**: Quick access panel, selector mode for adding items
- **media-library.js**: Image upload, storage, selection
- **reminders.js**: Calendar scheduling, interval tracking, breakdown modal
- **cards.js**: Add/delete cards, card type popover, reorder buttons
- **links.js**: Link modals for reminders and list items

#### Component Modules (`js/components/`)
- **sections.js**: Renders all section types (icons, lists, reminders, copy-paste)

### Key Functions

#### Core Application
- `init()`: Initialize app, load data, setup event listeners
- `saveModel()`: Persist current state to localStorage
- `restoreModel()`: Load data from localStorage
- `toggleEditMode()`: Enter/exit edit mode
- `confirmGlobalEdit()`: Save all pending changes
- `cancelGlobalEdit()`: Discard all pending changes

#### Rendering
- `renderAllSections()`: Render entire dashboard
- `createSectionElement(section)`: Create individual card
- `renderReminders(sectionId)`: Render reminders card content
- `renderIconSection(section, container)`: Render icon grid
- `renderList(sectionKey, targetEl, isTools)`: Render list items

#### Edit Operations
- `openEditPopover(element, data, type)`: Show edit form
- `openCalendarPopover(reminder)`: Schedule reminder
- `openIntervalPopover(reminder)`: Set interval tracking
- `openBreakdownModal(reminder)`: Open breakdown editor
- `openLinksModal(reminder, subtitle, sectionId)`: Open links editor modal for reminders
- `openListItemLinksModal(item, sectionId)`: Open links editor modal for list items
- `openColorPicker(sectionId, sectionType)`: Open color picker for section bubbles
- `openSubtitleColorPicker(sectionId, subtitle)`: Open color picker for subtitle bubbles
- `openImageEditor(currentSrc, currentZoom, currentX, currentY, onSave, type)`: Open image positioning/scaling editor
- `closeImageEditor()`: Close image editor modal
- `applyProfilePhotoTransform(imgElement, zoom, xPercent, yPercent)`: Apply transform to profile photo
- `applyLogoTransform(imgElement, zoom, xPercent, yPercent)`: Apply transform to logo
- `onAddCard(afterSectionId)`: Show card type selector
- `onDeleteCard(sectionId)`: Remove card with confirmation

#### Utilities
- `$(selector)`: Shorthand for querySelector
- `deepClone(obj)`: Deep copy objects
- `currentData()`: Get active data (working or model)
- `currentSections()`: Get sections array for current display mode (sections or sectionsStacked)
- `ensureSectionInBothArrays(section)`: Add section to both normal and stacked sections arrays
- `removeSectionFromBothArrays(sectionId)`: Remove section from both sections arrays
- `showToast(message)`: Show temporary notification
- `applyDarkMode()`: Apply theme to document
- `applyDisplayMode()`: Apply display mode (normal/stacked) to body
- `openDisplayModeModal()`: Open display mode selection modal
- `setDisplayMode(mode)`: Set and apply display mode
- `getColorForCurrentMode(colorData, defaultColor)`: Get color for current light/dark mode
- `setColorForCurrentMode(colorData, newColor)`: Set color for current mode
- `toggleReminderLinks(reminderKey, subtitle, sectionId, buttonEl)`: Toggle reminder link bubbles display
- `toggleListItemLinks(item, sectionId, buttonEl)`: Toggle list item link bubbles display
- `closeAllReminderLinks()`: Close all open reminder link bubble containers
- `closeAllListItemLinks()`: Close all open list item link bubble containers
- `lightenColorBy20Percent(color)`: Lighten RGB color for link bubbles

---

## Styling Architecture

### CSS Custom Properties

#### Light Theme (Default)
```css
:root {
  --bg: #f5f6f8;          /* Page background */
  --card: #ffffff;        /* Card background */
  --text: #1f2937;        /* Primary text */
  --muted: #6b7280;       /* Secondary text */
  --brand: #2c7be5;       /* Brand blue */
  --accent: #22c55e;      /* Success green */
  --danger: #ef4444;      /* Error/delete red */
  --warn: #f59e0b;        /* Warning orange */
  --shadow: 0 10px 30px rgba(0,0,0,0.08);
  --radius: 16px;
}
```

#### Dark Theme
```css
[data-theme="dark"] {
  --bg: #0f172a;
  --card: #1e293b;
  --text: #f1f5f9;
  --muted: #94a3b8;
  --brand: #3b82f6;
  --accent: #10b981;
  --danger: #ef4444;
  --warn: #f59e0b;
  --shadow: 0 10px 30px rgba(0,0,0,0.3);
}
```

### Component Classes

#### Cards
- `.card`: Base card styling with shadow and border-radius
- `.card-size-small/medium/large/full`: Dynamic sizing variants
- `.card.editing`: Shows edit controls (delete button, section plus)

#### Buttons
- `.fab`: Floating action button (48×48px, circular)
- `.fab-accept`: Green checkmark button
- `.fab-cancel`: Red cancel button
- `.fab-left`: Bottom-left FAB positioning (dark mode, import, etc.)
- `.wrench-btn`: Edit mode toggle (bottom-right, 62×62px)

#### Interactive Elements
- `.editable`: Marks elements as editable in edit mode
- `.add-tile`: Add button styling (dashed border, purple/blue theme)
- `.gap-add-btn`: Green circular + button between cards

#### Reminders
- `.reminder-item`: Individual reminder (rounded pill, grey background)
- `.reminder-subtitle`: Section headers within reminders
- `.days-badge`: Status badge (green/yellow/orange/red)
- `.calendar-btn`, `.hashtag-btn`: Mode selection icons
- `.links-btn`: Link icon button in edit mode
- `.reminder-links-toggle`: Link icon button in view mode (when links exist)
- `.reminder-links-expanded`: Container for expanded link bubbles (position: fixed)
- `.reminder-link-bubble`: Individual link bubble (pill-shaped, 20% lighter than parent)

#### Popovers & Modals
- `.edit-popover`: Right-side form for editing items (320px wide)
- `.calendar-popover`: Left-side calendar scheduling form
- `.interval-popover`: Right-side interval configuration
- `.breakdown-modal`: Full overlay with dialog for breakdowns
- `.card-type-popover`: Centered modal for card type selection
- `.reminder-links-modal`: Full overlay for editing reminder links
- `.reminder-links-dialog`: Dialog content for links editor (650px max-width)
- `.color-picker-modal`: Full overlay for color picker
- `.color-picker-dialog`: Dialog content with color input and mode label

---

## Design Principles & Preferences

### Visual Design

#### Icon Philosophy
- **Minimalist SVG Icons**: Single-color, line-based designs
- **No Emoji Icons**: Except in user-generated content
- **currentColor Usage**: Icons adapt to theme automatically
- **Stroke Weight**: Consistent 2px stroke for all SVG icons
- **Size Standards**:
  - Small icons (buttons): 16-20px
  - Medium icons (cards): 32px
  - Large icons (profile/logo): 48-90px

#### Icon Examples
- Edit: Minimalist pencil (not wrench)
- Dark mode: Sun/moon outline
- Calendar: Calendar grid outline
- Interval: # symbol (text-based)
- Breakdown: 4-square grid
- Save: Floppy disk outline
- Delete: × symbol
- Links: Chain link icon
- Color picker: Palette/paint icon

#### Spacing & Alignment
- **Equal Margins**: Buttons should have equal spacing from edges
- **Consistent Gaps**: 16px between most elements, 40px between cards
- **Centered Content**: Add buttons and icons centered in containers
- **Grid Systems**: 4-column for icons, 2-column for reminders

#### Color Usage

##### Light Mode
- Primary cards: White (#ffffff)
- Add tiles: Light purple (#eef2ff) with purple border (#c7d2fe)
- Analytics items: Light yellow (#fff4e5) with yellow border
- Tools items: Light green (#e6fff3) with green border
- Reminders: Light grey (#f7fafc)

##### Dark Mode
- Primary cards: Dark slate (#1e293b)
- Add tiles: Dark grey (#374151) with light grey text (#cbd5e1)
- All items: Dark slate (#334155) with lighter borders (#475569)
- Secondary buttons: Dark grey (#374151) with light text
- Consistent light grey theme throughout

#### Typography
- **Font Family**: Inter (Google Fonts)
- **Weights**: 300, 400, 500, 600, 700
- **Sizes**:
  - Headers: 36px (profile), 24px (section titles)
  - Body: 14-16px
  - Labels: 12px (muted color)

### User Experience Patterns

#### Edit Mode Workflow
1. Click pencil icon → Enter edit mode
2. Editable elements become interactive
3. Make changes (no immediate save)
4. Click ✓ to confirm OR × to cancel
5. All changes applied/discarded atomically

#### Two-Layer Saves
- Used for complex operations (breakdown → interval)
- Prevents accidental data loss
- Clear accept/cancel actions at each layer

#### Confirmation Dialogs
- Destructive actions require confirmation
- Import/export operations show dialog
- Delete operations can be cancelled

#### Visual Feedback
- Hover states on all interactive elements
- Toast notifications for actions
- Color changes on state transitions
- Transform animations (scale, translateY)

---

## Common Patterns & Conventions

### Code Style

#### Selectors
```javascript
// Use $ shorthand for querySelector
const element = $('#element-id');
const elements = document.querySelectorAll('.class');
```

#### Event Listeners
```javascript
// Prefer addEventListener over onclick
button.addEventListener('click', () => {
  // handler
});

// Use type="button" to prevent form submission
<button type="button" id="my-btn">
```

#### State Checks
```javascript
// Always check edit state before modifying
if (editState.enabled) {
  // Show edit controls
}

// Use currentData() to get active state
const data = currentData();
```

### CSS Patterns

#### Theme-Aware Colors
```css
/* Always use CSS variables */
.element {
  background: var(--card);
  color: var(--text);
}

/* Override for dark mode when needed */
[data-theme="dark"] .element {
  background: #334155;
}
```

#### SVG Icons
```html
<!-- Use currentColor for automatic theming -->
<svg fill="none" stroke="currentColor" stroke-width="2">
  <path d="..."/>
</svg>
```

#### Positioning
```css
/* Cards must have position: relative for absolute children */
.card {
  position: relative;
}

/* Buttons positioned absolute to card */
.card-delete-btn {
  position: absolute;
  top: 16px;
  right: 16px;
}
```

### Display Mode Architecture

The app supports two display modes with **independent section ordering**:

#### Two Section Arrays
```javascript
model.sections        // Section order for normal (single-column) mode
model.sectionsStacked // Section order for stacked (two-column) mode
```

#### Key Behaviors
- `currentSections()` returns the appropriate array based on `displayMode`
- When `sectionsStacked` is first accessed and is null, it's initialized from `sections` but with `twoColumnPair`/`pairIndex` stripped
- New sections are added to BOTH arrays via `ensureSectionInBothArrays()`, but layout properties are NOT copied between modes
- Deleting a section removes it from BOTH arrays via `removeSectionFromBothArrays()`
- Reordering only affects the current mode's array

#### Display Mode Switching
```javascript
setDisplayMode(mode)  // Updates both model AND editState.working
                      // Re-renders sections, saves to localStorage
```

### Drag-Drop Architecture

#### Card-Level Dragging (`drag-drop.js`)
- Cards can be dragged to reorder within the current display mode
- Drop indicator shows where card will be placed
- Two-column containers can be dragged together
- Dropping beside a card creates a two-column pair

#### Item-Level Dragging
- Icons, reminders, and copy-paste items can be reordered within their section
- Uses `initializeItemDragHandlers()` and `initializeContainerDragHandlers()`
- Drop indicator shows insertion point

#### Drag State
```javascript
dragState = {
  draggedElement,      // Card element being dragged
  draggedSection,      // Section ID
  draggedTwoCol,       // Whether dragging a two-col container
  draggedSecondSection,// Second card ID when dragging two-col
  dropIndicator,       // Visual indicator element
  potentialDropZone,   // Target card ID
  potentialDropPosition, // 'before', 'after', 'beside-left', 'beside-right'
  // Item-level
  draggedItem,
  draggedItemKey,
  draggedItemSection,
  itemDropIndicator
}
```

### Data Patterns

#### Adding Items
```javascript
// Always work on currentData()
const data = currentData();
data.sectionName.items.push(newItem);
// No save yet - waiting for user confirmation
```

#### Removing Items
```javascript
// Filter out by reference or index
const data = currentData();
data.sectionName.items = data.sectionName.items.filter(
  item => item !== itemToRemove
);
```

#### Deep Cloning
```javascript
// Use deepClone for nested objects
editState.working = deepClone(model);
// Now working is independent copy
```

---

## Feature Preferences & Guidelines

### When Adding New Features

1. **Icons**: Use minimalist SVG with currentColor
2. **Buttons**: Equal spacing from edges, proper alignment
3. **Dark Mode**: Always add dark mode styles for new elements
4. **Persistence**: Ensure data saves to model correctly
5. **Edit Mode**: Only show edit controls when `editState.enabled`
6. **Confirmation**: Destructive actions need confirmation
7. **Toast Feedback**: Show success/error messages
8. **Two-Layer Saves**: Complex operations should save incrementally

### Existing User Preferences

- Remove visual borders in edit mode (user is aware of editable items)
- Edit button should be smaller (62×62px, not larger)
- Dark mode only visible in edit mode
- Pound sign (#) in light grey for dark mode
- Add tiles as "+" only (not "+ Add" for lists)
- Card delete button in top-right with equal spacing
- Auto-round decimals to whole numbers for intervals
- Minimize use of emojis in UI elements

---

## Known Sections & Default Data

### Standard Sections
1. **Reminders** (type: reminders)
   - Work category
   - Content category
   - Calendar and interval tracking

2. **Daily Tasks** (type: icon)
   - Gmail, Calendar, Drive, Slack
   - 4-column icon grid

3. **Daily Tools** (type: icon)
   - VS Code, GitHub, Figma, Notion
   - Pairs with Daily Tasks in two-column layout

4. **Content Creation** (type: icon)
   - Canva, Loom, Grammarly, Unsplash

5. **Ads** (type: icon)
   - Google Ads, Facebook Ads, LinkedIn Ads, Twitter Ads

6. **Analytics** (type: list)
   - Google Analytics, Mixpanel, Hotjar, SEMrush
   - Yellow theme

7. **Tools** (type: list)
   - Zapier, Airtable, Trello, Asana
   - Green theme

---

## Browser Compatibility

### Requirements
- Modern browser with ES6+ support
- LocalStorage enabled
- JavaScript enabled

### Tested Browsers
- Chrome/Edge (Chromium)
- Firefox
- Safari

### Storage Limits
- LocalStorage: ~5-10MB (browser dependent)
- Sufficient for typical usage
- Media library uses base64 encoding

---

## Future Enhancement Considerations

### Potential Features
- Drag-and-drop reordering of cards
- Custom color themes
- Cloud sync across devices
- More card types (calendar view, kanban, etc.)
- Keyboard shortcuts
- Search/filter functionality
- Multi-language support
- Analytics dashboard

### Technical Debt
- ~~Consider breaking app.js into modules~~ ✓ Completed - now uses ES6 modules
- ~~Remove app-reference.js once ES6 migration is fully stable~~ ✓ Completed
- Implement proper state management library if complexity grows
- Add TypeScript for better type safety
- Consider indexedDB for larger data storage
- Add unit tests for critical functions

---

## Troubleshooting

### Common Issues

#### Dark Mode Not Persisting
- Check `saveModel()` includes `darkMode: data.darkMode`
- Verify `toggleDarkMode()` updates both `model.darkMode` and `editState.working.darkMode`

#### Delete Button Misaligned
- Ensure parent card has `position: relative`
- Check all card size variants have relative positioning

#### Icons Not Changing Color
- Verify SVG uses `stroke="currentColor"` or `fill="currentColor"`
- Check CSS uses `color: var(--text)` on parent

#### Changes Not Saving
- Confirm `confirmGlobalEdit()` is called, not just `saveModel()`
- Verify working copy is properly cloned
- Check localStorage quota not exceeded

#### Decimal Rounding Issues
- Use `Math.round(parseFloat(value))` not `parseInt()`
- Apply rounding before save, not after

---

## Version History

### Current Version: 2.0
- **ES6 Module Architecture**: Fully modularized codebase (~15 modules)
- Full customization system
- Dark mode support
- Interval breakdown feature
- Media library
- Import/export functionality
- Four card types
- Calendar and interval reminders
- Minimalist icon design
- **Reminder Links**: Add multiple links to any reminder with animated expand/collapse
- **List Item Links**: Add multiple links to any subtask/list item with animated expand/collapse
- **Independent Light/Dark Colors**: Set different custom colors for each theme mode
- **Subtitle Color Pickers**: Customize colors for Reminders and Copy-Paste subtitles
- **Display Mode Toggle**: Switch between normal and stacked (two-column) layouts
- **Independent Display Mode Ordering**: Each display mode maintains its own card order
- **Drag-and-Drop Card Reordering**: Full drag-drop support for cards and items

### Recent Updates (v2.0)
- **ES6 Module Migration**: Refactored monolithic app.js into 15+ ES6 modules
  - Clear separation: state, core, features, components
  - Improved maintainability and code organization
- **Independent Display Mode Sections**: Normal and stacked modes now have completely independent section orders
  - `sections` array for normal mode
  - `sectionsStacked` array for stacked mode
  - Two-column pairings (`twoColumnPair`, `pairIndex`) are mode-specific
- **Drag-and-Drop Improvements**:
  - Cards can be dragged to reorder within current display mode
  - Two-column containers can be moved together
  - Swap buttons for exchanging left/right cards in pairs
  - Items (icons, reminders, copy-paste) can be reordered within sections
- **Display Mode Persistence**: Switching display modes updates both model and working copy
- **Fixed Light/Dark Mode Color Independence**: Colors set in light mode and dark mode are now truly independent
  - Fixed `deepMergeModel` to perform deep merge of color objects instead of shallow copy
  - Setting a color in dark mode no longer overwrites the light mode color (and vice versa)
  - Added `sectionColors` and `subtitleColors` to JSON import/export
- Fixed card ordering glitches when toggling edit mode
- Fixed display mode not re-rendering sections on switch

### Previous Updates (v1.x)
- Added display mode toggle (normal/stacked) for large screen support
- Added links feature to subtask/list cards (same as reminder links)
- Added reminder links feature with animated bubble expansion
- Implemented independent light/dark mode color selection
- Added color picker for subtitle sections (Reminders, Copy-Paste cards)
- Link bubbles use fixed positioning to escape card overflow clipping
- Fade-out animation for link bubbles (simultaneous, no shrinking)
- Color storage format upgraded to `{ light, dark }` objects with backward compatibility
- Migrated from emoji to SVG icons
- Fixed dark mode persistence
- Added breakdown modal for intervals
- Improved button alignment
- Enhanced card type selector
- Fixed delete button positioning

---

## Contact & Maintenance

### File Manifest
- `index.html`: ~350 lines - Main HTML structure
- `styles.css`: ~2500 lines - All CSS styling
- `CLAUDE.md`: This documentation
- `js/main.js`: ~390 lines - ES6 entry point
- `js/state.js`: ~210 lines - Global state management
- `js/constants.js`: ~90 lines - App constants
- `js/utils.js`: ~200 lines - Utility functions
- `js/core/init.js`: ~600 lines - App initialization
- `js/core/storage.js`: ~320 lines - localStorage persistence
- `js/core/import-export.js`: ~590 lines - JSON import/export
- `js/features/edit-mode.js`: ~330 lines - Edit mode handling
- `js/features/drag-drop.js`: ~925 lines - Drag and drop
- `js/features/timers.js`: ~200 lines - Time tracking
- `js/features/quick-access.js`: ~280 lines - Quick access panel
- `js/features/media-library.js`: ~200 lines - Media management
- `js/features/image-editor.js`: ~380 lines - Profile photo and logo positioning/scaling editor
- `js/features/reminders.js`: ~680 lines - Reminder system
- `js/features/cards.js`: ~610 lines - Card management
- `js/features/links.js`: ~490 lines - Links feature
- `js/components/sections.js`: ~1100 lines - Section rendering
- `data/user_links.json`: Example data structure

### Development Guidelines
1. Always test in both light and dark mode
2. Verify changes save to localStorage
3. Check all card types and layouts
4. Test edit mode workflows
5. Ensure responsive design
6. Validate JSON structure

### Best Practices
- Comment complex logic
- Use semantic HTML
- Follow existing naming conventions
- Maintain consistent spacing
- Test destructive actions thoroughly
- Keep backup of working state

---

## Quick Reference

### Keyboard Shortcuts
*None currently implemented*

### Important Classes
- `.card` - Base card container
- `.editable` - Marks elements as editable
- `.add-tile` - Add button styling
- `.fab` - Floating action button
- `[data-theme="dark"]` - Dark mode selector
- `body.stacked-mode` - Stacked display mode (two-column grid)
- `.display-mode-toggle` - Display mode button in header
- `.display-mode-modal` - Display mode selection modal
- `.display-mode-option` - Individual display mode button
- `.reminder-links-toggle` - View mode link button (reminders)
- `.list-item-links-toggle` - View mode link button (list items)
- `.list-item-links-btn` - Edit mode link button (list items)
- `.reminder-links-expanded` - Expanded links container
- `.reminder-link-bubble` - Individual link pill
- `.color-picker-modal` - Color picker overlay

### Important IDs
- `#edit-toggle` - Edit mode button
- `#edit-accept-global` - Confirm changes
- `#edit-cancel-global` - Cancel changes
- `#dark-mode-toggle` - Theme switcher
- `#display-mode-toggle` - Display mode button
- `#display-mode-modal` - Display mode selection modal
- `#card-type-popover` - Card type selector
- `#reminder-links-modal` - Links editor modal (reminders)
- `#list-item-links-modal` - Links editor modal (list items)

### Storage Keys
- `personal_dashboard_model_v2` - Main data
- `personal_dashboard_backup_*` - Auto backups

### CSS Variables
- `var(--bg)` - Background
- `var(--card)` - Card background
- `var(--text)` - Primary text
- `var(--muted)` - Secondary text
- `var(--brand)` - Brand color
- `var(--shadow)` - Shadow effect

---

*This documentation should provide complete context for understanding, maintaining, and extending the Personal Dashboard application. All features, patterns, and preferences have been documented based on the current implementation.*
