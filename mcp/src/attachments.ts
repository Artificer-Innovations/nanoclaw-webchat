import fs from 'node:fs';
import path from 'node:path';
import type { WebChatAttachment } from './types.js';

export const MAX_ATTACHMENTS = 4;
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

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
  '.zip': 'application/zip',
  '.csv': 'text/csv',
  '.html': 'text/html',
  '.htm': 'text/html',
};

export function inferMimeType(name: string, mimeType = ''): string {
  if (mimeType.trim()) return mimeType.trim();
  const ext = name.includes('.') ? `.${name.split('.').pop()!.toLowerCase()}` : '';
  return EXT_TO_MIME[ext] ?? 'application/octet-stream';
}

export function attachmentTypeFromMime(mimeType: string): 'image' | 'file' {
  return mimeType.startsWith('image/') ? 'image' : 'file';
}

export interface ReadAttachmentPathsResult {
  attachments: WebChatAttachment[];
  errors: string[];
}

export function readAttachmentPaths(paths: string[]): ReadAttachmentPathsResult {
  const attachments: WebChatAttachment[] = [];
  const errors: string[] = [];

  if (paths.length > MAX_ATTACHMENTS) {
    errors.push(`Only ${MAX_ATTACHMENTS} attachments allowed`);
    paths = paths.slice(0, MAX_ATTACHMENTS);
  }

  for (const rawPath of paths) {
    const filePath = path.resolve(rawPath.trim());
    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      errors.push(`Could not read file: ${rawPath}`);
      continue;
    }
    if (!stat.isFile()) {
      errors.push(`Not a file: ${rawPath}`);
      continue;
    }
    if (stat.size > MAX_ATTACHMENT_BYTES) {
      errors.push(`${path.basename(filePath)} exceeds the 5 MB limit`);
      continue;
    }
    const name = path.basename(filePath);
    const mimeType = inferMimeType(name);
    try {
      const data = fs.readFileSync(filePath).toString('base64');
      attachments.push({
        name,
        mimeType,
        type: attachmentTypeFromMime(mimeType),
        size: stat.size,
        data,
      });
    } catch {
      errors.push(`Could not read file: ${rawPath}`);
    }
  }

  return { attachments, errors };
}
