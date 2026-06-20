import { getStoredToken } from './api';
import type { WebChatAttachment } from './types';

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

export interface PendingAttachment extends WebChatAttachment {
  previewUrl: string;
}

export type AttachmentRejectReason = 'too_large' | 'read_failed' | 'capacity';

export interface AttachmentRejection {
  name: string;
  reason: AttachmentRejectReason;
}

export interface ReadAttachmentFilesResult {
  attachments: PendingAttachment[];
  rejected: AttachmentRejection[];
}

export function inferMimeType(name: string, mimeType = ''): string {
  if (mimeType.trim()) return mimeType.trim();
  const ext = name.includes('.') ? `.${name.split('.').pop()!.toLowerCase()}` : '';
  return EXT_TO_MIME[ext] ?? 'application/octet-stream';
}

export function attachmentTypeFromMime(mimeType: string): 'image' | 'file' {
  return mimeType.startsWith('image/') ? 'image' : 'file';
}

/** Align `type` with `mimeType` when server payloads disagree. */
export function normalizeAttachment(att: WebChatAttachment): WebChatAttachment {
  const type = attachmentTypeFromMime(att.mimeType);
  return att.type === type ? att : { ...att, type };
}

export function formatAttachmentRejections(rejected: AttachmentRejection[]): string | null {
  if (rejected.length === 0) return null;
  const parts = rejected.map(({ name, reason }) => {
    switch (reason) {
      case 'too_large':
        return `${name} exceeds the 5 MB limit`;
      case 'read_failed':
        return `Could not read ${name}`;
      case 'capacity':
        return `Only ${MAX_ATTACHMENTS} attachments allowed (${name} skipped)`;
    }
  });
  return parts.join('; ');
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('read failed'));
        return;
      }
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

export async function readAttachmentFiles(
  files: FileList | File[],
  existingCount = 0,
): Promise<ReadAttachmentFilesResult> {
  const list = Array.from(files).filter((file) => file.name.trim().length > 0);
  const remaining = MAX_ATTACHMENTS - existingCount;
  const rejected: AttachmentRejection[] = [];

  if (list.length === 0) {
    return { attachments: [], rejected };
  }

  if (remaining <= 0) {
    return {
      attachments: [],
      rejected: list.map((file) => ({ name: file.name, reason: 'capacity' })),
    };
  }

  const selected = list.slice(0, remaining);
  for (const file of list.slice(remaining)) {
    rejected.push({ name: file.name, reason: 'capacity' });
  }

  const attachments: PendingAttachment[] = [];

  for (const file of selected) {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      rejected.push({ name: file.name, reason: 'too_large' });
      continue;
    }
    const mimeType = inferMimeType(file.name, file.type);
    try {
      const data = await readFileAsBase64(file);
      const previewUrl = URL.createObjectURL(file);
      attachments.push({
        name: file.name,
        mimeType,
        type: attachmentTypeFromMime(mimeType),
        size: file.size,
        data,
        previewUrl,
      });
    } catch {
      rejected.push({ name: file.name, reason: 'read_failed' });
    }
  }

  return { attachments, rejected };
}

/** Append new pending attachments without exceeding MAX_ATTACHMENTS. Caller revokes `dropped` previews. */
export function mergePendingAttachments(
  prev: PendingAttachment[],
  next: PendingAttachment[],
): { attachments: PendingAttachment[]; dropped: PendingAttachment[] } {
  const remaining = MAX_ATTACHMENTS - prev.length;
  if (remaining <= 0) {
    return { attachments: prev, dropped: next };
  }
  const accepted = next.slice(0, remaining);
  const dropped = next.slice(remaining);
  return { attachments: [...prev, ...accepted], dropped };
}

export function isSafeAttachmentUrl(url: string): boolean {
  if (!url.startsWith('/api/attachments/')) return false;
  if (url.includes('://') || url.startsWith('//')) return false;
  const lowered = url.toLowerCase();
  if (lowered.includes('javascript:') || lowered.includes('data:')) return false;
  return true;
}

function attachmentUrlWithAuth(path: string, token: string): string {
  if (!token) return path;
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}token=${encodeURIComponent(token)}`;
}

export function attachmentDataUrl(att: WebChatAttachment, token?: string): string | null {
  if (att.data) {
    return `data:${att.mimeType};base64,${att.data}`;
  }
  if (att.url && isSafeAttachmentUrl(att.url)) {
    const authToken = token ?? getStoredToken();
    return attachmentUrlWithAuth(att.url, authToken);
  }
  return null;
}

export function attachmentToBlob(att: WebChatAttachment): Blob | null {
  if (!att.data) return null;
  try {
    const binary = atob(att.data);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new Blob([bytes], { type: att.mimeType });
  } catch {
    return null;
  }
}

/** Open attachment content in a new tab (blob URL — data: URIs are blocked in new tabs). */
export function openAttachmentInNewTab(att: WebChatAttachment, token?: string): boolean {
  if (att.url && isSafeAttachmentUrl(att.url)) {
    const authToken = token ?? getStoredToken();
    const url = attachmentUrlWithAuth(att.url, authToken);
    const tab = window.open(url, '_blank', 'noopener,noreferrer');
    return tab !== null;
  }
  const blob = attachmentToBlob(att);
  if (!blob) return false;
  const url = URL.createObjectURL(blob);
  const tab = window.open(url, '_blank', 'noopener,noreferrer');
  if (!tab) {
    URL.revokeObjectURL(url);
    return false;
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}

export function attachmentPreviewUrl(att: PendingAttachment | WebChatAttachment): string | null {
  if ('previewUrl' in att && att.previewUrl) return att.previewUrl;
  return attachmentDataUrl(att);
}

export function revokeAttachmentPreviews(attachments: PendingAttachment[]): void {
  for (const att of attachments) {
    URL.revokeObjectURL(att.previewUrl);
  }
}

export function removePendingAtIndex(list: PendingAttachment[], index: number): PendingAttachment[] {
  const removed = list[index];
  if (removed) URL.revokeObjectURL(removed.previewUrl);
  return list.filter((_, i) => i !== index);
}

export function toSendAttachments(attachments: PendingAttachment[]): WebChatAttachment[] {
  return attachments.map(({ previewUrl: _previewUrl, ...rest }) => rest);
}
