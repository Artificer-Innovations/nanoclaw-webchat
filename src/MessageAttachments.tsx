import { attachmentDataUrl, normalizeAttachment } from './attachments';
import type { WebChatAttachment } from './types';

export function MessageAttachments({ attachments }: { attachments: WebChatAttachment[] }) {
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
            <div key={key} className="msg-attachment-image">
              <img src={dataUrl} alt={att.name} loading="lazy" />
            </div>
          );
        }

        return (
          <a
            key={key}
            className="msg-attachment-file"
            href={dataUrl}
            download={att.name}
            target="_blank"
            rel="noopener noreferrer"
          >
            {att.name}
          </a>
        );
      })}
    </div>
  );
}
