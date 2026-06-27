/**
 * Staged attachment uploads for the web channel (multipart + chunked JSON).
 */
import Busboy from 'busboy';
import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { pipeline as pipelineCallback } from 'stream';
import { pipeline as pipelinePromise } from 'stream/promises';

import { DATA_DIR } from './config.js';
import { inferAttachmentMime } from './webchat-serve-attachment.js';

export const DEFAULT_MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;
export const MAX_UPLOAD_BYTES =
  Number.parseInt(process.env.WEBCHAT_MAX_UPLOAD_BYTES ?? '', 10) || DEFAULT_MAX_UPLOAD_BYTES;
export const CHUNK_SIZE = 512 * 1024;
/** In-progress chunked assembly; refreshed on each received chunk. */
export const CHUNK_UPLOAD_TIMEOUT = 5 * 60 * 1000;
/** Completed staging entries waiting for message POST. */
export const COMPLETED_UPLOAD_TTL = 30 * 60 * 1000;

export function formatMaxUploadLabel(): string {
  if (MAX_UPLOAD_BYTES >= 1024 * 1024 * 1024) {
    return `${(MAX_UPLOAD_BYTES / 1024 / 1024 / 1024).toFixed(1)} GB`;
  }
  return `${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface StagedUpload {
  uploadId: string;
  name: string;
  mimeType: string;
  type: 'image' | 'file';
  size: number;
  filePath: string;
  platformId: string;
  threadId: string;
}

interface PendingChunkUpload {
  filename: string;
  mimeType: string;
  totalChunks: number;
  receivedChunks: Set<number>;
  tempDir: string;
  cumulativeSize: number;
  timer: ReturnType<typeof setTimeout>;
  platformId: string;
  threadId: string;
}

const completedUploads = new Map<string, StagedUpload>();
const pendingChunkedUploads = new Map<string, PendingChunkUpload>();

export function uploadsStagingRoot(): string {
  return path.join(DATA_DIR, 'webchat-uploads');
}

function stagedUploadDir(uploadId: string): string {
  return path.join(uploadsStagingRoot(), uploadId);
}

function stagedFilePath(uploadId: string): string {
  return path.join(stagedUploadDir(uploadId), 'file');
}

export function isValidUploadId(uploadId: string): boolean {
  return UUID_RE.test(uploadId);
}

function attachmentTypeFromMime(mimeType: string): 'image' | 'file' {
  return mimeType.startsWith('image/') ? 'image' : 'file';
}

function assertRegularFile(filePath: string): void {
  const st = fs.lstatSync(filePath);
  if (!st.isFile()) throw new Error('not a file');
}

function assertUnderRoot(filePath: string, root: string): void {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(filePath);
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
    throw new Error('path escape');
  }
}

function registerCompletedUpload(upload: StagedUpload): StagedUpload {
  completedUploads.set(upload.uploadId, upload);
  setTimeout(() => {
    /* v8 ignore if -- stale timer after upload replacement */
    if (completedUploads.get(upload.uploadId) !== upload) return;
    completedUploads.delete(upload.uploadId);
    try {
      fs.rmSync(path.dirname(upload.filePath), { recursive: true, force: true });
    } catch {
      // ignore cleanup failures
    }
  }, COMPLETED_UPLOAD_TTL);
  return upload;
}

/** Re-register a consumed upload after a failed message persist (rollback path). */
export function restoreStagedUpload(upload: StagedUpload): void {
  registerCompletedUpload(upload);
}

export function getStagedUpload(uploadId: string): StagedUpload | undefined {
  return completedUploads.get(uploadId);
}

export function consumeStagedUpload(uploadId: string): StagedUpload | undefined {
  const upload = completedUploads.get(uploadId);
  if (upload) completedUploads.delete(uploadId);
  return upload;
}

export function cleanupChunkedUpload(uploadId: string): void {
  const upload = pendingChunkedUploads.get(uploadId);
  if (!upload) return;
  clearTimeout(upload.timer);
  pendingChunkedUploads.delete(uploadId);
  try {
    fs.rmSync(upload.tempDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup failures
  }
}

export function resetUploadStateForTests(): void {
  for (const uploadId of pendingChunkedUploads.keys()) {
    cleanupChunkedUpload(uploadId);
  }
  for (const upload of completedUploads.values()) {
    try {
      fs.rmSync(path.dirname(upload.filePath), { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
  completedUploads.clear();
}

export async function parseMultipartUpload(
  req: http.IncomingMessage,
  platformId: string,
  threadId: string,
): Promise<{ upload: StagedUpload } | { error: string; status: number }> {
  const contentType = req.headers['content-type'] ?? '';
  if (!contentType.includes('multipart/form-data')) {
    return { error: 'Content-Type must be multipart/form-data', status: 400 };
  }

  return new Promise((resolve) => {
    const uploadId = crypto.randomUUID();
    const uploadDir = stagedUploadDir(uploadId);
    const finalPath = stagedFilePath(uploadId);
    let partialPath: string | null = null;
    let limitHit = false;
    let writeError = false;
    let fileInfo: { name: string; mimeType: string; size: number } | null = null;

    const cleanupPartial = () => {
      if (!partialPath) return;
      fs.promises.unlink(partialPath).catch(() => {});
      partialPath = null;
    };

    const busboy = Busboy({
      headers: req.headers,
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    });

    let fileWriteStream: fs.WriteStream | null = null;
    let fileWriteDone: Promise<void> | null = null;
    let fileMeta: { name: string; mimeType: string } | null = null;
    let settled = false;
    const settle = (value: { upload: StagedUpload } | { error: string; status: number }) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    busboy.on('file', (_field: string, stream: NodeJS.ReadableStream, info: { filename?: string; mimeType?: string }) => {
      fs.mkdirSync(uploadDir, { recursive: true });
      partialPath = finalPath;
      fileMeta = {
        name: info.filename || 'upload',
        mimeType: inferAttachmentMime(info.filename || 'upload', info.mimeType || ''),
      };
      const ws = fs.createWriteStream(finalPath);
      fileWriteStream = ws;
      fileWriteDone = new Promise<void>((resolveWrite) => {
        pipelineCallback(stream, ws, (err) => {
          if (err && !limitHit) writeError = true;
          resolveWrite();
        });
      });

      stream.on('error', () => {
        writeError = true;
        ws.destroy();
      });

      stream.on('limit', () => {
        limitHit = true;
        ws.destroy();
        cleanupPartial();
        try {
          fs.rmSync(uploadDir, { recursive: true, force: true });
        } catch {
          // ignore
        }
      });
    });

    busboy.on('finish', () => {
      void (async () => {
        if (fileWriteDone) {
          await fileWriteDone;
        }
        if (limitHit || writeError) {
          cleanupPartial();
          try {
            fs.rmSync(uploadDir, { recursive: true, force: true });
          } catch {
            // ignore
          }
          settle({
            error: limitHit ? `File exceeds ${formatMaxUploadLabel()} limit` : 'Upload failed',
            status: limitHit ? 413 : 500,
          });
          return;
        }
        if (!fileMeta) {
          settle({ error: 'No file uploaded', status: 400 });
          return;
        }
        partialPath = null;
        let size = 0;
        try {
          assertRegularFile(finalPath);
          size = fs.statSync(finalPath).size;
        } catch {
          cleanupPartial();
          settle({ error: 'Upload failed', status: 500 });
          return;
        }
        fileInfo = { ...fileMeta, size };
        const upload = registerCompletedUpload({
          uploadId,
          name: fileInfo.name,
          mimeType: fileInfo.mimeType,
          type: attachmentTypeFromMime(fileInfo.mimeType),
          size: fileInfo.size,
          filePath: finalPath,
          platformId,
          threadId,
        });
        settle({ upload });
      })();
    });

    busboy.on('error', () => {
      cleanupPartial();
      try {
        fs.rmSync(uploadDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
      settle({ error: 'Upload failed', status: 500 });
    });

    req.on('close', () => {
      if (settled || req.complete || req.readableEnded) return;
      fileWriteStream?.destroy();
      cleanupPartial();
      try {
        fs.rmSync(uploadDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
      settle({ error: 'Upload failed', status: 500 });
    });

    req.pipe(busboy);
  });
}

export interface ChunkUploadBody {
  uploadId: string;
  chunkIndex: number;
  totalChunks: number;
  filename: string;
  mimeType?: string;
  data: string;
}

export type AcceptChunkResult =
  | { ok: true; upload?: StagedUpload; received: number; total: number }
  | { ok: false; error: string; status: number };

export function isAcceptChunkOk(
  result: AcceptChunkResult,
): result is Extract<AcceptChunkResult, { ok: true }> {
  return result.ok;
}

function decodeChunkBase64(data: string): Buffer | null {
  const normalized = data.replace(/\s/g, '');
  if (!normalized || normalized.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) return null;
  const buf = Buffer.from(normalized, 'base64');
  /* v8 ignore next 3 -- Node accepts only canonical base64 in practice */
  if (buf.length === 0) return null;
  const reencoded = buf.toString('base64').replace(/=+$/, '');
  if (reencoded !== normalized.replace(/=+$/, '')) return null;
  return buf;
}

function refreshChunkTimer(uploadId: string, upload: PendingChunkUpload): void {
  clearTimeout(upload.timer);
  upload.timer = setTimeout(() => cleanupChunkedUpload(uploadId), CHUNK_UPLOAD_TIMEOUT);
}

export async function acceptChunk(
  body: ChunkUploadBody,
  platformId: string,
  threadId: string,
): Promise<AcceptChunkResult> {
  const { uploadId, chunkIndex, totalChunks, filename, data } = body;
  const mimeType = inferAttachmentMime(filename, body.mimeType ?? '');

  if (
    !uploadId ||
    !filename ||
    !data ||
    !Number.isInteger(totalChunks) ||
    totalChunks <= 0 ||
    !Number.isInteger(chunkIndex) ||
    chunkIndex < 0 ||
    chunkIndex >= totalChunks
  ) {
    return { ok: false, error: 'Missing or invalid required fields', status: 400 };
  }

  if (!isValidUploadId(uploadId)) {
    return { ok: false, error: 'Invalid uploadId format', status: 400 };
  }

  let upload = pendingChunkedUploads.get(uploadId);
  if (!upload) {
    const tempDir = path.join(os.tmpdir(), `nanoclaw-webchat-chunk-${uploadId}`);
    fs.mkdirSync(tempDir, { recursive: true });
    upload = {
      filename,
      mimeType,
      totalChunks,
      receivedChunks: new Set(),
      tempDir,
      cumulativeSize: 0,
      timer: undefined as unknown as NodeJS.Timeout,
      platformId,
      threadId,
    };
    pendingChunkedUploads.set(uploadId, upload);
    refreshChunkTimer(uploadId, upload);
  } else if (totalChunks !== upload.totalChunks) {
    return { ok: false, error: 'totalChunks mismatch', status: 400 };
  }

  if (upload.receivedChunks.has(chunkIndex)) {
    refreshChunkTimer(uploadId, upload);
    return { ok: true, received: upload.receivedChunks.size, total: upload.totalChunks };
  }

  const chunkBuf = decodeChunkBase64(data);
  if (!chunkBuf) {
    return { ok: false, error: 'invalid chunk data', status: 400 };
  }

  upload.cumulativeSize += chunkBuf.length;
  if (upload.cumulativeSize > MAX_UPLOAD_BYTES) {
    cleanupChunkedUpload(uploadId);
    return { ok: false, error: `File exceeds ${formatMaxUploadLabel()} limit`, status: 413 };
  }

  const chunkPath = path.join(upload.tempDir, String(chunkIndex));
  assertUnderRoot(chunkPath, upload.tempDir);
  await fs.promises.writeFile(chunkPath, chunkBuf);
  upload.receivedChunks.add(chunkIndex);
  refreshChunkTimer(uploadId, upload);

  if (upload.receivedChunks.size < upload.totalChunks) {
    return { ok: true, received: upload.receivedChunks.size, total: upload.totalChunks };
  }

  clearTimeout(upload.timer);
  pendingChunkedUploads.delete(uploadId);

  const uploadDir = stagedUploadDir(uploadId);
  fs.mkdirSync(uploadDir, { recursive: true });
  const finalPath = stagedFilePath(uploadId);
  const writeStream = fs.createWriteStream(finalPath);

  try {
    // `{ end: false }` requires Node.js >= 16.12 (repo engines: node >= 20).
    for (let i = 0; i < upload.totalChunks; i++) {
      const partPath = path.join(upload.tempDir, String(i));
      await pipelinePromise(fs.createReadStream(partPath), writeStream, { end: false });
    }
    await new Promise<void>((resolveWrite, rejectWrite) => {
      writeStream.on('finish', resolveWrite);
      writeStream.on('error', rejectWrite);
      writeStream.end();
    });
    fs.rmSync(upload.tempDir, { recursive: true, force: true });
    assertRegularFile(finalPath);
  } catch {
    writeStream.destroy();
    try {
      fs.rmSync(finalPath, { force: true });
    } catch {
      // ignore
    }
    cleanupChunkedUpload(uploadId);
    try {
      fs.rmSync(uploadDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    return { ok: false, error: 'Upload assembly failed', status: 500 };
  }

  const stat = fs.statSync(finalPath);
  const staged = registerCompletedUpload({
    uploadId,
    name: upload.filename,
    mimeType: upload.mimeType,
    type: attachmentTypeFromMime(upload.mimeType),
    size: stat.size,
    filePath: finalPath,
    platformId: upload.platformId,
    threadId: upload.threadId,
  });

  return { ok: true, upload: staged, received: upload.totalChunks, total: upload.totalChunks };
}
