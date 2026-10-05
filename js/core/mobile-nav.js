// Personal Dashboard - Mobile back-button rules (pure, Node-testable)
// The shell keeps ONE history entry per open layer (sheet, modal, editor),
// plus one base entry while a tab other than Tasks is showing. These helpers
// decide how to bring the history depth in line, which layer is on top, and
// what a Back press does. The DOM side lives in js/features/mobile/layers.js.

// How to move from `depth` entries to `want` entries
export function planHistory({ depth = 0, want = 0 } = {}) {
  const d = Math.max(0, depth | 0);
  const w = Math.max(0, want | 0);
  if (w > d) return { push: w - d };
  if (w < d) return { back: d - w };
  return {};
}

// open: [{ id, z, openedAt }] -> the one on top: highest z, ties go to the
// most recently opened (null when nothing is open)
export function pickTopLayer(open) {
  if (!Array.isArray(open) || !open.length) return null;
  let top = null;
  for (const layer of open) {
    if (!layer) continue;
    const z = Number.isFinite(layer.z) ? layer.z : 0;
    const t = Number.isFinite(layer.openedAt) ? layer.openedAt : 0;
    if (!top) { top = layer; continue; }
    const tz = Number.isFinite(top.z) ? top.z : 0;
    const tt = Number.isFinite(top.openedAt) ? top.openedAt : 0;
    if (z > tz || (z === tz && t >= tt)) top = layer;
  }
  return top;
}

// What one Back press does: close the top layer, go back to the home tab,
// or nothing (the browser leaves the app)
export function planBack({ top = null, tab = 'tasks', home = 'tasks' } = {}) {
  if (top) return 'close';
  if (tab && tab !== home) return 'home';
  return 'exit';
}
