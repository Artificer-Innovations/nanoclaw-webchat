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
    'Read messages from a channel main thread (threadId=main). Read-only. Use since (ms epoch) for incremental reads after sending a message. Poll repeatedly until outbound agent messages appear.',
    toolSchemas.readChannel,
    async ({ platformId, limit, since }) =>
      handleReadChannel(deps, platformId, limit, since),
  );

  server.tool(
    'webchat_read_thread',
    'Read messages from a specific thread. Read-only. Use since (ms epoch) for incremental reads after webchat_send_message.',
    toolSchemas.readThread,
    async ({ platformId, threadId, limit, since }) =>
      handleReadThread(deps, platformId, threadId, limit, since),
  );

  server.tool(
    'webchat_send_message',
    'Send a message to a web chat channel or thread. In lobby, include @mention to route to an agent. After sending, call webchat_read_channel or webchat_read_thread with since=timestamp to collect agent replies.',
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
    'List threads for a channel from server state (includes main and server-created threads).',
    toolSchemas.listThreads,
    async ({ platformId }) => handleListThreads(deps, platformId),
  );
}

export function createWebchatMcpServer(options: CreateWebchatMcpServerOptions): McpServer {
  const { config } = options;
  const client =
    options.client ??
    new WebchatClient({ apiBase: config.apiBase, secret: config.secret });

  const deps: ToolDeps = { client, log: webchatLog };

  const server = new McpServer({
    name: 'nanoclaw-webchat',
    version: '0.1.0',
  });

  wireWebchatTools(server, deps);

  return server;
}

export { createWebchatMcpServer as default };
