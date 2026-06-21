import { afterEach, describe, expect, it } from 'vitest';
import {
  ATTACHMENT_DRAWER_WIDTH_STORAGE_KEY,
  attachmentDrawerWidthFromDrag,
  attachmentDrawerWidthFromKeyboard,
  clampAttachmentDrawerWidth,
  defaultAttachmentDrawerWidth,
  getStoredAttachmentDrawerWidth,
  resetDrawerBodyScroll,
  setStoredAttachmentDrawerWidth,
} from './attachment-drawer-layout';

describe('attachment-drawer-layout', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('defaults to the smaller of 480px and 45vw', () => {
    expect(defaultAttachmentDrawerWidth(1200)).toBe(480);
    expect(defaultAttachmentDrawerWidth(800)).toBe(360);
  });

  it('clamps drawer width to min and max bounds', () => {
    expect(clampAttachmentDrawerWidth(100, 1000)).toBe(280);
    expect(clampAttachmentDrawerWidth(900, 1000)).toBe(800);
    expect(clampAttachmentDrawerWidth(420, 1000)).toBe(420);
  });

  it('reads and writes stored drawer width', () => {
    setStoredAttachmentDrawerWidth(520);
    expect(localStorage.getItem(ATTACHMENT_DRAWER_WIDTH_STORAGE_KEY)).toBe('520');
    expect(getStoredAttachmentDrawerWidth(1200)).toBe(520);
  });

  it('falls back to default width for invalid stored values', () => {
    localStorage.setItem(ATTACHMENT_DRAWER_WIDTH_STORAGE_KEY, 'not-a-number');
    expect(getStoredAttachmentDrawerWidth(1200)).toBe(480);
  });

  it('computes resized width from drag delta', () => {
    expect(attachmentDrawerWidthFromDrag(400, 900, 850, 1200)).toBe(450);
    expect(attachmentDrawerWidthFromDrag(400, 900, 950, 1200)).toBe(350);
  });

  it('computes resized width from keyboard arrows', () => {
    expect(attachmentDrawerWidthFromKeyboard(400, 'ArrowLeft', 1200)).toBe(420);
    expect(attachmentDrawerWidthFromKeyboard(400, 'ArrowRight', 1200)).toBe(380);
    expect(attachmentDrawerWidthFromKeyboard(400, 'Enter', 1200)).toBeNull();
  });

  it('resets drawer body scroll position', () => {
    const body = document.createElement('div');
    body.scrollTop = 120;
    resetDrawerBodyScroll(body);
    expect(body.scrollTop).toBe(0);
    expect(() => resetDrawerBodyScroll(null)).not.toThrow();
  });
});
