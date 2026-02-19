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
