import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SIDEBAR_COLLAPSED_STORAGE_KEY,
  SIDEBAR_WIDTH_STORAGE_KEY,
  clampSidebarWidth,
  getStoredSidebarCollapsed,
  getStoredSidebarWidth,
  setStoredSidebarCollapsed,
  setStoredSidebarWidth,
  sidebarWidthFromDrag,
  sidebarWidthFromKeyboard,
} from './sidebar-layout';

describe('sidebar-layout', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('clamps sidebar width to min and max bounds', () => {
    expect(clampSidebarWidth(100, 1000)).toBe(180);
    expect(clampSidebarWidth(600, 1000)).toBe(500);
    expect(clampSidebarWidth(240, 1000)).toBe(240);
  });

  it('reads and writes stored sidebar width', () => {
    setStoredSidebarWidth(280);
    expect(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).toBe('280');
    expect(getStoredSidebarWidth(1200)).toBe(280);
  });

  it('falls back to default width for invalid stored values', () => {
    localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, 'not-a-number');
    expect(getStoredSidebarWidth(1200)).toBe(220);
  });

  it('computes resized width from drag delta', () => {
    expect(sidebarWidthFromDrag(220, 300, 350, 1200)).toBe(270);
    expect(sidebarWidthFromDrag(220, 300, 250, 1200)).toBe(180);
  });

  it('computes resized width from keyboard arrows', () => {
    expect(sidebarWidthFromKeyboard(220, 'ArrowRight', 1200)).toBe(240);
    expect(sidebarWidthFromKeyboard(220, 'ArrowLeft', 1200)).toBe(200);
    expect(sidebarWidthFromKeyboard(220, 'Enter', 1200)).toBeNull();
  });

  it('falls back when sidebar width read throws', () => {
    const getItem = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(getStoredSidebarWidth(1200)).toBe(220);
    getItem.mockRestore();
  });

  it('falls back when collapsed read throws', () => {
    const getItem = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(getStoredSidebarCollapsed()).toBe(false);
    getItem.mockRestore();
  });

  it('ignores localStorage write failures', () => {
    const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(() => setStoredSidebarWidth(240)).not.toThrow();
    expect(() => setStoredSidebarCollapsed(true)).not.toThrow();
    setItem.mockRestore();
  });

  it('reads and writes collapsed state', () => {
    expect(getStoredSidebarCollapsed()).toBe(false);
    setStoredSidebarCollapsed(true);
    expect(localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY)).toBe('1');
    expect(getStoredSidebarCollapsed()).toBe(true);
    setStoredSidebarCollapsed(false);
    expect(getStoredSidebarCollapsed()).toBe(false);
  });
});
