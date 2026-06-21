import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ATTACHMENT_HTML_IFRAME_SANDBOX,
  buildCodePopoutDocument,
  buildCsvPopoutDocument,
  buildHtmlPopoutDocument,
  buildMarkdownPopoutDocument,
  buildPlainTextPopoutDocument,
  escapeHtml,
  openHtmlDocumentInNewTab,
} from './attachment-text-popout';

describe('attachment-text-popout', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('escapes html in popout documents', () => {
    expect(escapeHtml(`<script>"x"&</script>`)).toBe(
      '&lt;script&gt;&quot;x&quot;&amp;&lt;/script&gt;',
    );
  });

  it('builds a markdown popout document with preview and raw views', async () => {
    const html = await buildMarkdownPopoutDocument('notes.md', '# Title\n\nbody');
    expect(html).toContain('<title>notes.md</title>');
    expect(html).toContain('id="preview-view"');
    expect(html).toContain('id="raw-view"');
    expect(html).toContain('# Title');
    expect(html).toContain('Title');
    expect(html).toContain('Preview</button>');
    expect(html).toContain('Raw</button>');
  });

  it('builds a plain text popout document with preserved whitespace', () => {
    const html = buildPlainTextPopoutDocument('notes.txt', 'line one\n\nline two');
    expect(html).toContain('<pre class="raw-text">line one\n\nline two</pre>');
    expect(html).not.toContain('Preview</button>');
  });

  it('builds a code popout document with syntax highlighting', () => {
    const html = buildCodePopoutDocument('app.ts', 'const x = 1;', 'typescript');
    expect(html).toContain('language-typescript');
    expect(html).toContain('const x = 1;');
    expect(html).toContain('Preview</button>');
  });

  it('builds an html popout document with sandboxed preview', () => {
    const html = buildHtmlPopoutDocument('page.html', '<h1>Hello</h1>');
    expect(html).toContain(`sandbox="${ATTACHMENT_HTML_IFRAME_SANDBOX}"`);
    expect(html).toContain('srcdoc="&lt;h1&gt;Hello&lt;/h1&gt;"');
    expect(html).toContain('Preview</button>');
  });

  it('builds a csv popout document with table preview', () => {
    const html = buildCsvPopoutDocument('data.csv', 'Name,Count\nAlpha,1', 'data.csv');
    expect(html).toContain('<table class="csv-table">');
    expect(html).toContain('Alpha');
    expect(html).toContain('Preview</button>');
  });

  it('opens html documents in a new tab', () => {
    vi.useFakeTimers();
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window);
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:html');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    expect(openHtmlDocumentInNewTab('<html></html>')).toBe(true);
    expect(open).toHaveBeenCalledWith('blob:html', '_blank', 'noopener,noreferrer');
    vi.advanceTimersByTime(60_000);
    expect(revoke).toHaveBeenCalledWith('blob:html');
    vi.useRealTimers();
    createObjectURL.mockRestore();
  });

  it('returns false when a popout tab cannot be opened', () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:html');
    vi.spyOn(window, 'open').mockReturnValue(null);
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    expect(openHtmlDocumentInNewTab('<html></html>')).toBe(false);
    expect(revoke).toHaveBeenCalledWith('blob:html');
  });
});
