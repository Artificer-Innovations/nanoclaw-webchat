const DEFAULT_THREAD_TITLE = /^Thread \d+$/;

export function isAutoThreadTitle(title: string): boolean {
  return DEFAULT_THREAD_TITLE.test(title);
}

export function titleFromMessage(text: string, maxLength = 48): string {
  const line = text.trim().split(/\r?\n/, 1)[0].trim();
  const collapsed = line.replace(/\s+/g, ' ');
  if (!collapsed) return 'New thread';
  if (collapsed.length <= maxLength) return collapsed;
  return `${collapsed.slice(0, maxLength - 1)}…`;
}

export function defaultThreadTitle(childCount: number): string {
  return `Thread ${childCount + 1}`;
}
