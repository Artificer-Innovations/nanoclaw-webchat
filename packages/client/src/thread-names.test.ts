import { describe, expect, it } from 'vitest';
import { defaultThreadTitle, isAutoThreadTitle, titleFromMessage } from './thread-names';

describe('thread-names', () => {
  it('detects default auto thread titles', () => {
    expect(isAutoThreadTitle('Thread 1')).toBe(true);
    expect(isAutoThreadTitle('Thread 12')).toBe(true);
    expect(isAutoThreadTitle('My topic')).toBe(false);
  });

  it('builds titles from the first line of a message', () => {
    expect(titleFromMessage('hello world')).toBe('hello world');
    expect(titleFromMessage('line one\nline two')).toBe('line one');
    expect(titleFromMessage('   spaced   words   ')).toBe('spaced words');
    expect(titleFromMessage('')).toBe('New thread');
    expect(titleFromMessage('   \n   ')).toBe('New thread');
  });

  it('truncates long message titles', () => {
    const long = 'a'.repeat(60);
    expect(titleFromMessage(long)).toHaveLength(48);
    expect(titleFromMessage(long).endsWith('…')).toBe(true);
  });

  it('keeps titles that are exactly the max length', () => {
    const exact = 'a'.repeat(48);
    expect(titleFromMessage(exact)).toBe(exact);
  });

  it('creates default numbered thread titles', () => {
    expect(defaultThreadTitle(0)).toBe('Thread 1');
    expect(defaultThreadTitle(2)).toBe('Thread 3');
  });
});
