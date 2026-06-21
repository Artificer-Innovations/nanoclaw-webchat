import { describe, expect, it } from 'vitest';
import { renderFormattedMessageHtml } from './formatted-message-html';

describe('formatted-message-html', () => {
  it('renders markdown to static html', () => {
    const html = renderFormattedMessageHtml('# Hello');
    expect(html).toContain('formatted-message');
    expect(html).toContain('Hello');
  });
});
