const SENDER_HUES = [45, 28, 135, 200, 280, 330];

export function senderColor(name: string): string {
  if (name === 'You') return 'var(--sender-you)';
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash + name.charCodeAt(i) * (i + 1)) % SENDER_HUES.length;
  }
  return `hsl(${SENDER_HUES[hash]} 65% 58%)`;
}
