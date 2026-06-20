import { attachmentDataUrl } from './attachments';
import type { WebChatAttachment } from './types';

export function MessageAttachments({ attachments }: { attachments: WebChatAttachment[] }) {
  if (attachments.length === 0) return null;

  return (
    <div className="msg-attachments">
      {attachments.map((att) => {
        const dataUrl = attachmentDataUrl(att);
        if (!dataUrl) return null;
        const key = `${att.name}-${att.size ?? 0}`;

        if (att.type === 'image' || att.mimeType.startsWith('image/')) {
          return (
            <a
              key={key}
              className="msg-attachment msg-attachment-image"
              href={dataUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <img src={dataUrl} alt={att.name} loading="lazy" />
            </a>
          );
        }

        return (
          <a
            key={key}
            className="msg-attachment-file"
            href={dataUrl}
            download={att.name}
          >
            {att.name}
          </a>
        );
      })}
    </div>
  );
}
