import { describe, expect, it } from 'vitest';
import { isNearBottom, scrollToBottom, scrollToUnreadAnchor } from './chat-scroll';

describe('chat-scroll', () => {
  it('detects when the viewport is near the bottom', () => {
    const container = document.createElement('div');
    Object.defineProperty(container, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 400, configurable: true });
    container.scrollTop = 550;
    expect(isNearBottom(container)).toBe(true);
    container.scrollTop = 0;
    expect(isNearBottom(container)).toBe(false);
  });

  it('scrolls instantly to the bottom', () => {
    const container = document.createElement('div');
    Object.defineProperty(container, 'scrollHeight', { value: 900, configurable: true });
    scrollToBottom(container);
    expect(container.scrollTop).toBe(900);
  });

  it('handles null containers safely', () => {
    expect(isNearBottom(null)).toBe(true);
    expect(() => scrollToBottom(null)).not.toThrow();
    expect(() => scrollToUnreadAnchor(null, 3)).not.toThrow();
  });

  it('falls back to bottom when no message nodes exist', () => {
    const container = document.createElement('div');
    Object.defineProperty(container, 'scrollHeight', { value: 500, configurable: true });
    scrollToUnreadAnchor(container, 3);
    expect(container.scrollTop).toBe(500);
  });

  it('scrolls to the first unread message when unread count is provided', () => {
    const container = document.createElement('div');
    container.style.paddingTop = '16px';
    document.body.appendChild(container);

    const first = document.createElement('div');
    first.className = 'msg';
    Object.defineProperty(first, 'offsetTop', { value: 16, configurable: true });
    const second = document.createElement('div');
    second.className = 'msg';
    Object.defineProperty(second, 'offsetTop', { value: 56, configurable: true });
    const third = document.createElement('div');
    third.className = 'msg';
    Object.defineProperty(third, 'offsetTop', { value: 96, configurable: true });
    container.append(first, second, third);

    scrollToUnreadAnchor(container, 2);

    expect(container.scrollTop).toBe(40);

    container.remove();
  });
});
