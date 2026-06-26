import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  attachmentTypeFromMime,
  inferMimeType,
  readAttachmentPaths,
  MAX_ATTACHMENT_BYTES,
} from './attachments.js';

describe('attachments', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webchat-mcp-att-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('inferMimeType uses extension', () => {
    expect(inferMimeType('photo.png')).toBe('image/png');
    expect(inferMimeType('doc.bin', 'text/plain')).toBe('text/plain');
    expect(inferMimeType('unknown')).toBe('application/octet-stream');
  });

  it('attachmentTypeFromMime distinguishes image and file', () => {
    expect(attachmentTypeFromMime('image/png')).toBe('image');
    expect(attachmentTypeFromMime('application/pdf')).toBe('file');
  });

  it('readAttachmentPaths reads valid files', () => {
    const filePath = path.join(tmpDir, 'note.txt');
    fs.writeFileSync(filePath, 'hello');
    const result = readAttachmentPaths([filePath]);
    expect(result.errors).toHaveLength(0);
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]!.name).toBe('note.txt');
    expect(result.attachments[0]!.data).toBe(Buffer.from('hello').toString('base64'));
  });

  it('readAttachmentPaths rejects missing files', () => {
    const result = readAttachmentPaths(['/no/such/file.txt']);
    expect(result.attachments).toHaveLength(0);
    expect(result.errors[0]).toContain('Could not read file');
  });

  it('readAttachmentPaths rejects directories', () => {
    const result = readAttachmentPaths([tmpDir]);
    expect(result.errors[0]).toContain('Not a file');
  });

  it('readAttachmentPaths rejects oversized files', () => {
    const filePath = path.join(tmpDir, 'big.bin');
    fs.writeFileSync(filePath, Buffer.alloc(MAX_ATTACHMENT_BYTES + 1));
    const result = readAttachmentPaths([filePath]);
    expect(result.errors[0]).toContain('5 MB');
  });

  it('readAttachmentPaths handles read failures after stat', () => {
    const filePath = path.join(tmpDir, 'locked.txt');
    fs.writeFileSync(filePath, 'x');
    const readSpy = vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw new Error('read denied');
    });
    const result = readAttachmentPaths([filePath]);
    expect(result.errors[0]).toContain('Could not read file');
    readSpy.mockRestore();
  });

  it('readAttachmentPaths caps at max attachments', () => {
    const paths = Array.from({ length: 11 }, (_, i) => {
      const p = path.join(tmpDir, `f${i}.txt`);
      fs.writeFileSync(p, 'x');
      return p;
    });
    const result = readAttachmentPaths(paths);
    expect(result.errors[0]).toContain('Only 10 attachments');
    expect(result.attachments).toHaveLength(10);
  });
});
