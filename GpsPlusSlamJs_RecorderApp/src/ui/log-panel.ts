/**
 * Expandable Log Panel
 *
 * Displays recent log entries in a scrollable overlay panel.
 * Triggered by tapping the status area in the HUD.
 *
 * User feedback Issue #5: Users need to view detailed logs during
 * field testing to verify everything is working correctly.
 */

import {
  getLogBuffer,
  subscribeToLogs,
  LogLevel,
  type LogEntry,
} from 'gps-plus-slam-app-framework/utils/logger';
import { getRequiredElement } from '../utils/dom-helpers';

/** Cached DOM elements */
let panelElement: HTMLElement | null = null;
let contentElement: HTMLElement | null = null;
let closeButton: HTMLElement | null = null;
let statusElement: HTMLElement | null = null;

/** Subscription cleanup function */
let unsubscribe: (() => void) | null = null;

/** Track visibility state */
let visible = false;

/** Threshold in pixels for "close enough to bottom" detection */
const SCROLL_THRESHOLD = 50;

/**
 * Check if the user is scrolled to the bottom (within threshold).
 * Used for "sticky bottom" auto-scroll behavior.
 *
 * @param element - The scrollable element to check
 * @param threshold - Pixels from bottom to still consider "at bottom" (default 50)
 * @returns true if user is at or near bottom
 */
function isAtBottom(
  element: HTMLElement,
  threshold = SCROLL_THRESHOLD
): boolean {
  const { scrollTop, scrollHeight, clientHeight } = element;
  return scrollTop + clientHeight >= scrollHeight - threshold;
}

/**
 * Format timestamp as HH:MM:SS
 */
function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toTimeString().slice(0, 8);
}

/**
 * Get CSS class for log level
 */
function getLevelClass(level: LogLevel): string {
  switch (level) {
    case LogLevel.DEBUG:
      return 'log-entry-debug';
    case LogLevel.INFO:
      return 'log-entry-info';
    case LogLevel.WARN:
      return 'log-entry-warn';
    case LogLevel.ERROR:
      return 'log-entry-error';
    default:
      return 'log-entry-info';
  }
}

/**
 * Create a DOM element for a single log entry.
 * Uses textContent to safely escape HTML in user-provided content (XSS prevention).
 */
function createLogEntryElement(entry: LogEntry): HTMLElement {
  const time = formatTime(entry.timestamp);
  const levelClass = getLevelClass(entry.level);

  const container = document.createElement('div');
  container.classList.add('log-entry', levelClass);

  // Use textContent to safely set text (prevents XSS)
  container.textContent = `${time} [${entry.tag}] ${entry.message}`;

  return container;
}

/**
 * Render all buffered log entries to the content element
 */
function renderBuffer(): void {
  if (!contentElement) {
    return;
  }

  // Clear existing content
  contentElement.innerHTML = '';

  // Append each entry as a safe DOM node
  const buffer = getLogBuffer();
  for (const entry of buffer) {
    contentElement.appendChild(createLogEntryElement(entry));
  }
  contentElement.scrollTop = contentElement.scrollHeight;
}

/**
 * Append a new log entry to the panel (for live updates).
 * Uses "sticky bottom" behavior: only auto-scrolls if user was already
 * at/near the bottom. If user has scrolled up to read older entries,
 * their scroll position is preserved.
 */
function appendEntry(entry: LogEntry): void {
  if (!contentElement || !visible) {
    return;
  }

  // Check BEFORE appending (scrollHeight will change after appendChild)
  const wasAtBottom = isAtBottom(contentElement);

  contentElement.appendChild(createLogEntryElement(entry));

  // Only auto-scroll if user was already at bottom
  if (wasAtBottom) {
    contentElement.scrollTop = contentElement.scrollHeight;
  }
}

/**
 * Initialize the log panel component.
 * Must be called after DOM is ready.
 *
 * @throws Error if required DOM elements are not found
 */
export function initLogPanel(): void {
  // Required-element lookups via the shared helper (quality-review A-8 —
  // this used to hand-roll the getElementById-or-throw pattern next to it).
  panelElement = getRequiredElement('log-panel', 'the log panel markup');
  statusElement = getRequiredElement('status', 'the status bar markup');

  contentElement = document.getElementById('log-panel-content');
  closeButton = document.getElementById('log-panel-close');

  // Wire up status click to toggle panel
  statusElement.addEventListener('click', toggleLogPanel);

  // Wire up close button
  if (closeButton) {
    closeButton.addEventListener('click', hideLogPanel);
  }

  // Subscribe to log updates
  unsubscribe = subscribeToLogs(appendEntry);
}

/**
 * Show the log panel and render current buffer
 */
export function showLogPanel(): void {
  if (!panelElement) {
    return;
  }

  visible = true;
  panelElement.classList.remove('hidden');
  renderBuffer();
}

/**
 * Hide the log panel
 */
export function hideLogPanel(): void {
  if (!panelElement) {
    return;
  }

  visible = false;
  panelElement.classList.add('hidden');
}

/**
 * Check if the log panel is currently visible
 */
export function isLogPanelVisible(): boolean {
  return visible;
}

/**
 * Toggle log panel visibility
 */
export function toggleLogPanel(): void {
  if (visible) {
    hideLogPanel();
  } else {
    showLogPanel();
  }
}

/**
 * Cleanup function to remove event listeners and subscriptions.
 * Useful for testing.
 */
export function destroyLogPanel(): void {
  if (statusElement) {
    statusElement.removeEventListener('click', toggleLogPanel);
  }
  if (closeButton) {
    closeButton.removeEventListener('click', hideLogPanel);
  }
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }

  panelElement = null;
  contentElement = null;
  closeButton = null;
  statusElement = null;
  visible = false;
}
