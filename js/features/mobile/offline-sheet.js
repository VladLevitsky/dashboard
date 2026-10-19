// Personal Dashboard - Mobile shell: the Offline copy sheet (More → Offline copy)
// Opt-in copy of the app and this account's files on the phone (the work is in
// js/core/offline-copy.js). The sheet shows:
//   status   the app (opens without internet), this account's files (count,
//            size, not saved yet), last update, whether Android keeps it
//   size     what Save / Update now would download, asked of GET /files first
//   actions  Save offline copy / Update now (progress + Cancel), Remove
//            offline copy (asks inline; only this phone's copy goes)
//   limits   what doesn't work offline
// Not on iPhone / iPad (the More row isn't there). Signed out it only explains,
// or removes an app copy no account holds files in.

import { relativeTime } from '../../core/mobile-common.js';
import {
  getOfflineStatus, planOfflineCopy, startOfflineSave, removeOfflineCopy,
  requestPersistence, onOfflineChange, getRunningJob, isOffline,
} from '../../core/offline-copy.js';
import { formatBytes, filesLabel } from '../../core/offline-plan.js';

const OFFLINE_LIMITS = [
  ['Syncing', 'Changes wait on this phone and sync when you’re back online.'],
  ['Signing in, Google Calendar and busy times', 'They need the internet.'],
  ['Uploading files and images', 'Add them when you’re back online.'],
  ['Web links', 'Links to websites need the internet; saved files open.'],
  ['Files added elsewhere since the last update', 'Update now (or wait for the next quiet update) to get them.'],
];

const RESULT_TEXT = {
  cancelled: (r) => `Stopped. ${filesLabel(r.saved)} saved this time stay on this phone.`,
  quota: (r) => `Phone storage is full: saved ${r.saved} of ${filesLabel(r.total)}.`,
  offline: (r) => `Connection lost: saved ${r.saved} of ${filesLabel(r.total)}. Update when you’re back online.`,
  network: (r) => `Connection lost: saved ${r.saved} of ${filesLabel(r.total)}. Update when you’re back online.`,
  account: () => 'Stopped: the account changed.',
  auth: () => 'Sign in again to save your files.',
  'signed-out': () => 'Sign in to save an offline copy.',
  worker: () => 'This browser can’t keep an offline copy.',
  server: () => 'Couldn’t reach your files. Try again later.',
  partial: (r) => `Saved ${r.saved} of ${filesLabel(r.total)}. Some couldn’t be downloaded: try Update now later.`,
};

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

// The More row's value: 'On' while this account has a copy on the phone
export async function offlineRowValue() {
  try {
    const st = await getOfflineStatus();
    return st.saved ? 'On' : '';
  } catch { return ''; }
}

