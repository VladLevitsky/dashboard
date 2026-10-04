// Personal Dashboard - Writing help: the "Shortcuts & commands" window (#wr-help)
// One glass dialog with tabs (Writing, Card notes, Markdown & typing, Quick
// capture, Dashboard, Preferences) and a live search across all of them.
// Rows come from the registries only: writing-commands.js buildWritingHelp,
// writing-rules.js MARKDOWN_RULES_HELP, quick-capture-parse.js
// QUICK_CAPTURE_HELP and quick capture's own key rows. Only the Dashboard
// tab is written here.
//
// Ways in: Ctrl+/ and the ? toolbar button in any editor (the help command),
// ? anywhere you aren't typing, Settings -> Writing & shortcuts, quick
// capture's command list, window.openWritingHelp(tab).
// Opened from an editor it also works on that text: a slash / Markdown chip
// inserts itself at the caret, and while searching Enter runs the picked
// command there (its row shows the shortcut, so next time it's one key).
// Rows the editor doesn't have are dimmed.
// Preferences are api.prefs (localStorage 'dashboard_writing_prefs', per browser).

import { getCommand, formatKeys } from '../../core/writing-commands.js';
import { MARKDOWN_RULES_HELP } from '../../core/writing-rules.js';
import { QUICK_CAPTURE_HELP } from '../../core/quick-capture-parse.js';

const TABS = [
  { id: 'writing', label: 'Writing' },
  { id: 'notes', label: 'Card notes' },
  { id: 'markdown', label: 'Markdown & typing' },
  { id: 'quick', label: 'Quick capture' },
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'prefs', label: 'Preferences' }
];
const TAB_ALIASES = {
  full: 'writing', editors: 'writing', lite: 'notes', note: 'notes', 'card-notes': 'notes', cardnotes: 'notes',
  md: 'markdown', typing: 'markdown', 'quick-capture': 'quick', quickcapture: 'quick', qc: 'quick',
  global: 'dashboard', keys: 'dashboard', preferences: 'prefs', settings: 'prefs'
};

const TAB_INTRO = {
  writing: 'For task, subtask, idea, project and meeting descriptions. Type / in the text to find any of these.',
  notes: 'Card notes stay light: the toolbar only adds Link and ?, and the rest is typing.',
  markdown: 'Type these and they turn into formatting as you go. Backspace right after a change gives your characters back.',
  quick: 'Press N anywhere you aren’t typing (or tap the bolt in the Mobile layout). Commands can go anywhere in the line.',
  dashboard: 'Single keys work when you aren’t typing in a field.',
  prefs: 'Saved in this browser only.'
};

const PREF_ROWS = [
  { key: 'smartTypography', label: 'Smart typography', hint: 'Turns -> into →, != into ≠, (c) into © and two dashes between spaces into an em dash as you type' },
  { key: 'autolink', label: 'Link web addresses as you type', hint: 'https://…, www.… and domain.com/… become links when you press Space or Enter after them' },
  { key: 'markdownPaste', label: 'Paste Markdown as formatting', hint: 'Pasted text with # headings, - lists or **bold** comes in formatted, with an Undo' },
  { key: 'statusBar', label: 'Word count bar', hint: 'Words, characters, reading time and checklist progress under the full editors' },
  { key: 'typewriter', label: 'Typewriter scrolling in focus mode', hint: 'Keeps the line you are typing near the middle of the screen' }
];

// Which rows a markdown-tab section turns off with a preference
const SECTION_PREF = { 'Smart typography': 'smartTypography', Links: 'autolink' };

const FULL_EDITORS = ['task', 'subtask', 'ideas', 'projects', 'meetings'];
const EDITOR_NAMES = { task: 'task descriptions', subtask: 'subtasks', ideas: 'ideas', projects: 'projects', meetings: 'meetings', notes: 'card notes' };
const EDITOR_PLACE = { task: 'the task description', subtask: 'the subtask description', ideas: 'the idea editor', projects: 'the project editor', meetings: 'meeting notes', notes: 'this card note' };
// Commands that also need an editor feature (mirrors editor.js commandAvailableFor)
const FEATURE_OF = { outline: 'outline', template: 'templates', find: 'find', replace: 'find', focus: 'focus', docRef: 'docRefs', exportMd: 'export', exportPdf: 'export', copyMd: 'export', copyRich: 'export',
  findNext: 'find', findPrev: 'find', findMatchCase: 'find', findWholeWord: 'find', replaceAll: 'find' };
