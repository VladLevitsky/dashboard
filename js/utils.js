// Personal Dashboard - Utility Functions
// Common helper functions used across the application

// Note: We access model via window.model to avoid circular dependencies
// model is set on window by main.js after all modules load

// --- DOM Utilities
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// --- URL handling
export function openUrl(url) {
  window.open(url, '_blank');
}

// --- Deep clone utility
export function deepClone(obj) {
  // Simple deep clone via JSON - no special handling needed
  // Note: Legacy code that "fixed" reminders structure was removed.
  // With unified cards (schemaVersion 3), section data like obj["reminders"]
  // stores { subtitle: { icons: [], reminders: [], subtasks: [], copyPaste: [] }, ... }
  // The old code incorrectly converted these objects to empty arrays.
  return JSON.parse(JSON.stringify(obj));
}

// --- Key generation for new items
export function generateKey(prefix, collection) {
  let counter = 1;
  const existingKeys = collection.map(item => item.key);
  let newKey = `${prefix}_${counter}`;
  while (existingKeys.includes(newKey)) {
    counter++;
    newKey = `${prefix}_${counter}`;
  }
  return newKey;
}

// --- Light carried inside the glass rim of quick-access items.
// Every layer follows the same rounded path. CSS supplies the actual corner
// radius and clips the broad diffusion to the glass, leaving the image sharp.
// Separate stroke reach from feathering so pills can have a narrow luminous
// core with a long, smooth inward falloff. Defaults preserve the icon material.
export function createAnimatedBorder(borderColor, lightColor, cornerRadius, strokeWidth = 2.5, glowDepth = 1, glowFeather = glowDepth) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'animated-border-svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  const halfStroke = strokeWidth / 2;
  const cssW = `calc(100% - ${strokeWidth}px)`;
  const cssH = `calc(100% - ${strokeWidth}px)`;
  const uid = 'rim-' + Math.random().toString(36).slice(2, 10);
  const defs = document.createElementNS(ns, 'defs');
  for (const [name, blur] of [['bloom', 5], ['diffuse', 3.5], ['soft', 1.8], ['core', 0.75]]) {
    const filter = document.createElementNS(ns, 'filter');
    filter.id = `${uid}-${name}`;
    filter.setAttribute('x', '-25%');
    filter.setAttribute('y', '-25%');
    filter.setAttribute('width', '150%');
    filter.setAttribute('height', '150%');
    filter.setAttribute('color-interpolation-filters', 'sRGB');
    const gaussian = document.createElementNS(ns, 'feGaussianBlur');
    gaussian.setAttribute('stdDeviation', blur * glowFeather);
    filter.appendChild(gaussian);
    defs.appendChild(filter);
  }
  svg.appendChild(defs);

  function addLight(color, width, opacity, filter, dash = null, center = 0, parent = svg) {
    const r = document.createElementNS(ns, 'rect');
    r.setAttribute('fill', 'none');
    r.setAttribute('pathLength', '100');
    r.setAttribute('stroke', color);
    r.setAttribute('stroke-width', width);
    r.setAttribute('opacity', opacity);
    r.setAttribute('filter', `url(#${uid}-${filter})`);
    r.style.rx = `calc(var(--animated-border-radius, ${cornerRadius}px) - ${halfStroke}px)`;
    r.style.ry = `calc(var(--animated-border-radius, ${cornerRadius}px) - ${halfStroke}px)`;
    r.style.width = cssW;
    r.style.height = cssH;
    r.style.x = `${halfStroke}px`;
    r.style.y = `${halfStroke}px`;
    if (dash !== null) {
      r.setAttribute('stroke-linecap', 'round');
      r.setAttribute('stroke-dasharray', `${dash} ${100 - dash}`);
      // Fixed position: only the containing glow's brightness changes.
      r.setAttribute('stroke-dashoffset', dash / 2 - center);
    }
    parent.appendChild(r);
  }

  // Overlapping soft falloffs carry the edge light well into the glass.
  // The wide, faint layer fades before the icon image; the narrower layers
  // build intensity smoothly, without a flat band behind the bright edge.
  addLight(borderColor, 28 * glowDepth, 0.22, 'bloom');
  addLight(borderColor, 18 * glowDepth, 0.35, 'diffuse');
  addLight(borderColor, 8 * glowDepth, 0.35, 'soft');
  addLight(borderColor, strokeWidth + 1, 0.65, 'core');
  // Paired, offset pulses always overlap: the rim stays alive while bright
  // blue catches different fixed spots. Two slow periods give an uneven beat
  // without bringing back a circulating streak or long all-dim pauses.
  // Keep the original 38% rise and 49% fall in real seconds, but hold the
  // near-peak light for one third of its former 13% interval. CSS keyframe
  // offsets are normalized to this shorter cycle; paired spots stay in phase.
  const cycleScale = 0.38 + 0.13 / 3 + 0.49;
  for (const [center, duration, delay] of [[7, 8.4, -3.2], [44, 9.6, -6.8], [82, 8.4, -7.4], [21, 9.6, -2]]) {
    const glow = document.createElementNS(ns, 'g');
    glow.setAttribute('class', 'animated-border-light');
    glow.style.setProperty('--rim-glow-duration', `${(duration * cycleScale).toFixed(3)}s`);
    glow.style.setProperty('--rim-glow-delay', `${(delay * cycleScale).toFixed(3)}s`);
    // Keep each bright catch local while retaining its soft inward falloff.
    addLight(lightColor, 20 * glowDepth, 0.65, 'bloom', 24, center, glow);
    addLight(lightColor, 11 * glowDepth, 0.95, 'diffuse', 17, center, glow);
    addLight(lightColor, 5 * glowDepth, 1, 'soft', 10, center, glow);
    svg.appendChild(glow);
  }
  return svg;
}

