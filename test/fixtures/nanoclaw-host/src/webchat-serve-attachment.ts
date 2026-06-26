/**
 * Stream attachment bytes with optional HTTP Range support (constant memory per request).
 */
import fs from 'fs';
import http from 'http';
import { pipeline } from 'stream';

const EXT_TO_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.json': 'application/json',
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.zip': 'application/zip',
};

export function mimeTypeFromFilename(filename: string): string {
  const ext = filename.includes('.') ? `.${filename.split('.').pop()!.toLowerCase()}` : '';
  return EXT_TO_MIME[ext] ?? 'application/octet-stream';
}

function streamFileToResponse(readStream: fs.ReadStream, res: http.ServerResponse): void {
  pipeline(readStream, res, (err) => {
    if (err) {
      readStream.destroy();
    }
  });
}

export function serveAttachmentFile(
  filePath: string,
  storageName: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): void {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      res.writeHead(404).end();
      return;
    }
  } catch {
    res.writeHead(404).end();
    return;
  }

  const contentType = mimeTypeFromFilename(storageName);
  const baseHeaders = {
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff',
  } as const;

  const rangeHeader = req.headers.range;
  if (rangeHeader) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader);
    if (match) {
      const start = Number.parseInt(match[1]!, 10);
      const end = match[2] ? Number.parseInt(match[2], 10) : stat.size - 1;
      if (
        Number.isNaN(start) ||
        Number.isNaN(end) ||
        start < 0 ||
        end < start ||
        start >= stat.size
      ) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end();
        return;
      }
      const clampedEnd = Math.min(end, stat.size - 1);
      res.writeHead(206, {
        ...baseHeaders,
        'Content-Length': clampedEnd - start + 1,
        'Content-Range': `bytes ${start}-${clampedEnd}/${stat.size}`,
      });
      streamFileToResponse(fs.createReadStream(filePath, { start, end: clampedEnd }), res);
      return;
    }
  }

  res.writeHead(200, {
    ...baseHeaders,
    'Content-Length': stat.size,
  });
  streamFileToResponse(fs.createReadStream(filePath), res);
}
