export const ATTACHMENT_DRAWER_WIDTH_STORAGE_KEY = 'webchat_attachment_drawer_width';
export const ATTACHMENT_DRAWER_MIN_WIDTH = 280;
export const ATTACHMENT_DRAWER_MAX_WIDTH_RATIO = 0.8;
export const ATTACHMENT_DRAWER_DEFAULT_WIDTH = 480;
export const ATTACHMENT_DRAWER_DEFAULT_MAX_VW = 0.45;

export function defaultAttachmentDrawerWidth(viewportWidth = window.innerWidth): number {
  return Math.min(
    ATTACHMENT_DRAWER_DEFAULT_WIDTH,
    viewportWidth * ATTACHMENT_DRAWER_DEFAULT_MAX_VW,
  );
}

export function maxAttachmentDrawerWidth(viewportWidth = window.innerWidth): number {
  return viewportWidth * ATTACHMENT_DRAWER_MAX_WIDTH_RATIO;
}

export function clampAttachmentDrawerWidth(
  width: number,
  viewportWidth = window.innerWidth,
): number {
  return Math.round(
    Math.min(maxAttachmentDrawerWidth(viewportWidth), Math.max(ATTACHMENT_DRAWER_MIN_WIDTH, width)),
  );
}

export function getStoredAttachmentDrawerWidth(viewportWidth = window.innerWidth): number {
  const raw = localStorage.getItem(ATTACHMENT_DRAWER_WIDTH_STORAGE_KEY);
  if (raw != null) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed)) {
      return clampAttachmentDrawerWidth(parsed, viewportWidth);
    }
  }
  return clampAttachmentDrawerWidth(defaultAttachmentDrawerWidth(viewportWidth), viewportWidth);
}

export function setStoredAttachmentDrawerWidth(width: number): void {
  localStorage.setItem(ATTACHMENT_DRAWER_WIDTH_STORAGE_KEY, String(Math.round(width)));
}

export function attachmentDrawerWidthFromDrag(
  startWidth: number,
  startClientX: number,
  clientX: number,
  viewportWidth = window.innerWidth,
): number {
  return clampAttachmentDrawerWidth(startWidth + (startClientX - clientX), viewportWidth);
}

export function resetDrawerBodyScroll(body: HTMLDivElement | null): void {
  if (body) body.scrollTop = 0;
}