// --- Toast notification
export function showToast(message, duration = 2500) {
  const toast = $('#toast');
  if (!toast) return;

  toast.textContent = message;
  toast.hidden = false;
  toast.classList.add('show');

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
      toast.hidden = true;
    }, 300);
  }, duration);
}

// --- Color utilities

// Get color for current mode from a color object or legacy string
// defaultColorLight and defaultColorDark can be different for proper theme defaults
export function getColorForCurrentMode(colorData, defaultColorLight, defaultColorDark) {
  // If no dark default provided, use light default (backward compatible)
  const darkDefault = defaultColorDark || defaultColorLight;

  if (!colorData) {
    return window.model.darkMode ? darkDefault : defaultColorLight;
  }
  // Legacy: single string color
  if (typeof colorData === 'string') return colorData;
  // New format: { light: '#...', dark: '#...' }
  return window.model.darkMode ? (colorData.dark || darkDefault) : (colorData.light || defaultColorLight);
}

// Set color for current mode
export function setColorForCurrentMode(colorData, newColor) {
  // Convert legacy string to object if needed
  if (!colorData || typeof colorData === 'string') {
    colorData = { light: colorData || null, dark: null };
  }
  if (window.model.darkMode) {
    colorData.dark = newColor;
  } else {
    colorData.light = newColor;
  }
  return colorData;
}

