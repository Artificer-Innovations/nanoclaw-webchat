import type { MessagePart } from './message-content';
import { parseMessageContent } from './message-content';

function renderParts(parts: MessagePart[]) {
  return parts.map((part, index) => {
    if (part.type === 'text') {
      return <span key={index}>{part.value}</span>;
    }
    if (part.type === 'code') {
      return (
        <code key={index} className="inline-code">
          {part.value}
        </code>
      );
    }
    return (
      <pre key={index} className="code-block">
        <code>{part.value}</code>
      </pre>
    );
  });
}

export function FormattedMessage({ text, className }: { text: string; className?: string }) {
  const parts = parseMessageContent(text);
  return <span className={className ?? 'formatted-message'}>{renderParts(parts)}</span>;
}
