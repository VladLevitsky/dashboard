// Personal Dashboard - Mobile device rules (pure, Node-testable)
// Which layout a browser shows, decided once per page load:
//   - A PHONE (short screen side under 600px and a coarse pointer) is always
//     'mobile'. A stored dashboard_device_mode is ignored there and never
//     rewritten, so one wrong tap can no longer leave a phone on the grid.
//   - Anything else keeps the old rule: the stored pref, else auto by width.
// The inline boot script in index.html (<script data-mx-boot>) repeats these
// rules before any stylesheet loads, so a phone never paints the desktop
// header. Reference/mobile-device-test.mjs runs that script in a vm against
// these functions, so the two copies can't drift.
// No DOM access at import time: grid-engine.js (loaded by Node tests) imports this.

export const PHONE_MAX_SHORT_SIDE = 600;
// Bumped with every mobile deploy, together with the main.js shell specifier
// and every mobile*.css ?v= in index.html (the specifier test checks them).
export const MOBILE_BUILD = '2026-10-mobile-2';

export function isPhoneScreen({ width = 0, height = 0, coarse = false } = {}) {
  const short = Math.min(width || 0, height || 0);
  return short > 0 && short < PHONE_MAX_SHORT_SIDE && coarse === true;
}

// Same thresholds as grid-engine.js autoDetectMode()
export function autoModeForWidth(w) {
  return w < 768 ? 'mobile' : w < 1600 ? 'tablet' : 'desktop';
}

export function resolveDeviceMode({ phone, stored, screenWidth } = {}) {
  if (phone) return 'mobile';
  return ['mobile', 'tablet', 'desktop'].includes(stored) ? stored : autoModeForWidth(screenWidth || 1280);
}

// How the Mobile shell is framed (only when the mode is 'mobile'):
//   'phone'   full screen, the phone-only paths (history, sync guard, safe areas)
//   'full'    a small touch-only device that isn't a phone (an iPad mini, an
//             unfolded foldable: coarse pointer, no hover, short side under
//             768, where Mobile is the auto mode): full width like the old
//             Mobile grid, otherwise as the preview (Layout in More, no
//             phone-only paths)
//   'preview' a computer choosing Mobile (a touch laptop too: its mouse
//             hovers), or a big tablet that chose it: the 390px column
export const SMALL_TABLET_MAX_SHORT_SIDE = 768;
export function shellFrame({ phone = false, touchOnly = false, width = 0, height = 0 } = {}) {
  if (phone) return 'phone';
  const short = Math.min(width || 0, height || 0);
  return touchOnly && short > 0 && short < SMALL_TABLET_MAX_SHORT_SIDE ? 'full' : 'preview';
}

// Screen size + pointer of this browser ({0, 0, false, false} in Node or on any error)
export function readDeviceEnv() {
  try {
    const s = window.screen || {};
    const mq = (q) => !!(window.matchMedia && window.matchMedia(q).matches);
    const coarse = mq('(pointer: coarse)');
    return {
      width: s.width || 0,
      height: s.height || 0,
      coarse,
      touchOnly: coarse && mq('(hover: none)'),
    };
  } catch {
    return { width: 0, height: 0, coarse: false, touchOnly: false };
  }
}

let phoneCache;
// Cached for the page's lifetime: a phone stays a phone when it rotates
export function isPhoneDevice() {
  if (phoneCache === undefined) phoneCache = isPhoneScreen(readDeviceEnv());
  return phoneCache;
}

// Milliseconds from `now` to the next local midnight (DST-safe: built from
// the local calendar day, never by adding 24h)
export function msUntilNextLocalMidnight(now = new Date()) {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return Math.max(0, next.getTime() - now.getTime());
}