// Lighten and desaturate a color for add buttons
export function lightenAndDesaturateColor(hexColor) {
  hexColor = hexColor.replace('#', '');

  const r = parseInt(hexColor.substr(0, 2), 16) / 255;
  const g = parseInt(hexColor.substr(2, 2), 16) / 255;
  const b = parseInt(hexColor.substr(4, 2), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;

  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }

  // Increase lightness
  l = l + (1 - l) * 0.20;
  // Decrease saturation
  s = Math.max(0, s * 0.70);

  // Convert HSL back to RGB
  let r2, g2, b2;

  if (s === 0) {
    r2 = g2 = b2 = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;

    r2 = hue2rgb(p, q, h + 1/3);
    g2 = hue2rgb(p, q, h);
    b2 = hue2rgb(p, q, h - 1/3);
  }

  const toHex = (x) => {
    const hex = Math.round(x * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };

  return '#' + toHex(r2) + toHex(g2) + toHex(b2);
}

// Darken a color for borders
export function darkenColor(hexColor) {
  hexColor = hexColor.replace('#', '');

  const r = parseInt(hexColor.substr(0, 2), 16);
  const g = parseInt(hexColor.substr(2, 2), 16);
  const b = parseInt(hexColor.substr(4, 2), 16);

  const darkenAmount = 0.8;
  const r2 = Math.round(r * darkenAmount);
  const g2 = Math.round(g * darkenAmount);
  const b2 = Math.round(b * darkenAmount);

  const toHex = (x) => {
    const hex = x.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };

  return '#' + toHex(r2) + toHex(g2) + toHex(b2);
}

// Compensate a dark mode color for glass overlay: slightly brighter + more saturated
// so the final result (after white glass overlay) reads as the intended color
export function glassCompensateColor(hexColor) {
  hexColor = hexColor.replace('#', '');
  let r = parseInt(hexColor.substr(0, 2), 16);
  let g = parseInt(hexColor.substr(2, 2), 16);
  let b = parseInt(hexColor.substr(4, 2), 16);

  // Boost saturation by 15%: push channels away from the average
  const avg = (r + g + b) / 3;
  r = Math.round(r + (r - avg) * 0.15);
  g = Math.round(g + (g - avg) * 0.15);
  b = Math.round(b + (b - avg) * 0.15);

  // Darken slightly (8%) to counteract the white overlay brightening
  const darken = 0.92;
  r = Math.min(255, Math.max(0, Math.round(r * darken)));
  g = Math.min(255, Math.max(0, Math.round(g * darken)));
  b = Math.min(255, Math.max(0, Math.round(b * darken)));

  const toHex = (x) => { const h = x.toString(16); return h.length === 1 ? '0' + h : h; };
  return '#' + toHex(r) + toHex(g) + toHex(b);
}

// Create a lighter, more saturated glow color for dark mode priority items
// Returns an rgba string for use in box-shadow
export function makePriorityGlowColor(color) {
  if (!color) return 'rgba(100,160,255,0.35)';

  let r, g, b;
  if (color.startsWith('rgb')) {
    const m = color.match(/\d+\.?\d*/g);
    if (m && m.length >= 3) { r = parseInt(m[0]); g = parseInt(m[1]); b = parseInt(m[2]); }
    else return 'rgba(100,160,255,0.35)';
  } else if (color.startsWith('#')) {
    let hex = color.slice(1);
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    r = parseInt(hex.substr(0, 2), 16);
    g = parseInt(hex.substr(2, 2), 16);
    b = parseInt(hex.substr(4, 2), 16);
  } else return 'rgba(100,160,255,0.35)';

  // Lighten by 40%: blend toward white
  r = Math.round(r + (255 - r) * 0.4);
  g = Math.round(g + (255 - g) * 0.4);
  b = Math.round(b + (255 - b) * 0.4);

  // Boost saturation by 20%: push channels away from average
  const avg = (r + g + b) / 3;
  r = Math.min(255, Math.max(0, Math.round(r + (r - avg) * 0.2)));
  g = Math.min(255, Math.max(0, Math.round(g + (g - avg) * 0.2)));
  b = Math.min(255, Math.max(0, Math.round(b + (b - avg) * 0.2)));

  return `rgba(${r}, ${g}, ${b}, 0.45)`;
}

// Convert a light color to a dark mode equivalent
export function convertToDarkModeColor(hexColor) {
  hexColor = hexColor.replace('#', '');

  const r = parseInt(hexColor.substr(0, 2), 16) / 255;
  const g = parseInt(hexColor.substr(2, 2), 16) / 255;
  const b = parseInt(hexColor.substr(4, 2), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;

  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }

  // For dark mode: keep the hue, reduce saturation, and invert lightness
  l = 0.20 + (1 - l) * 0.15;
  s = Math.min(s * 0.7, 0.4);

  let r2, g2, b2;

  if (s === 0) {
    r2 = g2 = b2 = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;

    r2 = hue2rgb(p, q, h + 1/3);
    g2 = hue2rgb(p, q, h);
    b2 = hue2rgb(p, q, h - 1/3);
  }

  const toHex = (x) => {
    const hex = Math.round(x * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };

  return '#' + toHex(r2) + toHex(g2) + toHex(b2);
}

// Make a color more vibrant by increasing saturation and slightly darkening
// Keeps the same hue, just makes it richer and more prominent
export function makeColorMoreVibrant(color) {
  if (!color) return color;

  let r, g, b;

  // Parse rgb/rgba format
  if (color.startsWith('rgb')) {
    const matches = color.match(/\d+\.?\d*/g);
    if (matches && matches.length >= 3) {
      r = parseInt(matches[0]) / 255;
      g = parseInt(matches[1]) / 255;
      b = parseInt(matches[2]) / 255;
    } else {
      return color;
    }
  }
  // Parse hex format
  else if (color.startsWith('#')) {
    let hex = color.slice(1);
    if (hex.length === 3) {
      hex = hex.split('').map(c => c + c).join('');
    }
    r = parseInt(hex.substr(0, 2), 16) / 255;
    g = parseInt(hex.substr(2, 2), 16) / 255;
    b = parseInt(hex.substr(4, 2), 16) / 255;
  } else {
    return color;
  }

  // Convert RGB to HSL
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;

  if (max === min) {
    h = s = 0; // achromatic (grey)
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }

  // Make more vibrant:
  // - Increase saturation significantly (but cap at 1.0)
  // - Slightly decrease lightness for richness (but not too dark)
  // - For very light colors (high L), we can darken more
  // - For colors that are already dark, darken less

  const saturationBoost = 0.25; // Add 25% to saturation
  const lightnessReduction = l > 0.7 ? 0.12 : (l > 0.5 ? 0.08 : 0.05);

  s = Math.min(1, s + saturationBoost);
  l = Math.max(0.15, l - lightnessReduction);

  // Convert HSL back to RGB
  let r2, g2, b2;

  if (s === 0) {
    r2 = g2 = b2 = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;

    r2 = hue2rgb(p, q, h + 1/3);
    g2 = hue2rgb(p, q, h);
    b2 = hue2rgb(p, q, h - 1/3);
  }

  // Return as rgb string
  return `rgb(${Math.round(r2 * 255)}, ${Math.round(g2 * 255)}, ${Math.round(b2 * 255)})`;
}

// Lighten a color by 20% (for link bubbles)
export function lightenColorBy20Percent(color) {
  // Handle rgb format
  if (color.startsWith('rgb')) {
    const matches = color.match(/\d+/g);
    if (matches && matches.length >= 3) {
      let r = parseInt(matches[0]);
      let g = parseInt(matches[1]);
      let b = parseInt(matches[2]);

      // Lighten by 20%
      r = Math.min(255, Math.round(r + (255 - r) * 0.2));
      g = Math.min(255, Math.round(g + (255 - g) * 0.2));
      b = Math.min(255, Math.round(b + (255 - b) * 0.2));

      return `rgb(${r}, ${g}, ${b})`;
    }
  }

  // Handle hex format
  if (color.startsWith('#')) {
    let hex = color.slice(1);
    if (hex.length === 3) {
      hex = hex.split('').map(c => c + c).join('');
    }

    let r = parseInt(hex.substr(0, 2), 16);
    let g = parseInt(hex.substr(2, 2), 16);
    let b = parseInt(hex.substr(4, 2), 16);

    // Lighten by 20%
    r = Math.min(255, Math.round(r + (255 - r) * 0.2));
    g = Math.min(255, Math.round(g + (255 - g) * 0.2));
    b = Math.min(255, Math.round(b + (255 - b) * 0.2));

    return `rgb(${r}, ${g}, ${b})`;
  }

  // Return original if format not recognized
  return color;
}

// Convert a color to semi-transparent rgba for glass mode
// Returns rgba string with specified opacity (default 0.45)
export function colorToGlassRgba(color, opacity = 0.45) {
  if (!color) return null;

  // Handle rgb/rgba format
  if (color.startsWith('rgb')) {
    const matches = color.match(/\d+\.?\d*/g);
    if (matches && matches.length >= 3) {
      const r = parseInt(matches[0]);
      const g = parseInt(matches[1]);
      const b = parseInt(matches[2]);
      return `rgba(${r}, ${g}, ${b}, ${opacity})`;
    }
  }

  // Handle hex format
  if (color.startsWith('#')) {
    let hex = color.slice(1);
    if (hex.length === 3) {
      hex = hex.split('').map(c => c + c).join('');
    }

    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);

    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  }

  // Return original if format not recognized
  return color;
}

// Check if glass mode is currently active
export function isGlassModeActive() {
  return window.model && window.model.glassMode === true;
}

// --- Section data key mapping
export function getSectionDataKey(sectionType) {
  const mapping = {
    // Map by section type
    'dailyTasks': 'dailyTasks',
    'dailyTools': 'dailyTools',
    'contentCreation': 'contentCreation',
    'ads': 'ads',
    'analytics': 'analytics',
    'tools': 'tools',
    'reminders': 'reminders',
    // Map by section ID (with hyphens)
    'daily-tasks': 'dailyTasks',
    'daily-tools': 'dailyTools',
    'content-creation': 'contentCreation',
  };

  // For dynamic sections (new-card-*), the sectionType IS the data key
  if (sectionType.startsWith('new-card-')) {
    return sectionType;
  }

  return mapping[sectionType] || sectionType;
}

// --- Generate unique section ID
export function generateSectionId(prefix = 'new-card') {
  const data = window.currentData ? window.currentData() : { sections: [] };
  const existingIds = data.sections.map(s => s.id);
  let counter = 1;
  let newId = `${prefix}-${counter}`;
  while (existingIds.includes(newId)) {
    counter++;
    newId = `${prefix}-${counter}`;
  }
  return newId;
}

// --- Generate unique card title
export function generateUniqueCardTitle(baseTitle) {
  const data = window.currentData ? window.currentData() : { sections: [] };
  let counter = 1;
  let title = baseTitle;

  while (data.sections.some(s => s.title === title)) {
    counter++;
    title = `${baseTitle} ${counter}`;
  }

  return title;
}

// --- File to Data URL conversion
export async function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// --- Color code detection
// Check if a string is a valid color code (hex, rgb, rgba, hsl, hsla)
export function isColorCode(text) {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();

  // Hex color: #RGB, #RRGGBB, #RGBA, #RRGGBBAA
  if (/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(trimmed)) {
    return true;
  }

  // rgb(r, g, b) or rgba(r, g, b, a)
  if (/^rgba?\s*\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*[\d.]+)?\s*\)$/i.test(trimmed)) {
    return true;
  }

  // hsl(h, s%, l%) or hsla(h, s%, l%, a)
  if (/^hsla?\s*\(\s*\d{1,3}\s*,\s*\d{1,3}%?\s*,\s*\d{1,3}%?\s*(,\s*[\d.]+)?\s*\)$/i.test(trimmed)) {
    return true;
  }

  return false;
}

