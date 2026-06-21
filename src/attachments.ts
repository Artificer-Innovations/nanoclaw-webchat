import { buildCodePopoutDocument, buildCsvPopoutDocument, buildHtmlPopoutDocument, buildMarkdownPopoutDocument, buildPlainTextPopoutDocument, openHtmlDocumentInNewTab, ATTACHMENT_HTML_IFRAME_SANDBOX } from './attachment-text-popout';
import { codeLanguageFromAttachment, isCodeFilename, isCodeMimeType } from './attachment-code';
import { isCsvAttachment } from './csv-preview';
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
  '.tsv': 'text/tab-separated-values',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.cjs': 'text/javascript',
  '.jsx': 'text/javascript',
  '.ts': 'text/typescript',
  '.tsx': 'text/typescript',
  '.java': 'text/x-java-source',
  '.css': 'text/css',
  '.scss': 'text/x-scss',
  '.sass': 'text/x-sass',
  '.less': 'text/x-less',
  '.py': 'text/x-python',
  '.php': 'text/x-php',
  '.c': 'text/x-c',
  '.h': 'text/x-c',
  '.cpp': 'text/x-c++',
  '.cc': 'text/x-c++',
  '.cxx': 'text/x-c++',
  '.hpp': 'text/x-c++',
  '.hh': 'text/x-c++',
  '.go': 'text/x-go',
  '.rs': 'text/x-rust',
  '.rb': 'text/x-ruby',
  '.sh': 'text/x-shellscript',
  '.sql': 'text/x-sql',
  '.xml': 'text/xml',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.vue': 'text/x-vue',
  '.swift': 'text/x-swift',
  '.kt': 'text/x-kotlin',
  '.kts': 'text/x-kotlin',
  '.scala': 'text/x-scala',
  '.cs': 'text/x-csharp',
  '.lua': 'text/x-lua',
  '.r': 'text/x-r',
  '.rmd': 'text/x-r',
  '.dockerfile': 'text/x-dockerfile',
  '.pl': 'text/x-perl',
  '.pm': 'text/x-perl',
  '.ps1': 'text/x-powershell',
  '.psm1': 'text/x-powershell',
  '.m': 'text/x-objective-c',
  '.mm': 'text/x-objective-c',
  '.hs': 'text/x-haskell',
  '.erl': 'text/x-erlang',
  '.ex': 'text/x-elixir',
  '.exs': 'text/x-elixir',
  '.clj': 'text/x-clojure',
  '.cljs': 'text/x-clojure',
  '.dart': 'text/x-dart',
  '.vb': 'text/x-vb',
  '.fs': 'text/x-fsharp',
  '.groovy': 'text/x-groovy',
  '.gradle': 'text/x-groovy',
  '.jl': 'text/x-julia',
  '.f90': 'text/x-fortran',
  '.cmake': 'text/x-cmake',
  '.cr': 'text/x-crystal',
  '.nim': 'text/x-nim',
  '.ml': 'text/x-ocaml',
  '.tex': 'text/x-tex',
  '.proto': 'application/x-protobuf',
  '.graphql': 'application/graphql',
  '.gql': 'application/graphql',
  '.ini': 'text/plain',
  '.toml': 'text/x-toml',
  '.bat': 'text/plain',
  '.cmd': 'text/plain',
  '.coffee': 'text/javascript',
  '.d': 'text/x-d',
  '.elm': 'text/plain',
  '.nix': 'text/plain',
  '.mdx': 'text/markdown',
  '.zig': 'text/x-zig',
  '.svelte': 'text/x-svelte',
  '.mk': 'text/x-makefile',
  '.pug': 'text/x-pug',
  '.jade': 'text/x-pug',
  '.styl': 'text/x-stylus',
  '.jinja': 'text/x-jinja2',
  '.j2': 'text/x-jinja2',
  '.jinja2': 'text/x-jinja2',
  '.tcl': 'text/x-tcl',
  '.jsonnet': 'application/json',
  '.libsonnet': 'application/json',
  '.wgsl': 'text/plain',
  '.hlsl': 'text/plain',
  '.env': 'text/plain',
  '.applescript': 'text/x-applescript',
  '.rst': 'text/plain',
  '.hcl': 'text/x-hcl',
  '.tf': 'text/x-hcl',
  '.tfvars': 'text/x-hcl',
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

