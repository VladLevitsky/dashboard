// Personal Dashboard - Writing command registry (pure, no DOM)
// One table drives the editors' key handling, the slash menu, toolbar
// tooltips, context-menu hints and the commands reference. Nothing is
// documented here that doesn't exist, and nothing exists that isn't here.
// Node-testable: Reference/writing-commands-test.mjs
//
// Key spec grammar: parts joined with '+'. 'Mod' = Ctrl (Windows / Linux) or
// Cmd (Mac); 'Shift', 'Alt'. The last part is a letter ('K'), a digit ('1',
// matched on e.code 'Digit1') or a named key (Enter, Tab, ArrowUp, ArrowDown,
// Backslash, Slash, Period; Backspace and F3 in native rows). Letters match e.key
// (lower-cased), digits and punctuation match e.code, so layouts and Shift don't
// change what a key means. A spec never contains Ctrl+Alt (AltGr on Windows types
// characters).
//
// helpOnly rows are documented but never offered as commands (slash menu, the
// help window's Run). native rows are never matched by matchKeyEvent either: the
// browser, or the block / find code where the key applies (a table, a code block,
// the find bar), handles them. notMac rows are left out of the help on a Mac.

export const WRITING_GROUPS = [
  { id: 'text', label: 'Text' },
  { id: 'lists', label: 'Lists & checklists' },
  { id: 'blocks', label: 'Blocks' },
  { id: 'format', label: 'Formatting' },
  { id: 'insert', label: 'Insert' },
  { id: 'editing', label: 'Editing' },
  { id: 'tools', label: 'Document tools' }
];

const L = 'lite';
const F = 'full';
const BOTH = [L, F];
const DOC_EDITORS = ['projects', 'meetings', 'task', 'ideas'];

