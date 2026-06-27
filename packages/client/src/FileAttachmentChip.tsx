import { attachmentChipKind, attachmentChipLabel } from './attachments';
import type { WebChatAttachment } from './types';

export function FileAttachmentChip({
  att,
  onOpen,
  className = 'msg-attachment-file',
  ariaLabel,
}: {
  att: WebChatAttachment;
  onOpen: (att: WebChatAttachment) => void;
  className?: string;
  ariaLabel?: string;
}) {
  const kind = attachmentChipKind(att.mimeType, att.name);
  const kindLabel = attachmentChipLabel(kind);
  return (
    <button
      type="button"
      className={className}
      aria-label={ariaLabel ?? att.name}
      onClick={() => onOpen(att)}
    >
      <span className="attachment-chip-kind">{kindLabel}</span>
      <span className="attachment-chip-name" title={att.name}>{att.name}</span>
    </button>
  );
}
