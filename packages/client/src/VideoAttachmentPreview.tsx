import { useState } from 'react';
import {
  handleVideoPreviewError,
  videoMimeTypePlayable,
} from './attachments';
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
      <button
        type="button"
        className="msg-attachment-file"
        onClick={() => onOpenAttachment(att)}
      >
        {att.name}
      </button>
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

export function composerVideoPreviewUsesFileChip(mimeType: string): boolean {
  return !videoMimeTypePlayable(mimeType);
}