export type AttachmentPreviewMode = 'text' | 'embed' | 'metadata';

export type AttachmentTextCategory = 'markdown' | 'code' | 'plain' | 'html' | 'csv';

export function attachmentTextCategory(mimeType: string, name = ''): AttachmentTextCategory | null {
  if (mimeType === 'text/markdown') return 'markdown';
  if (mimeType === 'text/html') return 'html';
  if (isCsvAttachment(mimeType, name)) return 'csv';
  if (mimeType === 'text/plain') return 'plain';
  if (isCodeMimeType(mimeType) || isCodeFilename(name)) return 'code';
  return null;
}

export function attachmentIsTextPreviewable(mimeType: string, name = ''): boolean {
  return attachmentTextCategory(mimeType, name) !== null;
}

export function attachmentPreviewMode(mimeType: string, name = ''): AttachmentPreviewMode {
  if (attachmentIsTextPreviewable(mimeType, name)) return 'text';
  if (mimeType.startsWith('image/') || mimeType === 'application/pdf') return 'embed';
  return 'metadata';
}

export function attachmentUsesFormattedMessagePreview(mimeType: string, name = ''): boolean {
  return attachmentTextCategory(mimeType, name) === 'markdown';
}

export function attachmentUsesCodePreview(mimeType: string, name = ''): boolean {
  return attachmentTextCategory(mimeType, name) === 'code';
}

export function attachmentUsesHtmlPreview(mimeType: string, name = ''): boolean {
  return attachmentTextCategory(mimeType, name) === 'html';
}

export function attachmentUsesCsvPreview(mimeType: string, name = ''): boolean {
  return attachmentTextCategory(mimeType, name) === 'csv';
}

export function attachmentUsesIframePreview(mimeType: string): boolean {
  return mimeType === 'application/pdf';
}

/** HTML previews: run JS in an isolated origin; never add allow-same-origin (parent/token access). */
export { ATTACHMENT_HTML_IFRAME_SANDBOX };

/** Sandbox for untrusted HTML previews; omitted for PDFs (browser viewer). */
export function attachmentIframeSandbox(mimeType: string): string | undefined {
  return mimeType === 'text/html' ? ATTACHMENT_HTML_IFRAME_SANDBOX : undefined;
}

export function attachmentSupportsPopOut(mimeType: string, name = ''): boolean {
  const mode = attachmentPreviewMode(mimeType, name);
  return mode === 'embed' || mode === 'text';
}

export function attachmentSupportsPreviewToggle(mimeType: string, name = ''): boolean {
  const category = attachmentTextCategory(mimeType, name);
  return category === 'markdown' || category === 'code' || category === 'html' || category === 'csv';
}

export function attachmentTypeLabel(type: 'image' | 'file'): string {
  return type === 'image' ? 'Image' : 'File';
}