// Get contrasting text color (black or white) for a given background color
export function getContrastTextColor(color) {
  if (!color) return '#000000';

  let r, g, b;

  // Parse hex format
  if (color.startsWith('#')) {
    let hex = color.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      hex = hex.split('').map(c => c + c).join('').slice(0, 6);
    }
    r = parseInt(hex.substr(0, 2), 16);
    g = parseInt(hex.substr(2, 2), 16);
    b = parseInt(hex.substr(4, 2), 16);
  }
  // Parse rgb/rgba format
  else if (color.startsWith('rgb')) {
    const matches = color.match(/\d+/g);
    if (matches && matches.length >= 3) {
      r = parseInt(matches[0]);
      g = parseInt(matches[1]);
      b = parseInt(matches[2]);
    } else {
      return '#000000';
    }
  }
  // Parse hsl/hsla format - convert to RGB first
  else if (color.startsWith('hsl')) {
    const matches = color.match(/[\d.]+/g);
    if (matches && matches.length >= 3) {
      const h = parseInt(matches[0]) / 360;
      const s = parseInt(matches[1]) / 100;
      const l = parseInt(matches[2]) / 100;

      if (s === 0) {
        r = g = b = Math.round(l * 255);
      } else {
        const hue2rgb = (p, q, t) => {
          if (t < 0) t += 1;
          if (t > 1) t -= 1;
          if (t < 1/6) return p + (q - p) * 6 * t;
          if (t < 1/2) return q;
          if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
          return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = Math.round(hue2rgb(p, q, h + 1/3) * 255);
        g = Math.round(hue2rgb(p, q, h) * 255);
        b = Math.round(hue2rgb(p, q, h - 1/3) * 255);
      }
    } else {
      return '#000000';
    }
  } else {
    return '#000000';
  }

  // Calculate relative luminance using sRGB
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  // Return black for light backgrounds, white for dark backgrounds
  return luminance > 0.5 ? '#000000' : '#ffffff';
}

