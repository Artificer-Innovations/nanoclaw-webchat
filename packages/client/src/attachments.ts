import { buildAudioPopoutDocument, buildCodePopoutDocument, buildCsvPopoutDocument, buildHtmlPopoutDocument, buildMarkdownPopoutDocument, buildPlainTextPopoutDocument, buildVideoPopoutDocument, openHtmlDocumentInNewTab, ATTACHMENT_HTML_IFRAME_SANDBOX, ATTACHMENT_SVG_IFRAME_SANDBOX } from './attachment-text-popout';
import { codeLanguageFromAttachment, isCodeFilename, isCodeMimeType } from './attachment-code';
import { isCsvAttachment } from './csv-preview';
import { getStoredToken, uploadAttachmentMultipart } from './api';
import type { WebChatAttachment } from './types';

export const MAX_ATTACHMENTS = 10;
export const MAX_ATTACHMENT_BYTES = 1024 * 1024 * 1024;
/** Text attachments larger than this skip in-drawer preview (download instead). */
export const ATTACHMENT_TEXT_PREVIEW_MAX_BYTES = 2 * 1024 * 1024;
/** Client uses streaming multipart for all sizes up to MAX; chunked API remains for resumability. */
export const CHUNK_SIZE = 512 * 1024;
export const COMPOSER_TEXT_SNIPPET_MAX = 200;
/** Bytes read from text files when extracting a composer snippet (first line only). */
export const COMPOSER_TEXT_SNIPPET_READ_BYTES = 4096;