// id, label, group, keys, markdown, slash (aliases), tiers, editors?, hint, icon, inSlash, helpOnly?, native?, notMac?
export const WRITING_COMMANDS = [
  // --- Text
  { id: 'paragraph', label: 'Text', group: 'text', keys: ['Mod+Shift+0'], slash: ['text', 'normal', 'plain', 'p'], tiers: BOTH, icon: 'text', inSlash: true, hint: 'Turn the line back into normal text' },
  { id: 'heading1', label: 'Heading 1', group: 'text', keys: ['Mod+Shift+1'], markdown: '# ', slash: ['h1', 'title', 'heading', 'big'], tiers: BOTH, icon: 'h1', inSlash: true, hint: 'Big section heading' },
  { id: 'heading2', label: 'Heading 2', group: 'text', keys: ['Mod+Shift+2'], markdown: '## ', slash: ['h2', 'heading'], tiers: BOTH, icon: 'h2', inSlash: true, hint: 'Medium heading' },
  { id: 'heading3', label: 'Heading 3', group: 'text', keys: ['Mod+Shift+3'], markdown: '### ', slash: ['h3', 'heading', 'small'], tiers: BOTH, icon: 'h3', inSlash: true, hint: 'Small heading' },

  // --- Lists
  { id: 'bulletList', label: 'Bulleted list', group: 'lists', keys: ['Mod+Shift+8'], markdown: '- ', markdownAlt: ['* '], slash: ['bullet', 'ul', 'list', 'unordered'], tiers: BOTH, icon: 'bullet', inSlash: true, hint: 'Simple bullet points' },
  { id: 'numberedList', label: 'Numbered list', group: 'lists', keys: ['Mod+Shift+7'], markdown: '1. ', slash: ['number', 'ol', 'ordered'], tiers: BOTH, icon: 'numbered', inSlash: true, hint: 'A list with numbers' },
  { id: 'checklist', label: 'Checklist', group: 'lists', keys: ['Mod+Shift+9'], markdown: '[] ', markdownAlt: ['[ ] '], slash: ['todo', 'check', 'task list', 'checkbox'], tiers: BOTH, icon: 'checklist', inSlash: true, hint: 'Items you can tick off' },
  { id: 'toggleCheck', label: 'Check / uncheck item (also opens/closes a toggle)', group: 'lists', keys: ['Mod+Enter'], markdown: '[x] ', slash: [], tiers: BOTH, icon: 'check', inSlash: false, hint: 'Ticks the checklist item the caret is in' },
  { id: 'indent', label: 'Indent list item', group: 'lists', keys: ['Tab'], slash: [], tiers: BOTH, icon: 'indent', inSlash: false, helpOnly: true, hint: 'Nest the item under the one above' },
  { id: 'outdent', label: 'Outdent list item', group: 'lists', keys: ['Shift+Tab'], slash: [], tiers: BOTH, icon: 'outdent', inSlash: false, helpOnly: true, hint: 'Move the item one level out' },

  // --- Blocks
  { id: 'quote', label: 'Quote', group: 'blocks', keys: ['Mod+Shift+Period'], markdown: '> ', slash: ['quote', 'blockquote', 'citation'], tiers: BOTH, icon: 'quote', inSlash: true, hint: 'Indented quote with a bar' },
  { id: 'divider', label: 'Divider', group: 'blocks', keys: [], markdown: '---', slash: ['divider', 'hr', 'line', 'separator', 'rule'], tiers: BOTH, icon: 'divider', inSlash: true, hint: 'A horizontal line' },
  { id: 'callout', label: 'Callout', group: 'blocks', keys: [], markdown: '!! ', slash: ['callout', 'note', 'info', 'box', 'panel'], tiers: [F], icon: 'callout', inSlash: true, hint: 'Tinted note box (click its icon to change the kind)' },
  { id: 'calloutTip', label: 'Tip callout', group: 'blocks', keys: [], slash: ['tip', 'success', 'done'], tiers: [F], icon: 'tip', inSlash: true, hint: 'Green tip box' },
  { id: 'calloutDecision', label: 'Decision', group: 'blocks', keys: [], markdown: '<> ', slash: ['decision', 'decided', 'agreed'], tiers: [F], icon: 'decision', inSlash: true, hint: 'Record a decision' },
  { id: 'calloutWarning', label: 'Warning callout', group: 'blocks', keys: [], slash: ['warning', 'risk', 'careful'], tiers: [F], icon: 'warning', inSlash: true, hint: 'Amber warning box' },
  { id: 'calloutCaution', label: 'Caution callout', group: 'blocks', keys: [], slash: ['caution', 'danger', 'blocker', 'important'], tiers: [F], icon: 'caution', inSlash: true, hint: 'Red caution box' },
  { id: 'toggle', label: 'Toggle section', group: 'blocks', keys: [], markdown: '+ ', slash: ['toggle', 'collapse', 'collapsible', 'details', 'fold'], tiers: [F], icon: 'toggle', inSlash: true, hint: 'A section you can fold away' },
  { id: 'blockExit', label: 'Leave a quote, callout or toggle', group: 'blocks', keys: ['Enter', 'ArrowDown'], slash: [], tiers: BOTH, icon: 'quote', inSlash: false, helpOnly: true, native: true, hint: 'Enter on an empty last line, or ↓ on the last line, starts a new line below it' },
  { id: 'blockUnwrap', label: 'Unwrap a quote, callout or toggle', group: 'blocks', keys: ['Backspace'], slash: [], tiers: BOTH, icon: 'clear', inSlash: false, helpOnly: true, native: true, hint: 'At the start of its first line (a toggle: of its title) it turns back into plain lines' },
  { id: 'codeBlock', label: 'Code block', group: 'blocks', keys: [], markdown: '```', slash: ['code', 'snippet', 'pre'], tiers: [F], icon: 'code', inSlash: true, hint: 'Monospace block with a Copy button' },
  { id: 'codeIndent', label: 'Indent code lines', group: 'blocks', keys: ['Tab'], slash: [], tiers: [F], icon: 'indent', inSlash: false, helpOnly: true, native: true, hint: 'In a code block: two spaces, or every selected line' },
  { id: 'codeOutdent', label: 'Outdent code lines', group: 'blocks', keys: ['Shift+Tab'], slash: [], tiers: [F], icon: 'outdent', inSlash: false, helpOnly: true, native: true, hint: 'In a code block' },
  { id: 'codeExit', label: 'Leave a code block', group: 'blocks', keys: ['Enter', 'ArrowDown'], slash: [], tiers: [F], icon: 'code', inSlash: false, helpOnly: true, native: true, hint: 'Enter on an empty last line (Enter twice at the end), or ↓ on the last line' },
  { id: 'table', label: 'Table', group: 'blocks', keys: [], slash: ['table', 'grid', 'columns'], tiers: [F], icon: 'table', inSlash: true, hint: '/table 4x5 picks the size' },
  { id: 'tableNextCell', label: 'Next table cell', group: 'blocks', keys: ['Tab'], slash: [], tiers: [F], icon: 'table', inSlash: false, helpOnly: true, native: true, hint: 'In the last cell, Tab adds a row' },
  { id: 'tablePrevCell', label: 'Previous table cell', group: 'blocks', keys: ['Shift+Tab'], slash: [], tiers: [F], icon: 'table', inSlash: false, helpOnly: true, native: true, hint: 'From the first cell it moves to the table tools' },
  { id: 'tableLineBreak', label: 'New line in a table cell', group: 'blocks', keys: ['Enter'], slash: [], tiers: [F], icon: 'lineBreak', inSlash: false, helpOnly: true, native: true },

  // --- Formatting
  { id: 'bold', label: 'Bold', group: 'format', keys: ['Mod+B'], markdown: '**text**', slash: [], tiers: BOTH, icon: 'bold', inSlash: false },
  { id: 'italic', label: 'Italic', group: 'format', keys: ['Mod+I'], markdown: '*text*', slash: [], tiers: BOTH, icon: 'italic', inSlash: false },
  { id: 'underline', label: 'Underline', group: 'format', keys: ['Mod+U'], slash: [], tiers: BOTH, icon: 'underline', inSlash: false },
  { id: 'strike', label: 'Strikethrough', group: 'format', keys: ['Mod+Shift+X', 'Mod+Shift+S'], markdown: '~~text~~', slash: [], tiers: BOTH, icon: 'strike', inSlash: false },
  { id: 'inlineCode', label: 'Inline code', group: 'format', keys: ['Mod+E'], markdown: '`text`', slash: [], tiers: BOTH, icon: 'inlineCode', inSlash: false },
  { id: 'highlight', label: 'Highlight (current color)', group: 'format', keys: ['Mod+Shift+H'], markdown: '==text==', slash: [], tiers: BOTH, icon: 'highlight', inSlash: false, hint: 'Uses the color picked on the highlighter' },
  { id: 'clearFormat', label: 'Clear formatting', group: 'format', keys: ['Mod+Backslash'], slash: ['clear', 'plain'], tiers: BOTH, icon: 'clear', inSlash: true, hint: 'Removes bold, highlight, code… and turns headings back into text' },

  // --- Insert
  { id: 'link', label: 'Link', group: 'insert', keys: ['Mod+K'], markdown: '[text](url)', slash: ['link', 'url', 'href'], tiers: BOTH, icon: 'link', inSlash: true, hint: 'Ctrl+click a link to open it' },
  { id: 'date', label: 'Date', group: 'insert', keys: [], markdown: '@today', markdownAlt: ['@fri', '@21/12'], slash: ['date', 'today', 'tomorrow', 'day'], tiers: BOTH, icon: 'date', inSlash: true, hint: 'A date chip' },
  { id: 'time', label: 'Current time', group: 'insert', keys: [], slash: ['time', 'now', 'clock'], tiers: BOTH, icon: 'time', inSlash: true },
  { id: 'emoji', label: 'Emoji', group: 'insert', keys: [], markdown: ':smile', slash: ['emoji', 'smiley', 'icon'], tiers: BOTH, icon: 'emoji', inSlash: true },
  { id: 'mention', label: 'Mention a task', group: 'insert', keys: [], markdown: '@', slash: ['mention', 'task', 'at'], tiers: BOTH, editors: ['projects', 'meetings', 'notes'], icon: 'mention', inSlash: true, hint: 'Link an existing task as a colored pill' },
  { id: 'docRef', label: 'Link to a project, meeting or idea', group: 'insert', keys: [], markdown: '[[', slash: ['page', 'doc', 'project', 'meeting', 'idea', 'ref'], tiers: [F], icon: 'docRef', inSlash: true },
  { id: 'image', label: 'Image', group: 'insert', keys: [], markdown: '(paste or drop)', slash: ['image', 'picture', 'photo', 'screenshot'], tiers: BOTH, icon: 'image', inSlash: true, hint: 'Paste or drop a picture' },
  { id: 'template', label: 'Templates…', group: 'insert', keys: [], slash: ['template', 'preset', 'structure'], tiers: [F], icon: 'template', inSlash: true },
  { id: 'makeTask', label: 'Turn into task', group: 'insert', keys: [], slash: ['task', 'action', 'todo item', 'convert'], tiers: BOTH, editors: ['projects', 'meetings', 'notes'], icon: 'task', inSlash: true, hint: 'Creates a task from the selected text and links it' },
  { id: 'addSubtask', label: 'Add as subtask', group: 'insert', keys: [], slash: ['subtask', 'step'], tiers: BOTH, editors: ['task'], icon: 'subtask', inSlash: true, hint: 'Adds the selected text (or the line) as a subtask' },

  // --- Editing
  { id: 'moveUp', label: 'Move block up', group: 'editing', keys: ['Alt+Shift+ArrowUp'], slash: [], tiers: BOTH, icon: 'moveUp', inSlash: false, helpOnly: true },
  { id: 'moveDown', label: 'Move block down', group: 'editing', keys: ['Alt+Shift+ArrowDown'], slash: [], tiers: BOTH, icon: 'moveDown', inSlash: false, helpOnly: true },
  { id: 'duplicate', label: 'Duplicate block', group: 'editing', keys: ['Mod+D'], slash: ['duplicate', 'copy line'], tiers: BOTH, icon: 'duplicate', inSlash: true },
  { id: 'undo', label: 'Undo', group: 'editing', keys: ['Mod+Z'], slash: [], tiers: BOTH, icon: 'undo', inSlash: false, helpOnly: true, native: true },
  { id: 'redo', label: 'Redo', group: 'editing', keys: ['Mod+Shift+Z', 'Mod+Y'], slash: [], tiers: BOTH, icon: 'redo', inSlash: false, helpOnly: true, native: true },
  { id: 'lineBreak', label: 'Line break inside a block', group: 'editing', keys: ['Shift+Enter'], slash: [], tiers: BOTH, icon: 'lineBreak', inSlash: false, helpOnly: true, native: true },
  { id: 'plainPaste', label: 'Paste as plain text', group: 'editing', keys: ['Mod+Shift+V'], slash: [], tiers: BOTH, icon: 'paste', inSlash: false, helpOnly: true },

  // --- Document tools
  { id: 'save', label: 'Save', group: 'tools', keys: ['Mod+S'], slash: [], tiers: BOTH, icon: 'save', inSlash: false },
  { id: 'find', label: 'Find', group: 'tools', keys: ['Mod+F'], slash: ['find', 'search'], tiers: [F], icon: 'find', inSlash: true },
  { id: 'findNext', label: 'Find next', group: 'tools', keys: ['Enter', 'F3', 'Mod+G'], slash: [], tiers: [F], icon: 'find', inSlash: false, helpOnly: true, native: true, hint: 'Enter in the find field. F3 and Ctrl+G also work from the text while the bar is open' },
  { id: 'findPrev', label: 'Find previous', group: 'tools', keys: ['Shift+Enter', 'Shift+F3', 'Mod+Shift+G'], slash: [], tiers: [F], icon: 'find', inSlash: false, helpOnly: true, native: true },
  { id: 'findMatchCase', label: 'Match case on / off', group: 'tools', keys: ['Alt+C'], slash: [], tiers: [F], icon: 'find', inSlash: false, helpOnly: true, native: true, notMac: true, hint: 'In the find bar' },
  { id: 'findWholeWord', label: 'Whole words on / off', group: 'tools', keys: ['Alt+W'], slash: [], tiers: [F], icon: 'find', inSlash: false, helpOnly: true, native: true, notMac: true, hint: 'In the find bar' },
  { id: 'replace', label: 'Find and replace', group: 'tools', keys: ['Mod+H'], slash: ['replace'], tiers: [F], icon: 'replace', inSlash: true },
  { id: 'replaceAll', label: 'Replace all', group: 'tools', keys: ['Mod+Enter'], slash: [], tiers: [F], icon: 'replace', inSlash: false, helpOnly: true, native: true, hint: 'In the replace field (Enter replaces the current match)' },
  { id: 'outline', label: 'Outline', group: 'tools', keys: [], slash: ['outline', 'toc', 'contents', 'headings'], tiers: [F], editors: DOC_EDITORS, icon: 'outline', inSlash: true, hint: 'Jump between headings' },
  { id: 'focus', label: 'Focus mode', group: 'tools', keys: ['Mod+Shift+F'], slash: ['focus', 'zen', 'fullscreen', 'distraction'], tiers: [F], icon: 'focus', inSlash: true, hint: 'Write full screen without distractions' },
  { id: 'exportMd', label: 'Download Markdown (.md)', group: 'tools', keys: [], slash: ['export', 'markdown', 'md', 'download'], tiers: [F], icon: 'download', inSlash: true },
  { id: 'exportPdf', label: 'Export PDF / print', group: 'tools', keys: ['Mod+P'], slash: ['pdf', 'print'], tiers: [F], icon: 'pdf', inSlash: true },
  { id: 'copyMd', label: 'Copy as Markdown', group: 'tools', keys: [], slash: ['copy markdown', 'copy md'], tiers: [F], icon: 'copy', inSlash: true },
  { id: 'copyRich', label: 'Copy formatted text', group: 'tools', keys: [], slash: ['copy', 'copy rich', 'email'], tiers: [F], icon: 'copyRich', inSlash: true },
  { id: 'help', label: 'Shortcuts & commands', group: 'tools', keys: ['Mod+Slash'], slash: ['help', 'shortcuts', 'commands', 'keys', '?'], tiers: BOTH, icon: 'help', inSlash: true }
];

