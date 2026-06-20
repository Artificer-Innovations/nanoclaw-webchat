import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  attachmentDataUrl,
  attachmentPreviewUrl,
  attachmentTypeFromMime,
  inferMimeType,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  readAttachmentFiles,
  removePendingAtIndex,
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

  it('reads image files as base64 attachments', async () => {
    const file = new File(['hello'], 'photo.png', { type: 'image/png' });
    const attachments = await readAttachmentFiles([file]);
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
    const attachments = await readAttachmentFiles([file]);
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
    const attachments = await readAttachmentFiles(files);
    expect(attachments).toHaveLength(MAX_ATTACHMENTS);
    attachments.forEach((att) => URL.revokeObjectURL(att.previewUrl));
  });

  it('respects existing attachment count', async () => {
    const files = [new File(['x'], 'a.png', { type: 'image/png' }), new File(['y'], 'b.png', { type: 'image/png' })];
    const attachments = await readAttachmentFiles(files, MAX_ATTACHMENTS - 1);
    expect(attachments).toHaveLength(1);
    URL.revokeObjectURL(attachments[0]!.previewUrl);
  });

  it('skips files over the size limit', async () => {
    const big = new File([new Uint8Array(MAX_ATTACHMENT_BYTES + 1)], 'big.png', {
      type: 'image/png',
    });
    const attachments = await readAttachmentFiles([big]);
    expect(attachments).toHaveLength(0);
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
      }),
    ).toBeNull();
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
    const attachments = await readAttachmentFiles([new File(['x'], 'a.txt', { type: 'text/plain' })]);
    expect(attachments[0]?.data).toBe('rawbase64');
    URL.revokeObjectURL(attachments[0]!.previewUrl);
    vi.stubGlobal('FileReader', Original);
  });

  it('surfaces FileReader errors', async () => {
    const Original = global.FileReader;
    class ErrorReader extends Original {
      readAsDataURL() {
        this.onerror?.(new ProgressEvent('error'));
      }
    }
    vi.stubGlobal('FileReader', ErrorReader);
    await expect(readAttachmentFiles([new File(['x'], 'a.txt', { type: 'text/plain' })])).rejects.toThrow(
      'read failed',
    );
    vi.stubGlobal('FileReader', Original);
  });

  it('exposes the readImageFiles alias', async () => {
    const { readImageFiles } = await import('./attachments');
    const attachments = await readImageFiles([new File(['x'], 'a.png', { type: 'image/png' })]);
    URL.revokeObjectURL(attachments[0]!.previewUrl);
    expect(attachments).toHaveLength(1);
  });

  it('rejects non-string FileReader results', async () => {
    const Original = global.FileReader;
    class BadReader extends Original {
      readAsDataURL() {
        Object.defineProperty(this, 'result', { value: new ArrayBuffer(8), configurable: true });
        this.onload?.({ target: this } as ProgressEvent<FileReader>);
      }
    }
    vi.stubGlobal('FileReader', BadReader);
    await expect(readAttachmentFiles([new File(['x'], 'a.txt', { type: 'text/plain' })])).rejects.toThrow(
      'read failed',
    );
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
    expect(await readAttachmentFiles([blank])).toHaveLength(0);

    const full = Array.from({ length: MAX_ATTACHMENTS }, (_, i) =>
      new File(['x'], `file-${i}.txt`, { type: 'text/plain' }),
    );
    const loaded = await readAttachmentFiles(full);
    loaded.forEach((att) => URL.revokeObjectURL(att.previewUrl));
    expect(await readAttachmentFiles([new File(['y'], 'extra.txt')], MAX_ATTACHMENTS)).toHaveLength(0);
  });
});
