import { describe, expect, it } from 'vitest';
import { escapeHtml } from './html-escape';

describe('escapeHtml', () => {
  it('escapes html special characters', () => {
    expect(escapeHtml(`<script>"x"&</script>`)).toBe(
      '&lt;script&gt;&quot;x&quot;&amp;&lt;/script&gt;',
    );
  });
});
