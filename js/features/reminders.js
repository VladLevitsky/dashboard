// Personal Dashboard - Reminders Module
// Handles calendar/interval popovers and reminder helper functions

import { editState, currentData } from '../state.js';
import { $, showToast } from '../utils.js';
import { markDirtyAndSave, hideCalendarPopover, hideIntervalPopover } from './edit-mode.js';

// Module state
let currentBreakdownReminder = null;

// --- Days until date calculation
export function daysUntil(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    console.warn('daysUntil called with invalid date:', date);
    return 0;
  }

  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startOfTarget = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const msPerDay = 24 * 60 * 60 * 1000;
  const result = Math.round((startOfTarget - startOfToday) / msPerDay);

  if (result > 60) {
    console.warn('daysUntil: Unusually high days calculation detected:', {
      inputDate: date.toISOString(),
      today: today.toISOString(),
      result: result
    });
  }

  return result;
}

// --- Get next occurrence of a schedule
export function getNextOccurrence(spec) {
  if (!spec) {
    console.warn('getNextOccurrence called with null/undefined spec');
    return new Date();
  }

  if (typeof spec !== 'object') {
    console.warn('getNextOccurrence called with invalid spec:', spec);
    return new Date();
  }

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  if (spec.type === 'weekday') {
    const targetDow = spec.weekday;
    const weekInterval = spec.weekInterval || 1;
    const todayDow = now.getDay();

    let daysToAdd = (targetDow - todayDow + 7) % 7;
    if (daysToAdd === 0) {
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }

    const next = new Date(now);
    next.setDate(now.getDate() + daysToAdd);
    return next;
  }

  if (spec.type === 'firstWeekdayOfMonth') {
    function firstWeekday(y, m, weekday) {
      const first = new Date(y, m, 1);
      const diff = (weekday - first.getDay() + 7) % 7;
      return new Date(y, m, 1 + diff);
    }

    let candidate = firstWeekday(year, month, spec.weekday);
    const todayOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const candStart = new Date(candidate.getFullYear(), candidate.getMonth(), candidate.getDate());

    if (candStart < todayOnly) {
      let nextMonth, nextYear;
      if (month === 11) {
        nextMonth = 0;
        nextYear = year + 1;
      } else {
        nextMonth = month + 1;
        nextYear = year;
      }
      candidate = firstWeekday(nextYear, nextMonth, spec.weekday);
    } else if (candStart.getTime() === todayOnly.getTime()) {
      return todayOnly;
    }
    return candidate;
  }

  if (spec.type === 'monthly') {
    const dayOfMonth = spec.dayOfMonth;
    let candidate = new Date(year, month, dayOfMonth);
    const todayOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (candidate < todayOnly) {
      let nextMonth, nextYear;
      if (month === 11) {
        nextMonth = 0;
        nextYear = year + 1;
      } else {
        nextMonth = month + 1;
        nextYear = year;
      }
      candidate = new Date(nextYear, nextMonth, dayOfMonth);

      if (candidate.getDate() !== dayOfMonth) {
        candidate = new Date(nextYear, nextMonth + 1, 0);
      }
    } else if (candidate.getTime() === todayOnly.getTime()) {
      return todayOnly;
    }
    return candidate;
  }

  if (spec.type === 'monthlyWeekday') {
    const weekOfMonth = spec.weekOfMonth;
    const weekday = spec.weekday;

    function getWeekdayInMonth(y, m, weekOfMonth, weekday) {
      const first = new Date(y, m, 1);
      const firstWeekday = first.getDay();
      const daysToAdd = (weekday - firstWeekday + 7) % 7 + (weekOfMonth - 1) * 7;
      return new Date(y, m, 1 + daysToAdd);
    }

    let candidate = getWeekdayInMonth(year, month, weekOfMonth, weekday);
    const todayOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (candidate < todayOnly) {
      let nextMonth, nextYear;
      if (month === 11) {
        nextMonth = 0;
        nextYear = year + 1;
      } else {
        nextMonth = month + 1;
        nextYear = year;
      }
      candidate = getWeekdayInMonth(nextYear, nextMonth, weekOfMonth, weekday);
    } else if (candidate.getTime() === todayOnly.getTime()) {
      return todayOnly;
    }
    return candidate;
  }

  if (spec.type === 'once') {
    if (spec.date instanceof Date) {
      return spec.date;
    } else if (typeof spec.date === 'string') {
      return new Date(spec.date);
    } else {
      console.warn('Invalid date in once schedule:', spec.date);
      return now;
    }
  }

  return now;
}

