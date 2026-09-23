// Visual-only enhancement: match button blooms to their rendered colors,
// including user-selected swatches and controls created inside lazy modals.
// No model writes, timers or changes to click/focus behavior.
// Matrix tasks have dedicated priority-aware CSS; sampling their neutral glass
// background here would replace that treatment with the generic button glow.
const controls = 'button, [role="button"], .timer-circle, .notification-badge, .icon-button, .unified-subtask-item, .unified-copypaste-item, .list-item, .copy-paste-item';
const pending = new Set();
const ownStyles = new WeakMap();
let frame = 0;
const copyColorStyle = document.createElement('span').style;

function copyMaterialColor(value) {
  // Let CSS normalize supported hex/rgb/hsl inputs without adding a DOM node.
  copyColorStyle.color = '';
  copyColorStyle.color = value;
  const css = copyColorStyle.color;
  const parts = css.match(/[\d.]+/g)?.map(Number);
  if (!css.startsWith('rgb') || !parts || parts.length < 3) return null;
  const rgb = parts.slice(0, 3), alpha = parts[3] ?? 1;
  if (alpha <= 0) return null;
  // Only the emitted edge light is brightened. The core remains the input.
  const edge = rgb.map(channel => Math.round(channel + (255 - channel) * 0.28)).join(' ');
  const canvas = document.body.dataset.theme === 'dark' ? [34, 40, 50] : [207, 208, 210];
  const linear = rgb.map((channel, index) => {
    const value = (channel * alpha + canvas[index] * (1 - alpha)) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  const ink = (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#000' : '#fff';
  return {css, edge, ink, alpha};
}

function luminousColor(value) {
  // getComputedStyle serializes the dashboard's hex/rgb colors to rgb(a).
  const parts = value.match(/[\d.]+/g)?.map(Number);
  if (!value.startsWith('rgb') || !parts || parts.length < 3 || parts[3] === 0) return null;
  const [r, g, b] = parts.map(n => n / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const delta = max - min, light = (max + min) / 2;
  const saturation = delta / (1 - Math.abs(2 * light - 1));
  // Ignore neutral silver, white, gray text and nearly neutral slate surfaces.
  if (delta < 0.045 || saturation < 0.32 || (max < 0.24 && delta < 0.16)) return null;
  let hue = max === r ? ((g - b) / delta + (g < b ? 6 : 0)) : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  hue /= 6;
  const s = Math.max(0.72, Math.min(0.9, saturation));
  const l = 0.56;
  const a = s * Math.min(l, 1 - l);
  return [0, 8, 4].map(n => {
    const k = (n + hue * 12) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  }).join(' ');
}

function updateControl(element) {
  if (!element.isConnected || !element.getClientRects().length) return;
  const style = getComputedStyle(element);
  if (element.matches('.unified-copypaste-item:not(.add-tile), .copy-paste-item:not(.add-tile)')) {
    // Read the renderer's inline source, not our layered CSS output. This
    // avoids feedback and keeps color changes / return-to-neutral reliable.
    const source = element.dataset.originalColor || element.style.backgroundColor || style.backgroundColor;
    const color = copyMaterialColor(source);
    if (color && (element.classList.contains('color-swatch') || luminousColor(color.css))) {
      element.style.setProperty('--copy-base', color.css);
      element.style.setProperty('--copy-ink', color.ink);
      element.style.setProperty('--copy-alpha', String(color.alpha));
      element.style.setProperty('--control-glow-rgb', color.edge);
      element.setAttribute('data-glass-glow', 'material');
    } else {
      ['--control-glow-rgb', '--copy-base', '--copy-ink', '--copy-alpha'].forEach(property => element.style.removeProperty(property));
      element.removeAttribute('data-glass-glow');
    }
    ownStyles.set(element, element.getAttribute('style'));
    return;
  }
  // Background first, then colored icons/text on otherwise neutral buttons.
  // The sticky-note launcher expresses its chosen color through an SVG fill.
  const stickyFill = element.matches('.sticky-note-btn') ? style.getPropertyValue('--sticky-icon-body').trim() : '';
  const surfaceColor = luminousColor(stickyFill) || luminousColor(style.backgroundColor);
  const color = surfaceColor || luminousColor(style.color);
  if (color) {
    if (element.style.getPropertyValue('--control-glow-rgb') !== color) element.style.setProperty('--control-glow-rgb', color);
    element.setAttribute('data-glass-glow', surfaceColor ? 'surface' : 'ink');
  } else {
    element.style.removeProperty('--control-glow-rgb');
    element.removeAttribute('data-glass-glow');
  }
  ownStyles.set(element, element.getAttribute('style'));
}

function queue(root) {
  if (!(root instanceof Element)) return;
  if (root.matches(controls)) pending.add(root);
  root.querySelectorAll(controls).forEach(element => pending.add(element));
  if (!pending.size || frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    const batch = [...pending];
    pending.clear();
    batch.forEach(updateControl);
  });
}

const observer = new MutationObserver(records => {
  for (const record of records) {
    if (record.type === 'childList') {
      record.addedNodes.forEach(queue);
    } else {
      // Ignore our own CSS variable writes; all other changes are batched.
      if (record.attributeName === 'style' && ownStyles.has(record.target) && ownStyles.get(record.target) === record.target.getAttribute('style')) continue;
      queue(record.target);
    }
  }
});
observer.observe(document.body, {
  subtree: true, childList: true, attributes: true,
  attributeFilter: ['class', 'style', 'hidden', 'data-theme', 'data-style', 'data-color', 'data-original-color', 'disabled', 'aria-disabled']
});
// A class/style mutation can start a color transition; sample its final hue too.
document.body.addEventListener('transitionend', event => {
  if (event.propertyName === 'background-color' || event.propertyName === 'color') queue(event.target);
});
queue(document.body);

// Reflect item light only onto the nearby parts of its containing glass rim.
// Positions are measured after layout; the CSS recipe owns all color/intensity.
// Re-rendering, pinning, dragging and wrapping update the map without touching
// saved data or running an animation loop. Removed nodes are unobserved.
{
  const receivers = '.eisenhower-priority-card, .card';
  const emitters = '.eisenhower-task-pinned:not(.dragging), .unified-reminder-item, [data-glass-glow="material"]';
  const tracked = new Set();
  let lightFrame = 0;
  const scheduleLight = () => {
    if (!lightFrame) lightFrame = requestAnimationFrame(updateReflections);
  };
  const sizes = new ResizeObserver(scheduleLight);

  function updateReflections() {
    lightFrame = 0;
    const cards = [...document.querySelectorAll(receivers)];
    const elements = new Set(cards);
    const updates = [];
    // Read all geometry first, then write only changed light maps.
    for (const card of cards) {
      const isTaskCard = card.matches('.eisenhower-priority-card');
      const sources = [...card.querySelectorAll(emitters)].filter(source => source.closest(receivers) === card);
      sources.forEach(element => elements.add(element));
      const bounds = card.getBoundingClientRect();
      const lights = [];
      if (bounds.width && bounds.height) {
        const scaleX = bounds.width / card.offsetWidth;
        const scaleY = bounds.height / card.offsetHeight;
        for (const source of sources) {
          const rect = source.getBoundingClientRect();
          if (!rect.width || !rect.height) continue;
          const style = getComputedStyle(source);
          const hue = style.getPropertyValue('--light-rgb').trim();
          if (!/^\d+(?:\.\d+)?\s+\d+(?:\.\d+)?\s+\d+(?:\.\d+)?$/.test(hue)) continue;
          let width = rect.width / scaleX, inset = 0;
          if (source.matches('.unified-reminder-item')) {
            const fill = getComputedStyle(source, '::before');
            width = parseFloat(fill.width);
            inset = parseFloat(fill.left) || 0;
            if (!width || Number(fill.opacity) === 0) continue;
          }
          const x = ((rect.left - bounds.left) / scaleX + inset + width / 2).toFixed(1);
          const y = ((rect.top + rect.height / 2 - bounds.top) / scaleY).toFixed(1);
          const rx = (width / 2 + 64).toFixed(1);
          const ry = (rect.height / scaleY / 2 + 32).toFixed(1);
          const stops = isTaskCard
            ? 'var(--task-reflection-near), var(--task-reflection-mid) 55%, var(--task-reflection-far) 75%, transparent 100%'
            : `rgb(${hue} / var(--surface-reflection-near)), rgb(${hue} / var(--surface-reflection-mid)) 55%, rgb(${hue} / var(--surface-reflection-far)) 75%, transparent 100%`;
          lights.push(`radial-gradient(ellipse ${rx}px ${ry}px at ${x}px ${y}px, ${stops})`);
        }
      }
      updates.push([card, isTaskCard ? '--task-reflected-light' : '--surface-reflected-light', lights.join(', ') || 'none']);
    }
    for (const element of tracked) {
      if (!elements.has(element)) { sizes.unobserve(element); tracked.delete(element); }
    }
    for (const element of elements) {
      if (!tracked.has(element)) { sizes.observe(element); tracked.add(element); }
    }
    for (const [card, property, light] of updates) {
      // A separate decorative layer keeps the broad white bevel independent
      // of the shaded bevel and the thin rim that receives colored item light.
      if (card.matches('section.card, .app-header.card, .time-tracking-card, .quick-access-card, .eisenhower-card') &&
          !card.querySelector(':scope > .glass-card-highlight')) {
        const highlight = document.createElement('span');
        highlight.className = 'glass-card-highlight';
        highlight.setAttribute('aria-hidden', 'true');
        // Always exclude decoration from card content measurements.
        highlight.style.position = 'absolute';
        card.append(highlight);
      }
      if (card.style.getPropertyValue(property) !== light) {
        card.style.setProperty(property, light);
        ownStyles.set(card, card.getAttribute('style'));
      }
    }
  }

  new MutationObserver(records => {
    if (records.some(record => record.type !== 'attributes' || record.attributeName !== 'style' ||
      ownStyles.get(record.target) !== record.target.getAttribute('style'))) scheduleLight();
  }).observe(document.body, {subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'data-theme', 'data-progress-state', 'data-glass-glow']});
  document.body.addEventListener('transitionend', event => {
    if (['transform', 'width', 'opacity', 'background-color'].includes(event.propertyName)) scheduleLight();
  });
  scheduleLight();
}