export function formatUploadBytesLabel(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024 / 1024).toFixed(0)} GB`;
  }
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}

export function formatMaxUploadLabel(): string {
  return formatUploadBytesLabel(MAX_ATTACHMENT_BYTES);
}

export interface UploadedAttachment {
  uploadId: string;
  name: string;
  mimeType: string;
  type: 'image' | 'file';
  size: number;
}

const EXT_TO_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.ogv': 'video/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
  '.m4a': 'audio/mp4',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.json': 'application/json',
  '.zip': 'application/zip',
  '.7z': 'application/x-7z-compressed',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
  '.tgz': 'application/gzip',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.doc': 'application/msword',
  '.xls': 'application/vnd.ms-excel',
  '.ppt': 'application/vnd.ms-powerpoint',
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
  '.bat': 'text/x-cmd',
  '.cmd': 'text/x-cmd',
  '.coffee': 'text/javascript',
  '.d': 'text/x-d',
  '.elm': 'text/x-elm',
  '.nix': 'text/x-nix',
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
  '.wgsl': 'text/x-wgsl',
  '.hlsl': 'text/x-hlsl',
  '.env': 'text/plain',
  '.applescript': 'text/x-applescript',
  '.rst': 'text/plain',
  '.hcl': 'text/x-hcl',
  '.tf': 'text/x-hcl',
  '.tfvars': 'text/x-hcl',
};

export interface PendingAttachment extends WebChatAttachment {
  file: File;
  previewUrl: string;
  /** First non-empty line for composer mini-preview (text attachments only). */
  textSnippet?: string;
}

export type AttachmentRejectReason = 'too_large' | 'read_failed' | 'capacity' | 'upload_failed';

export interface AttachmentRejection {
  name: string;
  reason: AttachmentRejectReason;
  detail?: string;
}

export interface ReadAttachmentFilesResult {
  attachments: PendingAttachment[];
  rejected: AttachmentRejection[];
}

export function inferMimeType(name: string, mimeType = ''): string {
  const trimmed = mimeType.trim().split(';', 1)[0].trim().toLowerCase();
  const ext = name.includes('.') ? `.${name.split('.').pop()!.toLowerCase()}` : '';
  const fromExt = EXT_TO_MIME[ext];
  if (!trimmed || trimmed === 'application/octet-stream') {
    return fromExt ?? (trimmed || 'application/octet-stream');
  }
  if (fromExt?.startsWith('audio/') && !trimmed.startsWith('audio/')) {
    return fromExt;
  }
  if (fromExt?.startsWith('video/') && !trimmed.startsWith('video/')) {
    return fromExt;
  }
  if (fromExt?.startsWith('image/') && !trimmed.startsWith('image/')) {
    return fromExt;
  }
  return trimmed;
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
  if (mimeType === 'image/svg+xml') return null;
  if (isCodeMimeType(mimeType) || isCodeFilename(name)) return 'code';
  if (mimeType === 'text/plain') return 'plain';
  return null;
}

export function attachmentIsTextPreviewable(mimeType: string, name = ''): boolean {
  return attachmentTextCategory(mimeType, name) !== null;
}

export function attachmentIsVideo(mimeType: string): boolean {
  return mimeType.startsWith('video/');
}

const MEDIA_ERR_SRC_NOT_SUPPORTED = 4;

/** True when the browser reports it can play the container MIME (SSR: defer to onError). */
export function videoMimeTypePlayable(mimeType: string): boolean {
  if (typeof document === 'undefined') return true;
  return document.createElement('video').canPlayType(mimeType) !== '';
}

export function isVideoSrcNotSupportedError(error: MediaError | null | undefined): boolean {
  return (error?.code ?? 0) === MEDIA_ERR_SRC_NOT_SUPPORTED;
}

export function handleVideoPreviewError(
  event: { currentTarget: HTMLVideoElement },
  onUnsupported: () => void,
): void {
  if (isVideoSrcNotSupportedError(event.currentTarget.error)) {
    onUnsupported();
  }
}

/** True when the browser reports it can play the audio MIME (SSR: defer to onError). */
export function audioMimeTypePlayable(mimeType: string): boolean {
  if (typeof document === 'undefined') return true;
  return document.createElement('audio').canPlayType(mimeType) !== '';
}

export function handleAudioPreviewError(
  event: { currentTarget: HTMLAudioElement },
  onUnsupported: () => void,
): void {
  if (isVideoSrcNotSupportedError(event.currentTarget.error)) {
    onUnsupported();
  }
}

export function attachmentIsAudio(mimeType: string): boolean {
  return mimeType.startsWith('audio/');
}

export function attachmentIsSvg(mimeType: string): boolean {
  return mimeType === 'image/svg+xml';
}

const HEIC_IMAGE_MIMES = new Set(['image/heic', 'image/heif']);

export function attachmentIsHeic(mimeType: string): boolean {
  const normalized = mimeType.toLowerCase().split(';', 1)[0].trim();
  return HEIC_IMAGE_MIMES.has(normalized);
}

/** WebKit on Apple platforms can render HEIC/HEIF in img; Chromium on desktop/Android generally cannot. */
export function isHeicDisplaySupportedInBrowser(): boolean {
  if (typeof navigator === 'undefined') return true;
  const ua = navigator.userAgent;
  if (!/AppleWebKit/i.test(ua) || /Android/i.test(ua)) return false;
  // All iOS browsers use WebKit (Safari, Chrome CriOS, Firefox FxiOS, etc.).
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  // Desktop Safari (not Chromium-based shells that also embed WebKit on macOS).
  return /Safari/i.test(ua) && !/Chrome|Chromium|Edg|OPR|Firefox/i.test(ua);
}

/** SSR: defer to onError when HEIC support is unknown. */
export function imageMimeTypeDisplayable(mimeType: string): boolean {
  if (!attachmentIsHeic(mimeType)) return true;
  if (typeof document === 'undefined') return true;
  return isHeicDisplaySupportedInBrowser();
}

export function attachmentIsArchive(mimeType: string, name = ''): boolean {
  if (
    mimeType === 'application/zip' ||
    mimeType === 'application/x-7z-compressed' ||
    mimeType === 'application/x-tar' ||
    mimeType === 'application/gzip'
  ) {
    return true;
  }
  const ext = name.includes('.') ? `.${name.split('.').pop()!.toLowerCase()}` : '';
  return ext === '.zip' || ext === '.7z' || ext === '.tar' || ext === '.gz' || ext === '.tgz';
}

export function attachmentIsMdx(name: string): boolean {
  const ext = name.includes('.') ? `.${name.split('.').pop()!.toLowerCase()}` : '';
  return ext === '.mdx';
}

export type AttachmentChipKind =
  | 'pdf'
  | 'markdown'
  | 'html'
  | 'csv'
  | 'code'
  | 'json'
  | 'archive'
  | 'plain'
  | 'image'
  | 'file';

export function attachmentChipKind(mimeType: string, name = ''): AttachmentChipKind {
  const resolved = inferMimeType(name, mimeType);
  if (resolved === 'application/pdf') return 'pdf';
  const category = attachmentTextCategory(resolved, name);
  if (category === 'markdown') return 'markdown';
  if (category === 'html') return 'html';
  if (category === 'csv') return 'csv';
  if (category === 'code') {
    if (resolved === 'application/json' || name.toLowerCase().endsWith('.json')) return 'json';
    return 'code';
  }
  if (category === 'plain') return 'plain';
  if (attachmentIsArchive(resolved, name)) return 'archive';
  if (resolved.startsWith('image/')) return 'image';
  return 'file';
}

const CHIP_KIND_LABELS: Record<AttachmentChipKind, string> = {
  pdf: 'PDF',
  markdown: 'Markdown',
  html: 'HTML',
  csv: 'CSV',
  code: 'Code',
  json: 'JSON',
  archive: 'Archive',
  plain: 'Text',
  image: 'Image',
  file: 'File',
};

export function attachmentChipLabel(kind: AttachmentChipKind): string {
  return CHIP_KIND_LABELS[kind];
}

export function attachmentTextTooLargeForPreview(size?: number): boolean {
  return size != null && size > ATTACHMENT_TEXT_PREVIEW_MAX_BYTES;
}

export function attachmentFriendlyTypeLabel(mimeType: string, name = ''): string {
  const resolved = inferMimeType(name, mimeType);
  if (resolved.startsWith('image/')) return 'Image';
  if (attachmentIsVideo(resolved)) return 'Video';
  if (attachmentIsAudio(resolved)) return 'Audio';
  if (resolved === 'application/pdf') return 'PDF document';
  if (attachmentIsArchive(resolved, name)) {
    if (resolved === 'application/x-7z-compressed') return '7-Zip archive';
    if (resolved === 'application/x-tar') return 'Tar archive';
    if (resolved === 'application/gzip') return 'Gzip archive';
    return 'ZIP archive';
  }
  if (resolved.includes('wordprocessingml') || resolved === 'application/msword') return 'Word document';
  if (resolved.includes('spreadsheetml') || resolved === 'application/vnd.ms-excel') {
    return 'Excel spreadsheet';
  }
  if (resolved.includes('presentationml') || resolved === 'application/vnd.ms-powerpoint') {
    return 'PowerPoint presentation';
  }
  return 'File';
}

export function attachmentPreviewMode(mimeType: string, name = ''): AttachmentPreviewMode {
  const resolved = inferMimeType(name, mimeType);
  if (attachmentIsTextPreviewable(resolved, name)) return 'text';
  if (
    resolved.startsWith('image/') ||
    attachmentIsVideo(resolved) ||
    attachmentIsAudio(resolved) ||
    resolved === 'application/pdf'
  ) {
    return 'embed';
  }
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

export function attachmentUsesVideoPreview(mimeType: string): boolean {
  return attachmentIsVideo(mimeType);
}

export function attachmentUsesAudioPreview(mimeType: string): boolean {
  return attachmentIsAudio(mimeType);
}

export function attachmentUsesSvgPreview(mimeType: string): boolean {
  return attachmentIsSvg(mimeType);
}

/** HTML previews: run JS in an isolated origin; never add allow-same-origin (parent/token access). */
export { ATTACHMENT_HTML_IFRAME_SANDBOX, ATTACHMENT_SVG_IFRAME_SANDBOX };

/** Sandbox for untrusted HTML previews; omitted for PDFs (browser viewer). */
export function attachmentIframeSandbox(mimeType: string): string | undefined {
  return mimeType === 'text/html' ? ATTACHMENT_HTML_IFRAME_SANDBOX : undefined;
}

export function attachmentSupportsPopOut(mimeType: string, name = '', url?: string): boolean {
  const mode = attachmentPreviewMode(mimeType, name);
  if (mode === 'embed' || mode === 'text') return true;
  if (mode === 'metadata' && url && isSafeAttachmentUrl(url)) return true;
  return false;
}

export function attachmentSupportsPreviewToggle(mimeType: string, name = ''): boolean {
  const category = attachmentTextCategory(mimeType, name);
  return category === 'markdown' || category === 'code' || category === 'html' || category === 'csv';
}

export function attachmentTypeLabel(type: 'image' | 'file', mimeType = ''): string {
  if (type === 'image') return 'Image';
  if (attachmentIsVideo(mimeType)) return 'Video';
  if (attachmentIsAudio(mimeType)) return 'Audio';
  return 'File';
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

/** Align `type` and `mimeType` with filename hints when server/browser payloads disagree. */
export function normalizeAttachment(att: WebChatAttachment): WebChatAttachment {
  const mimeType = inferMimeType(att.name, att.mimeType);
  const type = attachmentTypeFromMime(mimeType);
  if (att.type === type && att.mimeType === mimeType) return att;
  return { ...att, mimeType, type };
}

export function formatAttachmentRejections(rejected: AttachmentRejection[]): string | null {
  if (rejected.length === 0) return null;
  const parts = rejected.map(({ name, reason, detail }) => {
    switch (reason) {
      case 'too_large':
        return `${name} exceeds the ${formatMaxUploadLabel()} limit`;
      case 'read_failed':
        return `Could not read ${name}`;
      case 'upload_failed':
        return detail ? `${name}: ${detail}` : `Upload failed for ${name}`;
      case 'capacity':
        return `Only ${MAX_ATTACHMENTS} attachments allowed (${name} skipped)`;
    }
  });
  return parts.join('; ');
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

  const attachments = await Promise.all(
    selected.map(async (file) => {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        return { ok: false as const, name: file.name, reason: 'too_large' as const };
      }
      const mimeType = inferMimeType(file.name, file.type);
      const textSnippet = await readComposerTextSnippet(file, mimeType);
      return {
        ok: true as const,
        attachment: {
          file,
          name: file.name,
          mimeType,
          type: attachmentTypeFromMime(mimeType),
          size: file.size,
          previewUrl: URL.createObjectURL(file),
          textSnippet,
        },
      };
    }),
  );

  const pending: PendingAttachment[] = [];
  for (const result of attachments) {
    if (result.ok) {
      pending.push(result.attachment);
    } else {
      rejected.push({ name: result.name, reason: result.reason });
    }
  }

  return { attachments: pending, rejected };
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
    const mimeType = inferMimeType(att.name, att.mimeType);
    return `data:${mimeType};base64,${att.data}`;
  }
  if (att.url && isSafeAttachmentUrl(att.url)) {
    const authToken = token ?? getStoredToken();
    return attachmentUrlWithAuth(att.url, authToken);
  }
  return null;
}

/** Absolute embed URL for media elements (popouts need same-origin absolute paths). */
export function attachmentEmbedUrl(att: WebChatAttachment, token?: string): string | null {
  const url = attachmentDataUrl(att, token);
  if (!url) return null;
  if (url.startsWith('/') && typeof window !== 'undefined') {
    return new URL(url, window.location.origin).href;
  }
  return url;
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

/** Video pop-out with native controls in a styled viewer page. */
export function openVideoAttachmentInNewTab(att: WebChatAttachment, token?: string): boolean {
  const videoSrc = attachmentEmbedUrl(att, token);
  if (!videoSrc) return false;
  return openHtmlDocumentInNewTab(buildVideoPopoutDocument(att.name, videoSrc, att.mimeType));
}

/** Audio pop-out with native controls in a styled viewer page. */
export function openAudioAttachmentInNewTab(att: WebChatAttachment, token?: string): boolean {
  const audioSrc = attachmentEmbedUrl(att, token);
  if (!audioSrc) return false;
  return openHtmlDocumentInNewTab(buildAudioPopoutDocument(att.name, audioSrc));
}

/** Markdown pop-out with the in-app renderer and preview/raw toggle. */
export async function openMarkdownAttachmentInNewTab(
  att: WebChatAttachment,
  token?: string,
): Promise<boolean> {
  const text = await fetchAttachmentText(att, token);
  if (text == null) return false;
  return openHtmlDocumentInNewTab(await buildMarkdownPopoutDocument(att.name, text));
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
  const fromServer = attachmentDataUrl(att);
  if (fromServer) return fromServer;
  if ('previewUrl' in att && att.previewUrl) return att.previewUrl;
  return null;
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

export function toSendAttachmentsFromUploads(uploads: UploadedAttachment[]): WebChatAttachment[] {
  return uploads.map(({ uploadId, name, mimeType, type, size }) => ({
    uploadId,
    name,
    mimeType,
    type,
    size,
  }));
}

export async function uploadAttachmentFile(
  token: string,
  platformId: string,
  threadId: string,
  file: File,
): Promise<UploadedAttachment> {
  return uploadAttachmentMultipart(token, platformId, threadId, file);
}

export async function uploadPendingAttachments(
  token: string,
  platformId: string,
  threadId: string,
  pending: PendingAttachment[],
): Promise<{ uploads: UploadedAttachment[]; failed: AttachmentRejection[] }> {
  const results = await Promise.allSettled(
    pending.map((att) => uploadAttachmentFile(token, platformId, threadId, att.file)),
  );

  const uploads: UploadedAttachment[] = [];
  const failed: AttachmentRejection[] = [];
  results.forEach((result, index) => {
    const name = pending[index]?.name ?? 'attachment';
    if (result.status === 'fulfilled') {
      uploads.push(result.value);
    } else {
      const detail =
        result.reason instanceof Error ? result.reason.message : 'Upload failed';
      failed.push({ name, reason: 'upload_failed', detail });
    }
  });

  return { uploads, failed };
}

export function optimisticAttachmentsFromPending(pending: PendingAttachment[]): WebChatAttachment[] {
  return pending.map(({ name, mimeType, type, size, previewUrl, textSnippet }) => ({
    name,
    mimeType,
    type,
    size,
    previewUrl,
    textSnippet,
  }));
}

async function readComposerTextSnippet(file: File, mimeType: string): Promise<string | undefined> {
  if (!attachmentIsTextPreviewable(mimeType, file.name)) return undefined;
  if (attachmentTextTooLargeForPreview(file.size)) return undefined;
  try {
    const text = await file.slice(0, COMPOSER_TEXT_SNIPPET_READ_BYTES).text();
    const line = text.split(/\r?\n/).find((entry) => entry.trim().length > 0) ?? '';
    if (!line) return undefined;
    return line.length > COMPOSER_TEXT_SNIPPET_MAX
      ? `${line.slice(0, COMPOSER_TEXT_SNIPPET_MAX)}…`
      : line;
  } catch {
    return undefined;
  }
}

async function fetchAttachmentAuthorized(url: string, token?: string): Promise<Response> {
  if (token) return fetch(attachmentUrlWithAuth(url, token));
  return fetch(url, { credentials: 'include' });
}

export async function fetchAttachmentText(att: WebChatAttachment, token?: string): Promise<string | null> {
  if (att.data) {
    return decodeAttachmentTextFromData(att.data);
  }
  if (att.url && isSafeAttachmentUrl(att.url)) {
    const authToken = token ?? getStoredToken();
    try {
      const res = await fetchAttachmentAuthorized(att.url, authToken || undefined);
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
    try {
      const res = await fetchAttachmentAuthorized(att.url, authToken || undefined);
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
