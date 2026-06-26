import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { mimeTypeFromFilename, serveAttachmentFile } from './webchat-serve-attachment.js';

function requestFile(
  filePath: string,
  storageName: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      serveAttachmentFile(filePath, storageName, req, res);
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close();
        reject(new Error('no port'));
        return;
      }
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: addr.port,
          path: '/file',
          method: 'GET',
          headers,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
          res.on('end', () => {
            server.close();
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              body: Buffer.concat(chunks),
            });
          });
        },
      );
      req.on('error', (err) => {
        server.close();
        reject(err);
      });
      req.end();
    });
  });
}

describe('webchat-serve-attachment', () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('maps common extensions to mime types', () => {
    expect(mimeTypeFromFilename('photo.png')).toBe('image/png');
    expect(mimeTypeFromFilename('notes.md')).toBe('text/markdown');
    expect(mimeTypeFromFilename('unknown')).toBe('application/octet-stream');
  });

  it('streams full file with length and accept-ranges headers', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-att-'));
    const filePath = path.join(tempDir, 'data.bin');
    fs.writeFileSync(filePath, Buffer.from('hello-world'));

    const res = await requestFile(filePath, 'data.bin');
    expect(res.status).toBe(200);
    expect(res.body.toString()).toBe('hello-world');
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(res.headers['content-length']).toBe('11');
    expect(res.headers['accept-ranges']).toBe('bytes');
  });

  it('returns 404 for missing files', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-att-'));
    const res = await requestFile(path.join(tempDir, 'missing.bin'), 'missing.bin');
    expect(res.status).toBe(404);
  });

  it('serves byte ranges with 206 partial content', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-att-'));
    const filePath = path.join(tempDir, 'range.txt');
    fs.writeFileSync(filePath, Buffer.from('0123456789'));

    const res = await requestFile(filePath, 'range.txt', { Range: 'bytes=2-5' });
    expect(res.status).toBe(206);
    expect(res.body.toString()).toBe('2345');
    expect(res.headers['content-range']).toBe('bytes 2-5/10');
    expect(res.headers['content-length']).toBe('4');
  });

  it('returns 416 for invalid range requests', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-att-'));
    const filePath = path.join(tempDir, 'range.txt');
    fs.writeFileSync(filePath, Buffer.from('abc'));

    const res = await requestFile(filePath, 'range.txt', { Range: 'bytes=10-20' });
    expect(res.status).toBe(416);
    expect(res.headers['content-range']).toBe('bytes */3');
  });
});
