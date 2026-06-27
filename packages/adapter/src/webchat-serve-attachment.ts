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
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.bmp': 'image/bmp',
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
  '.mov': 'video/quicktime',
  '.m4v': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.zip': 'application/zip',
};

export function mimeTypeFromFilename(filename: string): string {
  const ext = filename.includes('.') ? `.${filename.split('.').pop()!.toLowerCase()}` : '';
  return EXT_TO_MIME[ext] ?? 'application/octet-stream';
}

/** Prefer filename inference when upload/browser MIME is missing or generic. */
export function inferAttachmentMime(name: string, mimeType = ''): string {
  const trimmed = mimeType.trim().split(';', 1)[0].trim().toLowerCase();
  const fromFilename = mimeTypeFromFilename(name);
  if (!trimmed || trimmed === 'application/octet-stream') {
    return fromFilename;
  }
  if (fromFilename.startsWith('audio/') && !trimmed.startsWith('audio/')) {
    return fromFilename;
  }
  if (fromFilename.startsWith('video/') && !trimmed.startsWith('video/')) {
    return fromFilename;
  }
  if (fromFilename.startsWith('image/') && !trimmed.startsWith('image/')) {
    return fromFilename;
  }
  return trimmed;
}

export type ParsedAttachmentByteRange =
  | { ok: true; start: number; end: number }
  | { ok: false; reason: 'invalid' }
  | null;

/** Parse RFC 7233 `bytes=` ranges (prefix, open-ended, and suffix forms). */
export function parseAttachmentByteRange(
  rangeHeader: string,
  fileSize: number,
): ParsedAttachmentByteRange {
  const trimmed = rangeHeader.trim();

  const suffixMatch = /^bytes=-(\d+)$/.exec(trimmed);
  if (suffixMatch) {
    const suffixLen = Number.parseInt(suffixMatch[1]!, 10);
    if (Number.isNaN(suffixLen) || suffixLen <= 0 || fileSize === 0) {
      return { ok: false, reason: 'invalid' };
    }
    const start = Math.max(0, fileSize - suffixLen);
    return { ok: true, start, end: fileSize - 1 };
  }

  const match = /^bytes=(\d+)-(\d*)$/.exec(trimmed);
  if (!match) {
    return null;
  }

  const start = Number.parseInt(match[1]!, 10);
  const end = match[2] ? Number.parseInt(match[2], 10) : fileSize - 1;
  if (
    Number.isNaN(start) ||
    Number.isNaN(end) ||
    start < 0 ||
    end < start ||
    start >= fileSize
  ) {
    return { ok: false, reason: 'invalid' };
  }

  return { ok: true, start, end: Math.min(end, fileSize - 1) };
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
    const parsed = parseAttachmentByteRange(rangeHeader, stat.size);
    if (parsed?.ok === false) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end();
      return;
    }
    if (parsed?.ok === true) {
      const { start, end } = parsed;
      res.writeHead(206, {
        ...baseHeaders,
        'Content-Length': end - start + 1,
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      });
      streamFileToResponse(fs.createReadStream(filePath, { start, end }), res);
      return;
    }
  }

  res.writeHead(200, {
    ...baseHeaders,
    'Content-Length': stat.size,
  });
  streamFileToResponse(fs.createReadStream(filePath), res);
}