const BY_ID = new Map(WRITING_COMMANDS.map(c => [c.id, c]));

export function getCommand(id) {
  return BY_ID.get(id) || null;
}

// Markdown typed at the start of a line or around text (input-rules.js does the work)
export const MARKDOWN_HELP = [
  { section: 'Start a line with', pattern: '# ', result: 'Heading 1 (## and ### for smaller)', tiers: BOTH },
  { section: 'Start a line with', pattern: '- ', alt: ['* '], result: 'Bulleted list', tiers: BOTH },
  { section: 'Start a line with', pattern: '1. ', result: 'Numbered list', tiers: BOTH },
  { section: 'Start a line with', pattern: '[] ', alt: ['[ ] '], result: 'Checklist', tiers: BOTH },
  { section: 'Start a line with', pattern: '[x] ', result: 'Checked checklist item', tiers: BOTH },
  { section: 'Start a line with', pattern: '> ', result: 'Quote', tiers: BOTH },
  { section: 'Start a line with', pattern: '---', result: 'Divider', tiers: BOTH },
  { section: 'Start a line with', pattern: '```', alt: ['```js'], result: 'Code block (then Space or Enter)', tiers: [F] },
  { section: 'Start a line with', pattern: '!! ', result: 'Callout', tiers: [F] },
  { section: 'Start a line with', pattern: '<> ', result: 'Decision callout', tiers: [F] },
  { section: 'Start a line with', pattern: '+ ', result: 'Toggle section', tiers: [F] },
  { section: 'Around text', pattern: '**bold**', result: 'Bold', tiers: BOTH },
  { section: 'Around text', pattern: '*italic*', alt: ['_italic_'], result: 'Italic', tiers: BOTH },
  { section: 'Around text', pattern: '~~strike~~', result: 'Strikethrough', tiers: BOTH },
  { section: 'Around text', pattern: '`code`', result: 'Inline code', tiers: BOTH },
  { section: 'Around text', pattern: '==highlight==', result: 'Highlight (current color)', tiers: BOTH },
  { section: 'Around text', pattern: '[text](https://…)', result: 'Link', tiers: BOTH },
  { section: 'Escapes', pattern: '\\#', result: 'A backslash before a rule keeps the characters as typed', tiers: BOTH },
  { section: 'Escapes', pattern: 'Backspace', result: 'Right after a conversion, gives the typed characters back', tiers: BOTH }
];

