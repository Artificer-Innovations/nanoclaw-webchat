import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ATTACHMENT_HTML_IFRAME_SANDBOX,
  ATTACHMENT_SVG_IFRAME_SANDBOX,
  buildCodePopoutDocument,
  buildCsvPopoutDocument,
  buildHtmlPopoutDocument,
  buildMarkdownPopoutDocument,
  buildPlainTextPopoutDocument,
  buildVideoPopoutDocument,
  buildAudioPopoutDocument,
  openHtmlDocumentInNewTab,
} from './attachment-text-popout';

describe('attachment-text-popout', () => {
  afterEach(() => {
    vi.restoreAllMocks();
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

  it('builds a video popout document with native controls', () => {
    const html = buildVideoPopoutDocument(
      'clip.mp4',
      'http://127.0.0.1:3200/api/attachments/msg-1/clip.mp4?token=secret',
      'video/mp4',
    );
    expect(html).toContain('<title>clip.mp4</title>');
    expect(html).toContain('id="attachment-video"');
    expect(html).toContain('class="video-preview"');
    expect(html).toContain('id="attachment-video-fallback"');
    expect(html).toContain('src="http://127.0.0.1:3200/api/attachments/msg-1/clip.mp4?token=secret"');
    expect(html).not.toContain('<source');
    expect(html).toContain('controls');
    expect(html).toContain('playsinline');
    expect(html).toContain('video.canPlayType("video/mp4")');
  });

  it('builds an audio popout document with native controls', () => {
    const html = buildAudioPopoutDocument(
      'song.mp3',
      'http://127.0.0.1:3200/api/attachments/msg-1/song.mp3?token=secret',
    );
    expect(html).toContain('<title>song.mp3</title>');
    expect(html).toContain('class="audio-preview"');
    expect(html).toContain('src="http://127.0.0.1:3200/api/attachments/msg-1/song.mp3?token=secret"');
    expect(html).not.toContain('<source');
    expect(html).toContain('controls');
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

  it('defines a stricter sandbox for svg previews than html', () => {
    expect(ATTACHMENT_SVG_IFRAME_SANDBOX).not.toContain('allow-scripts');
    expect(ATTACHMENT_HTML_IFRAME_SANDBOX).toContain('allow-scripts');
  });

  it('lets html preview popups escape the sandbox without granting same-origin', () => {
    // target="_blank"/open-in-new-tab must land on a normal page, not a sandboxed one.
    expect(ATTACHMENT_HTML_IFRAME_SANDBOX).toContain('allow-popups-to-escape-sandbox');
    // but never same-origin — the escaped popup must not be able to reach parent/token state.
    expect(ATTACHMENT_HTML_IFRAME_SANDBOX).not.toContain('allow-same-origin');
    // escaping applies to popups only; svg previews stay locked down.
    expect(ATTACHMENT_SVG_IFRAME_SANDBOX).not.toContain('allow-popups-to-escape-sandbox');
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
