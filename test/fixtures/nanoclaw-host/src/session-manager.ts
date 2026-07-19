export function sessionDir(_agentFolder: string, _sessionId: string): string {
  return '/tmp/nanoclaw-fixture-session';
}

export function readOutboxFiles(
  _agentGroupId: string,
  _sessionId: string,
  _messageId: string,
  _files: string[],
): unknown[] {
  return [];
}
