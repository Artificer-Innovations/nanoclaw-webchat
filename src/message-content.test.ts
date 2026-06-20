import { describe, expect, it } from 'vitest';
import { parseMessageContent } from './message-content';

describe('message-content', () => {
  it('parses inline code', () => {
    expect(parseMessageContent('use `npm install` here')).toEqual([
      { type: 'text', value: 'use ' },
      { type: 'code', value: 'npm install' },
      { type: 'text', value: ' here' },
    ]);
  });

  it('parses fenced code blocks', () => {
    expect(parseMessageContent('before\n```\nline one\nline two\n```\nafter')).toEqual([
      { type: 'text', value: 'before\n' },
      { type: 'code-block', value: 'line one\nline two' },
      { type: 'text', value: '\nafter' },
    ]);
  });

  it('parses inline code inside plain text around a code block', () => {
    expect(parseMessageContent('run `foo` then:\n```\nbar\n```')).toEqual([
      { type: 'text', value: 'run ' },
      { type: 'code', value: 'foo' },
      { type: 'text', value: ' then:\n' },
      { type: 'code-block', value: 'bar' },
    ]);
  });

  it('keeps plain text when no inline markers are present', () => {
    expect(parseMessageContent('plain text only')).toEqual([{ type: 'text', value: 'plain text only' }]);
  });

  it('returns an empty text part for empty input', () => {
    expect(parseMessageContent('')).toEqual([{ type: 'text', value: '' }]);
  });

  it('parses empty fenced code blocks', () => {
    expect(parseMessageContent('```\n```')).toEqual([{ type: 'code-block', value: '' }]);
  });

  it('parses inline code at the start or end of a line', () => {
    expect(parseMessageContent('`only`')).toEqual([
      { type: 'code', value: 'only' },
    ]);
    expect(parseMessageContent('`start` rest')).toEqual([
      { type: 'code', value: 'start' },
      { type: 'text', value: ' rest' },
    ]);
  });

  it('parses compact fenced blocks without newlines', () => {
    expect(parseMessageContent('```code```')).toEqual([{ type: 'code-block', value: 'code' }]);
    expect(parseMessageContent('```\ncode\n```')).toEqual([{ type: 'code-block', value: 'code' }]);
  });
});
