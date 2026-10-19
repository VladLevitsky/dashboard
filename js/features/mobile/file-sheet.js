// Personal Dashboard - Mobile shell: opening R2 files on a phone (unit F5)
// file-service.js openFile() fetches first and then calls window.open(), which
// iOS Safari blocks (the tap's activation is gone after the await), and does
// nothing at all when signed out. On the shell, window.openFile is wrapped at
// mount (restored on unmount; file-service.js is not edited). Every caller
// (card items, the item sheet, Quick Access, Today, the calendar, the task
// editor, meeting files) calls window.openFile synchronously inside its tap,
// so the wrapper still has the user activation:
//   - signed out: a toast "Sign in to open files" with a Sign in action
//   - images: the full-screen viewer (below)
//   - HTML: a window opened synchronously, then sent to the isolated viewer
//     worker (never a blob: URL, which would run in the app's own origin)
//   - PDF and other files: a window opened synchronously, then sent to the
//     blob URL
//   - popup blocked: the viewer's file card (Open in a fresh tap, Download, Share)
//
// The viewer: one at a time, appended to <body> at z 10050 (mobile-links.css
// §3), the one exception to the shell's < 1000 z plan, so it shows over the
// writer frames, the calendar and meetings it is often opened from (a sheet
// at 950 opened hidden under them). The picture fits the screen; a pinch, a
// double tap or the mouse wheel (preview) zooms, one finger pans a zoomed
// picture, and at fit a vertical swipe closes it, as do Back (a shell layer:
// Back closes only the viewer, an editor under it stays open), Escape and ×.
// A single tap hides / shows the bar (name, Share where the browser can share
// files, Download). Every per-frame move goes through api.createMover and
// paused Web Animations (no style writes per frame: glass-glow.js watches the
// document); the whole viewer takes every touch (touch-action: none, its bar
// too), so a pinch never zooms the page under it. The viewer keeps its own
// object URL (revoked a minute after it closes), so Download and Share
// outlive the file cache.

import { API_BASE } from '../../constants.js';
import { isLoggedIn, getAuthToken } from '../../core/auth.js';
import { fetchFileBlobUrl, isFileMissing } from '../../core/file-service.js';

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);
const icon = (body, size = 22) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
const FILE_SVG = '<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
const CLOSE_SVG = icon('<path d="M18 6 6 18M6 6l12 12"/>');
const SHARE_SVG = icon('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>', 21);
const DOWNLOAD_SVG = icon('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>', 21);
const OPEN_SVG = icon('<path d="M15 3h6v6M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>', 18);

// Gesture tuning
const SLOP = 8;              // px a finger moves before it pans / swipes instead of tapping
const TAP_MS = 300;          // a second tap this soon after the first is a double tap
const TAP_PX = 30;           // ... and this close to it
const DOUBLE_SCALE = 2.5;    // double tap zooms to this (capped by the picture's own maximum)
const DISMISS_PX = 120;      // a swipe this far closes the viewer
const FLING = 0.5;           // px/ms: a quicker flick closes it from 24px
const FADE_MS = 1000;        // length of the paused swipe fades (driven through currentTime)
const REVOKE_MS = 60000;     // the viewer's own URL outlives it a little (a Download just started)

let api = null;
let original = null;
let current = null;          // the open viewer's handle

const extOf = (name) => {
  const m = /\.([a-z0-9]+)$/i.exec(String(name || '').trim());
  return m ? m[1].toLowerCase() : '';
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
// Past a pan limit the picture follows the finger at a third of the speed
const rubber = (v, lim) => (v > lim ? lim + (v - lim) * 0.35 : v < -lim ? -lim + (v + lim) * 0.35 : v);

export function initFileSheet(shellApi) {
  api = shellApi;
}

export function installFileOpener() {
  if (window.openFile === openFileMobile) return;
  original = window.openFile;
  window.openFile = openFileMobile;
}

export function uninstallFileOpener() {
  closeViewer({ immediate: true });
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
    openViewer({ fileId, fileName, mode: 'image' });
    return;
  }
  const w = openBlankWindow();
  if (!w) {
    openViewer({ fileId, fileName, mode: 'file', blocked: true });
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
    try { w.location.href = blobUrl; return; } catch { /* fall through to the file card */ }
  }
  try { w.close(); } catch { /* gone */ }
  if (blobUrl) openViewer({ fileId, fileName, mode: 'file', blocked: true });
  else toast('Couldn’t open the file');
}

