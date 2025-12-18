// Personal Dashboard - Image Editor Module
// Handles profile photo positioning and scaling

import { $ } from '../utils.js';
import { currentData } from '../state.js';
import { markDirtyAndSave } from './edit-mode.js';
import { openMediaLibrary, persistImageFromLibraryEntry } from './media-library.js';

// Editor state
let editorState = {
  imageSrc: '',
  zoomFactor: 1,  // 1.0 = 100%, 1.5 = 150% (relative zoom, not raw scale)
  x: 0,           // Position offset in pixels (for editor's 180px frame)
  y: 0,
  isDragging: false,
  dragStartX: 0,
  dragStartY: 0,
  startX: 0,
  startY: 0,
  onSave: null,
  imageNaturalWidth: 0,
  imageNaturalHeight: 0,
  minScale: 1,
  frameSize: 180
};

// --- Open image editor modal
export function openImageEditor(currentSrc, currentZoom, currentX, currentY, onSave) {
  const modal = $('#image-editor-modal');
  const img = $('#image-editor-img');
  const scaleSlider = $('#image-editor-scale');
  const scaleValue = $('#image-editor-scale-value');

  // Initialize state - x/y are pixel offsets within the editor frame
  editorState.imageSrc = currentSrc || '';
  editorState.zoomFactor = currentZoom || 1;
  editorState.x = currentX || 0;  // Pixel offset
  editorState.y = currentY || 0;  // Pixel offset
  editorState.onSave = onSave;

  // Show modal first so we can measure
  modal.hidden = false;

  // Load image and calculate dimensions
  img.onload = () => {
    editorState.imageNaturalWidth = img.naturalWidth;
    editorState.imageNaturalHeight = img.naturalHeight;

    // Calculate minimum scale to cover the frame
    const frame = $('.image-editor-frame');
    editorState.frameSize = frame.offsetWidth;

    const scaleX = editorState.frameSize / img.naturalWidth;
    const scaleY = editorState.frameSize / img.naturalHeight;
    editorState.minScale = Math.max(scaleX, scaleY);

    // Update slider range (1.0 to 1.5 = 100% to 150%)
    scaleSlider.min = '1';
    scaleSlider.max = '1.5';
    scaleSlider.value = editorState.zoomFactor;
    scaleValue.textContent = Math.round(editorState.zoomFactor * 100) + '%';

    updateImageTransform();
  };

  img.src = editorState.imageSrc;

  // Set up event listeners
  setupEditorListeners();
}

// --- Close image editor
export function closeImageEditor() {
  const modal = $('#image-editor-modal');
  modal.hidden = true;
  editorState.onSave = null;
  removeEditorListeners();
}

// --- Update image transform based on current state
function updateImageTransform() {
  const img = $('#image-editor-img');
  const frame = $('.image-editor-frame');

  if (!img || !frame || !editorState.imageNaturalWidth) return;

  // Calculate actual scale: minScale * zoomFactor
  const actualScale = editorState.minScale * editorState.zoomFactor;

  // Calculate scaled dimensions
  const scaledWidth = editorState.imageNaturalWidth * actualScale;
  const scaledHeight = editorState.imageNaturalHeight * actualScale;

  // Set image size to natural size (we'll scale with transform)
  img.style.width = editorState.imageNaturalWidth + 'px';
  img.style.height = editorState.imageNaturalHeight + 'px';

  // Center the image in frame, then apply offset (x/y are pixel offsets)
  const centerX = (editorState.frameSize - scaledWidth) / 2;
  const centerY = (editorState.frameSize - scaledHeight) / 2;

  img.style.transform = `translate(${centerX + editorState.x}px, ${centerY + editorState.y}px) scale(${actualScale})`;
  img.style.transformOrigin = 'top left';
  img.style.left = '0';
  img.style.top = '0';
  img.style.marginLeft = '0';
  img.style.marginTop = '0';
}

