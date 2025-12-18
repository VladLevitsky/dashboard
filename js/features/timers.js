// Personal Dashboard - Timers Module
// Handles time tracking functionality

import { model, editState, currentData } from '../state.js';
import { $, showToast } from '../utils.js';
import { TIMER_UPDATE_INTERVAL_MS, ANIMATION_DELAY_MS, CARD_HIDE_DELAY_MS } from '../constants.js';
import { saveModel } from '../core/storage.js';
import { openEditPopover } from './edit-mode.js';

// Module-level state
let timerInterval = null;

// --- Format time for display
export function formatTime(elapsed, includeMillis = false) {
  let totalSeconds, millis;

  if (includeMillis) {
    totalSeconds = Math.floor(elapsed / 1000);
    millis = Math.floor((elapsed % 1000) / 10);
  } else {
    totalSeconds = elapsed;
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  } else if (minutes > 0) {
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  } else if (includeMillis && totalSeconds < 60) {
    return `${secs}.${millis.toString().padStart(2, '0')}`;
  } else {
    return `${secs}`;
  }
}

// --- Get timer color based on elapsed time
export function getTimerColor(seconds) {
  const maxSeconds = 28800; // 8 hours
  const ratio = Math.min(seconds / maxSeconds, 1);

  if (ratio < 0.25) {
    const localRatio = ratio / 0.25;
    const r = Math.round(34 + (255 - 34) * localRatio);
    const g = Math.round(197 + (235 - 197) * localRatio);
    const b = Math.round(94 + (59 - 94) * localRatio);
    return `rgb(${r}, ${g}, ${b})`;
  } else if (ratio < 0.5) {
    const localRatio = (ratio - 0.25) / 0.25;
    const r = 255;
    const g = Math.round(235 + (191 - 235) * localRatio);
    const b = Math.round(59 + (0 - 59) * localRatio);
    return `rgb(${r}, ${g}, ${b})`;
  } else if (ratio < 0.75) {
    const localRatio = (ratio - 0.5) / 0.25;
    const r = 255;
    const g = Math.round(191 + (152 - 191) * localRatio);
    const b = 0;
    return `rgb(${r}, ${g}, ${b})`;
  } else {
    const localRatio = (ratio - 0.75) / 0.25;
    const r = Math.round(255 + (239 - 255) * localRatio);
    const g = Math.round(152 + (68 - 152) * localRatio);
    const b = Math.round(0 + (68 - 0) * localRatio);
    return `rgb(${r}, ${g}, ${b})`;
  }
}

// --- Start a timer
export function startTimer(timerId) {
  const data = currentData();
  const timer = data.timers.find(t => t.id === timerId);
  if (!timer) return;

  // Stop any other running timers
  data.timers.forEach(t => {
    if (t.id !== timerId && t.isRunning) {
      t.isRunning = false;
      t.lastTick = null;
    }
  });

  timer.isRunning = true;
  timer.lastTick = Date.now();

  saveModel();
  updateTimerDisplay();
}

// --- Stop a timer
export function stopTimer(timerId) {
  const data = currentData();
  const timer = data.timers.find(t => t.id === timerId);
  if (!timer) return;

  if (timer.isRunning && timer.lastTick) {
    const now = Date.now();
    const elapsed = Math.floor((now - timer.lastTick) / 1000);
    timer.elapsed += elapsed;
  }

  timer.isRunning = false;
  timer.lastTick = null;

  saveModel();
  updateTimerDisplay();
}

// --- Toggle a timer
export function toggleTimer(timerId) {
  const data = currentData();
  const timer = data.timers.find(t => t.id === timerId);
  if (!timer) return;

  if (timer.isRunning) {
    stopTimer(timerId);
  } else {
    startTimer(timerId);
  }
}

// --- Reset all timers
export function resetAllTimers() {
  const data = currentData();
  data.timers.forEach(timer => {
    timer.elapsed = 0;
    timer.isRunning = false;
    timer.lastTick = null;
  });
  if (!editState.enabled) {
    saveModel();
  }
  renderTimers();
}

// --- Add a new timer
export function addNewTimer() {
  const data = currentData();
  const newId = `timer-${Date.now()}`;
  data.timers.push({
    id: newId,
    title: `Task ${data.timers.length + 1}`,
    elapsed: 0,
    isRunning: false,
    lastTick: null
  });
  if (!editState.enabled) {
    saveModel();
  }
  renderTimers();
}

// --- Delete a timer
export function deleteTimer(timerId) {
  const data = currentData();
  const index = data.timers.findIndex(t => t.id === timerId);
  if (index !== -1) {
    data.timers.splice(index, 1);
    if (!editState.enabled) {
      saveModel();
    }
    renderTimers();
  }
}

