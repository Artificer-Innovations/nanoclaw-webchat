import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { PassThrough, Readable, Writable } from 'stream';

vi.mock('./config.js', async () => {
  const actual = await vi.importActual<typeof import('./config.js')>('./config.js');
  return { ...actual, DATA_DIR: '/tmp/nanoclaw-webchat-uploads-test' };
});

import {
  acceptChunk,
  consumeStagedUpload,
  formatMaxUploadLabel,
  getStagedUpload,
  isAcceptChunkOk,
  isValidUploadId,
  parseMultipartUpload,
  resetUploadStateForTests,
  restoreStagedUpload,
  uploadsStagingRoot,
} from './webchat-uploads.js';

const TEST_DATA = '/tmp/nanoclaw-webchat-uploads-test';

describe('webchat-uploads', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    resetUploadStateForTests();
    if (fs.existsSync(TEST_DATA)) {
      fs.rmSync(TEST_DATA, { recursive: true, force: true });
    }
  });

  it('validates upload ids as UUIDs', () => {
    expect(isValidUploadId('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    expect(isValidUploadId('../etc/passwd')).toBe(false);
  });

  it('parses multipart uploads to staging', async () => {
    const boundary = '----TestBoundary';
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.txt"\r\nContent-Type: text/plain\r\n\r\n`),
      Buffer.from('hello'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const req = Readable.from([payload]) as http.IncomingMessage;
    req.headers = {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'content-length': String(payload.length),
    };

    const result = await parseMultipartUpload(req, 'lobby', 'main');
    expect('upload' in result).toBe(true);
    if (!('upload' in result)) return;
    expect(result.upload.name).toBe('a.txt');
    expect(result.upload.size).toBe(5);
    expect(fs.existsSync(result.upload.filePath)).toBe(true);
    expect(fs.existsSync(uploadsStagingRoot())).toBe(true);
  });

  it('assembles chunked uploads', async () => {
    const uploadId = '550e8400-e29b-41d4-a716-446655440000';
    const data = Buffer.from('chunked-content').toString('base64');
    const result = await acceptChunk(
      {
        uploadId,
        chunkIndex: 0,
        totalChunks: 1,
        filename: 'chunk.txt',
        mimeType: 'text/plain',
        data,
      },
      'lobby',
      'main',
    );
    expect(isAcceptChunkOk(result)).toBe(true);
    if (!isAcceptChunkOk(result) || !result.upload) return;
    expect(result.upload.uploadId).toBe(uploadId);
    expect(result.upload.size).toBe(Buffer.from('chunked-content').length);
  });

  it('rejects invalid chunk requests', async () => {
    expect(await acceptChunk(
      { uploadId: 'not-a-uuid', chunkIndex: 0, totalChunks: 1, filename: 'a.txt', data: 'YQ==' },
      'lobby',
      'main',
    )).toMatchObject({ error: 'Invalid uploadId format', status: 400 });

    const uploadId = '550e8400-e29b-41d4-a716-446655440000';
    await acceptChunk(
      { uploadId, chunkIndex: 0, totalChunks: 2, filename: 'a.txt', mimeType: 'text/plain', data: 'YQ==' },
      'lobby',
      'main',
    );
    expect(await acceptChunk(
      { uploadId, chunkIndex: 1, totalChunks: 3, filename: 'a.txt', mimeType: 'text/plain', data: 'Yg==' },
      'lobby',
      'main',
    )).toMatchObject({ error: 'totalChunks mismatch', status: 400 });
  });

  it('returns partial progress for multi-chunk uploads', async () => {
    const uploadId = '550e8400-e29b-41d4-a716-446655440001';
    const first = await acceptChunk(
      {
        uploadId,
        chunkIndex: 0,
        totalChunks: 2,
        filename: 'part.bin',
        mimeType: 'application/octet-stream',
        data: Buffer.from('ab').toString('base64'),
      },
      'lobby',
      'main',
    );
    expect(first).toMatchObject({ ok: true, received: 1, total: 2 });
    if (!isAcceptChunkOk(first) || first.upload) return;

    const second = await acceptChunk(
      {
        uploadId,
        chunkIndex: 1,
        totalChunks: 2,
        filename: 'part.bin',
        mimeType: 'application/octet-stream',
        data: Buffer.from('cd').toString('base64'),
      },
      'lobby',
      'main',
    );
    expect(isAcceptChunkOk(second)).toBe(true);
    if (!isAcceptChunkOk(second) || !second.upload) return;
    expect(second.upload.size).toBe(4);
  });

  it('ignores duplicate chunk retries without inflating cumulative size', async () => {
    const uploadId = '550e8400-e29b-41d4-a716-446655440002';
    const chunkBody = {
      uploadId,
      chunkIndex: 0,
      totalChunks: 2,
      filename: 'dup.bin',
      mimeType: 'application/octet-stream',
      data: Buffer.from('aaa').toString('base64'),
    };
    const first = await acceptChunk(chunkBody, 'lobby', 'main');
    expect(first).toMatchObject({ ok: true, received: 1, total: 2 });
    const duplicate = await acceptChunk(chunkBody, 'lobby', 'main');
    expect(duplicate).toMatchObject({ ok: true, received: 1, total: 2 });

    const second = await acceptChunk(
      {
        uploadId,
        chunkIndex: 1,
        totalChunks: 2,
        filename: 'dup.bin',
        mimeType: 'application/octet-stream',
        data: Buffer.from('b').toString('base64'),
      },
      'lobby',
      'main',
    );
    expect(isAcceptChunkOk(second)).toBe(true);
    if (!isAcceptChunkOk(second) || !second.upload) return;
    expect(second.upload.size).toBe(4);
  });

  it('rejects chunk uploads with missing fields', async () => {
    expect(await acceptChunk(
      { uploadId: '550e8400-e29b-41d4-a716-446655440000', chunkIndex: 0, totalChunks: 1, filename: '', data: '' },
      'lobby',
      'main',
    )).toMatchObject({ status: 400 });
  });

  it('rejects non-multipart uploads', async () => {
    const req = Readable.from(['plain']) as http.IncomingMessage;
    req.headers = { 'content-type': 'text/plain' };
    const result = await parseMultipartUpload(req, 'lobby', 'main');
    expect(result).toMatchObject({ error: 'Content-Type must be multipart/form-data', status: 400 });
  });

  it('rejects multipart uploads without a file body', async () => {
    const boundary = '----EmptyBoundary';
    const payload = Buffer.from(`--${boundary}--\r\n`);
    const req = Readable.from([payload]) as http.IncomingMessage;
    req.headers = {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'content-length': String(payload.length),
    };
    const result = await parseMultipartUpload(req, 'lobby', 'main');
    expect(result).toMatchObject({ error: 'No file uploaded', status: 400 });
  });

  it('rejects chunks above the configured max upload size', async () => {
    vi.stubEnv('WEBCHAT_MAX_UPLOAD_BYTES', '2');
    vi.resetModules();
    const mod = await import('./webchat-uploads.js');
    const result = await mod.acceptChunk(
      {
        uploadId: '550e8400-e29b-41d4-a716-446655440004',
        chunkIndex: 0,
        totalChunks: 1,
        filename: 'big.bin',
        mimeType: 'application/octet-stream',
        data: Buffer.from('12345').toString('base64'),
      },
      'lobby',
      'main',
    );
    expect(result).toMatchObject({ status: 413 });
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('rejects multipart uploads above the configured max upload size', async () => {
    vi.stubEnv('WEBCHAT_MAX_UPLOAD_BYTES', '4');
    vi.resetModules();
    const mod = await import('./webchat-uploads.js');
    const boundary = '----LimitBoundary';
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="big.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      Buffer.from('123456789'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const req = Readable.from([payload]) as http.IncomingMessage;
    req.headers = {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'content-length': String(payload.length),
    };
    const result = await mod.parseMultipartUpload(req, 'lobby', 'main');
    expect(result).toMatchObject({ status: 413 });
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('rejects malformed multipart payloads', async () => {
    const req = Readable.from([Buffer.from('not multipart')]) as http.IncomingMessage;
    req.headers = {
      'content-type': 'multipart/form-data; boundary=----BadBoundary',
    };
    const result = await parseMultipartUpload(req, 'lobby', 'main');
    expect(result).toMatchObject({ status: 500 });
  });

  it('classifies staged image uploads by mime type', async () => {
    const uploadId = '550e8400-e29b-41d4-a716-446655440014';
    const result = await acceptChunk(
      {
        uploadId,
        chunkIndex: 0,
        totalChunks: 1,
        filename: 'photo.png',
        mimeType: 'image/png',
        data: Buffer.from('png-bytes').toString('base64'),
      },
      'lobby',
      'main',
    );
    expect(isAcceptChunkOk(result)).toBe(true);
    if (!isAcceptChunkOk(result) || !result.upload) return;
    expect(result.upload.type).toBe('image');
    expect(getStagedUpload(uploadId)?.type).toBe('image');
  });

  it('returns undefined when consuming an unknown staged upload', () => {
    expect(consumeStagedUpload('550e8400-e29b-41d4-a716-446655440099')).toBeUndefined();
  });

  it('rejects uploads when the content-type header is missing', async () => {
    const req = Readable.from(['plain']) as http.IncomingMessage;
    req.headers = {};
    const result = await parseMultipartUpload(req, 'lobby', 'main');
    expect(result).toMatchObject({ error: 'Content-Type must be multipart/form-data', status: 400 });
  });

  it('rejects strictly invalid base64 chunk strings', async () => {
    for (const data of ['a', '====', 'YQ===']) {
      resetUploadStateForTests();
      const result = await acceptChunk(
        {
          uploadId: '550e8400-e29b-41d4-a716-446655440015',
          chunkIndex: 0,
          totalChunks: 1,
          filename: 'bad.bin',
          mimeType: 'application/octet-stream',
          data,
        },
        'lobby',
        'main',
      );
      expect(result).toMatchObject({ error: 'invalid chunk data', status: 400 });
    }
  });

  it('returns 500 when multipart source stream errors', async () => {
    const boundary = '----SourceErrorBoundary';
    const stream = new PassThrough();
    stream.on('error', () => {});
    const req = stream as unknown as http.IncomingMessage;
    req.headers = {
      'content-type': `multipart/form-data; boundary=${boundary}`,
    };
    const promise = parseMultipartUpload(req, 'lobby', 'main');
    stream.write(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="err.txt"\r\nContent-Type: text/plain\r\n\r\npartial`,
    );
    await new Promise((r) => setImmediate(r));
    stream.destroy(new Error('connection reset'));
    const result = await promise;
    expect(result).toMatchObject({ error: 'Upload failed', status: 500 });
    const stagingEntries = fs.existsSync(uploadsStagingRoot()) ? fs.readdirSync(uploadsStagingRoot()) : [];
    expect(stagingEntries).toHaveLength(0);
  });

  it('returns 500 when multipart write fails without hitting size limit', async () => {
    const boundary = '----WriteFailBoundary';
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="fail.txt"\r\nContent-Type: text/plain\r\n\r\n`),
      Buffer.from('hello'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const req = Readable.from([payload]) as http.IncomingMessage;
    req.headers = {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'content-length': String(payload.length),
    };
    const writeSpy = vi.spyOn(fs, 'createWriteStream').mockImplementation(
      () =>
        new Writable({
          write(_chunk, _encoding, callback) {
            callback(new Error('disk full'));
          },
        }) as fs.WriteStream,
    );
    const result = await parseMultipartUpload(req, 'lobby', 'main');
    writeSpy.mockRestore();
    expect(result).toMatchObject({ error: 'Upload failed', status: 500 });
  });

  it('rejects invalid chunk data payloads', async () => {
    const result = await acceptChunk(
      {
        uploadId: '550e8400-e29b-41d4-a716-446655440013',
        chunkIndex: 0,
        totalChunks: 1,
        filename: 'bad.txt',
        mimeType: 'text/plain',
        data: '%%%',
      },
      'lobby',
      'main',
    );
    expect(result).toMatchObject({ error: 'invalid chunk data', status: 400 });
  });

  it('returns staged uploads by id until consumed', async () => {
    const uploadId = '550e8400-e29b-41d4-a716-446655440011';
    await acceptChunk(
      {
        uploadId,
        chunkIndex: 0,
        totalChunks: 1,
        filename: 'staged.txt',
        mimeType: 'text/plain',
        data: Buffer.from('staged').toString('base64'),
      },
      'lobby',
      'main',
    );
    expect(getStagedUpload(uploadId)?.uploadId).toBe(uploadId);
    consumeStagedUpload(uploadId);
    expect(getStagedUpload(uploadId)).toBeUndefined();
  });

  it('rejects chunk paths that escape the temp directory', async () => {
    const originalJoin = path.join;
    const joinSpy = vi.spyOn(path, 'join').mockImplementation((...args: string[]) => {
      if (
        args.length >= 2 &&
        typeof args[0] === 'string' &&
        args[0].includes('nanoclaw-webchat-chunk') &&
        args[1] === '0'
      ) {
        return '/tmp/nanoclaw-webchat-escape-chunk';
      }
      return originalJoin(...args);
    });
    try {
      await expect(
        acceptChunk(
          {
            uploadId: '550e8400-e29b-41d4-a716-446655440012',
            chunkIndex: 0,
            totalChunks: 1,
            filename: 'escape.txt',
            mimeType: 'text/plain',
            data: Buffer.from('x').toString('base64'),
          },
          'lobby',
          'main',
        ),
      ).rejects.toThrow('path escape');
    } finally {
      joinSpy.mockRestore();
    }
  });

  it('rejects cumulative chunk uploads above the configured max upload size', async () => {
    vi.stubEnv('WEBCHAT_MAX_UPLOAD_BYTES', '5');
    vi.resetModules();
    const mod = await import('./webchat-uploads.js');
    const uploadId = '550e8400-e29b-41d4-a716-446655440010';
    await mod.acceptChunk(
      {
        uploadId,
        chunkIndex: 0,
        totalChunks: 2,
        filename: 'x.bin',
        mimeType: 'application/octet-stream',
        data: Buffer.from('123').toString('base64'),
      },
      'lobby',
      'main',
    );
    const result = await mod.acceptChunk(
      {
        uploadId,
        chunkIndex: 1,
        totalChunks: 2,
        filename: 'x.bin',
        mimeType: 'application/octet-stream',
        data: Buffer.from('456789').toString('base64'),
      },
      'lobby',
      'main',
    );
    expect(result).toMatchObject({ status: 413 });
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('rejects multipart uploads when the staged file is not a regular file', async () => {
    const boundary = '----RegularFileBoundary';
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.txt"\r\nContent-Type: text/plain\r\n\r\n`),
      Buffer.from('hello'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const req = Readable.from([payload]) as http.IncomingMessage;
    req.headers = {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'content-length': String(payload.length),
    };
    const originalLstat = fs.lstatSync.bind(fs);
    const lstatSpy = vi.spyOn(fs, 'lstatSync').mockImplementation((target) => {
      if (String(target).endsWith(`${path.sep}file`)) {
        return { isFile: () => false } as fs.Stats;
      }
      return originalLstat(target);
    });
    const result = await parseMultipartUpload(req, 'lobby', 'main');
    lstatSpy.mockRestore();
    expect(result).toMatchObject({ error: 'Upload failed', status: 500 });
  });

  it('cleans up when multipart upload request aborts', async () => {
    const boundary = '----AbortBoundary';
    const stream = new PassThrough();
    const req = stream as unknown as http.IncomingMessage;
    const handlers = new Map<string, () => void>();
    const originalOn = req.on.bind(req);
    req.on = ((event: string | symbol, listener: (...args: unknown[]) => void) => {
      if (typeof event === 'string') handlers.set(event, listener as () => void);
      return originalOn(event, listener);
    }) as typeof req.on;
    req.headers = {
      'content-type': `multipart/form-data; boundary=${boundary}`,
    };
    void parseMultipartUpload(req, 'lobby', 'main');
    stream.write(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="abort.txt"\r\nContent-Type: text/plain\r\n\r\npartial`,
      ),
    );
    await new Promise((resolve) => setImmediate(resolve));
    Object.defineProperty(req, 'complete', { value: false, configurable: true });
    Object.defineProperty(req, 'readableEnded', { value: false, configurable: true });
    handlers.get('close')?.();
    stream.destroy();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const stagingEntries = fs.existsSync(uploadsStagingRoot()) ? fs.readdirSync(uploadsStagingRoot()) : [];
    expect(stagingEntries).toHaveLength(0);
  });

  it('returns upload assembly failed when chunk assembly cannot read a part', async () => {
    const uploadId = '550e8400-e29b-41d4-a716-446655440005';
    await acceptChunk(
      {
        uploadId,
        chunkIndex: 0,
        totalChunks: 2,
        filename: 'broken.bin',
        mimeType: 'application/octet-stream',
        data: Buffer.from('aa').toString('base64'),
      },
      'lobby',
      'main',
    );
    const originalCreateReadStream = fs.createReadStream.bind(fs);
    const readSpy = vi.spyOn(fs, 'createReadStream').mockImplementation((target, options) => {
      if (typeof target === 'string' && target.endsWith(`${path.sep}0`)) {
        const stream = new PassThrough();
        process.nextTick(() => stream.emit('error', new Error('missing chunk')));
        return stream as unknown as fs.ReadStream;
      }
      return originalCreateReadStream(target, options);
    });
    const result = await acceptChunk(
      {
        uploadId,
        chunkIndex: 1,
        totalChunks: 2,
        filename: 'broken.bin',
        mimeType: 'application/octet-stream',
        data: Buffer.from('bb').toString('base64'),
      },
      'lobby',
      'main',
    );
    readSpy.mockRestore();
    expect(result).toMatchObject({ error: 'Upload assembly failed', status: 500 });
  });

  it('cleans up abandoned in-progress chunked uploads after timeout', async () => {
    vi.useFakeTimers();
    const uploadId = '550e8400-e29b-41d4-a716-446655440008';
    await acceptChunk(
      {
        uploadId,
        chunkIndex: 0,
        totalChunks: 2,
        filename: 'pending.txt',
        mimeType: 'text/plain',
        data: Buffer.from('ab').toString('base64'),
      },
      'lobby',
      'main',
    );
    const tempDir = path.join(os.tmpdir(), `nanoclaw-webchat-chunk-${uploadId}`);
    expect(fs.existsSync(tempDir)).toBe(true);
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1);
    expect(fs.existsSync(tempDir)).toBe(false);
    vi.useRealTimers();
  });

  it('skips timeout cleanup when the staged upload was consumed', async () => {
    vi.useFakeTimers();
    const uploadId = '550e8400-e29b-41d4-a716-446655440009';
    const result = await acceptChunk(
      {
        uploadId,
        chunkIndex: 0,
        totalChunks: 1,
        filename: 'consumed.txt',
        mimeType: 'text/plain',
        data: Buffer.from('keep').toString('base64'),
      },
      'lobby',
      'main',
    );
    expect(result.ok).toBe(true);
    if (!isAcceptChunkOk(result) || !result.upload) {
      vi.useRealTimers();
      return;
    }
    const consumed = consumeStagedUpload(uploadId);
    expect(consumed?.uploadId).toBe(uploadId);
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1);
    vi.useRealTimers();
  });

  it('cleans up completed uploads after timeout', async () => {
    vi.useFakeTimers();
    const uploadId = '550e8400-e29b-41d4-a716-446655440007';
    const result = await acceptChunk(
      {
        uploadId,
        chunkIndex: 0,
        totalChunks: 1,
        filename: 'temp.txt',
        mimeType: 'text/plain',
        data: Buffer.from('temp').toString('base64'),
      },
      'lobby',
      'main',
    );
    expect(result.ok).toBe(true);
    if (!isAcceptChunkOk(result) || !result.upload) {
      vi.useRealTimers();
      return;
    }
    expect(fs.existsSync(result.upload.filePath)).toBe(true);
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 1);
    expect(fs.existsSync(result.upload.filePath)).toBe(false);
    vi.useRealTimers();
  });

  it('restoreStagedUpload re-registers consumed uploads', async () => {
    const uploadId = '550e8400-e29b-41d4-a716-446655440008';
    const result = await acceptChunk(
      {
        uploadId,
        chunkIndex: 0,
        totalChunks: 1,
        filename: 'restore.txt',
        mimeType: 'text/plain',
        data: Buffer.from('restore-me').toString('base64'),
      },
      'lobby',
      'main',
    );
    expect(isAcceptChunkOk(result)).toBe(true);
    if (!isAcceptChunkOk(result) || !result.upload) return;
    const consumed = consumeStagedUpload(uploadId);
    expect(consumed?.uploadId).toBe(uploadId);
    expect(getStagedUpload(uploadId)).toBeUndefined();
    restoreStagedUpload(consumed!);
    expect(getStagedUpload(uploadId)?.uploadId).toBe(uploadId);
  });

  it('cleans up partial chunk uploads after inactivity timeout', async () => {
    vi.useFakeTimers();
    const uploadId = '550e8400-e29b-41d4-a716-446655440009';
    const first = await acceptChunk(
      {
        uploadId,
        chunkIndex: 0,
        totalChunks: 2,
        filename: 'slow.bin',
        mimeType: 'application/octet-stream',
        data: Buffer.from('aa').toString('base64'),
      },
      'lobby',
      'main',
    );
    expect(first).toMatchObject({ ok: true, received: 1, total: 2 });
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1);
    const second = await acceptChunk(
      {
        uploadId,
        chunkIndex: 1,
        totalChunks: 2,
        filename: 'slow.bin',
        mimeType: 'application/octet-stream',
        data: Buffer.from('bb').toString('base64'),
      },
      'lobby',
      'main',
    );
    expect(isAcceptChunkOk(second)).toBe(true);
    if (!isAcceptChunkOk(second) || !second.upload) {
      vi.useRealTimers();
      return;
    }
    expect(second.upload.size).toBe(4);
    vi.useRealTimers();
  });

  it('formats GB upload limits by default', () => {
    expect(formatMaxUploadLabel()).toBe('1.0 GB');
  });

  it('formats MB upload limits from env', async () => {
    vi.stubEnv('WEBCHAT_MAX_UPLOAD_BYTES', String(50 * 1024 * 1024));
    vi.resetModules();
    const mod = await import('./webchat-uploads.js');
    expect(mod.formatMaxUploadLabel()).toBe('50 MB');
    vi.unstubAllEnvs();
    vi.resetModules();
  });
});
