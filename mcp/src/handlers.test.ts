import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  handleCreateThread,
  handleListAgents,
  handleListChannels,
  handleListThreads,
  handleReadChannel,
  handleReadThread,
  handleSendMessage,
  errorResult,
  textResult,
  type ToolDeps,
} from './handlers.js';
import { WebchatClient } from './client.js';
import type { BootstrapPayload, WebChatMessage } from './types.js';

const bootstrapFixture: BootstrapPayload = {
  user: { id: 'web:local', displayName: 'Local' },
  rooms: [
    {
      platformId: 'lobby',
      name: 'Lobby',
      kind: 'lobby',
      threads: [
        { id: 'main', title: 'Main' },
        { id: 'thread_abc', title: 'Topic' },
      ],
    },
    { platformId: 'dm:sarah', name: 'Sarah', kind: 'dm', folder: 'sarah' },
  ],
  agents: [{ folder: 'sarah', name: 'Sarah', mention: '@sarah' }],
};

const messageFixture: WebChatMessage = {
  id: 'web-1',
  direction: 'outbound',
  text: 'Reply',
  timestamp: 1710000000000,
  platformId: 'lobby',
  threadId: 'main',
};

function mockClient(overrides: Partial<WebchatClient> = {}): WebchatClient {
  return {
    fetchBootstrap: vi.fn().mockResolvedValue(bootstrapFixture),
    fetchMessages: vi.fn().mockResolvedValue({ messages: [messageFixture], engagedAgents: ['sarah'] }),
    sendMessage: vi.fn().mockResolvedValue({ messageId: 'web-99', timestamp: 1710000000001 }),
    createThread: vi.fn().mockResolvedValue({ id: 'thread_new', title: 'Task' }),
    ...overrides,
  } as unknown as WebchatClient;
}