export function formatAttachmentSize(size?: number): string {
  if (size == null) return 'Unknown';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function decodeAttachmentTextFromData(data: string): string | null {
  try {
    const binary = atob(data);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    return null;
  }
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

/** Shareable attachment URL without auth token (for clipboard). */
export function attachmentShareUrl(att: WebChatAttachment): string | null {
  if (att.url && isSafeAttachmentUrl(att.url)) {
    return new URL(att.url, window.location.origin).href;
  }
  if (att.data) {
    return `data:${att.mimeType};base64,${att.data}`;
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

/** Markdown pop-out with the in-app renderer and preview/raw toggle. */
export async function openMarkdownAttachmentInNewTab(
  att: WebChatAttachment,
  token?: string,
): Promise<boolean> {
  const text = await fetchAttachmentText(att, token);
  if (text == null) return false;
  return openHtmlDocumentInNewTab(buildMarkdownPopoutDocument(att.name, text));
}

/** Plain-text pop-out preserves blank lines via pre-wrap HTML. */
export async function openPlainTextAttachmentInNewTab(
  att: WebChatAttachment,
  token?: string,
): Promise<boolean> {
  const text = await fetchAttachmentText(att, token);
  if (text == null) return false;
  return openHtmlDocumentInNewTab(buildPlainTextPopoutDocument(att.name, text));
}

/** Code pop-out with syntax highlighting and preview/raw toggle. */
export async function openCodeAttachmentInNewTab(
  att: WebChatAttachment,
  token?: string,
): Promise<boolean> {
  const text = await fetchAttachmentText(att, token);
  if (text == null) return false;
  const language = codeLanguageFromAttachment(att.name, att.mimeType);
  if (!language) return false;
  return openHtmlDocumentInNewTab(buildCodePopoutDocument(att.name, text, language));
}

/** HTML pop-out with sandboxed preview and raw source toggle. */
export async function openHtmlAttachmentInNewTab(
  att: WebChatAttachment,
  token?: string,
): Promise<boolean> {
  const text = await fetchAttachmentText(att, token);
  if (text == null) return false;
  return openHtmlDocumentInNewTab(buildHtmlPopoutDocument(att.name, text));
}

/** CSV pop-out with table preview and raw source toggle. */
export async function openCsvAttachmentInNewTab(
  att: WebChatAttachment,
  token?: string,
): Promise<boolean> {
  const text = await fetchAttachmentText(att, token);
  if (text == null) return false;
  return openHtmlDocumentInNewTab(buildCsvPopoutDocument(att.name, text, att.name));
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

export async function fetchAttachmentText(att: WebChatAttachment, token?: string): Promise<string | null> {
  if (att.data) {
    return decodeAttachmentTextFromData(att.data);
  }
  if (att.url && isSafeAttachmentUrl(att.url)) {
    const authToken = token ?? getStoredToken();
    const url = attachmentUrlWithAuth(att.url, authToken);
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      return res.text();
    } catch {
      return null;
    }
  }
  return null;
}

export async function fetchAttachmentBlob(att: WebChatAttachment, token?: string): Promise<Blob | null> {
  const fromData = attachmentToBlob(att);
  if (fromData) return fromData;
  if (att.url && isSafeAttachmentUrl(att.url)) {
    const authToken = token ?? getStoredToken();
    const url = attachmentUrlWithAuth(att.url, authToken);
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      return res.blob();
    } catch {
      return null;
    }
  }
  return null;
}

export async function downloadAttachment(att: WebChatAttachment, token?: string): Promise<boolean> {
  const blob = await fetchAttachmentBlob(att, token);
  if (!blob) return false;
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = att.name;
  anchor.rel = 'noopener noreferrer';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
  return true;
}

export async function copyAttachmentLink(att: WebChatAttachment, _token?: string): Promise<boolean> {
  const url = attachmentShareUrl(att);
  if (!url) return false;
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    return false;
  }
}

export async function copyAttachmentContent(att: WebChatAttachment, token?: string): Promise<boolean> {
  const text = await fetchAttachmentText(att, token);
  if (text == null) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export async function copyAttachmentForPreview(
  att: WebChatAttachment,
  onSuccess: () => void,
  token?: string,
): Promise<void> {
  const mode = attachmentPreviewMode(att.mimeType, att.name);
  if (mode === 'text') {
    if (await copyAttachmentContent(att, token)) onSuccess();
    return;
  }
  if (await copyAttachmentLink(att, token)) onSuccess();
}
