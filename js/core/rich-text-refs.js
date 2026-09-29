// Personal Dashboard - Rich-text image references (pure string helpers)
// Images in rich text (task / subtask descriptions, projects, meetings, ideas,
// card and subtask notes) live in R2 file storage. The saved HTML only holds a
// reference, with no src:
//   <img data-r2-file-id="<fileId>" alt="">
// The page fills src in from the authenticated file cache whenever the HTML
// is shown (js/features/rich-text-images.js). While an upload is in flight the
// image is <img src="data:..." data-r2-uploading="<token>">, so a note saved
// mid-upload still keeps the picture; the token is swapped for the file id
// when the upload finishes.
// No DOM and no imports: storage, sync, the File Manager and the Node smoke
// test (Reference/rich-text-refs-test.mjs) all use these.

// One <img ...> tag; quoted attribute values may contain '>'
const IMG_TAG = /<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
const FILE_ID_ATTR = /\bdata-r2-file-id="([^"]+)"/i;
const FILE_ID_ATTR_ALL = /\bdata-r2-file-id="([^"]+)"/gi;
const SRC_ATTR = /\s+src="[^"]*"/i;
const UPLOADING_ATTR = /\s+data-r2-uploading="[^"]*"/i;
// Inline images worth moving to file storage (SVG is tiny and not an allowed upload type)
const INLINE_SRC = /\bsrc="(data:image\/(?!svg)[a-z0-9.+-]+;base64,[^"]+)"/i;

function toReference(tag, fileId) {
  const bare = tag.replace(SRC_ATTR, '').replace(UPLOADING_ATTR, '').replace(FILE_ID_ATTR, '');
  return bare.replace(/^<img\b/i, `<img data-r2-file-id="${fileId}"`);
}

// Drop the session-only src the page adds to R2 images, so saved HTML stays
// canonical (a blob: URL is dead after a reload anyway)
export function stripHydratedImageSrc(html) {
  if (typeof html !== 'string' || !html.includes('data-r2-file-id')) return html;
  return html.replace(IMG_TAG, tag => (FILE_ID_ATTR.test(tag) ? tag.replace(SRC_ATTR, '') : tag));
}

// Call fn(string, context) for every string inside value (objects / arrays,
// depth-first). context = { rootKey, title }: the top-level model key and the
// nearest enclosing object's title, used to name migrated images.
export function forEachString(value, fn, context = { rootKey: '', title: '' }) {
  if (typeof value === 'string') {
    fn(value, context);
  } else if (Array.isArray(value)) {
    value.forEach(item => forEachString(item, fn, context));
  } else if (value && typeof value === 'object') {
    const title = typeof value.title === 'string' && value.title ? value.title : context.title;
    for (const [key, child] of Object.entries(value)) {
      forEachString(child, fn, { rootKey: context.rootKey || key, title });
    }
  }
}

// Replace every string inside value (in place) with fn(string). Returns true
// if anything changed.
export function mapStringsDeep(value, fn) {
  let changed = false;
  const visit = (node) => {
    if (Array.isArray(node)) {
      node.forEach((item, i) => {
        if (typeof item === 'string') {
          const next = fn(item);
          if (next !== item) { node[i] = next; changed = true; }
        } else visit(item);
      });
    } else if (node && typeof node === 'object') {
      for (const key of Object.keys(node)) {
        const item = node[key];
        if (typeof item === 'string') {
          const next = fn(item);
          if (next !== item) { node[key] = next; changed = true; }
        } else visit(item);
      }
    }
  };
  visit(value);
  return changed;
}

// Every R2 file id referenced by a rich-text image anywhere inside value
export function collectRichTextFileIds(value, ids = new Set()) {
  forEachString(value, (s) => {
    if (!s.includes('data-r2-file-id')) return;
    for (const match of s.matchAll(FILE_ID_ATTR_ALL)) ids.add(match[1]);
  });
  return ids;
}

// Remove every image that references fileId (File Manager delete)
export function removeRichTextImage(html, fileId) {
  if (typeof html !== 'string' || !html.includes(fileId)) return html;
  return html.replace(IMG_TAG, tag => {
    const match = tag.match(FILE_ID_ATTR);
    return match && match[1] === fileId ? '' : tag;
  });
}

// Upload finished: turn the in-flight image into a file reference
export function resolveUploadToken(html, token, fileId) {
  if (typeof html !== 'string' || !html.includes(token)) return html;
  return html.replace(IMG_TAG, tag => (tag.includes(`data-r2-uploading="${token}"`) ? toReference(tag, fileId) : tag));
}

// Upload failed: keep the inline image, drop the in-flight marker
export function clearUploadToken(html, token) {
  if (typeof html !== 'string' || !html.includes(token)) return html;
  return html.replace(IMG_TAG, tag => (tag.includes(`data-r2-uploading="${token}"`) ? tag.replace(UPLOADING_ATTR, '') : tag));
}

// Data URLs of the inline (base64) images in an HTML string, in order, unique
export function findInlineImages(html) {
  if (typeof html !== 'string' || !html.includes('<img') || !html.includes('data:image/')) return [];
  const found = [];
  for (const tag of html.match(IMG_TAG) || []) {
    if (FILE_ID_ATTR.test(tag) || UPLOADING_ATTR.test(tag)) continue;
    const match = tag.match(INLINE_SRC);
    if (match && !found.includes(match[1])) found.push(match[1]);
  }
  return found;
}

// File names for stored images, so the File Manager says where each came from
const LABELS = {
  tasks: 'Task', completedTasks: 'Task', projects: 'Project', meetings: 'Meeting',
  ideas: 'Idea', cardNotes: 'Note', subtaskNotes: 'Note'
};
export function richTextLabel(rootKey) {
  return LABELS[rootKey] || 'Image';
}

// "Task - Write the blog post" (title cleaned for a file name, 60 chars max)
export function imageFileBase(label, title) {
  const clean = String(title || '').replace(/[\\/:*?"<>|#%{}^~[\]`]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60).trim();
  return clean ? `${label} - ${clean}` : label;
}

// Migration: replace an inline image (by its exact data URL) with a file reference
export function replaceInlineImage(html, dataUrl, fileId) {
  if (typeof html !== 'string' || !html.includes(dataUrl)) return html;
  return html.replace(IMG_TAG, tag => {
    const match = tag.match(INLINE_SRC);
    return match && match[1] === dataUrl && !FILE_ID_ATTR.test(tag) ? toReference(tag, fileId) : tag;
  });
}
