/**
 * @handle pattern shared with message-sender.ts for lobby agent resolution.
 * Agent folders are short alphanumeric names (e.g. sarah, team); @here is styled separately.
 */
export const MENTION_HANDLE_PATTERN = /@(\w+)/g;

export function textHasMention(text: string): boolean {
  return /@\w+/.test(text);
}