// --- Set up event listeners
function setupEditorListeners() {
  const frame = $('.image-editor-frame');
  const scaleSlider = $('#image-editor-scale');
  const scaleValue = $('#image-editor-scale-value');
  const chooseBtn = $('#image-editor-choose');
  const saveBtn = $('#image-editor-save');
  const cancelBtn = $('#image-editor-cancel');
  const closeBtn = $('#image-editor-close');
  const backdrop = $('.image-editor-backdrop');

  // Scale slider
  scaleSlider.addEventListener('input', handleScaleChange);

  // Drag handlers for the frame
  frame.addEventListener('mousedown', handleDragStart);
  document.addEventListener('mousemove', handleDragMove);
  document.addEventListener('mouseup', handleDragEnd);

  // Touch support
  frame.addEventListener('touchstart', handleTouchStart, { passive: false });
  document.addEventListener('touchmove', handleTouchMove, { passive: false });
  document.addEventListener('touchend', handleTouchEnd);

  // Button handlers
  chooseBtn.addEventListener('click', handleChooseImage);
  saveBtn.addEventListener('click', handleSave);
  cancelBtn.addEventListener('click', closeImageEditor);
  closeBtn.addEventListener('click', closeImageEditor);
  backdrop.addEventListener('click', closeImageEditor);
}

// --- Remove event listeners
function removeEditorListeners() {
  const frame = $('.image-editor-frame');
  const scaleSlider = $('#image-editor-scale');

  if (scaleSlider) {
    scaleSlider.removeEventListener('input', handleScaleChange);
  }

  if (frame) {
    frame.removeEventListener('mousedown', handleDragStart);
    frame.removeEventListener('touchstart', handleTouchStart);
  }

  document.removeEventListener('mousemove', handleDragMove);
  document.removeEventListener('mouseup', handleDragEnd);
  document.removeEventListener('touchmove', handleTouchMove);
  document.removeEventListener('touchend', handleTouchEnd);
}

// --- Handle scale slider change
function handleScaleChange(e) {
  const scaleValue = $('#image-editor-scale-value');
  editorState.zoomFactor = parseFloat(e.target.value);
  scaleValue.textContent = Math.round(editorState.zoomFactor * 100) + '%';
  updateImageTransform();
}

// --- Handle drag start
function handleDragStart(e) {
  e.preventDefault();
  editorState.isDragging = true;
  editorState.dragStartX = e.clientX;
  editorState.dragStartY = e.clientY;
  editorState.startX = editorState.x;
  editorState.startY = editorState.y;
}

// --- Handle drag move
function handleDragMove(e) {
  if (!editorState.isDragging) return;

  const deltaX = e.clientX - editorState.dragStartX;
  const deltaY = e.clientY - editorState.dragStartY;

  editorState.x = editorState.startX + deltaX;
  editorState.y = editorState.startY + deltaY;

  updateImageTransform();
}

// --- Handle drag end
function handleDragEnd() {
  editorState.isDragging = false;
}

// --- Touch handlers
function handleTouchStart(e) {
  if (e.touches.length === 1) {
    e.preventDefault();
    const touch = e.touches[0];
    editorState.isDragging = true;
    editorState.dragStartX = touch.clientX;
    editorState.dragStartY = touch.clientY;
    editorState.startX = editorState.x;
    editorState.startY = editorState.y;
  }
}

function handleTouchMove(e) {
  if (!editorState.isDragging || e.touches.length !== 1) return;
  e.preventDefault();

  const touch = e.touches[0];
  const deltaX = touch.clientX - editorState.dragStartX;
  const deltaY = touch.clientY - editorState.dragStartY;

  editorState.x = editorState.startX + deltaX;
  editorState.y = editorState.startY + deltaY;

  updateImageTransform();
}

function handleTouchEnd() {
  editorState.isDragging = false;
}

