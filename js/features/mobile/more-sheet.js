// Personal Dashboard - Mobile shell: the More sheet (unit F4, service `more`)
// Opened from the avatar. Replaces F0's interim sheet. Everything the desktop
// keeps in the header and Settings, reachable without edit mode:
//   account + sync status (Sync now / Sign in / Resolve), Light / Dark,
//   Classic / Sunset, Time tracking, Completed tasks, Task categories,
//   Writing & shortcuts, Cloud files, Backup (Download / Restore…),
//   Not on mobile, Layout (desktop preview only), Sign out.
// It calls the existing entry points (setDarkMode, setGlassTheme + saveModel,
// openTaskSettingsModal, openWritingHelp, openFileManager, the Settings backup
// controls, the auth buttons); reused dialogs (z 2000+) stack above the sheet.
// The status line is refreshed once a second while the sheet is open
// (Text.data only); a sign-in / sign-out rebuilds the sheet.

import { model } from '../../state.js';
import { saveModel } from '../../core/storage.js';
import { isLoggedIn, getUsername } from '../../core/auth.js';
import { setImageFromRef } from '../../core/file-service.js';
import { relativeTime } from '../../core/mobile-common.js';
import { setDarkMode, setGlassTheme } from '../edit-mode.js';
import { openFileManager } from '../file-manager.js';

const svg = (body, size = 20, width = 2) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
const ICONS = {
  time: svg('<circle cx="12" cy="13" r="8"></circle><polyline points="12 9 12 13 14.5 14.5"></polyline><line x1="10" y1="2.5" x2="14" y2="2.5"></line>'),
  completed: svg('<circle cx="12" cy="12" r="9"></circle><polyline points="8 12.5 11 15.5 16.5 9.5"></polyline>'),
  categories: svg('<line x1="5" y1="9" x2="20" y2="9"></line><line x1="4" y1="15" x2="19" y2="15"></line><line x1="10" y1="3" x2="8" y2="21"></line><line x1="16" y1="3" x2="14" y2="21"></line>'),
  help: svg('<circle cx="12" cy="12" r="9"></circle><path d="M9.6 9.2a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.6"></path><line x1="12" y1="17" x2="12" y2="17.01"></line>'),
  files: svg('<path d="M18 10h-1.3A7 7 0 1 0 9 19h9a4.5 4.5 0 0 0 0-9z"></path>'),
  info: svg('<circle cx="12" cy="12" r="9"></circle><line x1="12" y1="11" x2="12" y2="16.5"></line><line x1="12" y1="7.6" x2="12" y2="7.61"></line>'),
  download: svg('<path d="M12 3v12"></path><polyline points="7 10 12 15 17 10"></polyline><path d="M4 20h16"></path>', 18),
  upload: svg('<path d="M12 15V3"></path><polyline points="7 8 12 3 17 8"></polyline><path d="M4 20h16"></path>', 18),
  signout: svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line>', 18),
  chevron: svg('<polyline points="9 6 15 12 9 18"></polyline>', 16, 2.2),
};

// What the phone leaves to a larger screen (SPEC §7), in plain words
const NOT_ON_MOBILE = [
  ['Arranging cards', 'Creating, deleting, resizing and moving cards, card titles, colours and sections. Cards are arranged on the tablet and desktop layouts.'],
  ['Editing card items', 'Changing or deleting existing icons, reminders, subtasks and snippets, their links and schedules. Adding new items works here.'],
  ['Separators', 'Placing separators between icons.'],
  ['Sticky notes', 'Sticky notes stay on the desktop.'],
  ['Header photo and logo', 'Positioning the profile photo and logo, the name and title.'],
  ['Linking tasks to card items', 'Picking card items from the task editor. Existing links still show and open.'],
  ['Image resizing', 'Resizing images in notes and documents. Pasted images show full width.'],
  ['Keyboard shortcuts', 'They need a hardware keyboard.'],
];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function setText(node, text) {
  if (!node) return;
  const t = node.firstChild;
  if (t && t.nodeType === 3 && !t.nextSibling) { if (t.data !== text) t.data = text; }
  else node.textContent = text;
}

// { text, state: 'ok' | 'pending' | 'error' | 'out' }
export function syncStatusText(st, now = Date.now()) {
  if (!st || !st.signedIn) return { text: 'Not signed in', state: 'out' };
  if (st.conflict) return { text: 'Changes on two devices', state: 'error' };
  if (st.inFlight) return { text: 'Syncing…', state: 'pending' };
  if (st.failed) return { text: 'Couldn’t sync · will retry', state: 'error' };
  if (st.dirty) return { text: 'Changes waiting to sync', state: 'pending' };
  if (st.lastPushAt) return { text: `Synced ${relativeTime(st.lastPushAt, now)}`, state: 'ok' };
  return { text: 'Synced', state: 'ok' };
}