// --- Class for days left badge color
export function classForDaysLeft(n) {
  if (n >= 8) return 'days-green';
  if (n >= 3) return 'days-warn';
  if (n >= 1) return 'days-orange';
  return 'days-danger';
}

// --- Calculate interval progress
export function calculateIntervalProgress(reminder) {
  if (reminder.interval === null || reminder.interval === undefined ||
      reminder.currentNumber === null || reminder.currentNumber === undefined) {
    return { target: 0, progress: 0, percentage: 0 };
  }

  const target = reminder.interval;
  const current = reminder.currentNumber;
  const distanceToTarget = target - current;
  const totalDistance = Math.abs(target);
  const percentage = totalDistance > 0 ? (distanceToTarget / totalDistance) * 100 : 0;

  return {
    target,
    progress: distanceToTarget,
    percentage: percentage
  };
}

// --- Get interval color class
export function getIntervalColorClass(percentage, type = 'limit') {
  if (type === 'goal') {
    if (percentage < 0) return 'green';
    if (percentage >= 75) return 'red';
    if (percentage >= 50) return 'orange';
    if (percentage >= 25) return 'yellow';
    if (percentage >= 0) return 'green';
    return 'green';
  } else {
    if (percentage < 0) return 'red';
    if (percentage >= 75) return 'green';
    if (percentage >= 50) return 'yellow';
    if (percentage >= 25) return 'orange';
    if (percentage >= 0) return 'red';
    return 'red';
  }
}

// --- Format interval number
export function formatIntervalNumber(number, unit = 'none') {
  const formattedNumber = Math.abs(number) >= 100 ? number.toLocaleString() : number.toString();

  switch (unit) {
    case 'dollar':
      return `$${formattedNumber}`;
    case 'percent':
      return `${formattedNumber}%`;
    default:
      return formattedNumber;
  }
}

