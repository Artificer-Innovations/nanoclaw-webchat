import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebchatClient } from './client.js';
import type { WebchatMcpConfig } from './config.js';
import {
  handleCreateThread,
  handleListAgents,
  handleListChannels,
  handleListThreads,
  handleReadChannel,
  handleReadThread,
  handleSendMessage,
  toolSchemas,
  type ToolDeps,
} from './handlers.js';

export function webchatLog(msg: string): void {
  console.error(`[webchat-mcp] ${msg}`);
}

export interface CreateWebchatMcpServerOptions {
  config: WebchatMcpConfig;
  client?: WebchatClient;
}

export function wireWebchatTools(server: McpServer, deps: ToolDeps): void {
  server.tool(
    'webchat_list_channels',
    'List web chat channels (lobby and DM rooms). Optional query filters by name or platformId. Use platformId with webchat_read_channel or webchat_send_message.',
    toolSchemas.listChannels,
    async ({ query }) => handleListChannels(deps, query),
  );

  server.tool(
    'webchat_list_agents',
    'List NanoClaw agents available in web chat. In the lobby channel, include @mention in message text to route to a specific agent. For 1:1 chat, use platformId dm:<folder>.',
    toolSchemas.listAgents,
    async ({ query }) => handleListAgents(deps, query),
  );

  server.tool(
    'webchat_read_channel',
    'Read messages from a channel main thread (threadId=main). Read-only. Fetches full channel history and truncates client-side; for large channels or polling, use since (Unix ms timestamp) to bound the server response. limit is a client-side display cap only (default 50), not server pagination. After sending, poll with since=timestamp every 2–5 seconds until outbound agent messages appear.',
    toolSchemas.readChannel,
    async ({ platformId, limit, since }) =>
      handleReadChannel(deps, platformId, limit, since),
  );

  server.tool(
    'webchat_read_thread',
    'Read messages from a specific thread. Read-only. Fetches full thread history and truncates client-side; for large threads or polling, use since (Unix ms timestamp) to bound the server response. limit is a client-side display cap only (default 50), not server pagination. Poll with since=timestamp every 2–5 seconds after webchat_send_message.',
    toolSchemas.readThread,
    async ({ platformId, threadId, limit, since }) =>
      handleReadThread(deps, platformId, threadId, limit, since),
  );

  server.tool(
    'webchat_send_message',
    'Send a message to a web chat channel or thread. In lobby, include @mention to route to an agent. attachmentPaths are local file paths on the host running this MCP server (max 4, 5 MB each). After sending, call webchat_read_channel or webchat_read_thread with since=timestamp to collect agent replies; wait 2–5 seconds between polls.',
    toolSchemas.sendMessage,
    async (args) => handleSendMessage(deps, args),
  );

  server.tool(
    'webchat_create_thread',
    'Create a new thread in a channel. Returns threadId for use with webchat_send_message and webchat_read_thread. Does not post a message.',
    toolSchemas.createThread,
    async ({ platformId, title }) => handleCreateThread(deps, platformId, title),
  );

  server.tool(
    'webchat_list_threads',
    'List threads for a channel by fetching bootstrap and extracting that channel thread list (includes main and server-created threads).',
    toolSchemas.listThreads,
    async ({ platformId }) => handleListThreads(deps, platformId),
  );
}

export function createWebchatMcpServer(options: CreateWebchatMcpServerOptions): McpServer {
  const { config } = options;
  const client =
    options.client ??
    new WebchatClient({
      apiBase: config.apiBase,
      secret: config.secret,
      timeoutMs: config.requestTimeoutMs,
    });

  const deps: ToolDeps = { client, log: webchatLog };

  const server = new McpServer({
    name: 'nanoclaw-webchat',
    version: '0.1.0',
  });

  wireWebchatTools(server, deps);

  return server;
}

export { createWebchatMcpServer as default };
