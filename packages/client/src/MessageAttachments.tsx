import { attachmentIsAudio, attachmentIsVideo, attachmentPreviewUrl, normalizeAttachment } from './attachments';
import type { WebChatAttachment } from './types';

export function MessageAttachments({
  attachments,
  onOpenAttachment,
}: {
  attachments: WebChatAttachment[];
  onOpenAttachment: (att: WebChatAttachment) => void;
}) {
  if (attachments.length === 0) return null;

  return (
    <div className="msg-attachments">
      {attachments.map((raw, index) => {
        const att = normalizeAttachment(raw);
        const previewUrl = attachmentPreviewUrl(att);
        const key = `${index}-${att.name}-${att.size ?? 0}`;

        if (att.type === 'image') {
          if (!previewUrl) return null;
          return (
            <button
              key={key}
              type="button"
              className="msg-attachment-image"
              aria-label={`View ${att.name}`}
              onClick={() => onOpenAttachment(att)}
            >
              <img src={previewUrl} alt="" loading="lazy" />
            </button>
          );
        }

        if (attachmentIsVideo(att.mimeType)) {
          if (!previewUrl) return null;
          return (
            <button
              key={key}
              type="button"
              className="msg-attachment-video"
              aria-label={`View ${att.name}`}
              onClick={() => onOpenAttachment(att)}
            >
              <video src={previewUrl} preload="metadata" muted playsInline aria-hidden />
            </button>
          );
        }

        if (attachmentIsAudio(att.mimeType)) {
          if (!previewUrl) return null;
          return (
            <div key={key} className="msg-attachment-audio">
              <button
                type="button"
                className="msg-attachment-audio-title"
                aria-label={`View ${att.name}`}
                onClick={() => onOpenAttachment(att)}
              >
                {att.name}
              </button>
              <audio controls preload="metadata" src={previewUrl} aria-label={att.name} />
            </div>
          );
        }

        if (!previewUrl && !att.url && !att.data) return null;

        return (
          <button
            key={key}
            type="button"
            className="msg-attachment-file"
            onClick={() => onOpenAttachment(att)}
          >
            {att.name}
          </button>
        );
      })}
    </div>
  );
}