// --- Open calendar popover
export function openCalendarPopover(reminder, event) {
  const pop = $('#calendar-popover');
  const dateInput = $('#calendar-date');
  const repeatSelect = $('#calendar-repeat');
  const monthlyTypeSelect = $('#calendar-monthly-type');
  const monthlyOptions = $('#monthly-options');
  const weeklyTypeSelect = $('#calendar-weekly-type');
  const weeklyOptions = $('#weekly-options');

  // Position the popover near the cursor and within the viewport
  if (event) {
    const popoverWidth = 320;
    const popoverHeight = 350; // Approximate height
    const margin = 10;

    // Get scroll offsets for absolute positioning
    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;

    let left = event.clientX;
    let top = event.clientY;

    // Adjust horizontal position to stay within viewport
    if (left + popoverWidth + margin > window.innerWidth) {
      left = window.innerWidth - popoverWidth - margin;
    }
    if (left < margin) {
      left = margin;
    }

    // Adjust vertical position to stay within viewport
    if (top + popoverHeight + margin > window.innerHeight) {
      top = window.innerHeight - popoverHeight - margin;
    }
    if (top < margin) {
      top = margin;
    }

    // Add scroll offset for absolute positioning
    pop.style.left = `${left + scrollX}px`;
    pop.style.top = `${top + scrollY}px`;
    pop.style.bottom = 'auto';
  }

  let currentDate = reminder.schedule ? getNextOccurrence(reminder.schedule) : new Date();

  if (!(currentDate instanceof Date) || isNaN(currentDate.getTime())) {
    console.warn('Invalid currentDate in openCalendarPopover:', currentDate);
    currentDate = new Date();
  }

  dateInput.value = currentDate.toISOString().split('T')[0];

  let repeatType = 'none';
  let monthlyType = 'sameDay';
  let weeklyType = '1';
  if (reminder.schedule && reminder.schedule.type === 'weekday') {
    repeatType = 'weekly';
    weeklyType = (reminder.schedule.weekInterval || 1).toString();
  } else if (reminder.schedule && reminder.schedule.type === 'monthly') {
    repeatType = 'monthly';
    monthlyType = 'sameDay';
  } else if (reminder.schedule && reminder.schedule.type === 'monthlyWeekday') {
    repeatType = 'monthly';
    monthlyType = 'firstWeekday';
  } else if (reminder.schedule && reminder.schedule.type === 'firstWeekdayOfMonth') {
    repeatType = 'monthly';
    monthlyType = 'firstWeekday';
  }

  repeatSelect.value = repeatType;
  monthlyTypeSelect.value = monthlyType;
  weeklyTypeSelect.value = weeklyType;

  monthlyOptions.style.display = 'none';
  weeklyOptions.style.display = 'none';

  if (repeatType === 'monthly') {
    monthlyOptions.style.display = 'block';
  } else if (repeatType === 'weekly') {
    weeklyOptions.style.display = 'block';
  }

  function updateMonthlyLabels() {
    const selectedDate = new Date(dateInput.value + 'T00:00:00');
    const dayOfMonth = selectedDate.getDate();
    const weekday = selectedDate.getDay();
    const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const weekdayName = weekdayNames[weekday];

    const sameDayOption = monthlyTypeSelect.querySelector('option[value="sameDay"]');
    const firstWeekdayOption = monthlyTypeSelect.querySelector('option[value="firstWeekday"]');

    sameDayOption.textContent = `Every first ${dayOfMonth} of the month`;
    firstWeekdayOption.textContent = `Every first ${weekdayName} of the month`;
  }

  dateInput.onchange = updateMonthlyLabels;
  updateMonthlyLabels();

  repeatSelect.onchange = () => {
    if (repeatSelect.value === 'monthly') {
      monthlyOptions.style.display = 'block';
      weeklyOptions.style.display = 'none';
      updateMonthlyLabels();
    } else if (repeatSelect.value === 'weekly') {
      weeklyOptions.style.display = 'block';
      monthlyOptions.style.display = 'none';
    } else {
      weeklyOptions.style.display = 'none';
      monthlyOptions.style.display = 'none';
    }
  };

  const saveBtn = $('#calendar-save');
  saveBtn.onclick = () => {
    const selectedDate = new Date(dateInput.value + 'T00:00:00');
    const repeatType = repeatSelect.value;
    const monthlyType = monthlyTypeSelect.value;

    let newSchedule;
    if (repeatType === 'none') {
      newSchedule = { type: 'once', date: selectedDate };
    } else if (repeatType === 'weekly') {
      const weeklyType = $('#calendar-weekly-type').value;
      newSchedule = {
        type: 'weekday',
        weekday: selectedDate.getDay(),
        weekInterval: parseInt(weeklyType) || 1
      };
    } else if (repeatType === 'monthly') {
      if (monthlyType === 'sameDay') {
        newSchedule = { type: 'monthly', dayOfMonth: selectedDate.getDate() };
      } else if (monthlyType === 'firstWeekday') {
        newSchedule = {
          type: 'monthlyWeekday',
          weekday: selectedDate.getDay(),
          weekOfMonth: 1
        };
      }
    }

    reminder.schedule = newSchedule;
    markDirtyAndSave();
    if (window.renderAllSections) window.renderAllSections();
    hideCalendarPopover();
  };

  $('#calendar-cancel').onclick = hideCalendarPopover;
  $('#calendar-close').onclick = hideCalendarPopover;

  pop.hidden = false;
  editState.currentCalendarTarget = reminder;
}

