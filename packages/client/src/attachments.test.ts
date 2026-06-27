import { afterEach, describe, expect, it, vi } from 'vitest';
import * as attachmentsModule from './attachments';
import * as popoutModule from './attachment-text-popout';
import {
  attachmentDataUrl,
  attachmentEmbedUrl,
  ATTACHMENT_HTML_IFRAME_SANDBOX,
  ATTACHMENT_SVG_IFRAME_SANDBOX,
  attachmentIframeSandbox,
  attachmentPreviewMode,
  attachmentPreviewUrl,
  attachmentChipKind,
  attachmentChipLabel,
  attachmentFriendlyTypeLabel,
  attachmentIsArchive,
  attachmentIsMdx,
  attachmentIsSvg,
  attachmentTextTooLargeForPreview,
  ATTACHMENT_TEXT_PREVIEW_MAX_BYTES,
  audioMimeTypePlayable,
  handleAudioPreviewError,
  COMPOSER_TEXT_SNIPPET_MAX,
  COMPOSER_TEXT_SNIPPET_READ_BYTES,
  attachmentIsVideo,
  attachmentIsAudio,
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
  attachmentUsesVideoPreview,
  attachmentUsesAudioPreview,
  copyAttachmentContent,
  copyAttachmentForPreview,
  copyAttachmentLink,
  decodeAttachmentTextFromData,
  downloadAttachment,
  fetchAttachmentBlob,
  fetchAttachmentText,
  formatAttachmentRejections,
  formatMaxUploadLabel,
  formatUploadBytesLabel,
  formatAttachmentSize,
  handleVideoPreviewError,
  imageMimeTypeDisplayable,
  inferMimeType,
  isHeicDisplaySupportedInBrowser,
  attachmentIsHeic,
  isSafeAttachmentUrl,
  isVideoSrcNotSupportedError,
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
  openVideoAttachmentInNewTab,
  openAudioAttachmentInNewTab,
  readAttachmentFiles,
  removePendingAtIndex,
  revokeAttachmentPreviews,
  toSendAttachmentsFromUploads,
  uploadAttachmentFile,
  uploadPendingAttachments,
  videoMimeTypePlayable,
  CHUNK_SIZE,
  type PendingAttachment,
} from './attachments';
import * as api from './api';

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
    expect(inferMimeType('page.html', 'text/html; charset=utf-8')).toBe('text/html');
    expect(inferMimeType('clip.mp4')).toBe('video/mp4');
    expect(inferMimeType('clip.webm')).toBe('video/webm');
    expect(inferMimeType('24246.MOV')).toBe('video/quicktime');
    expect(inferMimeType('song.mp3')).toBe('audio/mpeg');
    expect(inferMimeType('tone.wav')).toBe('audio/wav');
    expect(inferMimeType('song.mp3', 'application/octet-stream')).toBe('audio/mpeg');
    expect(inferMimeType('song.mp3', 'audio/mp3')).toBe('audio/mp3');
    expect(inferMimeType('song.mp3', 'text/plain')).toBe('audio/mpeg');
    expect(inferMimeType('clip.mp4', 'text/plain')).toBe('video/mp4');
    expect(inferMimeType('photo.png', 'text/plain')).toBe('image/png');
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
    expect(attachmentTypeLabel('file', 'video/mp4')).toBe('Video');
    expect(attachmentTypeLabel('file', 'audio/mpeg')).toBe('Audio');
  });

  it('classifies video attachments', () => {
    expect(attachmentIsVideo('video/mp4')).toBe(true);
    expect(attachmentIsVideo('video/webm')).toBe(true);
    expect(attachmentIsVideo('image/png')).toBe(false);
    expect(attachmentUsesVideoPreview('video/mp4')).toBe(true);
    expect(attachmentUsesVideoPreview('application/pdf')).toBe(false);
    expect(videoMimeTypePlayable('video/mp4')).toBe(true);
    expect(isVideoSrcNotSupportedError({ code: 4 } as MediaError)).toBe(true);
    expect(isVideoSrcNotSupportedError({ code: 1 } as MediaError)).toBe(false);
    expect(isVideoSrcNotSupportedError(undefined)).toBe(false);
    expect(isVideoSrcNotSupportedError(null)).toBe(false);
    const onUnsupported = vi.fn();
    handleVideoPreviewError({ currentTarget: { error: { code: 4 } as MediaError } as HTMLVideoElement }, onUnsupported);
    expect(onUnsupported).toHaveBeenCalledOnce();
    onUnsupported.mockClear();
    handleVideoPreviewError({ currentTarget: { error: { code: 1 } as MediaError } as HTMLVideoElement }, onUnsupported);
    expect(onUnsupported).not.toHaveBeenCalled();
  });

  it('assumes video is playable during SSR', () => {
    vi.stubGlobal('document', undefined);
    expect(videoMimeTypePlayable('video/quicktime')).toBe(true);
    vi.unstubAllGlobals();
  });

  it('classifies audio attachments', () => {
    expect(attachmentIsAudio('audio/mpeg')).toBe(true);
    expect(attachmentIsAudio('audio/wav')).toBe(true);
    expect(attachmentIsAudio('video/mp4')).toBe(false);
    expect(attachmentUsesAudioPreview('audio/mpeg')).toBe(true);
    expect(attachmentUsesAudioPreview('audio/wav')).toBe(true);
  });

  it('classifies attachment preview modes', () => {
    expect(attachmentPreviewMode('text/plain')).toBe('text');
    expect(attachmentPreviewMode('text/markdown')).toBe('text');
    expect(attachmentPreviewMode('text/javascript', 'app.js')).toBe('text');
    expect(attachmentPreviewMode('application/octet-stream', 'app.js')).toBe('text');
    expect(attachmentPreviewMode('image/png')).toBe('embed');
    expect(attachmentPreviewMode('video/mp4')).toBe('embed');
    expect(attachmentPreviewMode('audio/mpeg')).toBe('embed');
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
    expect(attachmentTextCategory('text/plain', '.env')).toBe('code');
    expect(attachmentTextCategory('application/zip', 'archive.zip')).toBeNull();
  });

  it('classifies chip kinds and friendly type labels', () => {
    expect(attachmentChipKind('application/pdf', 'doc.pdf')).toBe('pdf');
    expect(attachmentChipLabel('pdf')).toBe('PDF');
    expect(attachmentChipKind('text/markdown', 'notes.md')).toBe('markdown');
    expect(attachmentChipKind('text/html', 'page.html')).toBe('html');
    expect(attachmentChipKind('text/csv', 'data.csv')).toBe('csv');
    expect(attachmentChipKind('application/json', 'data.json')).toBe('json');
    expect(attachmentChipKind('application/zip', 'archive.zip')).toBe('archive');
    expect(attachmentChipKind('text/javascript', 'app.ts')).toBe('code');
    expect(attachmentChipKind('image/png', 'photo.png')).toBe('image');
    expect(attachmentFriendlyTypeLabel('application/zip', 'archive.zip')).toBe('ZIP archive');
    expect(attachmentFriendlyTypeLabel('application/pdf', 'doc.pdf')).toBe('PDF document');
    expect(
      attachmentFriendlyTypeLabel(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'data.xlsx',
      ),
    ).toBe('Excel spreadsheet');
    expect(
      attachmentFriendlyTypeLabel(
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'deck.pptx',
      ),
    ).toBe('PowerPoint presentation');
    expect(attachmentIsArchive('application/zip', 'archive.zip')).toBe(true);
    expect(attachmentFriendlyTypeLabel('application/x-7z-compressed', 'a.7z')).toBe('7-Zip archive');
    expect(attachmentFriendlyTypeLabel('application/x-tar', 'a.tar')).toBe('Tar archive');
    expect(attachmentFriendlyTypeLabel('application/gzip', 'a.gz')).toBe('Gzip archive');
    expect(attachmentFriendlyTypeLabel('image/png', 'photo.png')).toBe('Image');
    expect(attachmentFriendlyTypeLabel('video/mp4', 'clip.mp4')).toBe('Video');
    expect(attachmentFriendlyTypeLabel('audio/mpeg', 'song.mp3')).toBe('Audio');
    expect(attachmentFriendlyTypeLabel('application/msword', 'doc.doc')).toBe('Word document');
    expect(attachmentIsMdx('post.mdx')).toBe(true);
    expect(attachmentIsMdx('README')).toBe(false);
    expect(attachmentIsArchive('application/octet-stream', 'archive.7z')).toBe(true);
    expect(attachmentIsArchive('application/octet-stream', 'archive.tar')).toBe(true);
    expect(attachmentIsArchive('application/octet-stream', 'archive.tgz')).toBe(true);
    expect(attachmentIsArchive('application/octet-stream', 'nodot')).toBe(false);
    expect(attachmentIsSvg('image/svg+xml')).toBe(true);
    expect(inferMimeType('icon.svg')).toBe('image/svg+xml');
    expect(attachmentPreviewMode('image/svg+xml', 'icon.svg')).toBe('embed');
  });

  it('guards large text previews and audio playability', () => {
    expect(attachmentTextTooLargeForPreview(ATTACHMENT_TEXT_PREVIEW_MAX_BYTES + 1)).toBe(true);
    expect(attachmentTextTooLargeForPreview(ATTACHMENT_TEXT_PREVIEW_MAX_BYTES)).toBe(false);
    expect(audioMimeTypePlayable('audio/mpeg')).toBe(true);
    const onUnsupported = vi.fn();
    handleAudioPreviewError(
      { currentTarget: { error: { code: 4 } as MediaError } as HTMLAudioElement },
      onUnsupported,
    );
    expect(onUnsupported).toHaveBeenCalledOnce();
    onUnsupported.mockClear();
    handleAudioPreviewError(
      { currentTarget: { error: { code: 1 } as MediaError } as HTMLAudioElement },
      onUnsupported,
    );
    expect(onUnsupported).not.toHaveBeenCalled();
  });

  it('detects HEIC display support and chip labels for images', () => {
    expect(attachmentIsHeic('image/heic')).toBe(true);
    expect(attachmentIsHeic('image/heif')).toBe(true);
    expect(imageMimeTypeDisplayable('image/png')).toBe(true);
    expect(imageMimeTypeDisplayable('image/heic')).toBe(isHeicDisplaySupportedInBrowser());
    expect(inferMimeType('photo.HEIC')).toBe('image/heic');
  });

  it('assumes HEIC is displayable during SSR', () => {
    vi.stubGlobal('document', undefined);
    vi.stubGlobal('navigator', undefined);
    expect(imageMimeTypeDisplayable('image/heic')).toBe(true);
    expect(isHeicDisplaySupportedInBrowser()).toBe(true);
    vi.unstubAllGlobals();
  });

  it('detects Safari vs Chromium for HEIC display support', () => {
    vi.stubGlobal('navigator', {
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    });
    expect(isHeicDisplaySupportedInBrowser()).toBe(true);
    vi.stubGlobal('navigator', {
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1',
    });
    expect(isHeicDisplaySupportedInBrowser()).toBe(true);
    vi.stubGlobal('navigator', {
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/120.0 Mobile/15E148 Safari/605.1.15',
    });
    expect(isHeicDisplaySupportedInBrowser()).toBe(true);
    vi.stubGlobal('navigator', {
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    expect(isHeicDisplaySupportedInBrowser()).toBe(false);
    vi.stubGlobal('navigator', {
      userAgent:
        'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    });
    expect(isHeicDisplaySupportedInBrowser()).toBe(false);
    vi.unstubAllGlobals();
  });

  it('assumes audio is playable during SSR', () => {
    vi.stubGlobal('document', undefined);
    expect(audioMimeTypePlayable('audio/flac')).toBe(true);
    vi.unstubAllGlobals();
  });

  it('classifies iframe preview and sandbox settings', () => {
    expect(attachmentUsesIframePreview('application/pdf')).toBe(true);
    expect(attachmentUsesIframePreview('text/html')).toBe(false);
    expect(attachmentUsesIframePreview('image/png')).toBe(false);
    expect(attachmentIframeSandbox('text/html')).toBe(ATTACHMENT_HTML_IFRAME_SANDBOX);
    expect(ATTACHMENT_HTML_IFRAME_SANDBOX).not.toContain('allow-same-origin');
    expect(ATTACHMENT_SVG_IFRAME_SANDBOX).not.toContain('allow-scripts');
    expect(attachmentIframeSandbox('application/pdf')).toBeUndefined();
  });

  it('classifies pop-out and preview toggle support', () => {
    expect(attachmentSupportsPopOut('text/plain')).toBe(true);
    expect(attachmentSupportsPopOut('video/mp4')).toBe(true);
    expect(attachmentSupportsPopOut('audio/mpeg')).toBe(true);
    expect(attachmentSupportsPopOut('text/markdown')).toBe(true);
    expect(attachmentSupportsPopOut('text/javascript', 'app.js')).toBe(true);
    expect(attachmentSupportsPopOut('text/html', 'page.html')).toBe(true);
    expect(attachmentSupportsPopOut('image/png')).toBe(true);
    expect(attachmentSupportsPopOut('application/zip')).toBe(false);
    expect(
      attachmentSupportsPopOut(
        'application/zip',
        'archive.zip',
        '/api/attachments/msg-1/archive.zip',
      ),
    ).toBe(true);
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

  it('normalizes generic mime types from filename', () => {
    expect(
      normalizeAttachment({
        name: 'song.mp3',
        mimeType: 'application/octet-stream',
        type: 'file',
      }),
    ).toMatchObject({ mimeType: 'audio/mpeg', type: 'file' });
  });

  it('classifies preview mode for generic mp3 mime types', () => {
    expect(attachmentPreviewMode('application/octet-stream', 'song.mp3')).toBe('embed');
  });

  it('formats rejection messages', () => {
    expect(formatUploadBytesLabel(50 * 1024 * 1024)).toBe('50 MB');
    expect(formatMaxUploadLabel()).toBe('1 GB');
    expect(
      formatAttachmentRejections([
        { name: 'big.png', reason: 'too_large' },
        { name: 'bad.txt', reason: 'read_failed' },
        { name: 'extra.txt', reason: 'capacity' },
      ]),
    ).toBe(
      'big.png exceeds the 1 GB limit; Could not read bad.txt; Only 10 attachments allowed (extra.txt skipped)',
    );
    expect(formatAttachmentRejections([])).toBeNull();
    expect(
      formatAttachmentRejections([{ name: 'x.png', reason: 'upload_failed' }]),
    ).toBe('Upload failed for x.png');
  });

  it('leaves matching attachment types unchanged', () => {
    const att = { name: 'a.png', mimeType: 'image/png', type: 'image' as const };
    expect(normalizeAttachment(att)).toBe(att);
  });

  it('returns a new object when mimeType is corrected from filename', () => {
    const att = {
      name: 'song.mp3',
      mimeType: 'application/octet-stream',
      type: 'file' as const,
    };
    expect(normalizeAttachment(att)).not.toBe(att);
    expect(normalizeAttachment(att)).toMatchObject({ mimeType: 'audio/mpeg' });
  });

  it('merges pending attachments without exceeding the cap', () => {
    const make = (name: string, previewUrl: string): PendingAttachment => ({
      file: new File(['x'], name, { type: 'text/plain' }),
      name,
      mimeType: 'text/plain',
      type: 'file',
      size: 1,
      previewUrl,
    });
    const prev = Array.from({ length: MAX_ATTACHMENTS - 1 }, (_, i) => make(`file-${i}.txt`, `blob:${i}`));
    const next = [make('d.txt', 'blob:d'), make('e.txt', 'blob:e')];
    const revoke = vi.spyOn(URL, 'revokeObjectURL');

    const { attachments, dropped } = mergePendingAttachments(prev, next);
    expect(attachments).toHaveLength(MAX_ATTACHMENTS);
    expect(dropped).toHaveLength(1);
    revokeAttachmentPreviews(dropped);
    expect(revoke).toHaveBeenCalledWith('blob:e');
    revoke.mockRestore();
  });

  it('accepts merges below the attachment cap', () => {
    const make = (name: string, previewUrl: string): PendingAttachment => ({
      file: new File(['x'], name, { type: 'text/plain' }),
      name,
      mimeType: 'text/plain',
      type: 'file',
      size: 1,
      previewUrl,
    });
    const prev = [make('a.txt', 'blob:a'), make('b.txt', 'blob:b'), make('c.txt', 'blob:c')];
    const next = [make('d.txt', 'blob:d'), make('e.txt', 'blob:e')];

    const { attachments, dropped } = mergePendingAttachments(prev, next);
    expect(attachments).toHaveLength(5);
    expect(dropped).toHaveLength(0);
  });

  it('revokes all incoming previews when already at capacity', () => {
    const make = (name: string, previewUrl: string): PendingAttachment => ({
      file: new File(['x'], name, { type: 'text/plain' }),
      name,
      mimeType: 'text/plain',
      type: 'file',
      size: 1,
      previewUrl,
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

  it('stages image files without reading base64', async () => {
    const file = new File(['hello'], 'photo.png', { type: 'image/png' });
    const { attachments } = await readAttachmentFiles([file]);
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({
      name: 'photo.png',
      mimeType: 'image/png',
      type: 'image',
      size: 5,
    });
    expect(attachments[0]?.previewUrl).toMatch(/^blob:/);
    expect(attachments[0]?.textSnippet).toBeUndefined();
    URL.revokeObjectURL(attachments[0]!.previewUrl);
  });

  it('stages non-image files such as markdown', async () => {
    const file = new File(['# Title\nbody'], 'notes.md', { type: 'text/markdown' });
    const { attachments } = await readAttachmentFiles([file]);
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({
      name: 'notes.md',
      mimeType: 'text/markdown',
      type: 'file',
      textSnippet: '# Title',
    });
    URL.revokeObjectURL(attachments[0]!.previewUrl);
  });

  it('truncates long composer text snippets', async () => {
    const longLine = 'x'.repeat(COMPOSER_TEXT_SNIPPET_MAX + 10);
    const file = new File([longLine], 'notes.txt', { type: 'text/plain' });
    const { attachments } = await readAttachmentFiles([file]);
    expect(attachments[0]?.textSnippet?.endsWith('…')).toBe(true);
    URL.revokeObjectURL(attachments[0]!.previewUrl);
  });

  it('skips composer snippet when text file has no content lines', async () => {
    const file = new File(['\n\n'], 'blank.txt', { type: 'text/plain' });
    const { attachments } = await readAttachmentFiles([file]);
    expect(attachments[0]?.textSnippet).toBeUndefined();
    URL.revokeObjectURL(attachments[0]!.previewUrl);
  });

  it('skips composer snippet when text read fails', async () => {
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    const slice = file.slice(0, COMPOSER_TEXT_SNIPPET_READ_BYTES);
    vi.spyOn(file, 'slice').mockReturnValue(slice);
    vi.spyOn(slice, 'text').mockRejectedValue(new Error('read failed'));
    const { attachments } = await readAttachmentFiles([file]);
    expect(attachments[0]?.textSnippet).toBeUndefined();
    URL.revokeObjectURL(attachments[0]!.previewUrl);
  });

  it('reads only the first bytes of a text file for composer snippets', async () => {
    const file = new File(['first line\n' + 'x'.repeat(5000)], 'notes.txt', { type: 'text/plain' });
    const sliceSpy = vi.spyOn(file, 'slice');
    const { attachments } = await readAttachmentFiles([file]);
    expect(sliceSpy).toHaveBeenCalledWith(0, COMPOSER_TEXT_SNIPPET_READ_BYTES);
    expect(attachments[0]?.textSnippet).toBe('first line');
    URL.revokeObjectURL(attachments[0]!.previewUrl);
  });

  it('skips composer snippet when attachment is too large', async () => {
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    Object.defineProperty(file, 'size', { value: ATTACHMENT_TEXT_PREVIEW_MAX_BYTES + 1 });
    const { attachments } = await readAttachmentFiles([file]);
    expect(attachments[0]?.textSnippet).toBeUndefined();
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

  it('infers mime types in data URLs from filenames', () => {
    expect(
      attachmentDataUrl({
        name: 'song.mp3',
        mimeType: 'application/octet-stream',
        type: 'file',
        data: 'aGVsbG8=',
      }),
    ).toBe('data:audio/mpeg;base64,aGVsbG8=');
  });

  it('builds absolute embed URLs for persisted attachments', () => {
    expect(
      attachmentEmbedUrl(
        {
          name: 'clip.mov',
          mimeType: 'video/quicktime',
          type: 'file',
          url: '/api/attachments/msg-1/clip.mov',
        },
        'secret',
      ),
    ).toBe(`${window.location.origin}/api/attachments/msg-1/clip.mov?token=secret`);
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

  it('opens video attachments in a viewer popout document', () => {
    const openDoc = vi.spyOn(popoutModule, 'openHtmlDocumentInNewTab').mockReturnValue(true);
    expect(
      openVideoAttachmentInNewTab({
        name: 'clip.mp4',
        mimeType: 'video/mp4',
        type: 'file',
        data: 'aGVsbG8=',
      }),
    ).toBe(true);
    expect(openDoc).toHaveBeenCalledWith(
      expect.stringContaining('class="video-preview"'),
    );
    expect(openDoc.mock.calls[0]![0]).toContain('data:video/mp4;base64,aGVsbG8=');
    expect(openDoc.mock.calls[0]![0]).toContain('video.canPlayType("video/mp4")');
  });

  it('uses absolute urls in video popouts for persisted attachments', () => {
    const openDoc = vi.spyOn(popoutModule, 'openHtmlDocumentInNewTab').mockReturnValue(true);
    expect(
      openVideoAttachmentInNewTab(
        {
          name: '24246.MOV',
          mimeType: 'application/octet-stream',
          type: 'file',
          url: '/api/attachments/msg-1/24246.MOV',
        },
        'secret',
      ),
    ).toBe(true);
    expect(openDoc.mock.calls[0]![0]).toContain(
      `${window.location.origin}/api/attachments/msg-1/24246.MOV?token=secret`,
    );
  });

  it('returns false when video popout has no embed URL', () => {
    expect(
      openVideoAttachmentInNewTab({
        name: 'clip.mp4',
        mimeType: 'video/mp4',
        type: 'file',
      }),
    ).toBe(false);
  });

  it('returns false when video popout tab cannot be opened', () => {
    vi.spyOn(popoutModule, 'openHtmlDocumentInNewTab').mockReturnValue(false);
    expect(
      openVideoAttachmentInNewTab({
        name: 'clip.mp4',
        mimeType: 'video/mp4',
        type: 'file',
        data: 'aGVsbG8=',
      }),
    ).toBe(false);
  });

  it('opens audio attachments in a viewer popout document', () => {
    const openDoc = vi.spyOn(popoutModule, 'openHtmlDocumentInNewTab').mockReturnValue(true);
    expect(
      openAudioAttachmentInNewTab({
        name: 'song.mp3',
        mimeType: 'audio/mpeg',
        type: 'file',
        data: 'aGVsbG8=',
      }),
    ).toBe(true);
    expect(openDoc).toHaveBeenCalledWith(expect.stringContaining('class="audio-preview"'));
    expect(openDoc.mock.calls[0]![0]).toContain('data:audio/mpeg;base64,aGVsbG8=');
  });

  it('returns false when audio popout has no embed URL', () => {
    expect(
      openAudioAttachmentInNewTab({
        name: 'song.mp3',
        mimeType: 'audio/mpeg',
        type: 'file',
      }),
    ).toBe(false);
  });

  it('returns false when audio popout tab cannot be opened', () => {
    vi.spyOn(popoutModule, 'openHtmlDocumentInNewTab').mockReturnValue(false);
    expect(
      openAudioAttachmentInNewTab({
        name: 'song.mp3',
        mimeType: 'audio/mpeg',
        type: 'file',
        data: 'aGVsbG8=',
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
    ).toBe('data:image/png;base64,aGVsbG8=');
    expect(
      attachmentPreviewUrl({
        name: 'a.png',
        mimeType: 'image/png',
        type: 'image',
        previewUrl: 'blob:preview',
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

  it('removes pending attachments by index', () => {
    const pending: PendingAttachment[] = [
      {
        file: new File(['a'], 'a.png', { type: 'image/png' }),
        name: 'a.png',
        mimeType: 'image/png',
        type: 'image',
        size: 1,
        previewUrl: 'blob:a',
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

  it('appends token query param when url already has search params', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, text: async () => 'from server' }) as Response),
    );
    expect(
      await fetchAttachmentText({
        name: 'notes.md',
        mimeType: 'text/markdown',
        type: 'file',
        url: '/api/attachments/msg-1/notes.md?download=1',
      }, 'secret'),
    ).toBe('from server');
    expect(fetch).toHaveBeenCalledWith('/api/attachments/msg-1/notes.md?download=1&token=secret');
    vi.unstubAllGlobals();
  });

  it('uses cookie auth when fetching attachment url without token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, text: async () => 'cookie auth' }) as Response),
    );
    expect(
      await fetchAttachmentText({
        name: 'notes.md',
        mimeType: 'text/markdown',
        type: 'file',
        url: '/api/attachments/msg-1/notes.md',
      }),
    ).toBe('cookie auth');
    expect(fetch).toHaveBeenCalledWith('/api/attachments/msg-1/notes.md', { credentials: 'include' });
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
    expect(fetch).toHaveBeenCalledWith('/api/attachments/msg-1/photo.png', { credentials: 'include' });

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

  describe('upload helpers', () => {
    it('uploads small files via multipart', async () => {
      vi.spyOn(api, 'uploadAttachmentMultipart').mockResolvedValue({
        uploadId: 'upload-id',
        name: 'a.txt',
        mimeType: 'text/plain',
        type: 'file',
        size: 5,
      });
      const file = new File(['hello'], 'a.txt', { type: 'text/plain' });
      const result = await uploadAttachmentFile('tok', 'lobby', 'main', file);
      expect(result.uploadId).toBe('upload-id');
      expect(api.uploadAttachmentMultipart).toHaveBeenCalledWith('tok', 'lobby', 'main', file);
    });

    it('uploads all files via multipart regardless of size', async () => {
      vi.spyOn(api, 'uploadAttachmentMultipart').mockResolvedValue({
        uploadId: 'upload-id',
        name: 'big.bin',
        mimeType: 'application/octet-stream',
        type: 'file',
        size: CHUNK_SIZE + 1,
      });
      const file = new File([new Uint8Array(CHUNK_SIZE + 1)], 'big.bin');
      const result = await uploadAttachmentFile('tok', 'lobby', 'main', file);
      expect(result.uploadId).toBe('upload-id');
      expect(api.uploadAttachmentMultipart).toHaveBeenCalledWith('tok', 'lobby', 'main', file);
    });

    it('collects upload failures from pending attachments', async () => {
      vi.spyOn(api, 'uploadAttachmentMultipart').mockRejectedValue(new Error('network down'));
      const pending: PendingAttachment[] = [
        {
          name: 'a.txt',
          mimeType: 'text/plain',
          type: 'file',
          size: 1,
          file: new File(['x'], 'a.txt'),
          previewUrl: 'blob:preview',
        },
      ];
      const { uploads, failed } = await uploadPendingAttachments('tok', 'lobby', 'main', pending);
      expect(uploads).toHaveLength(0);
      expect(failed).toEqual([{ name: 'a.txt', reason: 'upload_failed', detail: 'network down' }]);
    });

    it('falls back to a generic attachment label when upload failure lacks a name', async () => {
      vi.spyOn(api, 'uploadAttachmentMultipart').mockRejectedValue(new Error('network down'));
      const pending = [
        {
          name: undefined,
          mimeType: 'text/plain',
          type: 'file',
          size: 1,
          file: new File(['x'], 'a.txt'),
          previewUrl: 'blob:preview',
        },
      ] as unknown as PendingAttachment[];
      const { failed } = await uploadPendingAttachments('tok', 'lobby', 'main', pending);
      expect(failed).toEqual([{ name: 'attachment', reason: 'upload_failed', detail: 'network down' }]);
    });

    it('records a generic upload failure when rejection is not an Error', async () => {
      vi.spyOn(api, 'uploadAttachmentMultipart').mockRejectedValue('nope');
      const pending: PendingAttachment[] = [
        {
          name: 'a.txt',
          mimeType: 'text/plain',
          type: 'file',
          size: 1,
          file: new File(['x'], 'a.txt'),
          previewUrl: 'blob:preview',
        },
      ];
      const { failed } = await uploadPendingAttachments('tok', 'lobby', 'main', pending);
      expect(failed).toEqual([{ name: 'a.txt', reason: 'upload_failed', detail: 'Upload failed' }]);
    });

    it('maps uploaded attachments to send refs', () => {
      expect(
        toSendAttachmentsFromUploads([
          {
            uploadId: 'upload-id',
            name: 'a.txt',
            mimeType: 'text/plain',
            type: 'file',
            size: 1,
          },
        ]),
      ).toEqual([
        {
          uploadId: 'upload-id',
          name: 'a.txt',
          mimeType: 'text/plain',
          type: 'file',
          size: 1,
        },
      ]);
    });

    it('revokes preview object URLs', () => {
      const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
      revokeAttachmentPreviews([
        {
          name: 'a.txt',
          mimeType: 'text/plain',
          type: 'file',
          size: 1,
          file: new File(['x'], 'a.txt'),
          previewUrl: 'blob:test',
        },
      ]);
      expect(revoke).toHaveBeenCalledWith('blob:test');
    });
  });
});
