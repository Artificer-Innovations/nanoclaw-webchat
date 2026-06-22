import { afterEach, describe, expect, it, vi } from 'vitest';
import * as attachmentsModule from './attachments';
import * as popoutModule from './attachment-text-popout';
import {
  attachmentDataUrl,
  ATTACHMENT_HTML_IFRAME_SANDBOX,
  attachmentIframeSandbox,
  attachmentPreviewMode,
  attachmentPreviewUrl,
  attachmentToBlob,
  attachmentTypeFromMime,
  attachmentTypeLabel,
  attachmentSupportsPopOut,
  attachmentSupportsPreviewToggle,
  attachmentTextCategory,
  attachmentUsesCodePreview,
  attachmentUsesCsvPreview,
  attachmentUsesFormattedMessagePreview,
  attachmentUsesHtmlPreview,
  attachmentUsesIframePreview,
  copyAttachmentContent,
  copyAttachmentForPreview,
  copyAttachmentLink,
  decodeAttachmentTextFromData,
  downloadAttachment,
  fetchAttachmentBlob,
  fetchAttachmentText,
  formatAttachmentRejections,
  formatAttachmentSize,
  inferMimeType,
  isSafeAttachmentUrl,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  mergePendingAttachments,
  normalizeAttachment,
  openAttachmentInNewTab,
  openMarkdownAttachmentInNewTab,
  openCodeAttachmentInNewTab,
  openCsvAttachmentInNewTab,
  openHtmlAttachmentInNewTab,
  openPlainTextAttachmentInNewTab,
  readAttachmentFiles,
  removePendingAtIndex,
  revokeAttachmentPreviews,
  type PendingAttachment,
} from './attachments';

