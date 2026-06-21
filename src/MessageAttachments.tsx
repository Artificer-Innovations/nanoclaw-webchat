import { attachmentDataUrl, normalizeAttachment } from './attachments';
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
        const dataUrl = attachmentDataUrl(att);
        if (!dataUrl) return null;
        const key = `${index}-${att.name}-${att.size ?? 0}`;

        if (att.type === 'image') {
          return (
            <button
              key={key}
              type="button"
              className="msg-attachment-image"
              aria-label={`View ${att.name}`}
              onClick={() => onOpenAttachment(att)}
            >
              <img src={dataUrl} alt="" loading="lazy" />
            </button>
          );
        }

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