// Smart typography (pref smartTypography): typed pair -> character
export const TYPOGRAPHY_HELP = [
  { pattern: '->', result: '→' },
  { pattern: '<-', result: '←' },
  { pattern: '<->', result: '↔' },
  { pattern: '=>', result: '⇒' },
  { pattern: '!=', result: '≠' },
  { pattern: '<=', result: '≤' },
  { pattern: '>=', result: '≥' },
  { pattern: '+-', result: '±' },
  { pattern: '(c)', result: '©' },
  { pattern: ' -- ', result: ' — ' }
];

// --- Platform
export function isMacPlatform(nav = globalThis.navigator) {
  if (!nav) return false;
  const platform = (nav.userAgentData && nav.userAgentData.platform) || nav.platform || '';
  if (/mac|iphone|ipad|ipod/i.test(platform)) return true;
  return /Mac OS X|iPhone|iPad|iPod/.test(nav.userAgent || '') && !/Windows|Android/.test(nav.userAgent || '');
}

// --- Key spec parsing
const NAMED_KEYS = {
  enter: { key: 'Enter' },
  tab: { key: 'Tab' },
  arrowup: { key: 'ArrowUp' },
  arrowdown: { key: 'ArrowDown' },
  arrowleft: { key: 'ArrowLeft' },
  arrowright: { key: 'ArrowRight' },
  escape: { key: 'Escape' },
  backspace: { key: 'Backspace' },
  backslash: { code: 'Backslash' },
  slash: { code: 'Slash' },
  period: { code: 'Period' },
  comma: { code: 'Comma' }
};