describe('attachments', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('infers MIME types from filenames', () => {
    expect(inferMimeType('notes.md')).toBe('text/markdown');
    expect(inferMimeType('app.ts')).toBe('text/typescript');
    expect(inferMimeType('Main.java')).toBe('text/x-java-source');
    expect(inferMimeType('styles.css')).toBe('text/css');
    expect(inferMimeType('script.py')).toBe('text/x-python');
    expect(inferMimeType('index.php')).toBe('text/x-php');
    expect(inferMimeType('main.c')).toBe('text/x-c');
    expect(inferMimeType('header.h')).toBe('text/x-c');
    expect(inferMimeType('lib.cpp')).toBe('text/x-c++');
    expect(inferMimeType('types.hpp')).toBe('text/x-c++');
    expect(inferMimeType('doc.pdf', 'application/pdf')).toBe('application/pdf');
    expect(inferMimeType('unknown.xyz')).toBe('application/octet-stream');
    expect(inferMimeType('README')).toBe('application/octet-stream');
  });

  it('classifies attachment types from MIME', () => {
    expect(attachmentTypeFromMime('image/png')).toBe('image');
    expect(attachmentTypeFromMime('text/markdown')).toBe('file');
  });

  it('labels attachment types for metadata display', () => {
    expect(attachmentTypeLabel('image')).toBe('Image');
    expect(attachmentTypeLabel('file')).toBe('File');
  });

  it('classifies attachment preview modes', () => {
    expect(attachmentPreviewMode('text/plain')).toBe('text');
    expect(attachmentPreviewMode('text/markdown')).toBe('text');
    expect(attachmentPreviewMode('text/javascript', 'app.js')).toBe('text');
    expect(attachmentPreviewMode('application/octet-stream', 'app.js')).toBe('text');
    expect(attachmentPreviewMode('image/png')).toBe('embed');
    expect(attachmentPreviewMode('application/pdf')).toBe('embed');
    expect(attachmentPreviewMode('text/html')).toBe('text');
    expect(attachmentPreviewMode('text/csv')).toBe('text');
    expect(attachmentPreviewMode('application/zip')).toBe('metadata');
  });

  it('classifies text attachment categories', () => {
    expect(attachmentTextCategory('text/markdown', 'notes.md')).toBe('markdown');
    expect(attachmentTextCategory('text/plain', 'notes.txt')).toBe('plain');
    expect(attachmentTextCategory('text/html', 'page.html')).toBe('html');
    expect(attachmentTextCategory('text/csv', 'data.csv')).toBe('csv');
    expect(attachmentTextCategory('application/octet-stream', 'data.csv')).toBe('csv');
    expect(attachmentTextCategory('text/javascript', 'app.js')).toBe('code');
    expect(attachmentTextCategory('application/octet-stream', 'app.ts')).toBe('code');
    expect(attachmentTextCategory('application/zip', 'archive.zip')).toBeNull();
  });

  it('classifies iframe preview and sandbox settings', () => {
    expect(attachmentUsesIframePreview('application/pdf')).toBe(true);
    expect(attachmentUsesIframePreview('text/html')).toBe(false);
    expect(attachmentUsesIframePreview('image/png')).toBe(false);
    expect(attachmentIframeSandbox('text/html')).toBe(ATTACHMENT_HTML_IFRAME_SANDBOX);
    expect(ATTACHMENT_HTML_IFRAME_SANDBOX).not.toContain('allow-same-origin');
    expect(attachmentIframeSandbox('application/pdf')).toBeUndefined();
  });

  it('classifies pop-out and preview toggle support', () => {
    expect(attachmentSupportsPopOut('text/plain')).toBe(true);
    expect(attachmentSupportsPopOut('text/markdown')).toBe(true);
    expect(attachmentSupportsPopOut('text/javascript', 'app.js')).toBe(true);
    expect(attachmentSupportsPopOut('text/html', 'page.html')).toBe(true);
    expect(attachmentSupportsPopOut('image/png')).toBe(true);
    expect(attachmentSupportsPopOut('application/zip')).toBe(false);
    expect(attachmentSupportsPreviewToggle('text/markdown')).toBe(true);
    expect(attachmentSupportsPreviewToggle('text/plain')).toBe(false);
    expect(attachmentSupportsPreviewToggle('text/javascript', 'app.js')).toBe(true);
    expect(attachmentSupportsPreviewToggle('text/html', 'page.html')).toBe(true);
    expect(attachmentSupportsPreviewToggle('text/csv', 'data.csv')).toBe(true);
    expect(attachmentUsesFormattedMessagePreview('text/markdown')).toBe(true);
    expect(attachmentUsesFormattedMessagePreview('text/plain')).toBe(false);
    expect(attachmentUsesCsvPreview('text/csv', 'data.csv')).toBe(true);
    expect(attachmentUsesCodePreview('text/javascript', 'app.js')).toBe(true);
    expect(attachmentUsesHtmlPreview('text/html', 'page.html')).toBe(true);
  });

  it('formats attachment sizes', () => {
    expect(formatAttachmentSize(undefined)).toBe('Unknown');
    expect(formatAttachmentSize(512)).toBe('512 B');
    expect(formatAttachmentSize(2048)).toBe('2.0 KB');
    expect(formatAttachmentSize(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatAttachmentSize(2 * 1024 * 1024 * 1024)).toBe('2.0 GB');
  });

  it('decodes attachment text from base64 data', () => {
    expect(decodeAttachmentTextFromData('aGVsbG8=')).toBe('hello');
    const decode = vi.spyOn(global, 'atob').mockImplementation(() => {
      throw new Error('invalid base64');
    });
    expect(decodeAttachmentTextFromData('bad')).toBeNull();
    decode.mockRestore();
  });

  it('normalizes attachment type from mimeType', () => {
    expect(
      normalizeAttachment({
        name: 'photo.png',
        mimeType: 'image/png',
        type: 'file',
      }),
    ).toMatchObject({ type: 'image' });
  });

  it('formats rejection messages', () => {
    expect(
      formatAttachmentRejections([
        { name: 'big.png', reason: 'too_large' },
        { name: 'bad.txt', reason: 'read_failed' },
        { name: 'extra.txt', reason: 'capacity' },
      ]),
    ).toBe(
      'big.png exceeds the 5 MB limit; Could not read bad.txt; Only 4 attachments allowed (extra.txt skipped)',
    );
    expect(formatAttachmentRejections([])).toBeNull();
  });

  it('leaves matching attachment types unchanged', () => {
    const att = { name: 'a.png', mimeType: 'image/png', type: 'image' as const };
    expect(normalizeAttachment(att)).toBe(att);
  });

  it('merges pending attachments without exceeding the cap', () => {
    const make = (name: string, previewUrl: string): PendingAttachment => ({
      name,
      mimeType: 'text/plain',
      type: 'file',
      previewUrl,
      data: 'x',
    });
    const prev = [make('a.txt', 'blob:a'), make('b.txt', 'blob:b'), make('c.txt', 'blob:c')];
    const next = [make('d.txt', 'blob:d'), make('e.txt', 'blob:e')];
    const revoke = vi.spyOn(URL, 'revokeObjectURL');

    const { attachments, dropped } = mergePendingAttachments(prev, next);
    expect(attachments).toHaveLength(MAX_ATTACHMENTS);
    expect(dropped).toHaveLength(1);
    revokeAttachmentPreviews(dropped);
    expect(revoke).toHaveBeenCalledWith('blob:e');
    revoke.mockRestore();
  });

  it('revokes all incoming previews when already at capacity', () => {
    const make = (name: string, previewUrl: string): PendingAttachment => ({
      name,
      mimeType: 'text/plain',
      type: 'file',
      previewUrl,
      data: 'x',
    });
    const prev = Array.from({ length: MAX_ATTACHMENTS }, (_, i) => make(`file-${i}.txt`, `blob:${i}`));
    const next = [make('extra.txt', 'blob:extra')];
    const revoke = vi.spyOn(URL, 'revokeObjectURL');

    const { attachments, dropped } = mergePendingAttachments(prev, next);
    expect(attachments).toEqual(prev);
    expect(dropped).toEqual(next);
    revokeAttachmentPreviews(dropped);
    expect(revoke).toHaveBeenCalledWith('blob:extra');
    revoke.mockRestore();
  });

  it('reads image files as base64 attachments', async () => {
    const file = new File(['hello'], 'photo.png', { type: 'image/png' });
    const { attachments } = await readAttachmentFiles([file]);
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({
      name: 'photo.png',
      mimeType: 'image/png',
      type: 'image',
      size: 5,
    });
    expect(attachments[0]?.data).toBeTruthy();
    URL.revokeObjectURL(attachments[0]!.previewUrl);
  });

  it('reads non-image files such as markdown', async () => {
    const file = new File(['# Title'], 'notes.md', { type: 'text/markdown' });
    const { attachments } = await readAttachmentFiles([file]);
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({
      name: 'notes.md',
      mimeType: 'text/markdown',
      type: 'file',
    });
    URL.revokeObjectURL(attachments[0]!.previewUrl);
  });

  it('respects max attachment count', async () => {
    const files = Array.from({ length: MAX_ATTACHMENTS + 2 }, (_, i) =>
      new File(['x'], `photo-${i}.png`, { type: 'image/png' }),
    );
    const { attachments, rejected } = await readAttachmentFiles(files);
    expect(attachments).toHaveLength(MAX_ATTACHMENTS);
    expect(rejected).toHaveLength(2);
    attachments.forEach((att) => URL.revokeObjectURL(att.previewUrl));
  });

  it('respects existing attachment count', async () => {
    const files = [new File(['x'], 'a.png', { type: 'image/png' }), new File(['y'], 'b.png', { type: 'image/png' })];
    const { attachments } = await readAttachmentFiles(files, MAX_ATTACHMENTS - 1);
    expect(attachments).toHaveLength(1);
    URL.revokeObjectURL(attachments[0]!.previewUrl);
  });

  it('reports files over the size limit', async () => {
    const big = new File([new Uint8Array(MAX_ATTACHMENT_BYTES + 1)], 'big.png', {
      type: 'image/png',
    });
    const { attachments, rejected } = await readAttachmentFiles([big]);
    expect(attachments).toHaveLength(0);
    expect(rejected).toEqual([{ name: 'big.png', reason: 'too_large' }]);
  });

  it('builds data URLs from stored attachments', () => {
    expect(
      attachmentDataUrl({
        name: 'a.png',
        mimeType: 'image/png',
        type: 'image',
        data: 'aGVsbG8=',
      }),
    ).toBe('data:image/png;base64,aGVsbG8=');
    expect(
      attachmentDataUrl(
        {
          name: 'a.png',
          mimeType: 'image/png',
          type: 'image',
          url: '/api/attachments/msg-1/a.png',
        },
        'secret',
      ),
    ).toBe('/api/attachments/msg-1/a.png?token=secret');
    expect(
      attachmentDataUrl({
        name: 'a.png',
        mimeType: 'image/png',
        type: 'image',
      }),
    ).toBeNull();
  });

  it('prefers inline data over persisted url', () => {
    expect(
      attachmentDataUrl({
        name: 'a.png',
        mimeType: 'image/png',
        type: 'image',
        data: 'aGVsbG8=',
        url: '/api/attachments/msg-1/a.png',
      }),
    ).toBe('data:image/png;base64,aGVsbG8=');
  });

  it('rejects unsafe attachment urls', () => {
    expect(isSafeAttachmentUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeAttachmentUrl('//evil.example/api/attachments/msg/x')).toBe(false);
    expect(isSafeAttachmentUrl('/api/attachments/http://evil/x')).toBe(false);
    expect(isSafeAttachmentUrl('/api/attachments/msg/data:text/html,x')).toBe(false);
    expect(
      attachmentDataUrl({
        name: 'x',
        mimeType: 'text/plain',
        type: 'file',
        url: 'javascript:alert(1)',
      }),
    ).toBeNull();
    expect(
      attachmentDataUrl({
        name: 'x',
        mimeType: 'text/plain',
        type: 'file',
        url: '//evil.example/api/attachments/msg/x',
      }),
    ).toBeNull();
    expect(
      attachmentDataUrl({
        name: 'x',
        mimeType: 'text/plain',
        type: 'file',
        url: '/other/path',
      }),
    ).toBeNull();
    expect(
      openAttachmentInNewTab({
        name: 'x',
        mimeType: 'text/plain',
        type: 'file',
        url: 'https://evil.example/a.png',
      }),
    ).toBe(false);
  });

  it('uses stored token and appends query params for persisted urls', () => {
    sessionStorage.setItem('webchat_token', 'stored-secret');
    expect(
      attachmentDataUrl({
        name: 'a.png',
        mimeType: 'image/png',
        type: 'image',
        url: '/api/attachments/msg-1/a.png?size=1',
      }),
    ).toBe('/api/attachments/msg-1/a.png?size=1&token=stored-secret');
    expect(
      attachmentDataUrl({
        name: 'a.png',
        mimeType: 'image/png',
        type: 'image',
        url: '/api/attachments/msg-1/a.png',
      }),
    ).toBe('/api/attachments/msg-1/a.png?token=stored-secret');
    sessionStorage.removeItem('webchat_token');
    expect(
      attachmentDataUrl({
        name: 'a.png',
        mimeType: 'image/png',
        type: 'image',
        url: '/api/attachments/msg-1/a.png',
      }),
    ).toBe('/api/attachments/msg-1/a.png');
  });

  it('opens persisted attachments via url when data is absent', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window);
    expect(
      openAttachmentInNewTab(
        {
          name: 'photo.png',
          mimeType: 'image/png',
          type: 'image',
          url: '/api/attachments/msg-1/photo.png',
        },
        'secret',
      ),
    ).toBe(true);
    expect(open).toHaveBeenCalledWith(
      '/api/attachments/msg-1/photo.png?token=secret',
      '_blank',
      'noopener,noreferrer',
    );
    sessionStorage.setItem('webchat_token', 'stored');
    expect(
      openAttachmentInNewTab({
        name: 'photo.png',
        mimeType: 'image/png',
        type: 'image',
        url: '/api/attachments/msg-1/photo.png',
      }),
    ).toBe(true);
    expect(open).toHaveBeenCalledWith(
      '/api/attachments/msg-1/photo.png?token=stored',
      '_blank',
      'noopener,noreferrer',
    );
    sessionStorage.removeItem('webchat_token');
    open.mockRestore();
  });

  it('decodes attachments to blobs and opens them in a new tab', () => {
    const att = {
      name: 'photo.png',
      mimeType: 'image/png',
      type: 'image' as const,
      data: 'aGVsbG8=',
    };
    const blob = attachmentToBlob(att);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob?.type).toBe('image/png');

    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:opened');
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window);
    expect(openAttachmentInNewTab(att)).toBe(true);
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(open).toHaveBeenCalledWith('blob:opened', '_blank', 'noopener,noreferrer');
    createObjectURL.mockRestore();
    open.mockRestore();
  });

  it('opens markdown attachments in a rendered popout document', async () => {
    const openDoc = vi.spyOn(popoutModule, 'openHtmlDocumentInNewTab').mockReturnValue(true);
    expect(
      await openMarkdownAttachmentInNewTab({
        name: 'notes.md',
        mimeType: 'text/markdown',
        type: 'file',
        data: 'IyBQb3BvdXQ=',
      }),
    ).toBe(true);
    expect(openDoc).toHaveBeenCalled();
    const html = openDoc.mock.calls[0]![0] as string;
    expect(html).toContain('Popout');
    expect(html).toContain('Preview</button>');
  });

  it('opens plain text attachments in a pre-wrap popout document', async () => {
    const openDoc = vi.spyOn(popoutModule, 'openHtmlDocumentInNewTab').mockReturnValue(true);
    expect(
      await openPlainTextAttachmentInNewTab({
        name: 'notes.txt',
        mimeType: 'text/plain',
        type: 'file',
        data: btoa('line one\n\nline two'),
      }),
    ).toBe(true);
    const html = openDoc.mock.calls[0]![0] as string;
    expect(html).toContain('line one');
    expect(html).toContain('line two');
    expect(html).not.toContain('Preview</button>');
  });

  it('returns false when plain text popout text cannot load', async () => {
    vi.spyOn(attachmentsModule, 'fetchAttachmentText').mockResolvedValue(null);
    expect(
      await openPlainTextAttachmentInNewTab({
        name: 'notes.txt',
        mimeType: 'text/plain',
        type: 'file',
        url: '/api/attachments/msg-1/notes.txt',
      }),
    ).toBe(false);
  });

  it('opens code attachments in a syntax-highlighted popout document', async () => {
    const openDoc = vi.spyOn(popoutModule, 'openHtmlDocumentInNewTab').mockReturnValue(true);
    expect(
      await openCodeAttachmentInNewTab({
        name: 'app.ts',
        mimeType: 'text/typescript',
        type: 'file',
        data: btoa('const x = 1;'),
      }),
    ).toBe(true);
    const html = openDoc.mock.calls[0]![0] as string;
    expect(html).toContain('const x = 1;');
    expect(html).toContain('Preview</button>');
    expect(html).toContain('language-typescript');
  });

  it('returns false when code popout text cannot load', async () => {
    vi.spyOn(attachmentsModule, 'fetchAttachmentText').mockResolvedValue(null);
    expect(
      await openCodeAttachmentInNewTab({
        name: 'app.ts',
        mimeType: 'text/typescript',
        type: 'file',
        url: '/api/attachments/msg-1/app.ts',
      }),
    ).toBe(false);
  });

  it('returns false when code language cannot be inferred', async () => {
    vi.spyOn(attachmentsModule, 'fetchAttachmentText').mockResolvedValue('hello');
    expect(
      await openCodeAttachmentInNewTab({
        name: 'unknown.xyz',
        mimeType: 'application/octet-stream',
        type: 'file',
        data: btoa('hello'),
      }),
    ).toBe(false);
  });

  it('opens html attachments in a preview/raw popout document', async () => {
    const openDoc = vi.spyOn(popoutModule, 'openHtmlDocumentInNewTab').mockReturnValue(true);
    expect(
      await openHtmlAttachmentInNewTab({
        name: 'page.html',
        mimeType: 'text/html',
        type: 'file',
        data: btoa('<h1>Hello</h1>'),
      }),
    ).toBe(true);
    const html = openDoc.mock.calls[0]![0] as string;
    expect(html).toContain('srcdoc="&lt;h1&gt;Hello&lt;/h1&gt;"');
    expect(html).toContain('Preview</button>');
  });

  it('returns false when html popout text cannot load', async () => {
    vi.spyOn(attachmentsModule, 'fetchAttachmentText').mockResolvedValue(null);
    expect(
      await openHtmlAttachmentInNewTab({
        name: 'page.html',
        mimeType: 'text/html',
        type: 'file',
        url: '/api/attachments/msg-1/page.html',
      }),
    ).toBe(false);
  });

  it('opens csv attachments in a table popout document', async () => {
    const openDoc = vi.spyOn(popoutModule, 'openHtmlDocumentInNewTab').mockReturnValue(true);
    expect(
      await openCsvAttachmentInNewTab({
        name: 'data.csv',
        mimeType: 'text/csv',
        type: 'file',
        data: btoa('Name,Count\nAlpha,1'),
      }),
    ).toBe(true);
    const html = openDoc.mock.calls[0]![0] as string;
    expect(html).toContain('<table class="csv-table">');
    expect(html).toContain('Alpha');
    expect(html).toContain('Preview</button>');
  });

  it('returns false when csv popout text cannot load', async () => {
    vi.spyOn(attachmentsModule, 'fetchAttachmentText').mockResolvedValue(null);
    expect(
      await openCsvAttachmentInNewTab({
        name: 'data.csv',
        mimeType: 'text/csv',
        type: 'file',
        url: '/api/attachments/msg-1/data.csv',
      }),
    ).toBe(false);
  });

  it('returns false when markdown popout text cannot load', async () => {
    vi.spyOn(attachmentsModule, 'fetchAttachmentText').mockResolvedValue(null);
    expect(
      await openMarkdownAttachmentInNewTab({
        name: 'notes.md',
        mimeType: 'text/markdown',
        type: 'file',
        url: '/api/attachments/msg-1/notes.md',
      }),
    ).toBe(false);
  });

  it('returns false when markdown popout tab cannot be opened', async () => {
    vi.spyOn(popoutModule, 'openHtmlDocumentInNewTab').mockReturnValue(false);
    expect(
      await openMarkdownAttachmentInNewTab({
        name: 'notes.md',
        mimeType: 'text/markdown',
        type: 'file',
        data: 'IyBQb3BvdXQ=',
      }),
    ).toBe(false);
  });

  it('returns false when a new tab cannot be opened', () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:opened');
    vi.spyOn(window, 'open').mockReturnValue(null);
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    expect(
      openAttachmentInNewTab({
        name: 'photo.png',
        mimeType: 'image/png',
        type: 'image',
        data: 'aGVsbG8=',
      }),
    ).toBe(false);
    expect(revoke).toHaveBeenCalledWith('blob:opened');
    revoke.mockRestore();
  });

  it('returns null for invalid attachment data', () => {
    expect(attachmentToBlob({ name: 'x', mimeType: 'text/plain', type: 'file' })).toBeNull();
    const att = { name: 'bad.bin', mimeType: 'application/octet-stream', type: 'file' as const, data: 'abc' };
    const decode = vi.spyOn(global, 'atob').mockImplementation(() => {
      throw new Error('invalid base64');
    });
    expect(attachmentToBlob(att)).toBeNull();
    expect(openAttachmentInNewTab(att)).toBe(false);
    decode.mockRestore();
  });

  it('revokes blob URLs after opening a tab', () => {
    vi.useFakeTimers();
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:opened');
    vi.spyOn(window, 'open').mockReturnValue({} as Window);
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    try {
      openAttachmentInNewTab({
        name: 'photo.png',
        mimeType: 'image/png',
        type: 'image',
        data: 'aGVsbG8=',
      });
      vi.advanceTimersByTime(60_000);
      expect(revoke).toHaveBeenCalledWith('blob:opened');
    } finally {
      createObjectURL.mockRestore();
      revoke.mockRestore();
      vi.useRealTimers();
    }
  });

  it('uses preview URLs when present', () => {
    expect(
      attachmentPreviewUrl({
        name: 'a.png',
        mimeType: 'image/png',
        type: 'image',
        previewUrl: 'blob:preview',
        data: 'aGVsbG8=',
      }),
    ).toBe('blob:preview');
    expect(
      attachmentPreviewUrl({
        name: 'a.png',
        mimeType: 'image/png',
        type: 'image',
        data: 'aGVsbG8=',
      }),
    ).toBe('data:image/png;base64,aGVsbG8=');
  });

  it('reads raw base64 results without a data URL prefix', async () => {
    const Original = global.FileReader;
    class RawReader extends Original {
      readAsDataURL() {
        Object.defineProperty(this, 'result', { value: 'rawbase64', configurable: true });
        this.onload?.({ target: this } as ProgressEvent<FileReader>);
      }
    }
    vi.stubGlobal('FileReader', RawReader);
    const { attachments } = await readAttachmentFiles([new File(['x'], 'a.txt', { type: 'text/plain' })]);
    expect(attachments[0]?.data).toBe('rawbase64');
    URL.revokeObjectURL(attachments[0]!.previewUrl);
    vi.stubGlobal('FileReader', Original);
  });

  it('reports FileReader errors per file without failing the batch', async () => {
    const Original = global.FileReader;
    class ErrorReader extends Original {
      readAsDataURL() {
        this.onerror?.(new ProgressEvent('error'));
      }
    }
    vi.stubGlobal('FileReader', ErrorReader);
    const good = new File(['x'], 'good.txt', { type: 'text/plain' });
    const bad = new File(['x'], 'bad.txt', { type: 'text/plain' });
    const { attachments, rejected } = await readAttachmentFiles([good, bad]);
    expect(attachments).toHaveLength(0);
    expect(rejected).toEqual([
      { name: 'good.txt', reason: 'read_failed' },
      { name: 'bad.txt', reason: 'read_failed' },
    ]);
    vi.stubGlobal('FileReader', Original);
  });

  it('rejects non-string FileReader results per file', async () => {
    const Original = global.FileReader;
    class BadReader extends Original {
      readAsDataURL() {
        Object.defineProperty(this, 'result', { value: new ArrayBuffer(8), configurable: true });
        this.onload?.({ target: this } as ProgressEvent<FileReader>);
      }
    }
    vi.stubGlobal('FileReader', BadReader);
    const { attachments, rejected } = await readAttachmentFiles([
      new File(['x'], 'a.txt', { type: 'text/plain' }),
    ]);
    expect(attachments).toHaveLength(0);
    expect(rejected).toEqual([{ name: 'a.txt', reason: 'read_failed' }]);
    vi.stubGlobal('FileReader', Original);
  });

  it('removes pending attachments by index', () => {
    const pending = [
      {
        name: 'a.png',
        mimeType: 'image/png',
        type: 'image' as const,
        previewUrl: 'blob:a',
        data: 'a',
      },
    ];
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    expect(removePendingAtIndex(pending, 3)).toEqual(pending);
    expect(revoke).not.toHaveBeenCalled();

    expect(removePendingAtIndex(pending, 0)).toEqual([]);
    expect(revoke).toHaveBeenCalledWith('blob:a');
    revoke.mockRestore();
  });

  it('skips unnamed files and respects attachment capacity', async () => {
    const blank = new File(['x'], '   ', { type: 'text/plain' });
    expect((await readAttachmentFiles([blank])).attachments).toHaveLength(0);

    const full = Array.from({ length: MAX_ATTACHMENTS }, (_, i) =>
      new File(['x'], `file-${i}.txt`, { type: 'text/plain' }),
    );
    const loaded = await readAttachmentFiles(full);
    loaded.attachments.forEach((att) => URL.revokeObjectURL(att.previewUrl));
    const overflow = await readAttachmentFiles([new File(['y'], 'extra.txt')], MAX_ATTACHMENTS);
    expect(overflow.attachments).toHaveLength(0);
    expect(overflow.rejected).toEqual([{ name: 'extra.txt', reason: 'capacity' }]);
  });

  it('fetches attachment text from inline data and persisted urls', async () => {
    expect(
      await fetchAttachmentText({
        name: 'notes.md',
        mimeType: 'text/markdown',
        type: 'file',
        data: 'aGVsbG8=',
      }),
    ).toBe('hello');

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, text: async () => 'from server' }) as Response),
    );
    expect(
      await fetchAttachmentText({
        name: 'notes.md',
        mimeType: 'text/markdown',
        type: 'file',
        url: '/api/attachments/msg-1/notes.md',
      }, 'secret'),
    ).toBe('from server');
    expect(fetch).toHaveBeenCalledWith('/api/attachments/msg-1/notes.md?token=secret');
    vi.unstubAllGlobals();
  });

  it('returns null when attachment text cannot be fetched', async () => {
    expect(
      await fetchAttachmentText({
        name: 'notes.md',
        mimeType: 'text/markdown',
        type: 'file',
      }),
    ).toBeNull();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, text: async () => '' }) as Response),
    );
    expect(
      await fetchAttachmentText({
        name: 'notes.md',
        mimeType: 'text/markdown',
        type: 'file',
        url: '/api/attachments/msg-1/notes.md',
      }),
    ).toBeNull();
    vi.unstubAllGlobals();
  });

  it('returns null when attachment text fetch fails on the network', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network');
    }));
    expect(
      await fetchAttachmentText({
        name: 'notes.md',
        mimeType: 'text/markdown',
        type: 'file',
        url: '/api/attachments/msg-1/notes.md',
      }, 'secret'),
    ).toBeNull();
    vi.unstubAllGlobals();
  });

  it('returns null when attachment blob fetch fails on the network', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network');
    }));
    expect(
      await fetchAttachmentBlob({
        name: 'photo.png',
        mimeType: 'image/png',
        type: 'image',
        url: '/api/attachments/msg-1/photo.png',
      }, 'secret'),
    ).toBeNull();
    vi.unstubAllGlobals();
  });

  it('fetches attachment blobs from inline data and persisted urls', async () => {
    const fromData = await fetchAttachmentBlob({
      name: 'photo.png',
      mimeType: 'image/png',
      type: 'image',
      data: 'aGVsbG8=',
    });
    expect(fromData).toBeInstanceOf(Blob);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, blob: async () => new Blob(['x'], { type: 'text/plain' }) }) as Response),
    );
    const fromUrl = await fetchAttachmentBlob({
      name: 'notes.txt',
      mimeType: 'text/plain',
      type: 'file',
      url: '/api/attachments/msg-1/notes.txt',
    }, 'secret');
    expect(fromUrl).toBeInstanceOf(Blob);
    vi.unstubAllGlobals();
  });

  it('downloads attachments via a temporary object url', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:download');
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const click = vi.fn();
    const remove = vi.fn();
    const anchor = {
      href: '',
      download: '',
      rel: '',
      click,
      remove,
    } as unknown as HTMLAnchorElement;
    const createElement = vi.spyOn(document, 'createElement').mockReturnValue(anchor);
    const appendChild = vi.spyOn(document.body, 'appendChild').mockImplementation(() => anchor);

    expect(
      await downloadAttachment({
        name: 'photo.png',
        mimeType: 'image/png',
        type: 'image',
        data: 'aGVsbG8=',
      }),
    ).toBe(true);
    expect(createObjectURL).toHaveBeenCalled();
    expect(anchor.download).toBe('photo.png');
    expect(click).toHaveBeenCalled();
    expect(remove).toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledWith('blob:download');

    createObjectURL.mockRestore();
    revoke.mockRestore();
    createElement.mockRestore();
    appendChild.mockRestore();
  });

  it('returns false when attachment download fails', async () => {
    expect(
      await downloadAttachment({
        name: 'missing.bin',
        mimeType: 'application/octet-stream',
        type: 'file',
      }),
    ).toBe(false);
  });

  it('copies attachment links and content to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });

    expect(
      await copyAttachmentLink(
        {
          name: 'photo.png',
          mimeType: 'image/png',
          type: 'image',
          url: '/api/attachments/msg-1/photo.png',
        },
        'secret',
      ),
    ).toBe(true);
    expect(writeText).toHaveBeenCalledWith(
      new URL('/api/attachments/msg-1/photo.png', window.location.origin).href,
    );

    expect(
      await copyAttachmentContent({
        name: 'notes.txt',
        mimeType: 'text/plain',
        type: 'file',
        data: 'aGVsbG8=',
      }),
    ).toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');

    expect(
      await copyAttachmentLink({
        name: 'photo.png',
        mimeType: 'image/png',
        type: 'image',
        data: 'aGVsbG8=',
      }),
    ).toBe(true);
    expect(writeText).toHaveBeenCalledWith('data:image/png;base64,aGVsbG8=');

    writeText.mockRejectedValueOnce(new Error('denied'));
    expect(
      await copyAttachmentLink({
        name: 'photo.png',
        mimeType: 'image/png',
        type: 'image',
        data: 'aGVsbG8=',
      }),
    ).toBe(false);

    writeText.mockRejectedValueOnce(new Error('denied'));
    expect(
      await copyAttachmentContent({
        name: 'notes.txt',
        mimeType: 'text/plain',
        type: 'file',
        data: 'aGVsbG8=',
      }),
    ).toBe(false);

    expect(
      await copyAttachmentContent({
        name: 'notes.txt',
        mimeType: 'text/plain',
        type: 'file',
      }),
    ).toBe(false);

    vi.unstubAllGlobals();
  });

  it('returns null when attachment blobs cannot be fetched', async () => {
    expect(
      await fetchAttachmentBlob({
        name: 'missing.bin',
        mimeType: 'application/octet-stream',
        type: 'file',
      }),
    ).toBeNull();

    sessionStorage.setItem('webchat_token', 'stored');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, blob: async () => new Blob(['x']) }) as Response),
    );
    await fetchAttachmentBlob({
      name: 'photo.png',
      mimeType: 'image/png',
      type: 'image',
      url: '/api/attachments/msg-1/photo.png',
    });
    expect(fetch).toHaveBeenCalledWith('/api/attachments/msg-1/photo.png?token=stored');
    sessionStorage.removeItem('webchat_token');
    vi.unstubAllGlobals();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, blob: async () => new Blob() }) as Response),
    );
    expect(
      await fetchAttachmentBlob({
        name: 'photo.png',
        mimeType: 'image/png',
        type: 'image',
        url: '/api/attachments/msg-1/photo.png',
      }, 'secret'),
    ).toBeNull();
    vi.unstubAllGlobals();
  });

  it('returns false when copy link has no resolvable url', async () => {
    expect(
      await copyAttachmentLink({
        name: 'missing.bin',
        mimeType: 'application/octet-stream',
        type: 'file',
      }),
    ).toBe(false);
  });

  it('copies attachments for preview with success callback', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const onSuccess = vi.fn();
    await copyAttachmentForPreview(
      { name: 'notes.txt', mimeType: 'text/plain', type: 'file', data: 'aGVsbG8=' },
      onSuccess,
    );
    expect(onSuccess).toHaveBeenCalled();

    const skipped = vi.fn();
    vi.spyOn(global, 'atob').mockImplementation(() => {
      throw new Error('invalid');
    });
    await copyAttachmentForPreview(
      { name: 'notes.txt', mimeType: 'text/plain', type: 'file', data: 'bad' },
      skipped,
    );
    expect(skipped).not.toHaveBeenCalled();

    const emptyMarkdownSkipped = vi.fn();
    await copyAttachmentForPreview(
      { name: 'notes.txt', mimeType: 'text/plain', type: 'file' },
      emptyMarkdownSkipped,
    );
    expect(emptyMarkdownSkipped).not.toHaveBeenCalled();

    const linkSuccess = vi.fn();
    await copyAttachmentForPreview(
      { name: 'photo.png', mimeType: 'image/png', type: 'image', data: 'aGVsbG8=' },
      linkSuccess,
    );
    expect(linkSuccess).toHaveBeenCalled();

    const linkSkipped = vi.fn();
    await copyAttachmentForPreview(
      { name: 'missing.bin', mimeType: 'application/octet-stream', type: 'file' },
      linkSkipped,
    );
    expect(linkSkipped).not.toHaveBeenCalled();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, text: async () => 'remote' }) as Response),
    );
    const tokenSuccess = vi.fn();
    await copyAttachmentForPreview(
      {
        name: 'notes.md',
        mimeType: 'text/markdown',
        type: 'file',
        url: '/api/attachments/m/notes.md',
      },
      tokenSuccess,
      'explicit',
    );
    expect(tokenSuccess).toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith('/api/attachments/m/notes.md?token=explicit');

    const tokenLinkSuccess = vi.fn();
    await copyAttachmentForPreview(
      {
        name: 'photo.png',
        mimeType: 'image/png',
        type: 'image',
        url: '/api/attachments/m/photo.png',
      },
      tokenLinkSuccess,
      'explicit',
    );
    expect(tokenLinkSuccess).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
