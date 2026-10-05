// Personal Dashboard - Mobile shell: opening R2 files on a phone (unit F5)
// file-service.js openFile() fetches first and then calls window.open(), which
// iOS Safari blocks (the tap's activation is gone after the await), and does
// nothing at all when signed out. On the shell, window.openFile is wrapped at
// mount (restored on unmount; file-service.js is not edited). Every card item
// calls window.openFile synchronously inside its tap, so the wrapper still
// has the user activation:
//   - signed out: a toast "Sign in to open files" with a Sign in action
//   - images: the File sheet (spinner, then the picture, Download and Share)
//   - HTML: a window opened synchronously, then sent to the isolated viewer
//   - PDF and other files: a window opened synchronously, then sent to the
//     blob URL
//   - popup blocked: the File sheet with Download and Share (no iframe)

import { API_BASE } from '../../constants.js';
import { isLoggedIn, getAuthToken } from '../../core/auth.js';
import { fetchFileBlobUrl } from '../../core/file-service.js';

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);
const FILE_SVG = '<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';

let api = null;
let original = null;

const extOf = (name) => {
  const m = /\.([a-z0-9]+)$/i.exec(String(name || '').trim());
  return m ? m[1].toLowerCase() : '';
};

export function initFileSheet(shellApi) {
  api = shellApi;
}

export function installFileOpener() {
  if (window.openFile === openFileMobile) return;
  original = window.openFile;
  window.openFile = openFileMobile;
}

export function uninstallFileOpener() {
  if (window.openFile === openFileMobile) window.openFile = original;
  original = null;
}

function toast(message, actions) {
  if (api) api.toast(message, actions);
  else if (window.showToast) window.showToast(message);
}

function openSignIn() {
  const btn = document.getElementById('auth-toggle');
  if (btn) btn.click();
}

// A synchronously opened, still blank window (null when the popup is blocked)
function openBlankWindow() {
  try { return window.open('about:blank', '_blank'); } catch { return null; }
}

export function openFileMobile(fileId, fileName) {
  if (!fileId) return;
  if (!isLoggedIn()) {
    toast('Sign in to open files', [{ label: 'Sign in', run: openSignIn }]);
    return;
  }
  const ext = extOf(fileName);
  if (IMAGE_EXT.has(ext)) {
    openFileSheet({ fileId, fileName, image: true });
    return;
  }
  const w = openBlankWindow();
  if (!w) {
    openFileSheet({ fileId, fileName, image: false, blocked: true });
    return;
  }
  if (ext === 'html' || ext === 'htm') openHtmlIn(w, fileId);
  else openBlobIn(w, fileId, fileName);
}

async function openHtmlIn(w, fileId) {
  try {
    const res = await fetch(`${API_BASE}/files/${encodeURIComponent(fileId)}/view-link`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${getAuthToken()}`, 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error(`view-link ${res.status}`);
    const data = await res.json();
    if (!data || !data.url) throw new Error('no viewer url');
    try { w.opener = null; } catch { /* already detached */ }
    w.location.href = data.url;
  } catch {
    try { w.close(); } catch { /* gone */ }
    toast('Couldn’t open the file');
  }
}

async function openBlobIn(w, fileId, fileName) {
  const blobUrl = await fetchFileBlobUrl(fileId);
  if (blobUrl && !w.closed) {
    try { w.location.href = blobUrl; return; } catch { /* fall through to the sheet */ }
  }
  try { w.close(); } catch { /* gone */ }
  if (blobUrl) openFileSheet({ fileId, fileName, image: false, blocked: true });
  else toast('Couldn’t open the file');
}

// The in-app File sheet: the picture (images) or a file card, with Download
// and, where the browser can share files, Share / Save
export function openFileSheet({ fileId, fileName, image = false, blocked = false } = {}) {
  if (!api) return null;
  const name = fileName || 'File';
  return api.openSheet({
    id: 'file',
    title: name,
    size: 'auto',
    build(body, sheet) {
      sheet.el.classList.add('mx-file-sheet');
      const stage = document.createElement('div');
      stage.className = 'mx-file-stage';
      stage.setAttribute('aria-busy', 'true');
      const spinner = document.createElement('span');
      spinner.className = 'mx-spinner';
      spinner.setAttribute('role', 'status');
      spinner.setAttribute('aria-label', 'Loading');
      stage.appendChild(spinner);
      body.appendChild(stage);
      if (blocked && !image) {
        const note = document.createElement('p');
        note.className = 'mx-sheet-note';
        note.textContent = 'This browser blocked the new tab. Download or share the file instead.';
        body.appendChild(note);
      }
      const actions = document.createElement('div');
      actions.className = 'mx-file-actions';
      body.appendChild(actions);

      fetchFileBlobUrl(fileId).then(async (blobUrl) => {
        if (!stage.isConnected) return;
        stage.removeAttribute('aria-busy');
        spinner.remove();
        if (!blobUrl) {
          const p = document.createElement('p');
          p.className = 'mx-file-error';
          p.textContent = 'Couldn’t load this file. Check your connection and try again.';
          stage.appendChild(p);
          return;
        }
        if (image) {
          const img = document.createElement('img');
          img.className = 'mx-file-img';
          img.alt = name;
          img.src = blobUrl;
          stage.appendChild(img);
        } else {
          const card = document.createElement('div');
          card.className = 'mx-file-card';
          card.innerHTML = FILE_SVG;
          const t = document.createElement('span');
          t.className = 'mx-file-name';
          t.textContent = name;
          card.appendChild(t);
          stage.appendChild(card);
        }
        const dl = document.createElement('a');
        dl.className = 'mx-btn';
        dl.href = blobUrl;
        dl.download = name;
        dl.textContent = 'Download';
        actions.appendChild(dl);
        // Share / Save: the File object is ready before the tap, so share()
        // runs synchronously inside it
        let file = null;
        try {
          const blob = await (await fetch(blobUrl)).blob();
          file = new File([blob], name, { type: blob.type || '' });
        } catch { file = null; }
        if (file && navigator.share && navigator.canShare && navigator.canShare({ files: [file] }) && actions.isConnected) {
          const share = document.createElement('button');
          share.type = 'button';
          share.className = 'mx-btn mx-btn-primary';
          share.textContent = 'Share / Save';
          share.addEventListener('click', () => {
            navigator.share({ files: [file], title: name }).catch(() => { /* cancelled */ });
          });
          actions.appendChild(share);
        }
      });
    },
  });
}