const specCache = new Map();

export function parseKeySpec(spec) {
  if (specCache.has(spec)) return specCache.get(spec);
  const parts = String(spec).split('+').map(p => p.trim()).filter(Boolean);
  const last = parts.pop() || '';
  const mods = parts.map(p => p.toLowerCase());
  const parsed = {
    mod: mods.includes('mod'),
    shift: mods.includes('shift'),
    alt: mods.includes('alt'),
    raw: last,
    letter: null,
    code: null,
    key: null
  };
  const lower = last.toLowerCase();
  if (/^[a-z]$/i.test(last)) parsed.letter = lower;
  else if (/^[0-9]$/.test(last)) parsed.code = 'Digit' + last;
  else if (NAMED_KEYS[lower]) Object.assign(parsed, { code: NAMED_KEYS[lower].code || null, key: NAMED_KEYS[lower].key || null });
  else parsed.key = last;
  specCache.set(spec, parsed);
  return parsed;
}

function modifiersMatch(parsed, ev, mac) {
  const ctrl = !!ev.ctrlKey, meta = !!ev.metaKey;
  const modDown = mac ? meta : ctrl;
  const otherDown = mac ? ctrl : meta;
  if (otherDown) return false;
  if (modDown !== parsed.mod) return false;
  if (!!ev.shiftKey !== parsed.shift) return false;
  if (!!ev.altKey !== parsed.alt) return false;
  return true;
}