// --- Open interval popover
export function openIntervalPopover(reminder, event) {
  currentBreakdownReminder = reminder;

  const popover = $('#interval-popover');
  const form = $('#interval-form');
  const intervalInput = $('#interval-value');
  const currentInput = $('#interval-current');
  const typeSelect = $('#interval-type');
  const unitSelect = $('#interval-unit');

  // Position the popover near the cursor and within the viewport
  if (event) {
    const popoverWidth = 320;
    const popoverHeight = 300; // Approximate height
    const margin = 10;

    // Get scroll offsets for absolute positioning
    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;

    let left = event.clientX;
    let top = event.clientY;

    // Adjust horizontal position to stay within viewport
    if (left + popoverWidth + margin > window.innerWidth) {
      left = window.innerWidth - popoverWidth - margin;
    }
    if (left < margin) {
      left = margin;
    }

    // Adjust vertical position to stay within viewport
    if (top + popoverHeight + margin > window.innerHeight) {
      top = window.innerHeight - popoverHeight - margin;
    }
    if (top < margin) {
      top = margin;
    }

    // Add scroll offset for absolute positioning
    popover.style.left = `${left + scrollX}px`;
    popover.style.top = `${top + scrollY}px`;
    popover.style.bottom = 'auto';
  }

  intervalInput.value = reminder.interval ? Math.round(reminder.interval) : '';
  currentInput.value = reminder.currentNumber ? Math.round(reminder.currentNumber) : '';
  typeSelect.value = reminder.intervalType || 'limit';
  unitSelect.value = reminder.intervalUnit || 'none';

  if (reminder.breakdown && !reminder.breakdown.locked) {
    currentInput.disabled = true;
    currentInput.classList.add('disabled-sum-mode');
  } else {
    currentInput.disabled = false;
    currentInput.classList.remove('disabled-sum-mode');
  }

  form.onsubmit = (e) => {
    e.preventDefault();

    const targetNumber = Math.round(parseFloat(intervalInput.value));
    const currentNumber = Math.round(parseFloat(currentInput.value));
    const type = typeSelect.value;
    const unit = unitSelect.value;

    if (isNaN(targetNumber) || isNaN(currentNumber)) {
      showToast('Please enter valid numbers');
      return;
    }

    reminder.type = 'interval';
    reminder.interval = targetNumber;
    reminder.currentNumber = currentNumber;
    reminder.intervalType = type;
    reminder.intervalUnit = unit;

    markDirtyAndSave();
    if (window.renderAllSections) window.renderAllSections();
    hideIntervalPopover();
  };

  $('#interval-cancel').onclick = hideIntervalPopover;

  popover.hidden = false;
}

// --- Breakdown modal functions
export function openBreakdownModal(reminder) {
  currentBreakdownReminder = reminder;

  if (!reminder.breakdown) {
    reminder.breakdown = {
      locked: false,
      rows: []
    };
  }

  const intervalPopover = $('#interval-popover');
  intervalPopover.hidden = true;

  const modal = $('#breakdown-modal');
  const currentInput = $('#breakdown-current');
  const lockCheckbox = $('#breakdown-lock');

  currentInput.value = Math.round(reminder.currentNumber || 0);
  lockCheckbox.checked = reminder.breakdown.locked || false;
  currentInput.disabled = !reminder.breakdown.locked;

  renderBreakdownRows();

  if (!reminder.breakdown.locked) {
    updateBreakdownSum();
  }

  modal.hidden = false;
}

