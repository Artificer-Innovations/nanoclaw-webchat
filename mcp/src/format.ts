import type { WebChatAttachment, WebChatMessage } from './types.js';

export function formatAttachmentSummary(att: WebChatAttachment): string {
  const size = att.size != null ? `, ${att.size} bytes` : '';
  const location = att.url ? `, url: ${att.url}` : '';
  return `[${att.type}: ${att.name} (${att.mimeType}${size}${location})]`;
}

export function formatMessage(msg: WebChatMessage): string {
  const ts = new Date(msg.timestamp).toISOString();
  const sender =
    msg.direction === 'inbound'
      ? 'You'
      : msg.senderName?.trim() || 'Agent';
  const attachmentLine =
    msg.attachments && msg.attachments.length > 0
      ? `\n  Attachments: ${msg.attachments.map(formatAttachmentSummary).join(', ')}`
      : '';
  const text = msg.text.trim() || '(no text)';
  return `[${ts}] ${sender} (${msg.direction}): ${text}${attachmentLine}`;
}

export function formatMessages(messages: WebChatMessage[], limit: number): string {
  if (messages.length === 0) {
    return 'No messages.';
  }
  const slice = messages.slice(-limit);
  return slice.map(formatMessage).join('\n\n');
}

export function formatEngagedAgents(agents: string[]): string {
  if (agents.length === 0) return '';
  return `\n\nEngaged agents: ${agents.join(', ')}`;
}