// --- Copy text to clipboard
export function copyToClipboard(text) {
  if (!navigator.clipboard) {
    // Fallback for older browsers
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    document.body.appendChild(textArea);
    textArea.select();
    try {
      document.execCommand('copy');
      showToast('Copied to clipboard!');
    } catch (err) {
      showToast('Failed to copy');
    }
    document.body.removeChild(textArea);
    return;
  }

  navigator.clipboard.writeText(text).then(() => {
    showToast('Copied to clipboard!');
  }).catch(() => {
    showToast('Failed to copy');
  });
}

// --- Move cursor to just after a given node (outside it)
export function moveCursorAfterNode(node) {
  const sel = window.getSelection();
  if (!sel) return;
  const spacer = document.createTextNode('\u200B');
  if (node.nextSibling) {
    node.parentNode.insertBefore(spacer, node.nextSibling);
  } else {
    node.parentNode.appendChild(spacer);
  }
  const range = document.createRange();
  range.setStartAfter(spacer);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

// --- Normalize description HTML (strip lone <br> and whitespace)
export function normalizeDescHtml(html) {
  if (!html) return '';
  const stripped = html.replace(/<br\s*\/?>/gi, '').replace(/&nbsp;/gi, ' ').trim();
  return stripped ? html : '';
}

// --- Escape string for use in HTML attributes
export function escapeAttr(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