export function renderBreakdownRows() {
  const rowsContainer = $('#breakdown-rows');
  rowsContainer.innerHTML = '';

  if (!currentBreakdownReminder.breakdown.rows) {
    currentBreakdownReminder.breakdown.rows = [];
  }

  currentBreakdownReminder.breakdown.rows.forEach((row, index) => {
    const rowDiv = document.createElement('div');
    rowDiv.className = 'breakdown-row';

    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.placeholder = 'Title';
    titleInput.value = row.title || '';
    titleInput.addEventListener('input', (e) => {
      row.title = e.target.value;
    });

    const valueInput = document.createElement('input');
    valueInput.type = 'number';
    valueInput.placeholder = '0';
    valueInput.value = row.value || 0;
    valueInput.addEventListener('input', (e) => {
      row.value = parseFloat(e.target.value) || 0;
      updateBreakdownSum();
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-delete-row';
    deleteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="3 6 5 6 21 6"></polyline>
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
    </svg>`;
    deleteBtn.title = 'Delete row';
    deleteBtn.addEventListener('click', () => {
      currentBreakdownReminder.breakdown.rows.splice(index, 1);
      renderBreakdownRows();
      updateBreakdownSum();
    });

    rowDiv.appendChild(titleInput);
    rowDiv.appendChild(valueInput);
    rowDiv.appendChild(deleteBtn);
    rowsContainer.appendChild(rowDiv);
  });
}

export function updateBreakdownSum() {
  if (!currentBreakdownReminder || currentBreakdownReminder.breakdown.locked) return;

  const sum = currentBreakdownReminder.breakdown.rows.reduce((total, row) => {
    return total + (parseFloat(row.value) || 0);
  }, 0);

  const roundedSum = Math.round(sum);

  const currentInput = $('#breakdown-current');
  currentInput.value = roundedSum;
  currentBreakdownReminder.currentNumber = roundedSum;
}

export function hideBreakdownModal() {
  const modal = $('#breakdown-modal');
  modal.hidden = true;
}

export function cancelBreakdownModal() {
  hideBreakdownModal();
  const intervalPopover = $('#interval-popover');
  intervalPopover.hidden = false;
  currentBreakdownReminder = null;
}

export function acceptBreakdownModal() {
  if (!currentBreakdownReminder) return;

  const currentInput = $('#breakdown-current');
  const lockCheckbox = $('#breakdown-lock');

  currentBreakdownReminder.breakdown.locked = lockCheckbox.checked;

  if (lockCheckbox.checked) {
    currentBreakdownReminder.currentNumber = Math.round(parseFloat(currentInput.value) || 0);
  }

  const intervalCurrentInput = $('#interval-current');
  intervalCurrentInput.value = currentBreakdownReminder.currentNumber;

  if (!currentBreakdownReminder.breakdown.locked) {
    intervalCurrentInput.disabled = true;
    intervalCurrentInput.classList.add('disabled-sum-mode');
  } else {
    intervalCurrentInput.disabled = false;
    intervalCurrentInput.classList.remove('disabled-sum-mode');
  }

  hideBreakdownModal();
  const intervalPopover = $('#interval-popover');
  intervalPopover.hidden = false;
}

export function addBreakdownRow() {
  if (!currentBreakdownReminder) return;

  currentBreakdownReminder.breakdown.rows.push({ title: '', value: 0 });
  renderBreakdownRows();
}

export function toggleBreakdownLock() {
  if (!currentBreakdownReminder) return;

  const currentInput = $('#breakdown-current');
  const lockCheckbox = $('#breakdown-lock');

  currentBreakdownReminder.breakdown.locked = lockCheckbox.checked;
  currentInput.disabled = !lockCheckbox.checked;

  if (!lockCheckbox.checked) {
    updateBreakdownSum();
  }
}

// --- Get current breakdown reminder (for external access)
export function getCurrentBreakdownReminder() {
  return currentBreakdownReminder;
}

export function setCurrentBreakdownReminder(reminder) {
  currentBreakdownReminder = reminder;
}
