import { describe, it, expect } from 'vitest';
import {
  formatAttachmentSummary,
  formatEngagedAgents,
  formatMessage,
  formatMessages,
} from './format.js';
import type { WebChatMessage } from './types.js';

describe('format', () => {
  const base: WebChatMessage = {
    id: '1',
    direction: 'outbound',
    text: 'Hello',
    timestamp: 1710000000000,
    platformId: 'lobby',
    threadId: 'main',
    senderName: 'Sarah',
  };

  it('formatMessage includes sender and text', () => {
    const text = formatMessage(base);
    expect(text).toContain('Sarah');
    expect(text).toContain('Hello');
    expect(text).toContain('outbound');
  });

  it('formatMessage labels inbound as You', () => {
    const text = formatMessage({ ...base, direction: 'inbound', senderName: undefined });
    expect(text).toContain('You');
  });

  it('formatMessage uses Agent when senderName missing on outbound', () => {
    const text = formatMessage({ ...base, senderName: undefined });
    expect(text).toContain('Agent');
  });

  it('formatMessage handles empty text and attachments', () => {
    const text = formatMessage({
      ...base,
      text: '',
      attachments: [{ name: 'f.pdf', mimeType: 'application/pdf', type: 'file', size: 100, url: '/api/x' }],
    });
    expect(text).toContain('(no text)');
    expect(text).toContain('f.pdf');
    expect(text).toContain('/api/x');
  });

  it('formatAttachmentSummary includes size when present', () => {
    expect(formatAttachmentSummary({ name: 'a.png', mimeType: 'image/png', type: 'image' })).toContain(
      'a.png',
    );
    expect(
      formatAttachmentSummary({ name: 'a.png', mimeType: 'image/png', type: 'image', size: 50 }),
    ).toContain('50 bytes');
  });

  it('formatMessages returns empty message', () => {
    expect(formatMessages([], 10)).toBe('No messages.');
  });

  it('formatMessages limits count', () => {
    const messages = [1, 2, 3].map((n) => ({
      ...base,
      id: String(n),
      text: `msg ${n}`,
    }));
    const text = formatMessages(messages, 2);
    expect(text).toContain('msg 2');
    expect(text).toContain('msg 3');
    expect(text).not.toContain('msg 1');
  });

  it('formatEngagedAgents omits empty list', () => {
    expect(formatEngagedAgents([])).toBe('');
    expect(formatEngagedAgents(['sarah'])).toContain('sarah');
  });
});