export function createMoreSheet(api, { openTime } = {}) {
  let handle = null;
  let poll = 0;
  let signedIn = null;
  let status = null;         // { dot, text, action }
  let syncing = false;

  function row({ icon, label, value = '', onClick, cls = '' }) {
    const b = el('button', `mx-more-row ${cls}`.trim());
    b.type = 'button';
    const i = el('span', 'mx-more-row-icon');
    i.innerHTML = icon;
    const l = el('span', 'mx-more-row-label', label);
    b.append(i, l);
    b.appendChild(el('span', 'mx-more-row-value', value));   // always there: keeps the chevron column
    const c = el('span', 'mx-more-row-chevron');
    c.innerHTML = ICONS.chevron;
    b.appendChild(c);
    b.addEventListener('click', onClick);
    return b;
  }

  function group(title, ...children) {
    const g = el('section', 'mx-more-group');
    if (title) g.appendChild(el('h3', 'mx-more-heading', title));
    children.filter(Boolean).forEach(c => g.appendChild(c));
    return g;
  }

  function buildAccount() {
    const box = el('section', 'mx-more-account');
    const photo = el('span', 'mx-more-photo');
    const img = el('img', 'mx-more-photo-img');
    img.alt = '';
    const header = model.header || {};
    setImageFromRef(img, header.profilePhotoSrc, 'assets/icons/placeholder-profile.svg');
    const x = (parseFloat(header.profilePhotoXPercent) || 0) * 52;
    const y = (parseFloat(header.profilePhotoYPercent) || 0) * 52;
    img.style.objectPosition = `calc(50% + ${x.toFixed(1)}px) calc(50% + ${y.toFixed(1)}px)`;
    photo.appendChild(img);

    const info = el('div', 'mx-more-who');
    info.appendChild(el('span', 'mx-more-name', (header.profileName || '').trim() || 'You'));
    const line = el('span', 'mx-more-status');
    const dot = el('span', 'mx-more-status-dot');
    dot.setAttribute('aria-hidden', 'true');
    const text = el('span', 'mx-more-status-text', '');
    line.append(dot, text);
    line.setAttribute('role', 'status');
    info.appendChild(line);
    const user = isLoggedIn() ? getUsername() : '';
    if (user) info.appendChild(el('span', 'mx-more-user', `Signed in as ${user}`));

    const action = el('button', 'mx-btn mx-more-action');
    action.type = 'button';
    action.addEventListener('click', (e) => {
      const st = api.sync.status();
      if (!st.signedIn) {
        // Opens the auth dialog (z 2000), above this sheet; works with the header hidden
        e.stopPropagation();
        const toggle = document.getElementById('auth-toggle');
        if (toggle) toggle.click();
        return;
      }
      if (st.conflict) { api.sync.resolveConflict(); return; }
      syncNow(action);
    });
    box.append(photo, info, action);
    status = { dot, text, action };
    paintStatus();
    return box;
  }

  async function syncNow(btn) {
    if (syncing) return;
    syncing = true;
    paintStatus();
    let r = null;
    try { r = await api.sync.syncNow(); } catch { r = null; }
    syncing = false;
    if (r && r.ok) api.toast('Synced');
    else if (r && r.held) { /* the conflict sheet asks */ }
    else if (r && r.busy) api.toast('Syncing…');
    else api.toast('Offline, will retry');
    paintStatus();
  }

  function paintStatus() {
    if (!status) return;
    const st = api.sync.status();
    const { text, state } = syncStatusText(st);
    setText(status.text, text);
    if (status.dot.dataset.state !== state) status.dot.dataset.state = state;
    const label = !st.signedIn ? 'Sign in' : st.conflict ? 'Resolve' : 'Sync now';
    setText(status.action, label);
    const busy = syncing || (st.signedIn && !st.conflict && !!st.inFlight);
    if (status.action.disabled !== busy) status.action.disabled = busy;
    status.action.classList.toggle('mx-btn-primary', !st.signedIn || st.conflict);
  }

  function buildAppearance() {
    const theme = api.ui.segmented({
      label: 'Theme',
      options: [{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }],
      value: document.body.dataset.theme === 'dark' ? 'dark' : 'light',
      onChange: (v) => setDarkMode(v === 'dark'),
    });
    theme.classList.add('mx-more-seg');
    const glass = api.ui.segmented({
      label: 'Style',
      options: [{ value: 'classic', label: 'Classic' }, { value: 'sunset', label: 'Sunset' }],
      value: document.body.dataset.glassTheme === 'sunset' ? 'sunset' : 'classic',
      onChange: (v) => { setGlassTheme(v); saveModel(); },
    });
    glass.classList.add('mx-more-seg');
    const wrap = el('div', 'mx-more-appearance');
    wrap.append(theme, glass);
    return group('Appearance', wrap);
  }

  function buildRows() {
    const list = el('div', 'mx-more-list');
    const tt = model.timeTracking;
    list.appendChild(row({
      icon: ICONS.time, label: 'Time tracking', value: tt && tt.active ? 'Running' : '',
      cls: tt && tt.active ? 'is-live' : '',
      onClick: () => { if (openTime) openTime(); },
    }));
    const completed = api.service('completed');
    if (completed && typeof completed.open === 'function') {
      list.appendChild(row({
        icon: ICONS.completed, label: 'Completed tasks', value: String((model.completedTasks || []).length),
        onClick: () => completed.open(),
      }));
    }
    const cats = Array.isArray(model.taskCategories) ? model.taskCategories.length : 0;
    list.appendChild(row({
      icon: ICONS.categories, label: 'Task categories', value: cats ? String(cats) : '',
      onClick: () => { if (window.openTaskSettingsModal) window.openTaskSettingsModal(); },
    }));
    list.appendChild(row({
      icon: ICONS.help, label: 'Writing & shortcuts',
      onClick: () => { if (window.openWritingHelp) window.openWritingHelp('writing'); },
    }));
    list.appendChild(row({ icon: ICONS.files, label: 'Cloud files', onClick: () => openFileManager() }));
    return group(null, list);
  }

  function buildBackup() {
    const wrap = el('div', 'mx-more-backup');
    const dl = el('button', 'mx-btn mx-more-backup-btn');
    dl.type = 'button';
    dl.innerHTML = `${ICONS.download}<span>Download</span>`;
    dl.addEventListener('click', () => { const b = document.getElementById('settings-export-btn'); if (b) b.click(); });
    const up = el('button', 'mx-btn mx-more-backup-btn');
    up.type = 'button';
    up.innerHTML = `${ICONS.upload}<span>Restore…</span>`;
    // The file picker needs this tap's activation: no await before it
    up.addEventListener('click', () => { const i = document.getElementById('settings-import-input'); if (i) i.click(); });
    wrap.append(dl, up);
    const g = group('Backup', wrap);
    g.appendChild(el('p', 'mx-more-note', 'A JSON file of everything on this dashboard. Restoring replaces it (you are asked first).'));
    return g;
  }

  function openNotOnMobile() {
    api.openSheet({
      id: 'not-on-mobile',
      title: 'Not on mobile',
      size: 'tall',
      build(body) {
        body.appendChild(el('p', 'mx-sheet-note', 'These stay on the tablet and desktop layouts. Your data is the same everywhere.'));
        const list = el('dl', 'mx-more-nom');
        NOT_ON_MOBILE.forEach(([term, desc]) => {
          list.append(el('dt', '', term), el('dd', '', desc));
        });
        body.appendChild(list);
      },
    });
  }

  function buildLayout() {
    if (api.frame.phone || document.documentElement.hasAttribute('data-phone')) return null;
    const seg = api.ui.segmented({
      label: 'Layout',
      options: [{ value: 'mobile', label: 'Mobile' }, { value: 'tablet', label: 'Tablet' }, { value: 'desktop', label: 'Desktop' }],
      value: 'mobile',
      onChange: (v) => {
        if (handle) handle.close({ immediate: true });
        if (window.switchDeviceMode) window.switchDeviceMode(v);
      },
    });
    seg.classList.add('mx-more-seg', 'mx-more-layout-seg');
    const g = group('Layout', seg);
    g.classList.add('mx-more-layout');
    return g;
  }

  function build(body) {
    body.classList.add('mx-more');
    signedIn = isLoggedIn();
    body.appendChild(buildAccount());
    body.appendChild(buildAppearance());
    body.appendChild(buildRows());
    body.appendChild(buildBackup());
    const info = el('div', 'mx-more-list');
    info.appendChild(row({ icon: ICONS.info, label: 'Not on mobile', onClick: openNotOnMobile }));
    body.appendChild(group(null, info));
    const layout = buildLayout();
    if (layout) body.appendChild(layout);
    if (signedIn) {
      const out = el('button', 'mx-btn mx-btn-quiet mx-btn-danger mx-more-signout');
      out.type = 'button';
      out.innerHTML = `${ICONS.signout}<span>Sign out</span>`;
      out.addEventListener('click', () => { const b = document.getElementById('auth-logout-btn'); if (b) b.click(); });
      body.appendChild(out);
    }
  }

  function open() {
    if (handle) return handle;
    handle = api.openSheet({
      id: 'more',
      title: 'More',
      size: 'auto',
      build,
      onClose() {
        clearInterval(poll);
        poll = 0;
        status = null;
        handle = null;
      },
    });
    handle.el.classList.add('mx-more-sheet');
    poll = setInterval(() => {
      if (!handle) return;
      if (isLoggedIn() !== signedIn) { handle.update(); return; }
      paintStatus();
    }, 1000);
    return handle;
  }

  api.on('unmount', () => { if (handle) handle.close({ immediate: true }); });

  return { open, isOpen: () => !!handle };
}
