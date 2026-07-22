import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_MESSAGE_CHANNEL,
  MAX_COMPOSE_TEXT_LENGTH,
  parseAttachmentComposeMessage,
} from './attachment-compose';

const compose = (overrides: Record<string, unknown> = {}) => ({
  channel: ATTACHMENT_MESSAGE_CHANNEL,
  type: 'compose',
  text: 'hello from the preview',
  ...overrides,
});

describe('parseAttachmentComposeMessage', () => {
  it('accepts a well-formed compose message', () => {
    expect(parseAttachmentComposeMessage(compose())).toEqual({
      text: 'hello from the preview',
    });
  });

  it('trims trailing whitespace but preserves interior text', () => {
    expect(parseAttachmentComposeMessage(compose({ text: 'line one\nline two   \n' }))).toEqual({
      text: 'line one\nline two',
    });
  });

  it('rejects non-object payloads', () => {
    expect(parseAttachmentComposeMessage(null)).toBeNull();
    expect(parseAttachmentComposeMessage(undefined)).toBeNull();
    expect(parseAttachmentComposeMessage('compose')).toBeNull();
    expect(parseAttachmentComposeMessage(42)).toBeNull();
  });

  it('rejects a wrong or missing channel', () => {
    expect(parseAttachmentComposeMessage(compose({ channel: 'something-else' }))).toBeNull();
    expect(parseAttachmentComposeMessage(compose({ channel: undefined }))).toBeNull();
  });

  it('rejects a wrong or missing type', () => {
    expect(parseAttachmentComposeMessage(compose({ type: 'send' }))).toBeNull();
    expect(parseAttachmentComposeMessage(compose({ type: undefined }))).toBeNull();
  });

  it('rejects non-string or empty text', () => {
    expect(parseAttachmentComposeMessage(compose({ text: 123 }))).toBeNull();
    expect(parseAttachmentComposeMessage(compose({ text: '' }))).toBeNull();
    expect(parseAttachmentComposeMessage(compose({ text: '   \n  ' }))).toBeNull();
    expect(parseAttachmentComposeMessage(compose({ text: undefined }))).toBeNull();
  });

  it('rejects text longer than the cap', () => {
    const tooLong = 'x'.repeat(MAX_COMPOSE_TEXT_LENGTH + 1);
    expect(parseAttachmentComposeMessage(compose({ text: tooLong }))).toBeNull();
  });

  it('accepts text exactly at the cap', () => {
    const atCap = 'x'.repeat(MAX_COMPOSE_TEXT_LENGTH);
    expect(parseAttachmentComposeMessage(compose({ text: atCap }))).toEqual({ text: atCap });
  });
});
