import { z } from 'zod';
import { WebchatClient } from './client.js';
import { formatEngagedAgents, formatMessages } from './format.js';
import { readAttachmentPaths } from './attachments.js';

export function errorResult(message: string) {
  return {
    content: [{ type: 'text' as const, text: message }],
    isError: true as const,
  };
}

export function textResult(text: string) {
  return {
    content: [{ type: 'text' as const, text }],
  };
}

export interface ToolDeps {
  client: WebchatClient;
  log?: (msg: string) => void;
}

export async function handleListChannels(deps: ToolDeps, query?: string) {
  try {
    const bootstrap = await deps.client.fetchBootstrap();
    let rooms = bootstrap.rooms;
    if (query?.trim()) {
      const q = query.trim().toLowerCase();
      rooms = rooms.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.platformId.toLowerCase().includes(q),
      );
    }
    if (rooms.length === 0) {
      return textResult(query ? `No channels matching "${query}".` : 'No channels available.');
    }
    const lines = rooms.map(
      (r) =>
        `- ${r.name} (platformId: ${r.platformId}, kind: ${r.kind}${r.folder ? `, folder: ${r.folder}` : ''})`,
    );
    return textResult(`Channels:\n${lines.join('\n')}`);
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : String(err));
  }
}

export async function handleListAgents(deps: ToolDeps, query?: string) {
  try {
    const bootstrap = await deps.client.fetchBootstrap();
    let agents = bootstrap.agents;
    if (query?.trim()) {
      const q = query.trim().toLowerCase();
      agents = agents.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.folder.toLowerCase().includes(q) ||
          a.mention.toLowerCase().includes(q),
      );
    }
    if (agents.length === 0) {
      return textResult(query ? `No agents matching "${query}".` : 'No agents available.');
    }
    const lines = agents.map(
      (a) =>
        `- ${a.name} (folder: ${a.folder}, mention: ${a.mention}, dm platformId: dm:${a.folder})`,
    );
    return textResult(`Agents:\n${lines.join('\n')}`);
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : String(err));
  }
}

export async function handleReadChannel(
  deps: ToolDeps,
  platformId: string,
  limit = 50,
  since = 0,
) {
  try {
    const payload = await deps.client.fetchMessages(platformId, 'main', since);
    return textResult(
      formatMessages(payload.messages, limit) + formatEngagedAgents(payload.engagedAgents),
    );
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : String(err));
  }
}

export async function handleReadThread(
  deps: ToolDeps,
  platformId: string,
  threadId: string,
  limit = 50,
  since = 0,
) {
  try {
    const payload = await deps.client.fetchMessages(platformId, threadId, since);
    return textResult(
      formatMessages(payload.messages, limit) + formatEngagedAgents(payload.engagedAgents),
    );
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : String(err));
  }
}

export interface SendMessageArgs {
  platformId: string;
  message: string;
  threadId?: string;
  attachmentPaths?: string[];
}

export async function handleSendMessage(deps: ToolDeps, args: SendMessageArgs) {
  const threadId = args.threadId ?? 'main';
  try {
    let attachments;
    if (args.attachmentPaths?.length) {
      const result = readAttachmentPaths(args.attachmentPaths);
      if (result.errors.length > 0) {
        return errorResult(result.errors.join('; '));
      }
      attachments = result.attachments;
    }
    const trimmed = args.message.trim();
    if (!trimmed && (!attachments || attachments.length === 0)) {
      return errorResult('Message text or attachments required');
    }
    const sendResult = await deps.client.sendMessage(
      args.platformId,
      threadId,
      trimmed,
      attachments,
    );
    deps.log?.(`Sent message ${sendResult.messageId} to ${args.platformId}/${threadId}`);
    return textResult(
      JSON.stringify(
        {
          messageId: sendResult.messageId,
          timestamp: sendResult.timestamp,
          threadId,
          platformId: args.platformId,
        },
        null,
        2,
      ),
    );
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : String(err));
  }
}

export async function handleCreateThread(
  deps: ToolDeps,
  platformId: string,
  title?: string,
) {
  try {
    const record = await deps.client.createThread(platformId, title);
    return textResult(
      JSON.stringify(
        {
          threadId: record.id,
          title: record.title,
          platformId,
        },
        null,
        2,
      ),
    );
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : String(err));
  }
}

export async function handleListThreads(deps: ToolDeps, platformId: string) {
  try {
    const bootstrap = await deps.client.fetchBootstrap();
    const room = bootstrap.rooms.find((r) => r.platformId === platformId);
    if (!room) {
      return errorResult(`No channel found with platformId: ${platformId}`);
    }
    const threads = room.threads ?? [{ id: 'main', title: 'Main' }];
    const lines = threads.map((t) => `- ${t.title} (threadId: ${t.id})`);
    return textResult(`Threads in ${platformId}:\n${lines.join('\n')}`);
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : String(err));
  }
}

export const toolSchemas = {
  listChannels: { query: z.string().optional() },
  listAgents: { query: z.string().optional() },
  readChannel: {
    platformId: z.string(),
    limit: z
      .number()
      .int()
      .min(1)
      .max(500)
      .optional()
      .describe('Client-side display cap after full fetch (default 50). Does not limit server transfer.'),
    since: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe('Unix timestamp in milliseconds. Bounds server response; prefer for polling large channels.'),
  },
  readThread: {
    platformId: z.string(),
    threadId: z.string(),
    limit: z
      .number()
      .int()
      .min(1)
      .max(500)
      .optional()
      .describe('Client-side display cap after full fetch (default 50). Does not limit server transfer.'),
    since: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe('Unix timestamp in milliseconds. Bounds server response; prefer for polling large threads.'),
  },
  sendMessage: {
    platformId: z.string(),
    message: z.string().describe('Message text (required unless attachmentPaths provided)'),
    threadId: z.string().optional(),
    attachmentPaths: z
      .array(z.string())
      .optional()
      .describe('Local file paths on the host running the MCP server (max 4, 5 MB each)'),
  },
  createThread: {
    platformId: z.string(),
    title: z.string().optional(),
  },
  listThreads: {
    platformId: z.string(),
  },
};
