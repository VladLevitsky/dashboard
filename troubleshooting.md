# Troubleshooting Guide

## CSS Specificity Issues

### Issue: Collapsed Cards Not Collapsing (Copy-Paste Card)

**Symptoms:**
- Copy-paste card remains too tall when collapsed
- Title appears in top-left corner of a tall container
- Other cards (Analytics, Tools) collapse correctly but copy-paste doesn't
- CSS rules appear to be ignored despite using `!important`

**Root Cause:**
CSS specificity battle where collapsed rules were being overridden by card-sizing rules that had higher specificity due to `:not()` pseudo-classes.

**The Problem:**
```css
/* This rule at line ~1109 had HIGHER specificity: (0,1,5,1) */
section.card[id^="new-card-"]:not(.card-size-medium):not(.card-size-large):not(.card-size-full) {
  min-height: 120px !important;
  padding: 20px 40px 30px 40px !important;
}

/* Original collapsed rule only had specificity: (0,1,2,1) */
section.card[id^="new-card-"].collapsed {
  min-height: 0 !important;
  padding: 20px 40px !important;
}
```

**Why It Failed:**
- Each `:not()` pseudo-class adds to specificity (counts as a class selector)
- Three `:not()` selectors = 3 extra specificity points
- Even with `!important`, when specificity is different, the higher specificity wins
- Even when placed later in the CSS file, lower specificity still loses

**The Solution:**
1. Match or exceed the specificity by including the same `:not()` pattern in collapsed rules:
```css
section.card[id^="new-card-"]:not(.card-size-medium):not(.card-size-large):not(.card-size-full).collapsed {
  min-height: 0 !important;
  padding: 20px 40px !important;
}
```

2. Place collapsed rules at the END of the CSS file (after line ~1700) to ensure they're evaluated last

3. For cards with analytics-wrapper containers, ensure the wrapper is hidden when collapsed:
```css
.card.collapsed .analytics-wrapper,
section.card.collapsed .analytics-wrapper {
  display: none !important;
  height: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
}
```

**How to Diagnose:**
1. Use browser DevTools to inspect the collapsed element
2. Look at the "Computed" styles tab
3. Check which rules are being applied vs. crossed out
4. Count specificity using the formula:
   - Inline styles: 1,0,0,0
   - IDs: 0,1,0,0
   - Classes/attributes/pseudo-classes: 0,0,1,0
   - Elements: 0,0,0,1
5. `:not()`, `:is()`, `:where()` pseudo-classes count as their contents' specificity
6. If rules with equal `!important` conflict, higher specificity wins
7. If specificity is equal, the rule appearing later in CSS wins

**Prevention:**
- Keep collapsed card rules at the very END of CSS file
- Match all selector patterns from sizing rules when creating collapse overrides
- Test with hard refresh (Ctrl+Shift+R) to clear browser cache
- Use descriptive comments to mark critical rule placement

**Related Files:**
- `styles.css` (lines 1692-1761: Collapsed card rules - MUST BE LAST)
- `app.js` (lines 3667-3686: Copy-paste card structure)

---

## Duplicate Rendering Functions

### Issue: Changes to Item Rendering Not Taking Effect (Analytics/Tools Clickable Area)

**Symptoms:**
- Making Analytics or Tools list items fully clickable doesn't work
- Changes to `renderList()` function have no effect on displayed items
- View mode behavior doesn't match what's coded
- Reminders and Copy-Paste work correctly, but Analytics/Tools don't respond to similar changes
- The clickable area is smaller than the visual bubble despite code changes

**Root Cause:**
Multiple rendering functions exist for the same item types, and the wrong function is being edited. Analytics and Tools items are rendered by `renderListForSection()`, NOT by `renderList()`.

**The Problem:**
```javascript
// This function exists but is NOT used for Analytics/Tools (line 1420)
function renderList(sectionKey, targetEl, isTools) {
  // Changes here won't affect Analytics/Tools!
}

// This is the ACTUAL function used for Analytics/Tools (line 4360)
function renderListForSection(sectionEl, sectionId, isTools) {
  // This is what needs to be edited
}
```

