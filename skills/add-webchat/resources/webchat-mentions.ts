/**
 * Parse @folder agent mentions and implicit name references from lobby message text.
 * Semantics mirror nanoclaw-webchat/src/message-sender.ts for explicit mentions.
 */
export const MENTION_HANDLE_PATTERN = /@(\w+)/g;

export interface MentionParseOptions {
  agentFolders: readonly string[];
  /** When set, @team maps to this agent folder (WEBCHAT_TEAM_FOLDER). */
  teamFolder?: string | null;
}

export interface ImplicitMentionAgent {
  folder: string;
  displayName: string;
}

export function mentionedAgentFolders(text: string, opts: MentionParseOptions): string[] {
  const folderByHandle = new Map<string, string>();
  for (const folder of opts.agentFolders) {
    folderByHandle.set(folder.toLowerCase(), folder);
  }
  if (opts.teamFolder && opts.agentFolders.includes(opts.teamFolder)) {
    folderByHandle.set('team', opts.teamFolder);
  }

  const folders: string[] = [];
  const seen = new Set<string>();
  const pattern = new RegExp(MENTION_HANDLE_PATTERN.source, MENTION_HANDLE_PATTERN.flags);
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const handle = match[1]!.toLowerCase();
    if (handle === 'here') continue;
    const folder = folderByHandle.get(handle);
    if (!folder || seen.has(folder)) continue;
    seen.add(folder);
    folders.push(folder);
  }
  return folders;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Mask code blocks, inline code, and quoted spans so mentions inside them are ignored. */
function maskExcludedSpans(text: string): string {
  let masked = text;
  masked = masked.replace(/```[\s\S]*?```/g, (m) => ' '.repeat(m.length));
  masked = masked.replace(/`[^`]*`/g, (m) => ' '.repeat(m.length));
  masked = masked.replace(/"[^"]*"/g, (m) => ' '.repeat(m.length));
  masked = masked.replace(/'[^']*'/g, (m) => ' '.repeat(m.length));
  return masked;
}

function isCitation(text: string, matchIndex: number, matchedLength: number): boolean {
  const before = text.slice(Math.max(0, matchIndex - 12), matchIndex).toLowerCase();
  const afterStart = matchIndex + matchedLength;
  const after = text.slice(afterStart, afterStart + 24).toLowerCase();
  if (/\bas\s+$/.test(before)) return true;
  if (/\bper\s+$/.test(before)) return true;
  if (/^(?:'s\s+)?(?:said|mentioned|noted|wrote|suggested)\b/.test(after)) return true;
  return false;
}

function isAddressPosition(text: string, matchIndex: number, matchedLength: number): boolean {
  if (matchIndex === 0) return true;
  const before = text.slice(0, matchIndex);
  const after = text.slice(matchIndex + matchedLength);
  if (/^\s*[—\-:,]/.test(after)) return true;
  if (/,\s*$/.test(before)) return true;
  if (/(?:^|[\s,.])(?:hey|hi|ok|yo|so)\s+$/i.test(before)) return true;
  return false;
}

/**
 * Detect implicit name references to engaged agents (position-gated, whole-word).
 * Only agents in `engagedAgents` are considered.
 */
export function implicitMentionedFolders(text: string, engagedAgents: readonly ImplicitMentionAgent[]): string[] {
  if (engagedAgents.length === 0) return [];
  let masked = maskExcludedSpans(text);
  masked = masked.replace(new RegExp(MENTION_HANDLE_PATTERN.source, MENTION_HANDLE_PATTERN.flags), (m) =>
    ' '.repeat(m.length),
  );
  const found: string[] = [];
  const seen = new Set<string>();

  for (const agent of engagedAgents) {
    const names = [agent.folder, agent.displayName].filter(Boolean);
    for (const name of names) {
      const pattern = new RegExp(`\\b${escapeRegex(name)}\\b`, 'gi');
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(masked)) !== null) {
        if (isCitation(masked, match.index, match[0].length)) continue;
        if (!isAddressPosition(masked, match.index, match[0].length)) continue;
        if (!seen.has(agent.folder)) {
          seen.add(agent.folder);
          found.push(agent.folder);
        }
        break;
      }
      if (seen.has(agent.folder)) break;
    }
  }

  return found;
}

export function mentionHandleForFolder(folder: string, teamFolder: string | null): string {
  if (teamFolder && folder === teamFolder) return '@team';
  return `@${folder}`;
}

export function routingTextForAgent(text: string, folder: string, teamFolder: string | null): string {
  const trimmed = text.trim();
  const handle = mentionHandleForFolder(folder, teamFolder);
  return trimmed ? `${handle} ${trimmed}` : handle;
}