// Markdown that only means something at the start of a line
const BLOCK_MARKER_RE = /^(#{1,3} |[-*] |1\. |- \[ \] |\[[ xX]?\] |> |!! |<> |\+ |---$|```)/;

const ICONS = {
  search: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="7"/><line x1="20.5" y1="20.5" x2="16" y2="16"/></svg>',
  close: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
};

let api = null;
let MAC = false;
let root = null;
const els = {};
let qcKeyRows = null;           // quick capture's KEY_ROWS (loaded lazily: avoids an import cycle)
let keyListening = false;
const TOUCH = typeof matchMedia === 'function' ? matchMedia('(hover: none) and (pointer: coarse)') : { matches: false };

const state = {
  tab: 'writing',
  query: '',
  from: null,                   // { editor, range, st, ctx } when opened from an editor
  returnFocus: null,            // element to focus on close (not from an editor)
  runRows: [],                  // [{ el, id }] rows Enter can run, in screen order
  sel: -1
};

// --- Small DOM helpers ---------------------------------------------------------
function h(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function kbdGroup(alternatives) {
  const wrap = h('span', 'wr-help-keys');
  alternatives.filter(parts => parts && parts.length).forEach((parts, i) => {
    if (i) wrap.appendChild(h('span', 'wr-help-or', 'or'));
    wrap.insertAdjacentHTML('beforeend', api.ui.kbdHtml(parts));
  });
  return wrap;
}

// Leading / trailing spaces matter in Markdown ("# " needs its space): show them as ␣
function chipContent(text) {
  const frag = document.createDocumentFragment();
  const m = /^(\s*)(.*?)(\s*)$/s.exec(String(text));
  const space = (n) => { for (let i = 0; i < n; i++) { const s = h('span', 'wr-help-space', '␣'); s.setAttribute('aria-hidden', 'true'); frag.appendChild(s); } };
  space(m[1].length);
  frag.appendChild(document.createTextNode(m[2]));
  space(m[3].length);
  return frag;
}

function chip(text, { insert = null, slash = false, title = '' } = {}) {
  const clickable = insert != null && !!state.from;
  const node = h(clickable ? 'button' : 'span', 'wr-help-chip' + (slash ? ' is-slash' : ''));
  node.appendChild(chipContent(text));
  // "# " reads as "# then Space" (the ␣ glyphs are aria-hidden)
  const spoken = /\s$/.test(text) ? `${String(text).trim()} then Space` : String(text);
  if (clickable) {
    node.type = 'button';
    node.dataset.wrInsert = insert;
    if (slash) node.dataset.wrSlash = '';
    node.title = title ? `${title} · click to add it to your text` : 'Click to add it to your text';
    node.setAttribute('aria-label', `Insert ${spoken}`);
  } else {
    if (title) node.title = title;
    if (spoken !== String(text)) node.setAttribute('aria-label', spoken);
  }
  return node;
}

function badge(text) {
  return h('span', 'wr-help-badge', text);
}

function joinNames(list) {
  if (list.length <= 1) return list.join('');
  return list.slice(0, -1).join(', ') + ' & ' + list[list.length - 1];
}

// Search text: highlight every query token inside a label (one inline span,
// so the label's flex gap only separates it from its badge)
function highlight(text, tokens) {
  const frag = h('span', 'wr-help-text');
  const str = String(text ?? '');
  if (!tokens.length) { frag.appendChild(document.createTextNode(str)); return frag; }
  const lower = str.toLowerCase();
  const marks = [];
  tokens.forEach(t => {
    if (!t) return;
    let i = lower.indexOf(t);
    while (i >= 0) { marks.push([i, i + t.length]); i = lower.indexOf(t, i + t.length); }
  });
  if (!marks.length) { frag.appendChild(document.createTextNode(str)); return frag; }
  marks.sort((a, b) => a[0] - b[0]);
  const merged = [];
  marks.forEach(m => {
    const last = merged[merged.length - 1];
    if (last && m[0] <= last[1]) last[1] = Math.max(last[1], m[1]);
    else merged.push([...m]);
  });
  let pos = 0;
  merged.forEach(([s, e]) => {
    if (s > pos) frag.appendChild(document.createTextNode(str.slice(pos, s)));
    frag.appendChild(h('mark', 'wr-help-hit', str.slice(s, e)));
    pos = e;
  });
  if (pos < str.length) frag.appendChild(document.createTextNode(str.slice(pos)));
  return frag;
}

// "ctrl+shift+1", "ctrl shift 1" (and cmd / option words on a Mac) for the search
const GLYPH_WORDS = { '⌘': 'cmd command', '⇧': 'shift', '⌥': 'alt option', '⌃': 'ctrl control', '↩': 'enter return', '⇥': 'tab', '⌫': 'backspace' };
function keyWords(alternatives) {
  return alternatives.map(parts => {
    const words = parts.map(p => (GLYPH_WORDS[p] || p).toLowerCase());
    return [parts.join('+').toLowerCase(), words.join('+'), words.join(' '), parts.join('').toLowerCase()].join(' ');
  }).join(' ');
}

function platformHint(text) {
  if (!text) return '';
  return MAC ? text.replace(/Ctrl\+click/g, '⌘-click').replace(/\bCtrl\+/g, '⌘') : text;
}

// --- Editor context ----------------------------------------------------------------
function availableIn(st, id) {
  const cmd = getCommand(id);
  if (!cmd || !st) return true;
  if (!(cmd.tiers || []).includes(st.opts.tier)) return false;
  if (cmd.editors && !cmd.editors.includes(st.opts.id)) return false;
  const feature = FEATURE_OF[id];
  if (feature && st.features && !st.features[feature]) return false;
  return true;
}

function runnableIn(from, id) {
  if (!from) return false;
  const cmd = getCommand(id);
  if (!cmd || cmd.helpOnly || cmd.native || id === 'help') return false;
  if (!availableIn(from.st, id) || !api.hasCommand(id)) return false;
  return api.isAvailable(id, from.ctx);
}

function editorPlace() {
  return state.from ? (EDITOR_PLACE[state.from.st.opts.id] || 'this editor') : '';
}

// Restricted editors as a badge, seen from the full editors
function editorBadge(editors) {
  if (!editors) return '';
  const inFull = FULL_EDITORS.filter(id => editors.includes(id));
  if (inFull.length === FULL_EDITORS.length) return '';
  const missing = FULL_EDITORS.filter(id => !editors.includes(id));
  if (missing.length === 1) return `Not in ${EDITOR_NAMES[missing[0]]}`;
  return 'Only in ' + joinNames(inFull.map(id => EDITOR_NAMES[id]));
}

// --- Row models ----------------------------------------------------------------------
// Every tab is a list of groups { tab, title, note?, rows: [row] }. A row has
// `text` (lowercase search haystack) and render(tokens) -> Element.

function commandGroups(tab, opts) {
  return api.registry.buildWritingHelp(MAC, opts).map(section => ({
    tab,
    title: section.title,
    rows: section.rows.map(r => commandRow(tab, section.title, r))
  }));
}

function commandRow(tab, groupTitle, r) {
  const cmd = getCommand(r.id) || {};
  const from = state.from;
  const here = !from || availableIn(from.st, r.id);
  // Dimmed when the editor it was opened from lacks it, except on the Card
  // notes tab seen from a full editor (that tab still describes card notes)
  const aboutNotes = tab === 'notes' && !!from && from.st.opts.tier !== 'lite';
  const off = !!from && !here && !aboutNotes;
  const runnable = here && runnableIn(from, r.id);
  const badgeText = tab === 'writing' ? editorBadge(r.editors) : '';
  const hint = platformHint(r.hint);
  const slashTitle = r.slash.length ? 'Type / then ' + r.slash.join(', ') : '';
  const text = [
    r.label, hint, badgeText, groupTitle, r.id,
    keyWords(r.keys),
    r.markdown.join(' '),
    r.slash.map(s => `${s} /${s}`).join(' ')
  ].join(' ').toLowerCase();

  return {
    kind: 'cmd', id: r.id, text, runnable, off,
    render(tokens) {
      const row = h('div', 'wr-help-row wr-help-cmd');
      row.dataset.cmd = r.id;
      if (off) {
        row.classList.add('is-off');
        row.title = `Not available in ${editorPlace()}`;
      }
      const icon = h('span', 'wr-help-icon');
      icon.innerHTML = api.ui.icon(cmd.icon || 'text', 15);
      const main = h('div', 'wr-help-main');
      const label = h('div', 'wr-help-label');
      label.appendChild(highlight(r.label, tokens));
      if (badgeText) label.appendChild(badge(badgeText));
      // Search results mix everything: say when a full-editor command isn't in card notes
      else if (tokens.length && tab === 'writing' && !r.tiers.includes('lite')) label.appendChild(badge('Not in card notes'));
      main.appendChild(label);
      if (hint) main.appendChild(h('div', 'wr-help-hint', hint));
      const side = h('div', 'wr-help-side');
      if (r.keys.length) side.appendChild(kbdGroup(r.keys));
      const chips = h('span', 'wr-help-chips');
      r.markdown.forEach(md => {
        // Inline patterns with a placeholder ("**text**") and "(paste or drop)" only describe
        const insertable = here && !/text|^\(/.test(md);
        chips.appendChild(chip(md, { insert: insertable ? md : null, title: 'Markdown' }));
      });
      if (r.slash.length) {
        chips.appendChild(chip('/' + r.slash[0], { insert: here ? '/' + r.slash[0] : null, slash: true, title: slashTitle }));
      }
      if (chips.childElementCount) side.appendChild(chips);
      if (runnable) {
        row.classList.add('is-runnable');
        const run = h('button', 'wr-help-run');
        run.type = 'button';
        run.tabIndex = -1;
        run.dataset.wrRun = r.id;
        run.title = `Run it in ${editorPlace()}`;
        run.innerHTML = 'Run <span aria-hidden="true">↵</span>';
        side.appendChild(run);
      }
      row.append(icon, main, side);
      return row;
    }
  };
}

function markdownGroups() {
  const from = state.from;
  const lite = !!from && from.st.opts.tier === 'lite';
  const groups = [];
  const bySection = new Map();
  MARKDOWN_RULES_HELP.forEach(r => {
    const title = r.section || 'More';
    if (!bySection.has(title)) {
      const group = { tab: 'markdown', title, rows: [] };
      bySection.set(title, group);
      groups.push(group);
    }
    bySection.get(title).rows.push(markdownRow(r, lite, title));
  });
  groups.forEach(g => {
    const pref = SECTION_PREF[g.title];
    if (pref && !api.prefs.get(pref)) g.pref = pref;
  });
  return groups;
}

function markdownRow(r, lite, groupTitle) {
  const fullOnly = (r.tiers || []).length === 1 && r.tiers[0] === 'full';
  const off = lite && fullOnly;
  const variants = (r.variants && r.variants.length ? r.variants : [r.syntax]).filter(Boolean);
  const cmd = r.command ? getCommand(r.command) : null;
  // Clickable: line-start markers (go to the start of the line) and typography (at the caret)
  const insertable = !off && (r.kind === 'block' || r.kind === 'typography');
  const text = [r.syntax, variants.join(' '), r.result, r.hint, groupTitle, cmd ? cmd.label : '', fullOnly ? 'full editors' : ''].join(' ').toLowerCase();
  return {
    kind: 'md', text, off,
    render(tokens) {
      const row = h('div', 'wr-help-row wr-help-md' + (r.kind === 'typography' ? ' is-typo' : ''));
      if (off) { row.classList.add('is-off'); row.title = `Not available in ${editorPlace()}`; }
      const syntax = h('div', 'wr-help-syntax');
      if (r.kind === 'undo') syntax.appendChild(kbdGroup([[platformHint(r.syntax)]]));
      else variants.forEach(v => syntax.appendChild(chip(v, { insert: insertable ? v : null })));
      const main = h('div', 'wr-help-main');
      const label = h('div', 'wr-help-label');
      if (r.kind === 'typography') {
        label.appendChild(h('span', 'wr-help-arrow', '→'));
        label.appendChild(h('span', 'wr-help-glyph', String(r.result).trim()));
      } else {
        label.appendChild(highlight(r.result, tokens));
      }
      if (fullOnly) label.appendChild(badge('Full editors'));
      main.appendChild(label);
      if (r.hint && !(r.kind === 'escape' || r.kind === 'undo') && r.hint !== r.result) main.appendChild(h('div', 'wr-help-hint', r.hint));
      row.append(syntax, main);
      return row;
    }
  };
}

function quickGroups() {
  const groups = QUICK_CAPTURE_HELP.map(section => ({
    tab: 'quick',
    title: section.title,
    rows: section.rows.map(r => {
      const examples = r.examples || [];
      const text = [section.title, r.meaning, examples.map(x => x.text).join(' ')].join(' ').toLowerCase();
      return {
        kind: 'qc', text,
        render(tokens) {
          const row = h('div', 'wr-help-row wr-help-md wr-help-qc');
          const syntax = h('div', 'wr-help-syntax');
          examples.forEach(x => syntax.appendChild(h('span', 'qc-code' + (x.color ? ` task-bubble-${x.color}` : ''), x.text)));
          const main = h('div', 'wr-help-main');
          const label = h('div', 'wr-help-label');
          label.appendChild(highlight(r.meaning, tokens));
          main.appendChild(label);
          row.append(syntax, main);
          return row;
        }
      };
    })
  }));
  if (Array.isArray(qcKeyRows) && qcKeyRows.length) {
    groups.push({ tab: 'quick', title: 'Keys', rows: qcKeyRows.map(([combo, meaning]) => keyRow('quick', 'Keys', [combo], meaning)) });
  }
  return groups;
}

function keyRow(tab, groupTitle, alternatives, label, hint = '', gesture = false) {
  const text = [label, hint, groupTitle, gesture ? alternatives.flat().join(' ') : keyWords(alternatives)].join(' ').toLowerCase();
  return {
    kind: 'key', text,
    render(tokens) {
      const row = h('div', 'wr-help-row wr-help-md wr-help-keyrow');
      const syntax = h('div', 'wr-help-syntax');
      if (gesture) alternatives.forEach(a => syntax.appendChild(h('span', 'wr-help-chip is-gesture', a.join(' '))));
      else syntax.appendChild(kbdGroup(alternatives));
      const main = h('div', 'wr-help-main');
      const l = h('div', 'wr-help-label');
      l.appendChild(highlight(label, tokens));
      main.appendChild(l);
      if (hint) main.appendChild(h('div', 'wr-help-hint', hint));
      row.append(syntax, main);
      return row;
    }
  };
}

// The only hand-written tab: page-level keys (init.js search, quick capture, this window)
function dashboardGroups() {
  const ctrl = MAC ? '⌃' : 'Ctrl';
  const mod = formatKeys('Mod+Slash', MAC);
  const click = MAC ? '⌘-click' : 'Ctrl+click';
  return [
    {
      tab: 'dashboard', title: 'Anywhere you aren’t typing', rows: [
        keyRow('dashboard', 'Anywhere', [['N']], 'Quick capture', 'Add or change a task in one line (not in edit mode)'),
        keyRow('dashboard', 'Anywhere', [['/'], [ctrl, 'F']], 'Search the dashboard'),
        keyRow('dashboard', 'Anywhere', [['?']], 'Shortcuts & commands', 'This window')
      ]
    },
    {
      tab: 'dashboard', title: 'While writing', rows: [
        keyRow('dashboard', 'While writing', [mod], 'Shortcuts & commands', 'From any text editor (the ? button in its toolbar too)'),
        keyRow('dashboard', 'While writing', [['/']], 'Every command for the line', 'At the start of a line or after a space')
      ]
    },
    {
      tab: 'dashboard', title: 'Menus and windows', rows: [
        keyRow('dashboard', 'Menus and windows', [['↑'], ['↓']], 'Move through a list'),
        keyRow('dashboard', 'Menus and windows', [['Enter'], ['Tab']], 'Pick from an open list'),
        keyRow('dashboard', 'Menus and windows', [['Esc']], 'Close the menu or window on top')
      ]
    },
    {
      tab: 'dashboard', title: 'Mouse & touch', rows: [
        keyRow('dashboard', 'Mouse & touch', [['Long-press']], 'Add a card item to Quick Access, or take it out', 'Icons, reminders, subtasks and copy items, in view mode', true),
        keyRow('dashboard', 'Mouse & touch', [[click]], 'Open a link inside a text editor', 'A plain click puts the caret there', true)
      ]
    }
  ];
}

function prefGroups() {
  return [{
    tab: 'prefs',
    title: 'Writing',
    rows: PREF_ROWS.map(p => ({
      kind: 'pref', key: p.key, text: [p.label, p.hint, 'preferences settings'].join(' ').toLowerCase(),
      render(tokens) {
        const row = h('label', 'wr-help-row wr-help-pref');
        const main = h('div', 'wr-help-main');
        const label = h('div', 'wr-help-label');
        label.appendChild(highlight(p.label, tokens));
        main.append(label, h('div', 'wr-help-hint', p.hint));
        const sw = h('span', 'appearance-toggle-switch');
        const input = h('input');
        input.type = 'checkbox';
        input.dataset.wrPref = p.key;
        input.checked = !!api.prefs.get(p.key);
        input.setAttribute('aria-label', p.label);
        sw.append(input, h('span', 'appearance-toggle-slider'));
        row.append(main, sw);
        return row;
      }
    }))
  }];
}

function groupsFor(tab) {
  switch (tab) {
    case 'writing': return commandGroups('writing', { tier: 'full' });
    case 'notes': return commandGroups('notes', { tier: 'lite', editorId: 'notes' });
    case 'markdown': return markdownGroups();
    case 'quick': return quickGroups();
    case 'dashboard': return dashboardGroups();
    case 'prefs': return prefGroups();
    default: return [];
  }
}

// Search covers every tab once: the command list of the editor's own tier
// (card notes rows repeat the Writing rows, so only one of the two is searched)
function searchTabs() {
  const lite = state.from && state.from.st.opts.tier === 'lite';
  return TABS.map(t => t.id).filter(id => (lite ? id !== 'writing' : id !== 'notes'));
}

function tokensOf(query) {
  return String(query || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
}

function matches(row, tokens) {
  return tokens.every(t => row.text.includes(t));
}

// --- DOM -----------------------------------------------------------------------------
function ensureDom() {
  if (root) return;
  root = h('div', 'wr-help');
  root.id = 'wr-help';
  root.hidden = true;
  root.dataset.wrUi = '';
  root.innerHTML = `
    <div class="wr-help-backdrop"></div>
    <div class="wr-help-dialog" role="dialog" aria-modal="true" aria-labelledby="wr-help-title" tabindex="-1">
      <div class="wr-help-header">
        <div class="wr-help-heading">
          <h4 id="wr-help-title">Shortcuts &amp; commands</h4>
          <div class="wr-help-sub" hidden></div>
        </div>
        <button type="button" class="wr-help-close" title="Close (Esc)" aria-label="Close">${ICONS.close}</button>
      </div>
      <div class="wr-help-search">
        <span class="wr-help-search-icon">${ICONS.search}</span>
        <input type="search" class="wr-help-input" placeholder="Search commands, keys or Markdown" aria-label="Search commands, keys or Markdown" aria-controls="wr-help-panel" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="go" />
      </div>
      <div class="wr-help-tabs" role="tablist" aria-label="Sections"></div>
      <div class="wr-help-body" id="wr-help-panel" role="tabpanel" tabindex="0"></div>
      <div class="wr-help-footer"></div>
      <div class="wr-help-live" aria-live="polite" aria-atomic="true"></div>
    </div>`;
  document.body.appendChild(root);
  els.dialog = root.querySelector('.wr-help-dialog');
  els.sub = root.querySelector('.wr-help-sub');
  els.close = root.querySelector('.wr-help-close');
  els.input = root.querySelector('.wr-help-input');
  els.tabs = root.querySelector('.wr-help-tabs');
  els.body = root.querySelector('.wr-help-body');
  els.footer = root.querySelector('.wr-help-footer');
  els.live = root.querySelector('.wr-help-live');

  TABS.forEach(t => {
    const b = h('button', 'wr-help-tab');
    b.type = 'button';
    b.id = `wr-help-tab-${t.id}`;
    b.dataset.tab = t.id;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-controls', 'wr-help-panel');
    b.appendChild(h('span', 'wr-help-tab-label', t.label));
    const count = h('span', 'wr-help-tab-count');
    count.hidden = true;
    b.appendChild(count);
    els.tabs.appendChild(b);
  });

  root.querySelector('.wr-help-backdrop').addEventListener('click', () => closeWritingHelp());
  els.close.addEventListener('click', () => closeWritingHelp());
  els.tabs.addEventListener('click', (e) => {
    const tab = e.target.closest('.wr-help-tab');
    if (!tab) return;
    selectTab(tab.dataset.tab, { clearQuery: true });
  });
  els.input.addEventListener('input', () => {
    state.query = els.input.value;
    render();
  });
  els.body.addEventListener('click', onBodyClick);
  els.body.addEventListener('change', onBodyChange);
  // Hover (or a tap) picks a runnable row: its Run button shows
  const pickRow = (e) => {
    const row = e.target.closest('.wr-help-row.is-runnable');
    if (!row) return;
    const i = state.runRows.findIndex(r => r.el === row);
    if (i >= 0 && i !== state.sel) selectRun(i, false);
  };
  els.body.addEventListener('mousemove', pickRow);
  els.body.addEventListener('pointerdown', pickRow);
  // Focus moved out by the page (another field, an editor): stop being modal
  els.dialog.addEventListener('focusout', (e) => {
    const to = e.relatedTarget;
    if (to && to.nodeType === 1 && !root.contains(to)) closeWritingHelp({ restore: false });
  });
}

function renderTabs(counts) {
  els.tabs.querySelectorAll('.wr-help-tab').forEach(b => {
    const selected = !counts && b.dataset.tab === state.tab;
    b.setAttribute('aria-selected', String(selected));
    b.tabIndex = (counts ? b.dataset.tab === firstTabWith(counts) : selected) ? 0 : -1;
    b.classList.toggle('is-active', selected);
    const count = b.querySelector('.wr-help-tab-count');
    const n = counts ? counts[b.dataset.tab] : null;
    count.hidden = !n;
    count.textContent = n ? String(n) : '';
    b.classList.toggle('is-empty', !!counts && !n);
  });
  els.tabs.classList.toggle('is-searching', !!counts);
  els.body.setAttribute('aria-labelledby', counts ? 'wr-help-title' : `wr-help-tab-${state.tab}`);
  // Searching: bring the first tab with results into view (phones scroll the tab row)
  if (counts) revealTab(els.tabs.querySelector(`[data-tab="${firstTabWith(counts)}"]`));
}

// Scroll the tab row (only that row) so the tab shows with some air around it
function revealTab(btn) {
  const bar = els.tabs;
  if (!btn || bar.scrollWidth <= bar.clientWidth + 1) return;
  const b = btn.getBoundingClientRect();
  const r = bar.getBoundingClientRect();
  const air = 12;
  if (b.left < r.left + air) bar.scrollLeft -= r.left + air - b.left;
  else if (b.right > r.right - air) bar.scrollLeft += b.right - (r.right - air);
}

function firstTabWith(counts) {
  const hit = TABS.find(t => counts[t.id]);
  return hit ? hit.id : state.tab;
}

function render() {
  const tokens = tokensOf(state.query);
  const body = els.body;
  const prevScroll = body.scrollTop;
  body.textContent = '';
  state.runRows = [];
  state.sel = -1;

  let groups;
  let counts = null;
  if (tokens.length) {
    counts = {};
    groups = [];
    searchTabs().forEach(tabId => {
      const tabLabel = TABS.find(t => t.id === tabId).label;
      let n = 0;
      groupsFor(tabId).forEach(g => {
        const rows = g.rows.filter(r => matches(r, tokens));
        if (!rows.length) return;
        n += rows.length;
        groups.push({ ...g, rows, title: `${tabLabel} · ${g.title}` });
      });
      counts[tabId] = n;
    });
    TABS.forEach(t => { if (counts[t.id] == null) counts[t.id] = null; });
  } else {
    groups = groupsFor(state.tab);
    const intro = h('p', 'wr-help-intro', TAB_INTRO[state.tab] || '');
    if (state.tab === 'notes') {
      const link = h('button', 'wr-help-link', 'Markdown & typing');
      link.type = 'button';
      link.dataset.wrTab = 'markdown';
      intro.append(' For what you can type, see ', link);
    }
    if (state.from && groups.some(g => g.rows.some(r => r.off))) {
      intro.appendChild(h('span', 'wr-help-intro-off', ` Dimmed rows aren’t available in ${editorPlace()}.`));
    }
    body.appendChild(intro);
  }
  renderTabs(counts);

  let total = 0;
  groups.forEach(g => {
    const section = h('section', 'wr-help-group');
    const title = h('h5', 'wr-help-group-title', g.title);
    section.appendChild(title);
    if (g.pref) {
      const note = h('div', 'wr-help-note');
      note.appendChild(document.createTextNode(`${g.title === 'Links' ? 'Autolink' : g.title} is off. `));
      const on = h('button', 'wr-help-link', 'Turn it on');
      on.type = 'button';
      on.dataset.wrPrefOn = g.pref;
      note.appendChild(on);
      section.appendChild(note);
    }
    const list = h('div', 'wr-help-rows');
    g.rows.forEach(r => {
      const el = r.render(tokens);
      if (g.pref && r.kind === 'md') el.classList.add('is-paused');
      list.appendChild(el);
      if (r.runnable) state.runRows.push({ el, id: r.id });
      total++;
    });
    section.appendChild(list);
    body.appendChild(section);
  });

  if (tokens.length && !total) {
    const empty = h('div', 'wr-help-empty');
    empty.appendChild(h('div', 'wr-help-empty-title', `Nothing matches “${state.query.trim()}”`));
    empty.appendChild(h('div', 'wr-help-empty-hint', `Try a word like table, a key like ${MAC ? '⌘B' : 'Ctrl+B'}, or Markdown like **`));
    body.appendChild(empty);
  }
  if (state.tab === 'prefs' && !tokens.length) body.appendChild(prefsFooter());

  if (tokens.length) {
    body.scrollTop = 0;
    if (state.runRows.length) selectRun(0, false);
    els.live.textContent = total ? `${total} result${total === 1 ? '' : 's'}` : 'No results';
  } else {
    body.scrollTop = prevScroll;
    els.live.textContent = '';
  }
  renderFooter();
}

function prefsFooter() {
  const foot = h('div', 'wr-help-prefs-foot');
  const reset = h('button', 'wr-help-reset', 'Restore defaults');
  reset.type = 'button';
  reset.dataset.wrPrefsReset = '';
  const all = api.prefs.all();
  reset.disabled = Object.keys(api.prefs.defaults).every(k => all[k] === api.prefs.defaults[k]);
  foot.appendChild(reset);
  return foot;
}

function renderFooter() {
  const f = els.footer;
  f.textContent = '';
  const left = h('span', 'wr-help-foot-text wr-help-keyhint');
  const touch = h('span', 'wr-help-foot-text wr-help-touchhint');
  const keys = h('span', 'wr-help-foot-keys wr-help-keyhint');
  const query = !!state.query.trim();
  if (state.from && (query || ['writing', 'notes', 'markdown'].includes(state.tab))) {
    touch.textContent = state.tab === 'markdown' && !query ? 'Tap a chip to add it to your text' : 'Tap a command, then Run, to use it in your text';
    if (query && state.runRows.length) {
      keys.append(kbdGroup([['↑', '↓']]), ' pick · ', kbdGroup([['Enter']]), ` run it in ${editorPlace()}`);
    } else if (state.tab === 'markdown' && !query) {
      left.textContent = 'Click a chip to add it to your text';
    } else {
      left.textContent = 'Search, then Enter runs a command here · click a chip to add it to your text';
    }
  } else {
    keys.append(kbdGroup([['?']]), ' anywhere · ', kbdGroup([formatKeys('Mod+Slash', MAC)]), ' while writing');
  }
  const esc = h('span', 'wr-help-foot-esc wr-help-keyhint');
  esc.append(kbdGroup([['Esc']]), ' close');
  f.append(left, touch, keys, esc);
}

function selectTab(tab, { clearQuery = false, focus = false } = {}) {
  state.tab = TABS.some(t => t.id === tab) ? tab : 'writing';
  if (clearQuery && state.query) {
    state.query = '';
    els.input.value = '';
  }
  els.body.scrollTop = 0;
  render();
  els.body.scrollTop = 0;
  const btn = els.tabs.querySelector(`[data-tab="${state.tab}"]`);
  if (btn) {
    revealTab(btn);
    if (focus) btn.focus({ preventScroll: true });
  }
}

function selectRun(i, scroll = true) {
  const prev = state.runRows[state.sel];
  if (prev) { prev.el.classList.remove('is-selected'); prev.el.removeAttribute('aria-current'); }
  state.sel = i;
  const cur = state.runRows[i];
  if (!cur) return;
  cur.el.classList.add('is-selected');
  cur.el.setAttribute('aria-current', 'true');
  if (scroll) cur.el.scrollIntoView({ block: 'nearest' });
}

// --- Actions ---------------------------------------------------------------------------
function onBodyClick(e) {
  const tabLink = e.target.closest('[data-wr-tab]');
  if (tabLink) { selectTab(tabLink.dataset.wrTab, { clearQuery: true }); return; }
  const on = e.target.closest('[data-wr-pref-on]');
  if (on) {
    api.prefs.set(on.dataset.wrPrefOn, true);
    render();
    els.input.focus({ preventScroll: true });
    return;
  }
  if (e.target.closest('[data-wr-prefs-reset]')) {
    Object.entries(api.prefs.defaults).forEach(([k, v]) => { if (api.prefs.get(k) !== v) api.prefs.set(k, v); });
    syncPrefInputs();
    api.toast('Writing preferences restored');
    return;
  }
  const run = e.target.closest('[data-wr-run]');
  if (run) { runInEditor(run.dataset.wrRun); return; }
  const ins = e.target.closest('[data-wr-insert]');
  if (ins) insertInEditor(ins.dataset.wrInsert, ins.hasAttribute('data-wr-slash'));
}

function onBodyChange(e) {
  const input = e.target.closest('[data-wr-pref]');
  if (!input) return;
  api.prefs.set(input.dataset.wrPref, input.checked);
  const reset = els.body.querySelector('[data-wr-prefs-reset]');
  if (reset) {
    const all = api.prefs.all();
    reset.disabled = Object.keys(api.prefs.defaults).every(k => all[k] === api.prefs.defaults[k]);
  }
}

// Prefs changed (here or elsewhere): update the switches in place (focus stays put)
function syncPrefInputs() {
  if (!root || root.hidden) return;
  els.body.querySelectorAll('[data-wr-pref]').forEach(input => {
    const v = !!api.prefs.get(input.dataset.wrPref);
    if (input.checked !== v) input.checked = v;
  });
  const reset = els.body.querySelector('[data-wr-prefs-reset]');
  if (reset) {
    const all = api.prefs.all();
    reset.disabled = Object.keys(api.prefs.defaults).every(k => all[k] === api.prefs.defaults[k]);
  }
}

// Put the caret back where it was (focus first: restoreRange needs the editor focused)
function restoreEditor(from) {
  if (!from || !from.editor || !from.editor.isConnected) return false;
  try { from.editor.focus({ preventScroll: true }); } catch { from.editor.focus(); }
  const r = from.range;
  if (r && from.editor.contains(r.startContainer) && from.editor.contains(r.endContainer)) api.dom.restoreRange(r, from.editor);
  else api.dom.placeCaretAtEnd(from.editor);
  return true;
}

function runInEditor(id) {
  const from = state.from;
  if (!from) return;
  closeWritingHelp({ restore: false });
  if (!restoreEditor(from)) return;
  const st = api.stateOf(from.editor);
  let anchor = st && st.buttons ? st.buttons.get(id) : null;
  if (anchor && (anchor.hidden || !anchor.getClientRects().length)) anchor = null;
  const ok = api.runCommand(id, api.context(from.editor), anchor ? { source: 'help', anchor } : { source: 'help' });
  if (!ok) {
    const cmd = getCommand(id);
    api.toast(`${cmd ? cmd.label : 'That'} needs a selection or a different spot`);
  }
}

// Typed one character at a time with real insertText (not dom.exec), as if
// typed: input rules fire on their trigger character and the / @ : [[ menus
// open on theirs, then filter by the rest
function insertInEditor(text, slash) {
  const from = state.from;
  if (!from) return;
  closeWritingHelp({ restore: false });
  if (!restoreEditor(from)) return;
  const editor = from.editor;
  const sel = window.getSelection();
  if (sel && sel.rangeCount && !sel.isCollapsed) sel.collapseToEnd();
  let range = api.dom.getSelectionRange(editor);
  if (!range) return;
  let insert = text;
  if (BLOCK_MARKER_RE.test(text) && !slash) {
    // Line markers work at the start of a line: "# " turns the caret's line into a
    // heading; a divider / code fence needs an empty line, so it gets a new one
    const block = api.dom.blockOf(api.dom.anchorNode(range), editor);
    const hasText = !!block && block !== editor && !!block.textContent.replace(/[\u200B\s]/g, '');
    if (hasText && /^(---|```)/.test(text)) {
      api.dom.placeCaretAtEnd(block);
      document.execCommand('insertParagraph', false);
    } else if (hasText && api.dom.textBeforeCaret(range, editor, 400).replace(/[\u200B\s]/g, '')) {
      api.dom.placeCaretAtStart(block);
    }
  } else if (/^[/@:[]/.test(text)) {
    // Menus open after a space or at the start of a line
    const before = api.dom.textBeforeCaret(range, editor, 1);
    if (before && !/\s/.test(before)) insert = ' ' + text;
  }
  for (const ch of insert) {
    if (!editor.isConnected) break;
    document.execCommand('insertText', false, ch);
  }
}

// --- Open / close ---------------------------------------------------------------------------
function normalizeTab(tab) {
  const key = String(tab || '').toLowerCase();
  if (TABS.some(t => t.id === key)) return key;
  return TAB_ALIASES[key] || null;
}

// tab: 'writing' | 'notes' | 'markdown' | 'quick' | 'dashboard' | 'prefs' (aliases accepted)
// opts: { ctx } (a writing context: opened from that editor) | { returnFocus: Element }
export function openWritingHelp(tab, opts = {}) {
  if (!api) return;
  ensureDom();
  const wasOpen = !root.hidden;
  let ctx = opts.ctx && opts.ctx.editor ? opts.ctx : null;
  // Called without a context (slash menu footer, window.openWritingHelp) while
  // writing: still "from" that editor, so the caret comes back
  if (!ctx && !opts.returnFocus && !wasOpen) {
    const ed = api.editorForNode(document.activeElement);
    if (ed && api.dom.getSelectionRange(ed)) ctx = api.context(ed);
  }
  if (!wasOpen) {
    api.ui.closeAll('help');
    if (ctx) {
      const st = api.stateOf(ctx.editor);
      const range = ctx.range ? ctx.range.cloneRange() : null;
      state.from = st ? { editor: ctx.editor, range, st, ctx: { ...ctx, range } } : null;
      state.returnFocus = null;
    } else {
      state.from = null;
      const active = document.activeElement;
      state.returnFocus = opts.returnFocus || (active && active !== document.body ? active : null);
    }
    state.query = '';
    els.input.value = '';
  } else if (ctx && !state.from) {
    const st = api.stateOf(ctx.editor);
    if (st) state.from = { editor: ctx.editor, range: ctx.range ? ctx.range.cloneRange() : null, st, ctx };
  }
  const sub = state.from ? `In ${editorPlace()}` : '';
  els.sub.textContent = sub;
  els.sub.hidden = !sub;
  state.tab = normalizeTab(tab) || (state.from ? (state.from.st.opts.tier === 'lite' ? 'notes' : 'writing') : 'writing');
  if (!wasOpen) {
    root.hidden = false;
    startKeys();
    root.classList.remove('open');
    void root.offsetWidth; // restart the open animation
    root.classList.add('open');
    els.tabs.scrollLeft = 0;
  }
  selectTab(state.tab, { clearQuery: true });
  // Synchronous focus: the editor gives it up right away (Esc and the trap need it
  // here). Touch screens get the dialog itself, so the keyboard doesn't cover it.
  const target = TOUCH.matches ? els.dialog : els.input;
  try { target.focus({ preventScroll: true }); } catch { target.focus(); }
}

// opts.restore (default true): give focus back (the editor's caret, or the
// element that had it). false when something else has taken focus already.
export function closeWritingHelp(opts = {}) {
  if (!root || root.hidden) return;
  const restore = opts.restore !== false;
  root.hidden = true;
  root.classList.remove('open');
  stopKeys();
  const from = state.from;
  const back = state.returnFocus;
  state.from = null;
  state.returnFocus = null;
  state.runRows = [];
  state.sel = -1;
  els.body.textContent = '';
  if (!restore) return;
  if (from && restoreEditor(from)) return;
  if (back && back.isConnected && typeof back.focus === 'function') {
    try { back.focus({ preventScroll: true }); } catch { /* gone */ }
  }
}

export function isWritingHelpOpen() {
  return !!root && !root.hidden;
}

// --- Keys -----------------------------------------------------------------------------------
// While open, a window capture listener owns the keyboard: it runs before the
// Card Edit Modal's Esc, the writing popups, quick capture's N and the page's
// / search, and keeps them all from reacting under the dialog.
function startKeys() {
  if (keyListening) return;
  keyListening = true;
  window.addEventListener('keydown', onDialogKeydown, true);
}

function stopKeys() {
  if (!keyListening) return;
  keyListening = false;
  window.removeEventListener('keydown', onDialogKeydown, true);
}

function focusables() {
  return [...els.dialog.querySelectorAll('button, input, [tabindex="0"]')]
    .filter(n => !n.disabled && n.tabIndex >= 0 && n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden');
}

function trapTab(e) {
  const list = focusables();
  if (!list.length) return;
  const first = list[0], last = list[list.length - 1];
  const active = document.activeElement;
  if (e.shiftKey && (active === first || !list.includes(active))) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && (active === last || !list.includes(active))) { e.preventDefault(); first.focus(); }
}

function onDialogKeydown(e) {
  if (root.hidden || e.isComposing || e.keyCode === 229) return;
  const target = e.target;
  const inside = target && target.nodeType === 1 && (root.contains(target) || target === document.body || target === document.documentElement);
  if (!inside) return;
  const inInput = target === els.input;
  const key = e.key;
  const handled = () => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };

  if (key === 'Escape') { handled(); closeWritingHelp(); return; }
  if (api.registry.matchKeyEvent(e, MAC) === 'help' || (key === '?' && !inInput && !e.ctrlKey && !e.metaKey && !e.altKey)) {
    handled();
    closeWritingHelp();
    return;
  }
  if (key === 'Tab') { e.stopPropagation(); trapTab(e); return; }
  if (inInput && (key === 'ArrowDown' || key === 'ArrowUp') && state.runRows.length && !e.altKey && !e.ctrlKey && !e.metaKey) {
    handled();
    const n = state.runRows.length;
    const next = state.sel < 0 ? (key === 'ArrowDown' ? 0 : n - 1) : (state.sel + (key === 'ArrowDown' ? 1 : -1) + n) % n;
    selectRun(next);
    return;
  }
  if (inInput && key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
    handled();
    const cur = state.runRows[state.sel];
    if (cur) runInEditor(cur.id);
    return;
  }
  const tab = target.closest && target.closest('.wr-help-tab');
  if (tab && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) {
    handled();
    const ids = TABS.map(t => t.id);
    let i = ids.indexOf(tab.dataset.tab);
    if (key === 'ArrowLeft') i = (i - 1 + ids.length) % ids.length;
    else if (key === 'ArrowRight') i = (i + 1) % ids.length;
    else i = key === 'Home' ? 0 : ids.length - 1;
    selectTab(ids[i], { clearQuery: true, focus: true });
    return;
  }
  // Every other key stays inside the dialog (no N, / or Ctrl+F page shortcuts behind it)
  e.stopPropagation();
  // Typing while a tab, chip or the list has focus searches (the key lands in the field)
  if (!inInput && key.length === 1 && key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey && target.tagName !== 'INPUT') {
    els.input.focus({ preventScroll: true });
  }
}

// ? anywhere you aren't typing (quick capture's guard: fields, contenteditable, shadow roots)
function onGlobalKeydown(e) {
  if (e.key !== '?' || e.defaultPrevented || e.repeat || e.isComposing) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (isWritingHelpOpen()) return;
  const target = typeof e.composedPath === 'function' ? e.composedPath()[0] : e.target;
  if (api.dom.isTypingTarget(target) || api.dom.isTypingTarget(document.activeElement)) return;
  e.preventDefault();
  // A writing editor on screen: its own tab; otherwise the page's keys
  const shown = api.editors().find(ed => ed.getClientRects().length && ed.offsetParent !== null);
  const st = shown ? api.stateOf(shown) : null;
  openWritingHelp(st ? (st.opts.tier === 'lite' ? 'notes' : 'writing') : 'dashboard');
}

// --- Install ----------------------------------------------------------------------------------
export function install(writingApi) {
  api = writingApi;
  MAC = !!api.registry.isMac;

  // Replaces the core stub (a toast): Ctrl+/, the ? toolbar button, /help
  api.registerCommand('help', {
    run(ctx) {
      openWritingHelp(ctx && ctx.tier === 'lite' ? 'notes' : 'writing', { ctx });
      return true;
    }
  });
  api.help = { open: openWritingHelp, close: closeWritingHelp, isOpen: isWritingHelpOpen };
  window.openWritingHelp = openWritingHelp;

  document.addEventListener('keydown', onGlobalKeydown);

  // Settings -> Writing & shortcuts (index.html)
  const settingsBtn = document.getElementById('settings-writing-help-btn');
  if (settingsBtn) settingsBtn.addEventListener('click', () => openWritingHelp('writing', { returnFocus: settingsBtn }));

  api.prefs.onChange(() => syncPrefInputs());

  // Quick capture's key rows live in its UI module; it is already loaded by main.js
  import('../quick-capture.js').then(m => { if (Array.isArray(m.KEY_ROWS)) qcKeyRows = m.KEY_ROWS; }).catch(() => {});
}
