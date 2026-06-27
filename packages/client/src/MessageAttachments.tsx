import {
  attachmentIsAudio,
  attachmentIsVideo,
  attachmentPreviewUrl,
  normalizeAttachment,
} from './attachments';
import { FileAttachmentChip } from './FileAttachmentChip';
import type { WebChatAttachment } from './types';
import {
  MessageAudioAttachment,
  MessageImageAttachment,
  MessageVideoAttachment,
} from './VideoAttachmentPreview';

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
            <MessageImageAttachment
              key={key}
              att={att}
              previewUrl={previewUrl}
              onOpenAttachment={onOpenAttachment}
            />
          );
        }

        if (attachmentIsVideo(att.mimeType)) {
          if (!previewUrl) return null;
          return (
            <MessageVideoAttachment
              key={key}
              att={att}
              previewUrl={previewUrl}
              onOpenAttachment={onOpenAttachment}
            />
          );
        }

        if (attachmentIsAudio(att.mimeType)) {
          if (!previewUrl) return null;
          return (
            <MessageAudioAttachment
              key={key}
              att={att}
              previewUrl={previewUrl}
              onOpenAttachment={onOpenAttachment}
            />
          );
        }

        if (!previewUrl && !att.url && !att.data) return null;

        return (
          <FileAttachmentChip
            key={key}
            att={att}
            onOpen={onOpenAttachment}
            className="msg-attachment-file"
          />
        );
      })}
    </div>
  );
}
