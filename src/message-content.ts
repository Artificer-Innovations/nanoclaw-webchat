export type MessagePart =
  | { type: 'text'; value: string }
  | { type: 'code'; value: string }
  | { type: 'code-block'; value: string };

const FENCED_CODE = /```(?:\r?\n)?([\s\S]*?)```/g;
const INLINE_CODE = /`([^`\n]+)`/g;

function parseInlineCode(text: string): MessagePart[] {
  const parts: MessagePart[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const pattern = new RegExp(INLINE_CODE.source, INLINE_CODE.flags);

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    parts.push({ type: 'code', value: match[1]! });
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push({ type: 'text', value: text.slice(lastIndex) });
  }

  return parts;
}

function appendInlineParts(parts: MessagePart[], text: string): void {
  if (!text) return;
  parts.push(...parseInlineCode(text));
}

export function parseMessageContent(text: string): MessagePart[] {
  if (!text) return [{ type: 'text', value: '' }];

  const parts: MessagePart[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const pattern = new RegExp(FENCED_CODE.source, FENCED_CODE.flags);

  while ((match = pattern.exec(text)) !== null) {
    appendInlineParts(parts, text.slice(lastIndex, match.index));
    parts.push({ type: 'code-block', value: match[1].replace(/^\r?\n/, '').replace(/\r?\n$/, '') });
    lastIndex = pattern.lastIndex;
  }

  appendInlineParts(parts, text.slice(lastIndex));
  return parts;
}