**Why It Failed:**
1. Section creation code at line 3996 calls `renderListForSection()`, not `renderList()`
2. Two functions have similar purposes but serve different contexts
3. `renderList()` may be legacy code or used for different sections
4. Editing the wrong function means changes never reach the rendered output
5. The rendered HTML structure is correct, but behavior doesn't match edited code

**The Solution:**

1. **Trace the call stack to find the actual rendering function:**
   ```javascript
   // Start at section creation (line 3948-3996)
   if (['analytics', 'tools', 'newCardAnalytics'].includes(section.type)) {
     // ...
     renderListForSection(sectionEl, section.id, section.type === 'tools');
     // ↑ This is the actual function being called
   }
   ```

2. **Apply changes to `renderListForSection()` at line 4360:**
   ```javascript
   function renderListForSection(sectionEl, sectionId, isTools) {
     // ...
     items.forEach(item => {
       const div = document.createElement('div');
       const a = document.createElement('a');
       a.href = item.url;
       a.textContent = item.text;

       // In view mode, make entire bubble clickable
       if (!editState.enabled) {
         a.style.pointerEvents = 'none';
         div.style.cursor = 'pointer';
         div.dataset.url = item.url;
       }

       div.appendChild(a);

       div.addEventListener('click', (e) => {
         if (!editState.enabled) {
           e.preventDefault();
           const url = div.dataset.url;
           if (url) window.open(url, '_blank', 'noopener,noreferrer');
           return;
         }
         // Edit mode logic...
       });
     });
   }
   ```

3. **Understand the component hierarchy:**
   ```
   sectionEl (card)
   └── wrapper (analytics-wrapper)
       ├── icon (section-icon)
       └── list (list-links) ← ID: analytics-list or tools-list
           └── div (list-item) ← The visual bubble
               └── a (link) ← Text content
   ```

**How to Diagnose:**

1. **Search for the function call, not just the function definition:**
   ```bash
   # Find where rendering is actually called
   grep "renderList.*analytics" app.js
   grep "renderListForSection" app.js
   ```

2. **Add console.log statements to both functions:**
   ```javascript
   function renderList() {
     console.log('renderList called');
     // ...
   }

   function renderListForSection() {
     console.log('renderListForSection called');
     // ...
   }
   ```

3. **Check which function actually executes:**
   - Open browser console
   - Look for the console.log output
   - The function that logs is the one that needs editing

4. **Trace back from the HTML element:**
   - Inspect the rendered element in DevTools
   - Search for where that element's class/ID is created
   - Follow the trail to the actual rendering function

5. **Look for section type conditions:**
   ```javascript
   if (section.type === 'analytics' || section.type === 'tools') {
     // What rendering function is called here?
   }
   ```

**Prevention:**

- **Consolidate rendering functions:** If two functions do similar things, consider refactoring into one
- **Use clear naming:** Name functions based on their specific purpose (e.g., `renderLegacyList` vs `renderDynamicList`)
- **Add comments:** Mark which functions are used where
  ```javascript
  // Used for: Analytics, Tools, newCardAnalytics sections
  function renderListForSection() { }

  // Legacy: Used only for initial load (deprecated?)
  function renderList() { }
  ```
- **Search before editing:** Always search for function calls before assuming a function is used
- **Verify changes:** After editing, verify the change appears in the browser (add a temporary visual change like background color)

**Related Files:**
- `app.js` line 1420: `renderList()` - Not used for Analytics/Tools
- `app.js` line 4360: `renderListForSection()` - **Actual function for Analytics/Tools**
- `app.js` line 3996: Section creation code that calls `renderListForSection()`

**Similar Patterns to Watch For:**
- Any card type with multiple rendering paths
- Functions with similar names but different purposes
- Legacy code that hasn't been fully removed
- Conditional rendering based on section types

---

## Additional Issues

*Add more troubleshooting entries here as they arise*