describe('handlers', () => {
  let tmpDir: string;
  let deps: ToolDeps;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webchat-mcp-handlers-'));
    deps = {
      client: mockClient(),
      log: vi.fn(),
    };
  });

  it('textResult and errorResult shape', () => {
    expect(textResult('ok').content[0]!.text).toBe('ok');
    expect(errorResult('bad').isError).toBe(true);
  });

  it('handleListChannels lists all rooms', async () => {
    const result = await handleListChannels(deps);
    expect(result.content[0]!.text).toContain('Lobby');
    expect(result.content[0]!.text).toContain('dm:sarah');
  });

  it('handleListChannels filters by query', async () => {
    const result = await handleListChannels(deps, 'sarah');
    expect(result.content[0]!.text).toContain('Sarah');
    expect(result.content[0]!.text).not.toContain('Lobby');
  });

  it('handleListChannels handles no matches and empty rooms', async () => {
    deps.client = mockClient({
      fetchBootstrap: vi.fn().mockResolvedValue({ ...bootstrapFixture, rooms: [] }),
    });
    expect((await handleListChannels(deps, 'x')).content[0]!.text).toContain('No channels matching');
    expect((await handleListChannels(deps)).content[0]!.text).toBe('No channels available.');
  });

  it('handleListChannels handles fetch errors', async () => {
    deps.client = mockClient({
      fetchBootstrap: vi.fn().mockRejectedValue(new Error('network')),
    });
    const result = await handleListChannels(deps);
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe('network');
  });

  it('handleListChannels ignores blank query', async () => {
    const result = await handleListChannels(deps, '   ');
    expect(result.content[0]!.text).toContain('Lobby');
  });

  it('handleListChannels handles non-Error throws', async () => {
    deps.client = mockClient({
      fetchBootstrap: vi.fn().mockRejectedValue('fail'),
    });
    const result = await handleListChannels(deps);
    expect(result.content[0]!.text).toBe('fail');
  });

  it('handleListAgents lists and filters agents', async () => {
    expect((await handleListAgents(deps)).content[0]!.text).toContain('@sarah');
    expect((await handleListAgents(deps, 'sarah')).content[0]!.text).toContain('Sarah');
    deps.client = mockClient({
      fetchBootstrap: vi.fn().mockResolvedValue({ ...bootstrapFixture, agents: [] }),
    });
    expect((await handleListAgents(deps, 'x')).content[0]!.text).toContain('No agents matching');
  });

  it('handleListAgents handles empty agents without query', async () => {
    deps.client = mockClient({
      fetchBootstrap: vi.fn().mockResolvedValue({ ...bootstrapFixture, agents: [] }),
    });
    expect((await handleListAgents(deps)).content[0]!.text).toBe('No agents available.');
  });

  it('handleListAgents filters by mention and folder', async () => {
    deps.client = mockClient({
      fetchBootstrap: vi.fn().mockResolvedValue({
        ...bootstrapFixture,
        agents: [{ folder: 'dir', name: 'Other', mention: '@pickme' }],
      }),
    });
    expect((await handleListAgents(deps, 'pickme')).content[0]!.text).toContain('@pickme');
    expect((await handleListAgents(deps, 'dir')).content[0]!.text).toContain('folder: dir');
  });

  it('handleListAgents ignores blank query', async () => {
    expect((await handleListAgents(deps, '   ')).content[0]!.text).toContain('@sarah');
  });

  it('handleListAgents handles errors', async () => {
    deps.client = mockClient({
      fetchBootstrap: vi.fn().mockRejectedValue(new Error('agents down')),
    });
    expect((await handleListAgents(deps)).content[0]!.text).toBe('agents down');
  });

  it('handleListAgents handles non-Error throws', async () => {
    deps.client = mockClient({
      fetchBootstrap: vi.fn().mockRejectedValue('boom'),
    });
    expect((await handleListAgents(deps)).content[0]!.text).toBe('boom');
  });

  it('handleReadChannel handles non-Error throws', async () => {
    deps.client = mockClient({
      fetchMessages: vi.fn().mockRejectedValue('nope'),
    });
    expect((await handleReadChannel(deps, 'lobby')).content[0]!.text).toBe('nope');
    expect((await handleReadThread(deps, 'lobby', 'main')).content[0]!.text).toBe('nope');
  });

  it('handleSendMessage defaults threadId and works without log', async () => {
    deps.log = undefined;
    const result = await handleSendMessage(deps, { platformId: 'lobby', message: 'hi' });
    expect(result.content[0]!.text).toContain('web-99');
  });

  it('handleCreateThread handles non-Error throws', async () => {
    deps.client = mockClient({
      createThread: vi.fn().mockRejectedValue('create fail'),
    });
    expect((await handleCreateThread(deps, 'lobby')).content[0]!.text).toBe('create fail');
  });

  it('handleReadChannel and handleReadThread format messages and engaged agents', async () => {
    expect((await handleReadChannel(deps, 'lobby')).content[0]!.text).toContain('Reply');
    expect((await handleReadChannel(deps, 'lobby')).content[0]!.text).toContain('Engaged agents');
    expect((await handleReadThread(deps, 'lobby', 'main')).content[0]!.text).toContain('Reply');
    expect((await handleReadChannel(deps, 'lobby', 25, 500)).content[0]!.text).toContain('Reply');
    expect((await handleReadThread(deps, 'lobby', 'main', 25, 500)).content[0]!.text).toContain('Reply');
  });

  it('handleReadChannel handles errors', async () => {
    deps.client = mockClient({
      fetchMessages: vi.fn().mockRejectedValue(new Error('404')),
    });
    expect((await handleReadChannel(deps, 'lobby')).isError).toBe(true);
    expect((await handleReadThread(deps, 'lobby', 'main')).isError).toBe(true);
  });

  it('handleSendMessage sends and returns metadata', async () => {
    const result = await handleSendMessage(deps, {
      platformId: 'lobby',
      message: '@sarah hi',
    });
    expect(result.content[0]!.text).toContain('web-99');
    expect(deps.log).toHaveBeenCalled();
  });

  it('handleSendMessage validates empty message', async () => {
    const result = await handleSendMessage(deps, {
      platformId: 'lobby',
      message: '   ',
    });
    expect(result.isError).toBe(true);
  });

  it('handleSendMessage reports attachment errors', async () => {
    const result = await handleSendMessage(deps, {
      platformId: 'lobby',
      message: 'see file',
      attachment_paths: ['/missing.txt'],
    });
    expect(result.isError).toBe(true);
  });

  it('handleSendMessage sends attachments without text', async () => {
    const filePath = path.join(tmpDir, 'note.txt');
    fs.writeFileSync(filePath, 'data');
    const result = await handleSendMessage(deps, {
      platformId: 'lobby',
      message: '',
      attachment_paths: [filePath],
    });
    expect(result.isError).toBeUndefined();
    expect(deps.client.sendMessage).toHaveBeenCalled();
  });

  it('handleSendMessage handles client errors', async () => {
    deps.client = mockClient({
      sendMessage: vi.fn().mockRejectedValue('send fail'),
    });
    const result = await handleSendMessage(deps, {
      platformId: 'lobby',
      message: 'hi',
    });
    expect(result.content[0]!.text).toBe('send fail');
  });

  it('handleSendMessage handles Error throws', async () => {
    deps.client = mockClient({
      sendMessage: vi.fn().mockRejectedValue(new Error('send error')),
    });
    expect(
      (await handleSendMessage(deps, { platformId: 'lobby', message: 'hi' })).content[0]!.text,
    ).toBe('send error');
  });

  it('handleCreateThread uses server API', async () => {
    const created = await handleCreateThread(deps, 'lobby', 'Task');
    expect(created.content[0]!.text).toContain('thread_new');
    expect(deps.client.createThread).toHaveBeenCalledWith('lobby', 'Task');
    await handleCreateThread(deps, 'lobby');
    expect(deps.client.createThread).toHaveBeenCalledWith('lobby', undefined);
  });

  it('handleCreateThread handles errors', async () => {
    deps.client = mockClient({
      createThread: vi.fn().mockRejectedValue(new Error('disk full')),
    });
    const result = await handleCreateThread(deps, 'lobby');
    expect(result.isError).toBe(true);
  });

  it('handleListThreads reads bootstrap threads', async () => {
    const listed = await handleListThreads(deps, 'lobby');
    expect(listed.content[0]!.text).toContain('Topic');
    expect(listed.content[0]!.text).toContain('Main');
  });

  it('handleListThreads falls back to main for unknown room', async () => {
    const listed = await handleListThreads(deps, 'unknown');
    expect(listed.content[0]!.text).toContain('Main');
  });

  it('handleListThreads falls back when room has no threads array', async () => {
    deps.client = mockClient({
      fetchBootstrap: vi.fn().mockResolvedValue({
        ...bootstrapFixture,
        rooms: [{ platformId: 'lobby', name: 'Lobby', kind: 'lobby' }],
      }),
    });
    const listed = await handleListThreads(deps, 'lobby');
    expect(listed.content[0]!.text).toContain('Main');
  });

  it('handleListThreads handles Error throws', async () => {
    deps.client = mockClient({
      fetchBootstrap: vi.fn().mockRejectedValue(new Error('bootstrap fail')),
    });
    expect((await handleListThreads(deps, 'lobby')).content[0]!.text).toBe('bootstrap fail');
  });

  it('handleListThreads handles errors', async () => {
    deps.client = mockClient({
      fetchBootstrap: vi.fn().mockRejectedValue('list fail'),
    });
    const result = await handleListThreads(deps, 'lobby');
    expect(result.content[0]!.text).toBe('list fail');
  });
});
