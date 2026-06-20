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

export function inferMimeType(name: string, mimeType = ''): string {
  if (mimeType.trim()) return mimeType.trim();
  const ext = name.includes('.') ? `.${name.split('.').pop()!.toLowerCase()}` : '';
  return EXT_TO_MIME[ext] ?? 'application/octet-stream';
}

export function attachmentTypeFromMime(mimeType: string): 'image' | 'file' {
  return mimeType.startsWith('image/') ? 'image' : 'file';
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
): Promise<PendingAttachment[]> {
  const list = Array.from(files).filter((file) => file.name.trim().length > 0);
  const remaining = MAX_ATTACHMENTS - existingCount;
  if (remaining <= 0 || list.length === 0) return [];

  const selected = list.slice(0, remaining);
  const results: PendingAttachment[] = [];

  for (const file of selected) {
    if (file.size > MAX_ATTACHMENT_BYTES) continue;
    const mimeType = inferMimeType(file.name, file.type);
    const data = await readFileAsBase64(file);
    const previewUrl = URL.createObjectURL(file);
    results.push({
      name: file.name,
      mimeType,
      type: attachmentTypeFromMime(mimeType),
      size: file.size,
      data,
      previewUrl,
    });
  }

  return results;
}

/** @deprecated Use readAttachmentFiles */
export const readImageFiles = readAttachmentFiles;

export function attachmentDataUrl(att: WebChatAttachment): string | null {
  if (!att.data) return null;
  return `data:${att.mimeType};base64,${att.data}`;
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
