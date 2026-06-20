import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  attachmentDataUrl,
  attachmentPreviewUrl,
  attachmentToBlob,
  attachmentTypeFromMime,
  formatAttachmentRejections,
  inferMimeType,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  mergePendingAttachments,
  normalizeAttachment,
  openAttachmentInNewTab,
  readAttachmentFiles,
  removePendingAtIndex,
  revokeAttachmentPreviews,
  type PendingAttachment,
} from './attachments';

describe('attachments', () => {
  it('infers MIME types from filenames', () => {
    expect(inferMimeType('notes.md')).toBe('text/markdown');
    expect(inferMimeType('doc.pdf', 'application/pdf')).toBe('application/pdf');
    expect(inferMimeType('unknown.xyz')).toBe('application/octet-stream');
    expect(inferMimeType('README')).toBe('application/octet-stream');
  });

  it('classifies attachment types from MIME', () => {
    expect(attachmentTypeFromMime('image/png')).toBe('image');
    expect(attachmentTypeFromMime('text/markdown')).toBe('file');
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
      attachmentDataUrl({
        name: 'a.png',
        mimeType: 'image/png',
        type: 'image',
        url: '/api/attachments/msg-1/a.png',
      }),
    ).toBe('/api/attachments/msg-1/a.png');
    expect(
      attachmentDataUrl({
        name: 'a.png',
        mimeType: 'image/png',
        type: 'image',
      }),
    ).toBeNull();
  });

  it('opens persisted attachments via url when data is absent', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window);
    expect(
      openAttachmentInNewTab({
        name: 'photo.png',
        mimeType: 'image/png',
        type: 'image',
        url: '/api/attachments/msg-1/photo.png',
      }),
    ).toBe(true);
    expect(open).toHaveBeenCalledWith('/api/attachments/msg-1/photo.png', '_blank', 'noopener,noreferrer');
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
});
