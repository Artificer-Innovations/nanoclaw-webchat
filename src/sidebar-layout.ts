export const SIDEBAR_WIDTH_STORAGE_KEY = 'webchat_sidebar_width';
export const SIDEBAR_COLLAPSED_STORAGE_KEY = 'webchat_sidebar_collapsed';
export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_MAX_WIDTH_RATIO = 0.5;
export const SIDEBAR_DEFAULT_WIDTH = 220;
export const SIDEBAR_KEYBOARD_RESIZE_STEP = 20;

export function maxSidebarWidth(viewportWidth = window.innerWidth): number {
  return viewportWidth * SIDEBAR_MAX_WIDTH_RATIO;
}

export function clampSidebarWidth(
  width: number,
  viewportWidth = window.innerWidth,
): number {
  return Math.round(
    Math.min(maxSidebarWidth(viewportWidth), Math.max(SIDEBAR_MIN_WIDTH, width)),
  );
}

export function getStoredSidebarWidth(viewportWidth = window.innerWidth): number {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
  } catch {
    raw = null;
  }
  if (raw != null) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed)) {
      return clampSidebarWidth(parsed, viewportWidth);
    }
  }
  return clampSidebarWidth(SIDEBAR_DEFAULT_WIDTH, viewportWidth);
}

export function setStoredSidebarWidth(width: number): void {
  try {
    localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(Math.round(width)));
  } catch {
    // ignore write failures in sandboxed or restricted storage contexts
  }
}

export function sidebarWidthFromDrag(
  startWidth: number,
  startClientX: number,
  clientX: number,
  viewportWidth = window.innerWidth,
): number {
  return clampSidebarWidth(startWidth + (clientX - startClientX), viewportWidth);
}

export function sidebarWidthFromKeyboard(
  currentWidth: number,
  key: string,
  viewportWidth = window.innerWidth,
): number | null {
  if (key === 'ArrowRight') {
    return clampSidebarWidth(currentWidth + SIDEBAR_KEYBOARD_RESIZE_STEP, viewportWidth);
  }
  if (key === 'ArrowLeft') {
    return clampSidebarWidth(currentWidth - SIDEBAR_KEYBOARD_RESIZE_STEP, viewportWidth);
  }
  return null;
}

export function getStoredSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setStoredSidebarCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0');
  } catch {
    // ignore write failures in sandboxed or restricted storage contexts
  }
}