function keyMatches(parsed, ev) {
  if (parsed.letter) {
    const key = typeof ev.key === 'string' ? ev.key : '';
    if (key.length === 1 && key.toLowerCase() === parsed.letter) return true;
    // Non-Latin layouts (e.key is e.g. Cyrillic): fall back to the physical key
    if (!(key.length === 1 && /[a-z]/i.test(key)) && ev.code === 'Key' + parsed.letter.toUpperCase()) return true;
    return false;
  }
  if (parsed.code) return ev.code === parsed.code;
  if (parsed.key) return ev.key === parsed.key;
  return false;
}

export function matchKeySpec(spec, ev, mac = false) {
  const parsed = parseKeySpec(spec);
  return modifiersMatch(parsed, ev, mac) && keyMatches(parsed, ev);
}

// ev = { key, code, ctrlKey, metaKey, shiftKey, altKey } -> command id or null.
// Native rows (undo / redo / line break, keys inside tables, code blocks and the
// find bar) never match: the browser or that block's own handler does them.
export function matchKeyEvent(ev, mac = false) {
  if (!ev) return null;
  // AltGr (Ctrl+Alt) types characters on many layouts: never a shortcut
  if (ev.ctrlKey && ev.altKey) return null;
  for (const cmd of WRITING_COMMANDS) {
    if (cmd.native || !cmd.keys || !cmd.keys.length) continue;
    for (const spec of cmd.keys) {
      if (matchKeySpec(spec, ev, mac)) return cmd.id;
    }
  }
  return null;
}

