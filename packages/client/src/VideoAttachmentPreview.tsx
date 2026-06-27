import { useState } from 'react';
import {
  audioMimeTypePlayable,
  handleAudioPreviewError,
  handleVideoPreviewError,
  imageMimeTypeDisplayable,
  videoMimeTypePlayable,
} from './attachments';
import { FileAttachmentChip } from './FileAttachmentChip';
import type { WebChatAttachment } from './types';

export function MessageVideoAttachment({
  att,
  previewUrl,
  onOpenAttachment,
}: {
  att: WebChatAttachment;
  previewUrl: string;
  onOpenAttachment: (att: WebChatAttachment) => void;
}) {
  const [failed, setFailed] = useState(false);
  const useFallback = failed || !videoMimeTypePlayable(att.mimeType);

  if (useFallback) {
    return (
      <FileAttachmentChip att={att} onOpen={onOpenAttachment} className="msg-attachment-file" />
    );
  }

  return (
    <button
      type="button"
      className="msg-attachment-video"
      aria-label={`View ${att.name}`}
      onClick={() => onOpenAttachment(att)}
    >
      <video
        src={previewUrl}
        preload="none"
        muted
        playsInline
        aria-hidden
        onError={(event) => handleVideoPreviewError(event, () => setFailed(true))}
      />
    </button>
  );
}

export function MessageAudioAttachment({
  att,
  previewUrl,
  onOpenAttachment,
}: {
  att: WebChatAttachment;
  previewUrl: string;
  onOpenAttachment: (att: WebChatAttachment) => void;
}) {
  const [failed, setFailed] = useState(false);
  const useFallback = failed || !audioMimeTypePlayable(att.mimeType);

  if (useFallback) {
    return (
      <FileAttachmentChip att={att} onOpen={onOpenAttachment} className="msg-attachment-file" />
    );
  }

  return (
    <div className="msg-attachment-audio">
      <button
        type="button"
        className="msg-attachment-audio-title"
        aria-label={`View ${att.name}`}
        onClick={() => onOpenAttachment(att)}
      >
        {att.name}
      </button>
      <audio
        controls
        preload="metadata"
        src={previewUrl}
        aria-label={att.name}
        onError={(event) => handleAudioPreviewError(event, () => setFailed(true))}
      />
    </div>
  );
}

export function MessageImageAttachment({
  att,
  previewUrl,
  onOpenAttachment,
}: {
  att: WebChatAttachment;
  previewUrl: string;
  onOpenAttachment: (att: WebChatAttachment) => void;
}) {
  const [failed, setFailed] = useState(false);
  const useFallback = failed || !imageMimeTypeDisplayable(att.mimeType);

  if (useFallback) {
    return (
      <FileAttachmentChip
        att={att}
        onOpen={onOpenAttachment}
        className="msg-attachment-file"
        ariaLabel={`View ${att.name}`}
      />
    );
  }

  return (
    <button
      type="button"
      className="msg-attachment-image"
      aria-label={`View ${att.name}`}
      onClick={() => onOpenAttachment(att)}
    >
      <img
        src={previewUrl}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
      />
    </button>
  );
}

export function ComposerImagePreview({
  previewUrl,
  mimeType,
  name,
}: {
  previewUrl: string;
  mimeType: string;
  name: string;
}) {
  const [failed, setFailed] = useState(false);
  const useFallback = failed || !imageMimeTypeDisplayable(mimeType);

  if (useFallback) {
    return (
      <span className="composer-preview-name" title={name}>
        {name}
      </span>
    );
  }

  return (
    <img
      src={previewUrl}
      alt={name}
      onError={() => setFailed(true)}
    />
  );
}

export function composerImagePreviewUsesFileChip(mimeType: string): boolean {
  return !imageMimeTypeDisplayable(mimeType);
}

export function ComposerVideoPreview({
  previewUrl,
  mimeType,
  name,
}: {
  previewUrl: string;
  mimeType: string;
  name: string;
}) {
  const [failed, setFailed] = useState(false);
  const useFallback = failed || !videoMimeTypePlayable(mimeType);

  if (useFallback) {
    return (
      <span className="composer-preview-name" title={name}>
        {name}
      </span>
    );
  }

  return (
    <video
      src={previewUrl}
      preload="metadata"
      muted
      playsInline
      aria-label={name}
      onError={(event) => handleVideoPreviewError(event, () => setFailed(true))}
    />
  );
}

export function ComposerAudioPreview({
  previewUrl,
  mimeType,
  name,
}: {
  previewUrl: string;
  mimeType: string;
  name: string;
}) {
  const [failed, setFailed] = useState(false);
  const useFallback = failed || !audioMimeTypePlayable(mimeType);

  if (useFallback) {
    return (
      <span className="composer-preview-name" title={name}>
        {name}
      </span>
    );
  }

  return (
    <audio
      src={previewUrl}
      controls
      preload="metadata"
      aria-label={name}
      onError={(event) => handleAudioPreviewError(event, () => setFailed(true))}
    />
  );
}

export function composerVideoPreviewUsesFileChip(mimeType: string): boolean {
  return !videoMimeTypePlayable(mimeType);
}

export function composerAudioPreviewUsesFileChip(mimeType: string): boolean {
  return !audioMimeTypePlayable(mimeType);
}