// --- Handle choose different image
function handleChooseImage() {
  openMediaLibrary((chosen) => {
    const img = $('#image-editor-img');
    const scaleSlider = $('#image-editor-scale');
    const scaleValue = $('#image-editor-scale-value');

    editorState.imageSrc = persistImageFromLibraryEntry(chosen);

    // Reset position and zoom when choosing new image
    editorState.x = 0;
    editorState.y = 0;
    editorState.zoomFactor = 1;

    // Load new image and recalculate dimensions
    img.onload = () => {
      editorState.imageNaturalWidth = img.naturalWidth;
      editorState.imageNaturalHeight = img.naturalHeight;

      // Recalculate minimum scale
      const frame = $('.image-editor-frame');
      editorState.frameSize = frame.offsetWidth;

      const scaleX = editorState.frameSize / img.naturalWidth;
      const scaleY = editorState.frameSize / img.naturalHeight;
      editorState.minScale = Math.max(scaleX, scaleY);

      // Update slider (1.0 to 1.5 = 100% to 150%)
      scaleSlider.min = '1';
      scaleSlider.max = '1.5';
      scaleSlider.value = '1';
      scaleValue.textContent = '100%';

      updateImageTransform();
    };

    img.src = editorState.imageSrc;
  });
}

// --- Handle save
function handleSave() {
  if (editorState.onSave) {
    // Save x/y as percentage of frame size so it scales correctly to profile
    editorState.onSave({
      src: editorState.imageSrc,
      zoom: editorState.zoomFactor,
      xPercent: editorState.x / editorState.frameSize,
      yPercent: editorState.y / editorState.frameSize
    });
  }
  closeImageEditor();
}

// --- Apply image transform to an element (generalized for any frame size)
// zoom: zoom factor (1.0-1.5), xPercent/yPercent: position as percentage of frame
function applyImageTransform(imgElement, zoom, xPercent, yPercent, frameWidth, frameHeight) {
  if (!imgElement) return;

  const zoomFactor = zoom || 1;
  const xPct = xPercent || 0;
  const yPct = yPercent || 0;

  // Wait for image to load to get natural dimensions
  const applyTransform = () => {
    const naturalWidth = imgElement.naturalWidth || frameWidth;
    const naturalHeight = imgElement.naturalHeight || frameHeight;

    // Calculate minScale to cover the frame (same logic as editor)
    const scaleX = frameWidth / naturalWidth;
    const scaleY = frameHeight / naturalHeight;
    const minScale = Math.max(scaleX, scaleY);

    // Calculate actual scale: minScale * zoomFactor
    const actualScale = minScale * zoomFactor;

    // Calculate scaled dimensions
    const scaledWidth = naturalWidth * actualScale;
    const scaledHeight = naturalHeight * actualScale;

    // Convert percentage offset to pixels for this frame size
    // Use the larger dimension for percentage calculation (editor uses 180px square)
    const refSize = Math.max(frameWidth, frameHeight);
    const offsetX = xPct * refSize;
    const offsetY = yPct * refSize;

    // Set image size to natural size
    imgElement.style.width = naturalWidth + 'px';
    imgElement.style.height = naturalHeight + 'px';

    // Center the image in frame, then apply offset
    const centerX = (frameWidth - scaledWidth) / 2;
    const centerY = (frameHeight - scaledHeight) / 2;

    imgElement.style.transform = `translate(${centerX + offsetX}px, ${centerY + offsetY}px) scale(${actualScale})`;
    imgElement.style.transformOrigin = 'top left';
    imgElement.style.left = '0';
    imgElement.style.top = '0';
  };

  if (imgElement.complete && imgElement.naturalWidth) {
    applyTransform();
  } else {
    imgElement.onload = applyTransform;
  }
}

// --- Apply profile photo transform (90x90 square frame)
export function applyProfilePhotoTransform(imgElement, zoom, xPercent, yPercent) {
  applyImageTransform(imgElement, zoom, xPercent, yPercent, 90, 90);
}

// --- Apply logo transform (216x126 rectangular frame)
export function applyLogoTransform(imgElement, zoom, xPercent, yPercent) {
  applyImageTransform(imgElement, zoom, xPercent, yPercent, 216, 126);
}