// --- Formatting for people
const MAC_PARTS = { mod: '⌘', shift: '⇧', alt: '⌥' };
const WIN_PARTS = { mod: 'Ctrl', shift: 'Shift', alt: 'Alt' };
const KEY_LABELS = {
  enter: { mac: '↩', win: 'Enter' },
  tab: { mac: '⇥', win: 'Tab' },
  arrowup: { mac: '↑', win: '↑' },
  arrowdown: { mac: '↓', win: '↓' },
  arrowleft: { mac: '←', win: '←' },
  arrowright: { mac: '→', win: '→' },
  escape: { mac: 'Esc', win: 'Esc' },
  backspace: { mac: '⌫', win: 'Backspace' },
  backslash: { mac: '\\', win: '\\' },
  slash: { mac: '/', win: '/' },
  period: { mac: '.', win: '.' },
  comma: { mac: ',', win: ',' }
};

function formatOne(spec, mac) {
  const parsed = parseKeySpec(spec);
  const names = mac ? MAC_PARTS : WIN_PARTS;
  const out = [];
  // Mac convention orders modifiers ⌥⇧⌘; Windows Ctrl+Alt+Shift
  if (mac) {
    if (parsed.alt) out.push(names.alt);
    if (parsed.shift) out.push(names.shift);
    if (parsed.mod) out.push(names.mod);
  } else {
    if (parsed.mod) out.push(names.mod);
    if (parsed.alt) out.push(names.alt);
    if (parsed.shift) out.push(names.shift);
  }
  const lower = parsed.raw.toLowerCase();
  if (KEY_LABELS[lower]) out.push(mac ? KEY_LABELS[lower].mac : KEY_LABELS[lower].win);
  else out.push(parsed.raw.length === 1 ? parsed.raw.toUpperCase() : parsed.raw);
  return out;
}

// 'Mod+Shift+1' -> ['Ctrl', 'Shift', '1'] (or ['⇧', '⌘', '1'] on Mac).
// An array of specs gives an array of part lists (one per alternative).
export function formatKeys(keys, mac = false) {
  if (Array.isArray(keys)) return keys.map(spec => formatOne(spec, mac));
  if (!keys) return [];
  return formatOne(keys, mac);
}

// One spec as a single string: 'Ctrl+Shift+1' or '⇧⌘1'
export function formatKeysText(spec, mac = false) {
  if (!spec) return '';
  return formatOne(spec, mac).join(mac ? '' : '+');
}

// The first shortcut of a command as text, or '' (toolbar titles, menu hints)
export function keyHint(id, mac = false) {
  const cmd = BY_ID.get(id);
  if (!cmd || !cmd.keys || !cmd.keys.length) return '';
  return formatKeysText(cmd.keys[0], mac);
}

// "Bold (Ctrl+B)" for tooltips
export function commandTitle(id, mac = false, label) {
  const cmd = BY_ID.get(id);
  const text = label || (cmd ? cmd.label : id);
  const hint = keyHint(id, mac);
  return hint ? `${text} (${hint})` : text;
}

// --- Filters
function inTier(cmd, tier) {
  return !tier || (cmd.tiers || []).includes(tier);
}
function inEditor(cmd, editorId) {
  return !editorId || !cmd.editors || cmd.editors.includes(editorId);
}

export function commandsFor(tier, editorId) {
  return WRITING_COMMANDS.filter(cmd => inTier(cmd, tier) && inEditor(cmd, editorId));
}

export function slashItemsFor(tier, editorId) {
  return commandsFor(tier, editorId).filter(cmd => cmd.inSlash && !cmd.helpOnly);
}

// Sections for the commands reference:
// [{ id, title, rows: [{ id, label, keys: [[parts]], markdown, slash, tiers, hint }] }]
// opts: { tier, editorId } to show only what that editor has. notMac rows are left out on a Mac
export function buildWritingHelp(mac = false, opts = {}) {
  const list = commandsFor(opts.tier, opts.editorId).filter(cmd => !(mac && cmd.notMac));
  return WRITING_GROUPS.map(group => ({
    id: group.id,
    title: group.label,
    rows: list.filter(cmd => cmd.group === group.id).map(cmd => ({
      id: cmd.id,
      label: cmd.label,
      keys: formatKeys(cmd.keys || [], mac),
      markdown: [cmd.markdown, ...(cmd.markdownAlt || [])].filter(Boolean),
      slash: cmd.inSlash ? (cmd.slash || []).slice() : [],
      tiers: (cmd.tiers || []).slice(),
      editors: cmd.editors ? cmd.editors.slice() : null,
      hint: cmd.hint || ''
    }))
  })).filter(section => section.rows.length);
}