// --- Update timer display
export function updateTimerDisplay() {
  const data = currentData();

  const hasRunningTimers = data.timers.some(t => t.isRunning);
  if (!hasRunningTimers) return;

  const isDarkMode = document.body.dataset.theme === 'dark';

  data.timers.forEach(timer => {
    const circleEl = document.querySelector(`[data-timer-id="${timer.id}"]`);
    if (!circleEl) return;

    let currentElapsedMs = timer.elapsed * 1000;
    if (timer.isRunning && timer.lastTick) {
      const now = Date.now();
      const sessionElapsedMs = now - timer.lastTick;
      currentElapsedMs += sessionElapsedMs;
    }

    const currentElapsedSec = Math.floor(currentElapsedMs / 1000);

    const displayEl = circleEl.querySelector('.timer-display');
    if (displayEl) {
      if (currentElapsedSec < 60) {
        displayEl.textContent = formatTime(currentElapsedMs, true);
      } else {
        displayEl.textContent = formatTime(currentElapsedSec, false);
      }
    }

    const color = getTimerColor(currentElapsedSec);

    if (timer.isRunning) {
      circleEl.style.backgroundColor = color;
      circleEl.style.borderColor = 'transparent';
    } else {
      circleEl.style.backgroundColor = isDarkMode ? 'var(--card)' : 'white';
      circleEl.style.borderColor = color;
    }

    if (timer.isRunning) {
      circleEl.classList.add('active');
      circleEl.classList.remove('paused');
    } else {
      circleEl.classList.remove('active');
      if (currentElapsedSec > 0) {
        circleEl.classList.add('paused');
      } else {
        circleEl.classList.remove('paused');
      }
    }
  });
}

// --- Render timers
export function renderTimers() {
  const data = currentData();
  const container = $('#timer-container');
  if (!container) return;

  container.innerHTML = '';

  data.timers.forEach(timer => {
    const timerEl = document.createElement('div');
    timerEl.className = 'timer-item';

    const titleEl = document.createElement('div');
    titleEl.className = 'timer-title';
    titleEl.textContent = timer.title;

    if (editState.enabled) {
      titleEl.classList.add('editable');
      titleEl.addEventListener('click', (e) => {
        e.stopPropagation();
        openEditPopover(titleEl, {
          text: timer.title,
          hideUrl: true,
          allowDelete: true
        }, ({ text, accept, delete: doDelete }) => {
          if (!accept) return;
          if (doDelete) {
            deleteTimer(timer.id);
            return;
          }
          const currentTimer = data.timers.find(t => t.id === timer.id);
          if (currentTimer) {
            currentTimer.title = text || currentTimer.title;
          }
          renderTimers();
        });
      });
    }

    const circleEl = document.createElement('div');
    circleEl.className = 'timer-circle';
    circleEl.dataset.timerId = timer.id;

    let currentElapsedMs = timer.elapsed * 1000;
    if (timer.isRunning && timer.lastTick) {
      const now = Date.now();
      const sessionElapsedMs = now - timer.lastTick;
      currentElapsedMs += sessionElapsedMs;
    }

    const currentElapsedSec = Math.floor(currentElapsedMs / 1000);

    const color = getTimerColor(currentElapsedSec);
    const isDarkMode = document.body.dataset.theme === 'dark';

    if (timer.isRunning) {
      circleEl.classList.add('active');
      circleEl.style.backgroundColor = color;
      circleEl.style.borderColor = 'transparent';
    } else {
      if (isDarkMode) {
        circleEl.style.backgroundColor = '';
        circleEl.style.setProperty('background-color', 'var(--card)');
      } else {
        circleEl.style.backgroundColor = 'white';
      }
      circleEl.style.borderColor = color;
      if (currentElapsedSec > 0) {
        circleEl.classList.add('paused');
      }
    }

    const iconSvg = `
      <svg class="timer-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="14" r="8"></circle>
        <line x1="12" y1="6" x2="12" y2="2"></line>
        <line x1="8" y1="2" x2="16" y2="2"></line>
        <line x1="12" y1="14" x2="12" y2="10"></line>
        <line x1="12" y1="14" x2="15" y2="17"></line>
      </svg>
    `;
    circleEl.innerHTML = iconSvg;

    const displayEl = document.createElement('div');
    displayEl.className = 'timer-display';
    if (currentElapsedSec < 60) {
      displayEl.textContent = formatTime(currentElapsedMs, true);
    } else {
      displayEl.textContent = formatTime(currentElapsedSec, false);
    }
    circleEl.appendChild(displayEl);

    circleEl.addEventListener('click', () => {
      if (!editState.enabled) {
        toggleTimer(timer.id);
      }
    });

    timerEl.appendChild(titleEl);
    timerEl.appendChild(circleEl);
    container.appendChild(timerEl);
  });

  const buttonsContainer = $('#timer-buttons-container');
  if (buttonsContainer) {
    buttonsContainer.hidden = !editState.enabled;
  }
}

// --- Toggle time tracking panel
export function toggleTimeTracking() {
  const card = $('#time-tracking-card');
  if (!card) return;

  const data = currentData();

  data.timeTrackingExpanded = !data.timeTrackingExpanded;

  if (data.timeTrackingExpanded) {
    card.hidden = false;
    setTimeout(() => card.classList.add('active'), ANIMATION_DELAY_MS);
    renderTimers();

    const buttonsContainer = $('#timer-buttons-container');
    if (buttonsContainer) {
      buttonsContainer.hidden = !editState.enabled;
    }

    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(updateTimerDisplay, TIMER_UPDATE_INTERVAL_MS);
  } else {
    card.classList.remove('active');
    setTimeout(() => card.hidden = true, CARD_HIDE_DELAY_MS);

    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  if (!editState.enabled) {
    saveModel();
  }
}

// --- Get timer interval reference (for external access)
export function getTimerInterval() {
  return timerInterval;
}

// --- Set timer interval reference (for external access)
export function setTimerInterval(interval) {
  timerInterval = interval;
}

// --- Clear timer interval
export function clearTimerInterval() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

// --- Start timer interval
export function startTimerInterval() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(updateTimerDisplay, TIMER_UPDATE_INTERVAL_MS);
}
