export const SCROLL_NEAR_BOTTOM_THRESHOLD = 80;

export function isNearBottom(container: HTMLElement | null, threshold = SCROLL_NEAR_BOTTOM_THRESHOLD): boolean {
  if (!container) return true;
  return container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
}

export function scrollToBottom(container: HTMLElement | null): void {
  if (!container) return;
  container.scrollTop = container.scrollHeight;
}

export function scrollToUnreadAnchor(container: HTMLElement | null, unreadCount: number): void {
  if (!container || unreadCount <= 0) {
    scrollToBottom(container);
    return;
  }
  const msgElements = container.querySelectorAll<HTMLElement>('.msg');
  if (msgElements.length === 0) {
    scrollToBottom(container);
    return;
  }
  const index = Math.max(0, msgElements.length - unreadCount);
  const target = msgElements[index]!;
  const containerStyles = getComputedStyle(container);
  const paddingTop = Number.parseFloat(containerStyles.paddingTop) || 0;
  container.scrollTop = Math.max(0, target.offsetTop - paddingTop);
}
