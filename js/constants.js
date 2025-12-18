// Personal Dashboard - Constants and Configuration
// All static configuration values and icon paths

export const PLACEHOLDER_URL = 'https://telcobridges.com';

// Configuration constants
export const TIMER_UPDATE_INTERVAL_MS = 100; // Update timer display every 100ms for smooth millisecond display
export const ANIMATION_DELAY_MS = 10; // Delay for CSS transition triggers
export const CARD_HIDE_DELAY_MS = 400; // Delay before hiding cards (matches CSS transition)
export const APP_VERSION = '3.1'; // Current app version for exports

// Storage keys
export const STORAGE_KEY = 'personal_dashboard_model_v2';
export const MEDIA_STORAGE_KEY = 'personal_dashboard_media_library_v1';
export const LINKS_FILE_PATH = 'data/user_links.json';
export const MEDIA_MANIFEST_PATH = 'Media Library/media.json';

// --- Icon registry (placeholder SVGs)
// To enforce equal size regardless of source image, all icons render inside a fixed button with 32x32 image size via CSS.
export const icons = {
  // Daily Tasks
  Daily_tasks_1: 'assets/logos/Daily_tasks_1.svg',
  Daily_tasks_2: 'assets/logos/Daily_tasks_2.svg',

  // Daily Tools
  Daily_tools_1: 'assets/logos/Daily_tools_1.svg',
  Daily_tools_2: 'assets/logos/Daily_tools_2.svg',
  Daily_tools_3: 'assets/logos/Daily_tools_3.svg',
  Daily_tools_4: 'assets/logos/Daily_tools_4.svg',

  // Content Creation (7 incl. divider)
  Content_creation_1: 'assets/logos/Content_creation_1.svg',
  Content_creation_2: 'assets/logos/Content_creation_2.svg',
  Content_creation_3: 'assets/logos/Content_creation_3.svg',
  Content_creation_4: 'assets/logos/Content_creation_4.svg',
  Content_creation_divider: 'assets/icons/Content_creation_divider.svg',
  Content_creation_5: 'assets/logos/Content_creation_5.svg',
  Content_creation_6: 'assets/logos/Content_creation_6.svg',

  // Ads
  Ads_1: 'assets/logos/Ads_1.svg',
  Ads_2: 'assets/logos/Ads_2.svg',
  Ads_3: 'assets/logos/Ads_3.svg',
  Ads_4: 'assets/logos/Ads_4.svg',
  Ads_5: 'assets/icons/Ads_5.svg',
  Ads_divider: 'assets/icons/Ads_divider.svg',
};

// Link icon SVG for reminder links and list item links
export const LINK_ICON_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
  </svg>
`;