export function closeViewer(opts) {
  if (current) current.close(opts);
}

export function isViewerOpen() {
  return !!current;
}

function make(tag, className) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  return el;
}

function iconButton(className, label, svg) {
  const b = make('button', `mx-viewer-btn ${className}`);
  b.type = 'button';
  b.setAttribute('aria-label', label);
  b.title = label;
  b.innerHTML = svg;
  return b;
}

// The viewer. mode 'image': the picture, zoomable; mode 'file': a file card
// with Open (a fresh tap, so a new window is allowed), for a blocked popup.
// Built synchronously inside the tap (the Back entry is pushed with its user
// activation); the bytes arrive later.
export function openViewer({ fileId, fileName, mode = 'image', blocked = false } = {}) {
  if (!api || !fileId) return null;
  if (current) current.close({ immediate: true });
  const name = String(fileName || '').trim() || 'File';
  const ext = extOf(name);
  const opener = document.activeElement;

  const el = make('div', 'mx-viewer');
  el.dataset.mode = mode;
  el.dataset.chrome = 'on';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', name);
  el.tabIndex = -1;
  const backdrop = make('div', 'mx-viewer-backdrop');
  const stage = make('div', 'mx-viewer-stage');
  const bar = make('header', 'mx-viewer-bar');
  const closeBtn = iconButton('mx-viewer-close', 'Close', CLOSE_SVG);
  const title = make('h2', 'mx-viewer-title');
  title.textContent = name;
  const actions = make('div', 'mx-viewer-actions');
  bar.append(closeBtn, title, actions);
  el.append(backdrop, stage, bar);

  const v = { closed: false, ready: false, blob: null, ownUrl: null, cachedUrl: null, img: null, mover: null, nw: 1, nh: 1 };
  let unregister = null;

  // --- Close ------------------------------------------------------------------

  // Back to the control that opened the viewer, unless the focus moved on, or
  // the opener is a text field (the keyboard would come up in a writer frame)
  function restoreFocus() {
    const active = document.activeElement;
    if (active && active !== document.body && !el.contains(active)) return;
    if (!opener || opener === document.body || !opener.isConnected || el.contains(opener)) return;
    if (opener.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(opener.tagName)) return;
    if (opener.closest('[inert], [hidden], [aria-hidden="true"]')) return;
    try { opener.focus({ preventScroll: true }); } catch { /* gone */ }
  }

  // dismissed: a swipe let go past the threshold, so the picture leaves from
  // where the finger left it
  function close({ immediate = false, dismissed = false } = {}) {
    if (v.closed) return;
    v.closed = true;
    if (current === handle) current = null;
    stopTween();
    clearTimeout(tapTimer);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('orientationchange', onResize);
    if (unregister) { unregister(); unregister = null; }
    api.syncHistory();
    restoreFocus();
    const url = v.ownUrl;
    const done = () => {
      el.remove();
      if (url) setTimeout(() => URL.revokeObjectURL(url), REVOKE_MS);
    };
    if (immediate || api.reduceMotion()) { done(); return; }
    el.inert = true;
    el.dataset.closing = '1';
    const a = api.animate(el, [{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: 'ease-in' });
    if (dismissed && v.img) {
      const drop = (box ? box.h : 400) * 0.25;
      api.animate(v.img, [{ transform: transformOf(z.x, z.y, z.s) }, { transform: transformOf(z.x, z.y + drop, z.s * 0.96) }],
        { duration: 160, easing: 'ease-in' });
    }
    // The resting opacity is 0, so nothing flashes back when the fill-less
    // animation ends a frame before the removal
    el.style.opacity = '0';
    if (a) { a.onfinish = done; a.oncancel = done; } else done();
  }

  const handle = { el, close, get isOpen() { return !v.closed; } };

  // --- Loading ----------------------------------------------------------------

  function setStage(...nodes) {
    stage.replaceChildren(...nodes);
  }

  function showSpinner() {
    const spinner = make('span', 'mx-spinner');
    spinner.setAttribute('role', 'status');
    spinner.setAttribute('aria-label', 'Loading');
    stage.setAttribute('aria-busy', 'true');
    setStage(spinner);
  }

  function fail(kind) {
    stage.removeAttribute('aria-busy');
    const msg = make('div', 'mx-viewer-msg');
    const p = make('p');
    const what = mode === 'image' ? 'image' : 'file';
    if (kind === 'missing') p.textContent = `This ${what} isn’t in your cloud files any more.`;
    else if (kind === 'decode') p.textContent = 'This image can’t be shown here. Download or share it instead.';
    else p.textContent = `Couldn’t load this ${what}. Check your connection and try again.`;
    msg.appendChild(p);
    if (kind === 'network') {
      const retry = make('button', 'mx-viewer-pill');
      retry.type = 'button';
      retry.textContent = 'Try again';
      retry.addEventListener('click', () => { load(); });
      msg.appendChild(retry);
    }
    setStage(msg);
  }

  // Share (where the browser can share files) and Download, once the bytes
  // are here. The File is built now, so share() runs inside its own tap
  function addActions() {
    if (actions.childElementCount) return;
    let file = null;
    try { file = new File([v.blob], name, { type: v.blob.type || '' }); } catch { file = null; }
    let canShare = false;
    try { canShare = !!(file && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })); } catch { canShare = false; }
    if (canShare) {
      const share = iconButton('mx-viewer-share', 'Share', SHARE_SVG);
      share.addEventListener('click', () => {
        navigator.share({ files: [file], title: name }).catch((err) => {
          if (!err || err.name !== 'AbortError') toast('Couldn’t share this file');
        });
      });
      actions.appendChild(share);
    }
    const dl = make('a', 'mx-viewer-btn mx-viewer-download');
    dl.href = v.ownUrl;
    dl.download = name;
    dl.setAttribute('aria-label', 'Download');
    dl.title = 'Download';
    dl.innerHTML = DOWNLOAD_SVG;
    actions.appendChild(dl);
  }

  // Open outside the app (file mode), inside this tap
  function openOutside() {
    if (ext === 'html' || ext === 'htm') {
      const w = openBlankWindow();
      if (!w) { toast('The browser blocked the new tab. Download or share the file instead.'); return; }
      openHtmlIn(w, fileId);
      close();
      return;
    }
    let w = null;
    try { w = window.open(v.cachedUrl || v.ownUrl, '_blank'); } catch { w = null; }
    if (!w) { toast('The browser blocked the new tab. Download or share the file instead.'); return; }
    close();
  }

  function showFileCard() {
    stage.removeAttribute('aria-busy');
    const card = make('div', 'mx-viewer-file');
    card.innerHTML = FILE_SVG;
    const n = make('p', 'mx-viewer-file-name');
    n.textContent = name;
    card.appendChild(n);
    if (blocked) {
      const note = make('p', 'mx-viewer-note');
      note.textContent = 'The browser blocked the new tab. Open it again, or download or share the file.';
      card.appendChild(note);
    }
    const open = make('button', 'mx-viewer-pill is-primary');
    open.type = 'button';
    open.innerHTML = `${OPEN_SVG}<span>Open</span>`;
    open.addEventListener('click', openOutside);
    card.appendChild(open);
    setStage(card);
  }

  async function load() {
    showSpinner();
    const cached = await fetchFileBlobUrl(fileId);
    let blob = null;
    if (cached && !v.closed) {
      try {
        const res = await fetch(cached);
        if (res.ok) blob = await res.blob();
      } catch { blob = null; }
    }
    if (v.closed) return;
    if (!blob) { fail(isFileMissing(fileId) ? 'missing' : 'network'); return; }
    v.blob = blob;
    v.cachedUrl = cached;
    v.ownUrl = URL.createObjectURL(blob);
    addActions();
    if (mode !== 'image') { showFileCard(); return; }
    const img = make('img', 'mx-viewer-img');
    img.alt = name;
    img.draggable = false;
    img.src = v.ownUrl;
    try {
      if (img.decode) await img.decode();
      else await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; });
    } catch {
      if (!v.closed) fail('decode');
      return;
    }
    if (v.closed) return;
    v.nw = img.naturalWidth || 1;
    v.nh = img.naturalHeight || 1;
    stage.removeAttribute('aria-busy');
    setStage(img);
    v.img = img;
    v.mover = api.createMover(img);
    v.ready = true;
  }

  // --- View state and motion -----------------------------------------------------
  // z = the picture's transform (origin: its centre = the stage centre). The
  // picture is laid out to fill the stage with object-fit: contain, so at
  // scale s the painted image is fit size × s, centred at the stage centre + (x, y).

  const z = { s: 1, x: 0, y: 0 };
  let box = null;              // stage geometry, read when a gesture starts
  let tween = 0;

  const transformOf = (x, y, s) => `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${s})`;

  function apply(s, x, y) {
    z.s = s; z.x = x; z.y = y;
    if (!v.mover) return;
    if (s === 1 && x === 0 && y === 0) v.mover.release();   // at rest: no transform left behind
    else v.mover.moveTo(x, y, s);
  }

  // One layout read (the viewer box; its stage fills it and is never transformed)
  function measure() {
    const r = el.getBoundingClientRect();
    const w = Math.max(1, r.width);
    const h = Math.max(1, r.height);
    const fit = Math.min(w / v.nw, h / v.nh);
    const fw = v.nw * fit;
    const fh = v.nh * fit;
    // Up to twice the picture's own pixels, at least 3×, at most 8×
    box = { cx: r.left + w / 2, cy: r.top + h / 2, w, h, fw, fh, max: clamp((v.nw / fw) * 2, 3, 8) };
    return box;
  }

  const limits = (s) => ({ x: Math.max(0, (box.fw * s - box.w) / 2), y: Math.max(0, (box.fh * s - box.h) / 2) });

  // The translation that keeps the point under (px, py) still while the scale
  // goes from z.s to s, kept inside the pan limits
  function zoomTarget(px, py, s) {
    const qx = px - box.cx;
    const qy = py - box.cy;
    const lim = limits(s);
    return {
      x: clamp(qx - (qx - z.x) * s / z.s, -lim.x, lim.x),
      y: clamp(qy - (qy - z.y) * s / z.s, -lim.y, lim.y),
    };
  }

  function stopTween() {
    if (tween) { cancelAnimationFrame(tween); tween = 0; }
  }

  // A short eased glide that writes only the mover
  function tweenTo(s1, x1, y1, ms = 200) {
    stopTween();
    const from = { ...z };
    const still = Math.abs(from.s - s1) < 1e-3 && Math.abs(from.x - x1) < 0.5 && Math.abs(from.y - y1) < 0.5;
    if (still || api.reduceMotion()) { apply(s1, x1, y1); return; }
    const t0 = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      if (k >= 1) { tween = 0; apply(s1, x1, y1); return; }
      const e = 1 - (1 - k) ** 3;
      apply(from.s + (s1 - from.s) * e, from.x + (x1 - from.x) * e, from.y + (y1 - from.y) * e);
      tween = requestAnimationFrame(step);
    };
    tween = requestAnimationFrame(step);
  }

  // Back inside the limits (scale 1 … max) after a pinch or a pan; anchor =
  // where the fingers last were (the pinch midpoint, then the finger left
  // panning), so an over-zoom settles about them
  function settle(anchor) {
    measure();
    let s = clamp(z.s, 1, box.max);
    let x = z.x;
    let y = z.y;
    if (s < 1.01) {
      s = 1; x = 0; y = 0;
    } else if (s !== z.s && anchor) {
      ({ x, y } = zoomTarget(anchor.x, anchor.y, s));
    } else {
      const lim = limits(s);
      x = clamp(x, -lim.x, lim.x);
      y = clamp(y, -lim.y, lim.y);
    }
    tweenTo(s, x, y, 180);
  }

  function zoomBy(factor, px, py) {
    if (!v.ready) return;
    stopTween();
    measure();
    const s = clamp(z.s * factor, 1, box.max);
    if (s <= 1.001) { tweenTo(1, 0, 0, 160); return; }
    const t = zoomTarget(px ?? box.cx, py ?? box.cy, s);
    tweenTo(s, t.x, t.y, 160);
  }

  function toggleZoom(px, py) {
    measure();
    if (z.s > 1.01) { tweenTo(1, 0, 0); return; }
    const s = Math.min(DOUBLE_SCALE, box.max);
    const t = zoomTarget(px, py, s);
    tweenTo(s, t.x, t.y);
  }

  // One attribute per tap (not one glass-glow watches)
  function toggleChrome() {
    if (v.closed) return;
    el.dataset.chrome = el.dataset.chrome === 'off' ? 'on' : 'off';
  }

  // --- Swipe to close ---------------------------------------------------------------
  // The backdrop (and the bar) fade through paused animations whose
  // currentTime follows the finger

  let fade = null;
  let barFade = null;

  function pausedFade(target, to) {
    try {
      const a = target.animate([{ opacity: 1 }, { opacity: to }], { duration: FADE_MS, fill: 'both' });
      a.pause();
      a.currentTime = 0;
      return a;
    } catch {
      return null;
    }
  }

  function dropFades() {
    [fade, barFade].forEach(a => { if (a) { try { a.cancel(); } catch { /* gone */ } } });
    fade = barFade = null;
  }

  function startDismiss() {
    dropFades();
    fade = pausedFade(backdrop, 0.1);
    if (el.dataset.chrome !== 'off') barFade = pausedFade(bar, 0);
  }

  function moveDismiss(dx, dy) {
    const y = dy > 0 ? dy : dy * 0.3;
    const p = Math.min(1, Math.max(0, y) / (box.h * 0.45));
    apply(1 - 0.12 * p, dx, y);
    if (fade) fade.currentTime = p * FADE_MS;
    if (barFade) barFade.currentTime = Math.min(1, p * 3) * FADE_MS;
  }

  function endDismiss(vy, cancelled) {
    if (!cancelled && (z.y > DISMISS_PX || (z.y > 24 && vy > FLING))) {
      close({ dismissed: true });
      return;
    }
    const k = fade ? (fade.currentTime || 0) / FADE_MS : 0;
    const kb = barFade ? (barFade.currentTime || 0) / FADE_MS : 0;
    dropFades();
    if (k > 0) api.animate(backdrop, [{ opacity: 1 - 0.9 * k }, { opacity: 1 }], { duration: 160 });
    if (kb > 0) api.animate(bar, [{ opacity: 1 - kb }, { opacity: 1 }], { duration: 160 });
    tweenTo(1, 0, 0, 160);
  }

  // Downward speed over the last 100 ms of the swipe (px/ms)
  function speed(samples) {
    if (samples.length < 2) return 0;
    const last = samples[samples.length - 1];
    const first = samples.find(s => last.t - s.t <= 100) || samples[0];
    return last.t > first.t ? (last.y - first.y) / (last.t - first.t) : 0;
  }

  // --- Pointers -----------------------------------------------------------------------
  // One finger: tap / double tap, pan (zoomed) or swipe (at fit). Two: pinch
  // about their midpoint, which also pans; lifting one carries on as a pan
  // from where the pinch left the picture (lim: rubber limits that already
  // take in a pinch past the pan limits, so nothing jumps under the finger;
  // the release glides it back inside).

  const pointers = new Map();
  let g = null;                // the gesture under way
  let tapTimer = 0;
  let lastTap = null;          // { x, y, t: when it lifted }

  function startPinch() {
    const [a, b] = [...pointers.values()];
    const m = mid(a, b);
    g = { kind: 'pinch', d0: Math.max(1, dist(a, b)), m0: m, last: m, s0: z.s, tx0: z.x, ty0: z.y, multi: true };
  }

  function onDown(e) {
    if (!v.ready || v.closed) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    stopTween();
    if (!pointers.size) measure();
    try { stage.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      g = { kind: null, x0: e.clientX, y0: e.clientY, t0: e.timeStamp, tx0: z.x, ty0: z.y, multi: false, samples: [] };
    } else if (pointers.size === 2) {
      // A second finger mid-swipe: the swipe is dropped, the pinch starts at fit
      if (g && g.kind === 'dismiss') { dropFades(); apply(1, 0, 0); }
      startPinch();
    }
  }

  function onMove(e) {
    const p = pointers.get(e.pointerId);
    if (!p || !g) return;
    p.x = e.clientX;
    p.y = e.clientY;
    if (g.kind === 'pinch') {
      if (pointers.size < 2) return;
      const [a, b] = [...pointers.values()];
      const m = mid(a, b);
      let s = g.s0 * dist(a, b) / g.d0;
      if (s < 1) s = Math.max(0.5, 1 - (1 - s) * 0.5);
      else if (s > box.max) s = box.max + (s - box.max) * 0.3;
      const qx = g.m0.x - box.cx;
      const qy = g.m0.y - box.cy;
      g.last = m;
      apply(s, (m.x - box.cx) - (qx - g.tx0) * s / g.s0, (m.y - box.cy) - (qy - g.ty0) * s / g.s0);
      return;
    }
    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    if (!g.kind) {
      if (Math.hypot(dx, dy) < SLOP) return;
      g.kind = z.s > 1.01 ? 'pan' : Math.abs(dy) > Math.abs(dx) ? 'dismiss' : 'none';
      if (g.kind === 'dismiss') startDismiss();
    }
    if (g.kind === 'pan') {
      const lim = g.lim || limits(z.s);
      if (g.anchor) g.anchor = { x: e.clientX, y: e.clientY };
      apply(z.s, rubber(g.tx0 + dx, lim.x), rubber(g.ty0 + dy, lim.y));
    } else if (g.kind === 'dismiss') {
      g.samples.push({ y: e.clientY, t: e.timeStamp });
      if (g.samples.length > 8) g.samples.shift();
      moveDismiss(dx, dy);
    }
  }

  function onUp(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    try { stage.releasePointerCapture(e.pointerId); } catch { /* released */ }
    if (!g) return;
    const cancelled = e.type === 'pointercancel';
    if (g.kind === 'pinch') {
      if (pointers.size === 1) {
        const [r] = [...pointers.values()];
        const l = limits(z.s);
        g = {
          kind: z.s > 1.01 ? 'pan' : 'none', x0: r.x, y0: r.y, t0: e.timeStamp, tx0: z.x, ty0: z.y, multi: true, samples: [],
          lim: { x: Math.max(l.x, Math.abs(z.x)), y: Math.max(l.y, Math.abs(z.y)) }, anchor: { x: r.x, y: r.y },
        };
      } else if (!pointers.size) {
        const anchor = g.last;
        g = null;
        settle(anchor);
      }
      return;
    }
    if (pointers.size) return;
    const gest = g;
    g = null;
    if (gest.kind === 'dismiss') { endDismiss(speed(gest.samples), cancelled); return; }
    if (gest.kind) { settle(gest.anchor); return; }
    if (cancelled || gest.multi || e.timeStamp - gest.t0 > 400) return;
    // A tap: a second one soon after and close by zooms; alone, it toggles the bar
    if (lastTap && gest.t0 - lastTap.t < TAP_MS && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < TAP_PX) {
      clearTimeout(tapTimer);
      tapTimer = 0;
      lastTap = null;
      toggleZoom(e.clientX, e.clientY);
      return;
    }
    lastTap = { x: e.clientX, y: e.clientY, t: e.timeStamp };
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => { tapTimer = 0; lastTap = null; toggleChrome(); }, TAP_MS);
  }

  // Mouse wheel / trackpad (the desktop preview): zoom about the cursor
  function onWheel(e) {
    if (!v.ready || v.closed) return;
    e.preventDefault();
    stopTween();
    measure();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? box.h : 1;
    const s = clamp(z.s * Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.002)), 1, box.max);
    if (s <= 1.001) { apply(1, 0, 0); return; }
    const t = zoomTarget(e.clientX, e.clientY, s);
    apply(s, t.x, t.y);
  }

  // A new screen size: back to fit
  function onResize() {
    stopTween();
    pointers.clear();
    g = null;
    dropFades();
    apply(1, 0, 0);
  }

  // Escape closes the viewer before anything under it sees the key (the
  // preview's layer Escape, the calendar's own); keys aimed at a window opened
  // over it (help) are left alone. Tab stays inside; + − 0 zoom.
  function onKey(e) {
    if (v.closed) return;
    const t = e.target;
    const ours = t === document.body || t === document.documentElement || (t instanceof Node && el.contains(t));
    if (!ours) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key === 'Tab') {
      const list = [...el.querySelectorAll('button, a[href]')].filter(n => n.getClientRects().length);
      if (!list.length) return;
      const i = list.indexOf(document.activeElement);
      const next = e.shiftKey ? (i <= 0 ? list.length - 1 : i - 1) : (i < 0 || i === list.length - 1 ? 0 : i + 1);
      e.preventDefault();
      list[next].focus();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey || !v.ready) return;
    const zoom = { '+': 1.5, '=': 1.5, '-': 1 / 1.5, _: 1 / 1.5 }[e.key];
    if (zoom) zoomBy(zoom);
    else if (e.key === '0') tweenTo(1, 0, 0, 160);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  // --- Wire up ------------------------------------------------------------------------

  closeBtn.addEventListener('click', () => close());
  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerup', onUp);
  stage.addEventListener('pointercancel', onUp);
  stage.addEventListener('wheel', onWheel, { passive: false });
  stage.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  document.body.appendChild(el);
  current = handle;
  // A shell layer: Back (and, in the preview, Escape) closes it first, as it
  // stacks above every reused modal. The entry is pushed now, inside the tap
  unregister = api.registerLayer({
    id: 'file-viewer', kind: 'shell',
    root: () => el, isOpen: () => !v.closed, back: () => close(),
  });
  api.syncHistory();
  api.animate(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
  api.animate(stage, [{ transform: 'scale(0.96)' }, { transform: 'scale(1)' }], { duration: 200 });
  try { el.focus({ preventScroll: true }); } catch { /* not focusable */ }
  load();
  return handle;
}