export function openOfflineSheet(api, { onClose } = {}) {
  let st = null;
  let plan = null;         // { ok, plan, reason } from planOfflineCopy
  let planning = false;   // a size check is on its way
  let wasSaved = false;
  let confirming = false;
  let alive = true;
  let unsub = null;
  const ui = {};

  let refreshSeq = 0;
  // The newest call wins: an older one that is still waiting drops its answers
  const refresh = async ({ replan = false } = {}) => {
    const seq = ++refreshSeq;
    const next = await getOfflineStatus();
    if (!alive || seq !== refreshSeq) return;
    st = next;
    paint();
    if (!getRunningJob() && st.signedIn && !st.offline && (replan || !plan)) {
      planning = true;
      paint();
      const p = await planOfflineCopy().catch(() => ({ ok: false, reason: 'network' }));
      if (!alive || seq !== refreshSeq) return;
      planning = false;
      plan = p;
      paint();
    }
  };

  function statusRow(label) {
    const dt = el('dt', '', label);
    const dd = el('dd', '', '');
    ui.status.append(dt, dd);
    return dd;
  }

  function build(body) {
    body.classList.add('mx-offline');
    body.appendChild(el('p', 'mx-sheet-note', 'Keeps the app and your files on this phone, so they open without internet. Your dashboard is always on this phone: changes made offline sync when you’re back online.'));

    ui.status = el('dl', 'mx-offline-status');
    ui.app = statusRow('App');
    ui.files = statusRow('Your files');
    ui.updated = statusRow('Updated');
    ui.kept = statusRow('Kept by Android');
    body.appendChild(ui.status);

    ui.plan = el('p', 'mx-offline-plan', '');
    ui.plan.setAttribute('role', 'status');
    body.appendChild(ui.plan);

    ui.progress = el('div', 'mx-offline-progress');
    ui.bar = el('progress', 'mx-offline-bar');
    ui.bar.max = 1;
    ui.bar.value = 0;
    ui.progressText = el('span', 'mx-offline-progress-text', '');
    ui.cancel = el('button', 'mx-btn mx-btn-quiet mx-offline-cancel', 'Cancel');
    ui.cancel.type = 'button';
    ui.cancel.addEventListener('click', () => { const job = getRunningJob(); if (job) job.cancel(); });
    ui.progress.append(ui.bar, ui.progressText, ui.cancel);
    ui.progress.hidden = true;
    body.appendChild(ui.progress);

    ui.actions = el('div', 'mx-offline-actions');
    ui.save = el('button', 'mx-btn mx-btn-primary mx-offline-save', 'Save offline copy');
    ui.save.type = 'button';
    ui.save.addEventListener('click', onSave);
    ui.remove = el('button', 'mx-btn mx-btn-quiet mx-btn-danger mx-offline-remove', 'Remove offline copy');
    ui.remove.type = 'button';
    ui.remove.addEventListener('click', () => { confirming = true; paint(); ui.confirmYes.focus(); });
    ui.actions.append(ui.save, ui.remove);
    body.appendChild(ui.actions);

    ui.confirm = el('div', 'mx-offline-confirm');
    ui.confirm.setAttribute('role', 'group');
    ui.confirmText = el('p', 'mx-offline-confirm-text', 'Remove the offline copy from this phone? Your dashboard and your cloud files stay as they are.');
    const row = el('div', 'mx-offline-confirm-actions');
    ui.confirmYes = el('button', 'mx-btn mx-btn-danger mx-offline-confirm-yes', 'Remove');
    ui.confirmYes.type = 'button';
    ui.confirmYes.addEventListener('click', onRemove);
    const no = el('button', 'mx-btn mx-btn-quiet mx-offline-confirm-no', 'Keep it');
    no.type = 'button';
    no.addEventListener('click', () => { confirming = false; paint(); ui.remove.focus(); });
    row.append(ui.confirmYes, no);
    ui.confirm.append(ui.confirmText, row);
    ui.confirm.hidden = true;
    body.appendChild(ui.confirm);

    body.appendChild(el('h3', 'mx-more-heading mx-offline-heading', 'Not available offline'));
    const limits = el('dl', 'mx-more-nom mx-offline-limits');
    OFFLINE_LIMITS.forEach(([term, desc]) => limits.append(el('dt', '', term), el('dd', '', desc)));
    body.appendChild(limits);
    body.appendChild(el('p', 'mx-more-note', 'While you’re online the copy updates itself every few hours.'));

    paint();
  }

  function planText() {
    const job = getRunningJob();
    if (!st) return '';
    if (job) return '';
    if (!st.signedIn) {
      return st.anyCopy
        ? 'An account saved an offline copy on this phone. Sign in to update or remove it.'
        : 'Sign in to save an offline copy of your files.';
    }
    if (st.offline) return 'You’re offline. Save or update when you’re back online.';
    if (planning || !plan) return 'Checking your files…';
    if (!plan.ok) {
      if (plan.reason === 'auth') return 'Sign in again to save your files.';
      return 'Couldn’t check your files. Try again in a moment.';
    }
    const p = plan.plan;
    let text;
    if (!st.saved) text = p.files.length ? `Saves the app and ${filesLabel(p.files.length)} (${formatBytes(p.totalBytes)}).` : 'Saves the app. Your dashboard has no files to save yet.';
    else if (p.download.length) text = `Update: ${filesLabel(p.download.length)} to download (${formatBytes(p.downloadBytes)}).`;
    else text = p.remove.length ? `Up to date (${filesLabel(p.remove.length)} no longer used will be removed).` : 'Up to date.';
    if (st.quota && p.downloadBytes && st.quota - (st.usage || 0) < p.downloadBytes * 1.1) {
      text += ' There may not be enough free space on this phone for all of it.';
    }
    return text;
  }

  function paint() {
    if (!ui.status) return;
    const job = getRunningJob();
    const s = st || {};
    setText(ui.app, !st ? '…' : s.app ? (s.worker ? 'Saved · opens without internet' : 'Saved') : 'Not saved');
    let files = 'None saved';
    if (s.saved) {
      files = `${filesLabel(s.files)} · ${formatBytes(s.bytes)}`;
      if (s.missing) files += ` · ${s.missing} not saved yet`;
    } else if (!s.signedIn && s.anyCopy) {
      files = 'Saved by an account';
    }
    setText(ui.files, files);
    setText(ui.updated, s.updatedAt ? relativeTime(s.updatedAt) : '—');
    setText(ui.kept, s.persisted === true ? 'Yes' : s.persisted === false ? 'Not guaranteed (Android may clear it when space runs low)' : '—');
    setText(ui.plan, planText());

    ui.progress.hidden = !job;
    if (job) {
      const j = job.state;
      const phase = j.phase === 'app' ? 'The app' : j.phase === 'files' ? 'Your files' : 'Checking';
      const count = j.total ? ` · ${j.done} of ${j.total}` : '';
      const size = j.phase === 'files' && j.totalBytes ? ` · ${formatBytes(j.bytes)} of ${formatBytes(j.totalBytes)}` : '';
      setText(ui.progressText, `${phase}${count}${size}`);
      const value = j.total ? Math.min(1, j.done / j.total) : 0;
      if (ui.bar.value !== value) ui.bar.value = value;
    }

    const canSave = !!(st && s.signedIn && !s.offline && !job && plan && plan.ok);
    setText(ui.save, s.saved ? 'Update now' : 'Save offline copy');
    ui.save.hidden = !!job || !s.signedIn;
    if (ui.save.disabled !== !canSave) ui.save.disabled = !canSave;
    // Signed out: only an app copy no account holds files in can go from here
    const canRemove = !!st && !job && (s.signedIn ? (s.saved || (s.app && !s.otherCopies)) : (s.app && !s.anyCopy));
    ui.remove.hidden = !canRemove || confirming;
    ui.confirm.hidden = !canRemove || !confirming;
  }

  function onSave() {
    if (getRunningJob()) return;
    // Inside the tap: Android ties the persistence request to it
    requestPersistence();
    wasSaved = !!(st && st.saved);
    const job = startOfflineSave();
    paint();
    job.promise.then((r) => {
      if (r.ok) api.toast(wasSaved ? 'Offline copy updated' : 'Offline copy saved');
      else api.toast((RESULT_TEXT[r.reason] || RESULT_TEXT.server)(r));
      // The sheet reads the copy again through onOfflineChange (the run's end)
    });
  }

  async function onRemove() {
    ui.confirmYes.disabled = true;
    let r = null;
    try { r = await removeOfflineCopy(); } catch { r = null; }
    ui.confirmYes.disabled = false;
    confirming = false;
    if (r && r.ok) api.toast(r.othersLeft ? 'Your offline copy was removed. Another account’s copy keeps the app here.' : 'Offline copy removed from this phone');
    else api.toast('Couldn’t remove the offline copy');
    paint();   // the status itself comes back through onOfflineChange
  }

  const onNet = () => refresh({ replan: true });

  const handle = api.openSheet({
    id: 'offline-copy',
    title: 'Offline copy',
    size: 'tall',
    build,
    onClose() {
      alive = false;
      if (unsub) unsub();
      window.removeEventListener('online', onNet);
      window.removeEventListener('offline', onNet);
      if (typeof onClose === 'function') onClose();
    },
  });
  if (handle && handle.el) handle.el.classList.add('mx-offline-sheet');
  let lastPhase = null;
  unsub = onOfflineChange(() => {
    if (!alive) return;
    paint();
    const job = getRunningJob();
    const phase = job ? job.state.phase : null;
    // A run (here or a quiet one) just ended: read the copy again; a new phase
    // (the app saved, the files next): the status line catches up
    if (!job) refresh({ replan: true });
    else if (phase !== lastPhase) refresh();
    lastPhase = phase;
  });
  window.addEventListener('online', onNet);
  window.addEventListener('offline', onNet);
  refresh();
  return handle;
}
