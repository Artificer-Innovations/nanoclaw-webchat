import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import http from 'http';
import { createServer as createNetServer } from 'node:net';
import path from 'path';
import WebSocket from 'ws';

vi.mock('../config.js', async () => {
  const actual = await vi.importActual<typeof import('../config.js')>('../config.js');
  return { ...actual, DATA_DIR: '/tmp/nanoclaw-web-adapter-test' };
});

const TEST_DATA = '/tmp/nanoclaw-web-adapter-test';

vi.mock('nanoclaw-webchat', () => ({
  getAssetDir: vi.fn(() => '/tmp/nanoclaw-webchat-test-assets'),
}));

vi.mock('../webchat-sync.js', () => ({
  buildWebchatBootstrap: () => ({
    user: { id: 'web:local', displayName: 'Local' },
    rooms: [
      {
        platformId: 'inbox',
        name: 'Inbox',
        kind: 'inbox',
        threads: [{ id: 'main', title: 'Main' }],
      },
      {
        platformId: 'lobby',
        name: 'Lobby',
        kind: 'lobby',
        threads: [{ id: 'main', title: 'Main' }],
      },
    ],
    agents: [{ folder: 'sarah', name: 'Sarah', mention: '@sarah' }],
  }),
  readTeamFolder: () => null,
  WEB_INBOX_PLATFORM_ID: 'inbox',
}));

vi.mock('../db/agent-groups.js', () => ({
  getAllAgentGroups: () => [
    { id: 'ag-sarah', folder: 'sarah', name: 'Sarah', agent_provider: null, created_at: '2020-01-01' },
    { id: 'ag-diego', folder: 'diego', name: 'Diego', agent_provider: null, created_at: '2020-01-01' },
    { id: 'ag-rahul', folder: 'rahul', name: 'Rahul', agent_provider: null, created_at: '2020-01-01' },
  ],
  getAgentGroup: vi.fn((id: string) => {
    if (id === 'ag-sarah') {
      return { id: 'ag-sarah', folder: 'sarah', name: 'Sarah', agent_provider: null, created_at: '2020-01-01' };
    }
    return undefined;
  }),
}));

vi.mock('../db/connection.js', () => ({
  getDb: vi.fn(() => ({})),
  hasTable: vi.fn((_db: unknown, table: string) => table === 'pending_approvals'),
}));

vi.mock('../db/sessions.js', async () => {
  const actual = await vi.importActual<typeof import('../db/sessions.js')>('../db/sessions.js');
  return {
    ...actual,
    getPendingApproval: vi.fn(),
    getSession: vi.fn(),
  };
});

const routeCaptures: Array<{
  platformId: string;
  threadId: string | null;
  message: {
    id: string;
    kind: 'chat' | 'chat-sdk';
    content: unknown;
    timestamp: string;
    isGroup?: boolean;
  };
}> = [];

vi.mock('../webchat-thread-cleanup.js', () => ({
  cleanupAgentSessionsForThread: vi.fn(),
}));

vi.mock('../db/messaging-groups.js', () => ({
  getMessagingGroupByPlatform: vi.fn(() => ({ id: 'mg-lobby' })),
  getMessagingGroup: vi.fn(),
}));

vi.mock('../router.js', () => ({
  routeInbound: vi.fn(async (event: {
    platformId: string;
    threadId: string | null;
    message: { id: string; kind: 'chat' | 'chat-sdk'; content: string; timestamp: string; isGroup?: boolean };
  }) => {
    routeCaptures.push({
      platformId: event.platformId,
      threadId: event.threadId,
      message: {
        id: event.message.id,
        kind: event.message.kind,
        content: JSON.parse(event.message.content),
        timestamp: event.message.timestamp,
        isGroup: event.message.isGroup,
      },
    });
  }),
}));

import { createWebAdapter, clearWebAdapterTestState, flushWebAgentDeliveryChains } from './web.js';
import type { ChannelSetup, InboundMessage } from './adapter.js';
import { routeInbound } from '../router.js';
import { cleanupAgentSessionsForThread } from '../webchat-thread-cleanup.js';
import { getDb, hasTable } from '../db/connection.js';
import { getAgentGroup } from '../db/agent-groups.js';
import { getMessagingGroupByPlatform, getMessagingGroup } from '../db/messaging-groups.js';
import { getPendingApproval, getSession } from '../db/sessions.js';
import { getAssetDir } from 'nanoclaw-webchat';
import * as webchatStore from '../webchat-store.js';
import { resetUploadStateForTests } from '../webchat-uploads.js';
import * as agentGroups from '../db/agent-groups.js';
import * as webchatMentions from '../webchat-mentions.js';

const routeInboundMock = vi.mocked(routeInbound);
const cleanupSessionsMock = vi.mocked(cleanupAgentSessionsForThread);
const getDbMock = vi.mocked(getDb);
const hasTableMock = vi.mocked(hasTable);
const getAgentGroupMock = vi.mocked(getAgentGroup);
const getMessagingGroupMock = vi.mocked(getMessagingGroupByPlatform);
const getMessagingGroupByIdMock = vi.mocked(getMessagingGroup);
const getPendingApprovalMock = vi.mocked(getPendingApproval);
const getSessionMock = vi.mocked(getSession);
const getAssetDirMock = vi.mocked(getAssetDir);

const SECRET = 'test-secret';
let testPort = 0;

async function reservePort(): Promise<number> {
  // Probe-and-release: OS may reassign the port before adapter.setup() binds it (TOCTOU).
  // Acceptable for tests; fixed incrementing ports caused EADDRINUSE flakes on CI.
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const addr = probe.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      probe.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

function httpPostJson(path: string, body: unknown, port = testPort): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'POST',
        agent: false,
        headers: {
          Authorization: `Bearer ${SECRET}`,
          'Content-Type': 'application/json',
          Connection: 'close',
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) as Record<string, unknown> });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: {} });
          }
        });
      },
    );
    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

function httpMultipartUpload(
  path: string,
  filename: string,
  content: Buffer,
  port = testPort,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const boundary = '----WebKitFormBoundaryTestUpload';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'POST',
        agent: false,
        headers: {
          Authorization: `Bearer ${SECRET}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length,
          Connection: 'close',
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) as Record<string, unknown> });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: {} });
          }
        });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function httpPost(path: string, body: unknown, port = testPort): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'POST',
        agent: false,
        headers: {
          Authorization: `Bearer ${SECRET}`,
          'Content-Type': 'application/json',
          Connection: 'close',
        },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      },
    );
    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

function httpGetText(path: string, port = testPort): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'GET',
        agent: false,
        headers: { Connection: 'close' },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function httpGet(path: string, port = testPort): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'GET',
        agent: false,
        headers: { Authorization: `Bearer ${SECRET}`, Connection: 'close' },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: data });
          }
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

const PNG_BASE64 = Buffer.from('fake-png').toString('base64');

async function flushAgentDeliveries(): Promise<void> {
  await flushWebAgentDeliveryChains();
}

function httpDelete(path: string, port = testPort): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'DELETE',
        agent: false,
        headers: { Authorization: `Bearer ${SECRET}`, Connection: 'close' },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: data });
          }
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('web channel adapter', () => {
  let adapter: ReturnType<typeof createWebAdapter>;
  const captures = routeCaptures;
  let setup: ChannelSetup;
  const actionCaptures: Array<{ questionId: string; value: string; userId: string }> = [];

  beforeEach(async () => {
    clearWebAdapterTestState();
    resetUploadStateForTests();
    captures.length = 0;
    actionCaptures.length = 0;
    getDbMock.mockReset();
    getDbMock.mockReturnValue({} as ReturnType<typeof getDb>);
    hasTableMock.mockReset();
    hasTableMock.mockImplementation((_db: unknown, table: string) => table === 'pending_approvals');
    getAgentGroupMock.mockReset();
    getAgentGroupMock.mockImplementation((id: string) => {
      if (id === 'ag-sarah') {
        return { id: 'ag-sarah', folder: 'sarah', name: 'Sarah', agent_provider: null, created_at: '2020-01-01' };
      }
      return undefined;
    });
    getPendingApprovalMock.mockReset();
    getSessionMock.mockReset();
    getMessagingGroupByIdMock.mockReset();
    testPort = await reservePort();
    if (fs.existsSync(TEST_DATA)) {
      fs.rmSync(TEST_DATA, { recursive: true, force: true });
    }
    const assetDir = '/tmp/nanoclaw-webchat-test-assets';
    fs.mkdirSync(assetDir, { recursive: true });
    fs.writeFileSync(
      path.join(assetDir, 'index.html'),
      '<!doctype html><html><head></head><body><div id="root"></div></body></html>',
    );
    setup = {
      onInbound() {},
      onInboundEvent() {},
      onMetadata() {},
      onAction(questionId, value, userId) {
        actionCaptures.push({ questionId, value, userId });
      },
    };
    adapter = createWebAdapter({
      port: testPort,
      authToken: SECRET,
      userId: 'web:local',
      displayName: 'Local',
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await flushAgentDeliveries();
    await adapter.teardown();
    if (fs.existsSync(TEST_DATA)) {
      fs.rmSync(TEST_DATA, { recursive: true, force: true });
    }
  });

  it('routes POST messages to onInbound with threadId', async () => {
    await adapter.setup(setup);
    const status = await httpPost('/api/rooms/lobby/threads/thread_abc/messages', {
      text: '@sarah hello',
    });
    expect(status).toBe(200);
    await flushAgentDeliveries();
    const liveCaptures = captures.filter((c) => c.message.id.includes('-route-'));
    expect(liveCaptures).toHaveLength(1);
    expect(liveCaptures[0]!.platformId).toBe('lobby');
    expect(liveCaptures[0]!.threadId).toBe('thread_abc');
    expect(liveCaptures[0]!.message.isGroup).toBe(true);
    expect(liveCaptures[0]!.message.content).toMatchObject({ text: '@sarah hello' });
  });

  it('injects webchat token meta into served index.html', async () => {
    await adapter.setup(setup);
    const { status, body } = await httpGetText('/', testPort);
    expect(status).toBe(200);
    expect(body).toContain('name="webchat-token"');
    expect(body).toContain(`content="${SECRET}"`);
  });

  it('marks per-agent DM rooms as non-group inbound messages', async () => {
    await adapter.setup(setup);
    const status = await httpPost('/api/rooms/dm%3Asarah/threads/main/messages', {
      text: 'direct hello',
    });
    expect(status).toBe(200);
    expect(captures).toHaveLength(1);
    expect(captures[0]!.platformId).toBe('dm:sarah');
    expect(captures[0]!.message.isGroup).toBe(false);
  });

  it('accepts image-only POST messages and forwards attachments to onInbound', async () => {
    await adapter.setup(setup);
    const status = await httpPost('/api/rooms/lobby/threads/thread_abc/messages', {
      text: '@sarah',
      attachments: [
        {
          name: 'photo.png',
          mimeType: 'image/png',
          type: 'image',
          data: PNG_BASE64,
        },
      ],
    });
    expect(status).toBe(200);
    await flushAgentDeliveries();
    const liveCaptures = captures.filter((c) => c.message.id.includes('-route-'));
    expect(liveCaptures).toHaveLength(1);
    expect(liveCaptures[0]!.message.content).toMatchObject({
      attachments: [
        expect.objectContaining({
          name: 'photo.png',
          mimeType: 'image/png',
          type: 'image',
          data: PNG_BASE64,
        }),
      ],
    });
  });

  it('stores inbound attachments in GET history', async () => {
    await adapter.setup(setup);
    const status = await httpPost('/api/rooms/lobby/threads/thread_abc/messages', {
      text: 'look',
      attachments: [
        {
          name: 'photo.png',
          mimeType: 'image/png',
          type: 'image',
          data: PNG_BASE64,
        },
      ],
    });
    expect(status).toBe(200);

    const { status: getStatus, body } = await httpGet('/api/rooms/lobby/threads/thread_abc/messages');
    expect(getStatus).toBe(200);
    expect(body).toMatchObject({
      messages: [
        expect.objectContaining({
          direction: 'inbound',
          text: 'look',
          attachments: [
            expect.objectContaining({
              name: 'photo.png',
              url: expect.stringContaining('/api/attachments/'),
            }),
          ],
        }),
      ],
    });
  });

  it('accepts non-image inbound attachments such as PDF', async () => {
    await adapter.setup(setup);
    const status = await httpPost('/api/rooms/lobby/threads/thread_abc/messages', {
      text: '@sarah',
      attachments: [
        {
          name: 'doc.pdf',
          mimeType: 'application/pdf',
          type: 'file',
          data: PNG_BASE64,
        },
      ],
    });
    expect(status).toBe(200);
    await flushAgentDeliveries();
    const liveCaptures = captures.filter((c) => c.message.id.includes('-route-'));
    expect(liveCaptures).toHaveLength(1);
    expect(liveCaptures[0]!.message.content).toMatchObject({
      attachments: [
        expect.objectContaining({
          name: 'doc.pdf',
          mimeType: 'application/pdf',
          type: 'file',
        }),
      ],
    });
  });

  it('rejects attachments with missing data', async () => {
    await adapter.setup(setup);
    const status = await httpPost('/api/rooms/lobby/threads/thread_abc/messages', {
      attachments: [{ name: 'doc.pdf', mimeType: 'application/pdf', data: '' }],
    });
    expect(status).toBe(400);
    expect(captures).toHaveLength(0);
  });

  it('pushes deliver() output over WebSocket', async () => {
    await adapter.setup(setup);

    const received: unknown[] = [];
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${testPort}/api/ws?token=${SECRET}`);
      ws.on('open', async () => {
        await adapter.deliver('lobby', 'thread_abc', {
          kind: 'chat',
          content: { text: 'Agent reply' },
        });
      });
      ws.on('message', (data) => {
        received.push(JSON.parse(data.toString()));
        ws.close();
        resolve();
      });
      ws.on('error', reject);
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      type: 'message',
      message: { text: 'Agent reply', direction: 'outbound', platformId: 'lobby' },
    });
  });

  it('includes senderName from deliver() content on WebSocket', async () => {
    await adapter.setup(setup);

    const received: unknown[] = [];
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${testPort}/api/ws?token=${SECRET}`);
      ws.on('open', async () => {
        await adapter.deliver('lobby', 'thread_abc', {
          kind: 'chat',
          content: { text: 'On it', senderName: 'Diego' },
        });
      });
      ws.on('message', (data) => {
        received.push(JSON.parse(data.toString()));
        ws.close();
        resolve();
      });
      ws.on('error', reject);
    });

    expect(received[0]).toMatchObject({
      type: 'message',
      message: { text: 'On it', senderName: 'Diego', direction: 'outbound' },
    });
  });

  it('pushes deliver() file attachments over WebSocket', async () => {
    await adapter.setup(setup);

    const received: unknown[] = [];
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${testPort}/api/ws?token=${SECRET}`);
      ws.on('open', async () => {
        await adapter.deliver('lobby', 'thread_abc', {
          kind: 'chat',
          content: { text: 'Here is the chart' },
          files: [{ filename: 'chart.png', data: Buffer.from('fake-png') }],
        });
      });
      ws.on('message', (data) => {
        received.push(JSON.parse(data.toString()));
        ws.close();
        resolve();
      });
      ws.on('error', reject);
    });

    expect(received[0]).toMatchObject({
      type: 'message',
      message: {
        text: 'Here is the chart',
        direction: 'outbound',
        attachments: [
          expect.objectContaining({
            name: 'chart.png',
            mimeType: 'image/png',
            type: 'image',
            url: expect.stringContaining('/api/attachments/'),
          }),
        ],
      },
    });
  });

  it('delivers file-only outbound messages without text', async () => {
    await adapter.setup(setup);

    const received: unknown[] = [];
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${testPort}/api/ws?token=${SECRET}`);
      ws.on('open', async () => {
        await adapter.deliver('lobby', 'thread_abc', {
          kind: 'chat',
          content: { text: '' },
          files: [{ filename: 'report.pdf', data: Buffer.from('%PDF-1.4') }],
        });
      });
      ws.on('message', (data) => {
        received.push(JSON.parse(data.toString()));
        ws.close();
        resolve();
      });
      ws.on('error', reject);
    });

    expect(received[0]).toMatchObject({
      type: 'message',
      message: {
        text: '',
        attachments: [
          expect.objectContaining({
            name: 'report.pdf',
            mimeType: 'application/pdf',
            type: 'file',
          }),
        ],
      },
    });
  });

  it('persists messages across adapter restart', async () => {
    await adapter.setup(setup);
    await httpPost('/api/rooms/lobby/threads/main/messages', { text: 'persist me' });
    await adapter.teardown();

    adapter = createWebAdapter({
      port: testPort,
      authToken: SECRET,
      userId: 'web:local',
      displayName: 'Local',
    });
    await adapter.setup(setup);

    const { status, body } = await httpGet('/api/rooms/lobby/threads/main/messages');
    expect(status).toBe(200);
    expect(body).toMatchObject({
      messages: [expect.objectContaining({ text: 'persist me', direction: 'inbound' })],
    });
  });

  it('creates, renames, and deletes threads via REST', async () => {
    await adapter.setup(setup);

    const createRes = await new Promise<{ status: number; body: unknown }>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: testPort,
          path: '/api/rooms/lobby/threads',
          method: 'POST',
          agent: false,
          headers: {
            Authorization: `Bearer ${SECRET}`,
            'Content-Type': 'application/json',
            Connection: 'close',
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            try {
              resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) });
            } catch {
              resolve({ status: res.statusCode ?? 0, body: data });
            }
          });
        },
      );
      req.on('error', reject);
      req.write(JSON.stringify({ title: 'Topic' }));
      req.end();
    });
    expect(createRes.status).toBe(200);
    const threadId = (createRes.body as { id: string }).id;

    const patchRes = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: testPort,
          path: `/api/rooms/lobby/threads/${encodeURIComponent(threadId)}`,
          method: 'PATCH',
          agent: false,
          headers: {
            Authorization: `Bearer ${SECRET}`,
            'Content-Type': 'application/json',
            Connection: 'close',
          },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode ?? 0));
        },
      );
      req.on('error', reject);
      req.write(JSON.stringify({ title: 'Renamed' }));
      req.end();
    });
    expect(patchRes).toBe(200);

    const delStatus = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: testPort,
          path: `/api/rooms/lobby/threads/${encodeURIComponent(threadId)}`,
          method: 'DELETE',
          agent: false,
          headers: { Authorization: `Bearer ${SECRET}`, Connection: 'close' },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode ?? 0));
        },
      );
      req.on('error', reject);
      req.end();
    });
    expect(delStatus).toBe(200);
  });

  it('returns engagedAgents in GET messages for lobby threads', async () => {
    await adapter.setup(setup);
    await httpPost('/api/rooms/lobby/threads/thread_abc/messages', { text: '@sarah hello' });

    const { status, body } = await httpGet('/api/rooms/lobby/threads/thread_abc/messages');
    expect(status).toBe(200);
    expect(body).toMatchObject({
      messages: [expect.objectContaining({ text: '@sarah hello' })],
      engagedAgents: ['sarah'],
    });
  });

  it('routes follow-up lobby messages to engaged agents without @mentions', async () => {
    await adapter.setup(setup);
    await httpPost('/api/rooms/lobby/threads/thread_abc/messages', { text: '@sarah hello' });
    await flushAgentDeliveries();
    captures.length = 0;

    await httpPost('/api/rooms/lobby/threads/thread_abc/messages', { text: 'any updates?' });
    await flushAgentDeliveries();

    expect(captures).toHaveLength(1);
    expect(captures[0]!.message.content).toMatchObject({
      text: 'any updates?',
      webchatReceiver: 'sarah',
    });
  });

  it('routes no-@ follow-ups to all engaged agents with routing metadata', async () => {
    await adapter.setup(setup);
    await httpPost('/api/rooms/lobby/threads/thread_abc/messages', { text: '@sarah first' });
    await flushAgentDeliveries();
    await httpPost('/api/rooms/lobby/threads/thread_abc/messages', { text: '@diego second' });
    await flushAgentDeliveries();
    captures.length = 0;

    await httpPost('/api/rooms/lobby/threads/thread_abc/messages', { text: 'thanks both' });
    await flushAgentDeliveries();

    const liveCaptures = captures.filter((c) => c.message.id.includes('-route-'));
    expect(liveCaptures).toHaveLength(2);
    for (const capture of liveCaptures) {
      const content = capture.message.content as {
        text: string;
        routing: { responseExpectation: string; isPeerReply: boolean };
      };
      expect(content.routing.isPeerReply).toBe(false);
      expect(content.routing.responseExpectation).toBe('defer');
    }
    expect(liveCaptures.map((c) => (c.message.content as { text: string }).text).sort()).toEqual([
      'thanks both',
      'thanks both',
    ]);
    expect(
      liveCaptures.map((c) => (c.message.content as { webchatReceiver: string }).webchatReceiver).sort(),
    ).toEqual(['diego', 'sarah']);
  });

  it('explicit @mention routes to all engaged agents with per-receiver metadata', async () => {
    await adapter.setup(setup);
    await httpPost('/api/rooms/lobby/threads/thread_abc/messages', { text: '@sarah first' });
    await flushAgentDeliveries();
    await httpPost('/api/rooms/lobby/threads/thread_abc/messages', { text: '@diego second' });
    await flushAgentDeliveries();
    captures.length = 0;

    await httpPost('/api/rooms/lobby/threads/thread_abc/messages', { text: '@diego your turn' });
    await flushAgentDeliveries();

    const liveCaptures = captures.filter((c) => c.message.id.includes('-route-'));
    expect(liveCaptures).toHaveLength(2);
    for (const capture of liveCaptures) {
      expect((capture.message.content as { text: string }).text).toBe('@diego your turn');
    }
    const byReceiver = Object.fromEntries(
      liveCaptures.map((c) => {
        const content = c.message.content as {
          webchatReceiver: string;
          routing: { responseExpectation: string };
        };
        return [content.webchatReceiver, content.routing.responseExpectation];
      }),
    );
    expect(byReceiver['diego']).toBe('expected');
    expect(byReceiver['sarah']).toBe('defer');
  });

  it('does not route lobby messages with no mentions when no agents are engaged', async () => {
    await adapter.setup(setup);
    await httpPost('/api/rooms/lobby/threads/thread_abc/messages', { text: 'hello everyone' });
    expect(captures).toHaveLength(0);
  });

  it('broadcasts engaged event when new agents are mentioned', async () => {
    await adapter.setup(setup);

    const received: unknown[] = [];
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${testPort}/api/ws?token=${SECRET}`);
      ws.on('open', async () => {
        await httpPost('/api/rooms/lobby/threads/thread_abc/messages', { text: '@sarah hello' });
      });
      ws.on('message', (data) => {
        const event = JSON.parse(data.toString()) as { type: string };
        if (event.type === 'engaged') {
          received.push(event);
          ws.close();
          resolve();
        }
      });
      ws.on('error', reject);
    });

    expect(received[0]).toMatchObject({
      type: 'engaged',
      platformId: 'lobby',
      threadId: 'thread_abc',
      agents: ['sarah'],
    });
  });

  it('persists engaged agents across adapter restart', async () => {
    await adapter.setup(setup);
    await httpPost('/api/rooms/lobby/threads/thread_abc/messages', { text: '@sarah hello' });
    await adapter.teardown();

    adapter = createWebAdapter({
      port: testPort,
      authToken: SECRET,
      userId: 'web:local',
      displayName: 'Local',
    });
    await adapter.setup(setup);

    const { body } = await httpGet('/api/rooms/lobby/threads/thread_abc/messages');
    expect(body).toMatchObject({ engagedAgents: ['sarah'] });
  });

  it('removes engaged agent via DELETE and broadcasts engaged event', async () => {
    await adapter.setup(setup);
    await httpPost('/api/rooms/lobby/threads/thread_abc/messages', { text: '@sarah hello' });
    await flushAgentDeliveries();

    const { status, body } = await httpDelete('/api/rooms/lobby/threads/thread_abc/engaged/sarah');
    expect(status).toBe(200);
    expect(body).toMatchObject({ agents: [] });

    const { body: messagesBody } = await httpGet('/api/rooms/lobby/threads/thread_abc/messages');
    expect(messagesBody).toMatchObject({ engagedAgents: [] });
  });

  it('delivers room stub and replays history when a second agent joins', async () => {
    await adapter.setup(setup);
    await httpPost('/api/rooms/lobby/threads/thread_abc/messages', { text: '@sarah hello one' });
    await flushAgentDeliveries();
    await httpPost('/api/rooms/lobby/threads/thread_abc/messages', { text: 'follow up two' });
    await flushAgentDeliveries();
    captures.length = 0;

    await httpPost('/api/rooms/lobby/threads/thread_abc/messages', { text: '@diego your turn' });
    await flushAgentDeliveries();

    const diegoDeliveries = captures.filter(
      (c) => (c.message.content as { webchatReceiver?: string }).webchatReceiver === 'diego',
    );
    expect(diegoDeliveries.length).toBeGreaterThanOrEqual(4);

    const stub = diegoDeliveries.find((c) => c.message.id.includes('backfill-stub'));
    const intro = diegoDeliveries.find((c) => c.message.id.includes('backfill-intro'));
    const replayOne = diegoDeliveries.find((c) => c.message.id.includes('backfill-replay') && (c.message.content as { text: string }).text.includes('hello one'));
    const replayTwo = diegoDeliveries.find((c) => c.message.id.includes('backfill-replay') && (c.message.content as { text: string }).text === 'follow up two');
    const live = diegoDeliveries.find((c) => c.message.id.includes('-route-'));
    expect(stub).toBeDefined();
    expect(intro).toBeDefined();
    expect(replayOne).toBeDefined();
    expect(replayTwo).toBeDefined();
    expect(live).toBeDefined();
    expect(stub!.message.content).toMatchObject({
      sender: 'System',
      senderId: 'web:local',
      synthetic: true,
      syntheticKind: 'room_context',
    });
    expect(intro!.message.content).toMatchObject({
      sender: 'System',
      senderId: 'web:local',
      synthetic: true,
      syntheticKind: 'backfill_intro',
    });
    expect((stub!.message.content as { text: string }).text).toContain('engaged in this lobby thread');
    expect((intro!.message.content as { text: string }).text).toContain('Recent thread messages follow');
    expect((replayOne!.message.content as { routing?: { isPeerReply?: boolean } }).routing).toMatchObject({
      isPeerReply: false,
    });
    expect(replayOne!.message.content).toMatchObject({ threadMessageSeq: 1, historicalReplay: true });
    expect(replayTwo!.message.content).toMatchObject({ threadMessageSeq: 2 });
    expect(live!.message.content).toMatchObject({ threadMessageSeq: 3 });

    const order = diegoDeliveries.map((c) => captures.indexOf(c));
    expect(order.indexOf(captures.indexOf(stub!))).toBeLessThan(order.indexOf(captures.indexOf(live!)));
    expect(order.indexOf(captures.indexOf(replayTwo!))).toBeLessThan(order.indexOf(captures.indexOf(live!)));
  });

  it('does not prepend join stub on the newly joined agent copy', async () => {
    await adapter.setup(setup);
    await httpPost('/api/rooms/lobby/threads/thread_abc/messages', { text: '@sarah first' });
    await flushAgentDeliveries();
    captures.length = 0;

    await httpPost('/api/rooms/lobby/threads/thread_abc/messages', { text: '@diego second' });
    await flushAgentDeliveries();

    const diegoLive = captures.find(
      (c) =>
        c.message.id.includes('-route-') &&
        (c.message.content as { webchatReceiver?: string }).webchatReceiver === 'diego',
    );
    expect(diegoLive).toBeDefined();
    expect((diegoLive!.message.content as { text: string }).text).toBe('@diego second');
    expect((diegoLive!.message.content as { text: string }).text).not.toContain('has joined');

    const sarahLive = captures.find(
      (c) =>
        c.message.id.includes('-route-') &&
        (c.message.content as { webchatReceiver?: string }).webchatReceiver === 'sarah',
    );
    expect(sarahLive).toBeDefined();
    expect((sarahLive!.message.content as { text: string }).text).toBe('@diego second');
    expect((sarahLive!.message.content as { rosterStub?: string }).rosterStub).toBe('Diego has joined this thread.');
  });

  it('fans out peer reply when sender left engaged set but peers remain', async () => {
    await adapter.setup(setup);
    await httpPost('/api/rooms/lobby/threads/thread_abc/messages', { text: '@sarah first' });
    await flushAgentDeliveries();
    await httpPost('/api/rooms/lobby/threads/thread_abc/messages', { text: '@diego second' });
    await flushAgentDeliveries();

    const { status } = await httpDelete('/api/rooms/lobby/threads/thread_abc/engaged/sarah');
    expect(status).toBe(200);
    captures.length = 0;

    await adapter.deliver('lobby', 'thread_abc', {
      kind: 'chat',
      content: { text: 'Late reply from Sarah', senderName: 'Sarah', senderFolder: 'sarah' },
    });
    await flushAgentDeliveries();

    const peer = captures.find(
      (c) =>
        c.message.id.startsWith('web-peer-') &&
        (c.message.content as { webchatReceiver?: string }).webchatReceiver === 'diego',
    );
    expect(peer).toBeDefined();
    expect((peer!.message.content as { text: string }).text).toBe('Late reply from Sarah');
  });

  it('does not repeat backfill when agent is already engaged', async () => {
    await adapter.setup(setup);
    await httpPost('/api/rooms/lobby/threads/thread_abc/messages', { text: '@sarah hello' });
    await flushAgentDeliveries();
    captures.length = 0;

    await httpPost('/api/rooms/lobby/threads/thread_abc/messages', { text: '@sarah again' });
    await flushAgentDeliveries();

    const stubs = captures.filter((c) => c.message.id.includes('backfill-stub'));
    expect(stubs).toHaveLength(0);
  });

  it('fans out agent peer replies to other engaged agents', async () => {
    await adapter.setup(setup);
    await httpPost('/api/rooms/lobby/threads/thread_abc/messages', { text: '@sarah first' });
    await flushAgentDeliveries();
    await httpPost('/api/rooms/lobby/threads/thread_abc/messages', { text: '@diego second' });
    await flushAgentDeliveries();
    captures.length = 0;

    await adapter.deliver('lobby', 'thread_abc', {
      kind: 'chat',
      content: { text: 'Peer reply from Diego', senderName: 'Diego', senderFolder: 'diego' },
    });
    await flushAgentDeliveries();

    expect(captures.length).toBeGreaterThanOrEqual(1);
    const peer = captures.find((c) => c.message.id.startsWith('web-peer-'));
    expect(peer).toBeDefined();
    expect(peer!.message.content).toMatchObject({
      routing: { isPeerReply: true, responseExpectation: 'defer' },
      senderId: 'web:local',
      sender: 'Diego',
    });
  });

  it('returns 401 for API requests without Bearer token', async () => {
    await adapter.setup(setup);
    const { status } = await httpGetText('/api/rooms/lobby/threads/main/messages', testPort);
    expect(status).toBe(401);
  });

  it('returns bootstrap payload from GET /api/bootstrap', async () => {
    await adapter.setup(setup);
    const { status, body } = await httpGet('/api/bootstrap');
    expect(status).toBe(200);
    expect(body).toMatchObject({
      user: { id: 'web:local', displayName: 'Local' },
      rooms: expect.any(Array),
      agents: expect.any(Array),
    });
  });

  it('returns 426 for GET /api/ws', async () => {
    await adapter.setup(setup);
    const { status } = await httpGetText('/api/ws?token=' + SECRET, testPort);
    expect(status).toBe(426);
  });

  it('broadcasts typing events via setTyping', async () => {
    await adapter.setup(setup);
    const received: unknown[] = [];
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${testPort}/api/ws?token=${SECRET}`);
      ws.on('open', async () => {
        await adapter.setTyping!('lobby', 'thread_abc');
      });
      ws.on('message', (data) => {
        received.push(JSON.parse(data.toString()));
        ws.close();
        resolve();
      });
      ws.on('error', reject);
    });
    expect(received[0]).toMatchObject({ type: 'typing', platformId: 'lobby', threadId: 'thread_abc' });
  });

  it('serves static assets with correct Content-Type', async () => {
    const assetDir = '/tmp/nanoclaw-webchat-test-assets';
    fs.writeFileSync(path.join(assetDir, 'app.js'), 'console.log("x")');
    fs.writeFileSync(path.join(assetDir, 'styles.css'), 'body {}');
    await adapter.setup(setup);
    const js = await httpGetText('/app.js', testPort);
    const css = await httpGetText('/styles.css', testPort);
    expect(js.status).toBe(200);
    expect(js.body).toContain('console.log');
    expect(css.status).toBe(200);
    expect(css.body).toContain('body');
  });

  it('replaces existing webchat-token meta on second index serve', async () => {
    const assetDir = '/tmp/nanoclaw-webchat-test-assets';
    fs.writeFileSync(
      path.join(assetDir, 'index.html'),
      '<!doctype html><html><head><meta name="webchat-token" content="old" /></head><body></body></html>',
    );
    await adapter.setup(setup);
    const first = await httpGetText('/', testPort);
    const second = await httpGetText('/', testPort);
    expect(first.body).toContain(`content="${SECRET}"`);
    expect(second.body).not.toContain('content="old"');
  });

  it('returns undefined from deliver() when content is empty', async () => {
    await adapter.setup(setup);
    const id = await adapter.deliver('lobby', 'thread_abc', { kind: 'chat', content: { text: '   ' } });
    expect(id).toBeUndefined();
  });

  it('skips oversize outbound file attachments', async () => {
    await adapter.setup(setup);
    const huge = Buffer.alloc(6 * 1024 * 1024);
    await adapter.deliver('lobby', 'thread_abc', {
      kind: 'chat',
      content: { text: 'see attached' },
      files: [{ filename: 'big.bin', data: huge }],
    });
    const { body } = await httpGet('/api/rooms/lobby/threads/thread_abc/messages');
    const msg = (body as { messages: Array<{ attachments?: unknown[] }> }).messages.at(-1);
    expect(msg?.attachments ?? []).toHaveLength(0);
  });

  it('continues when routeInbound throws', async () => {
    routeInboundMock.mockRejectedValueOnce(new Error('router down'));
    await adapter.setup(setup);
    const status = await httpPost('/api/rooms/lobby/threads/thread_abc/messages', { text: '@sarah hello' });
    expect(status).toBe(200);
    await flushAgentDeliveries();
  });

  it('filters GET messages with since query', async () => {
    await adapter.setup(setup);
    await httpPost('/api/rooms/lobby/threads/main/messages', { text: 'first' });
    const { body: firstBody } = await httpGet('/api/rooms/lobby/threads/main/messages');
    const firstTs = (firstBody as { messages: Array<{ timestamp: number }> }).messages[0]!.timestamp;
    await httpPost('/api/rooms/lobby/threads/main/messages', { text: 'second' });
    const { status, body } = await httpGet(`/api/rooms/lobby/threads/main/messages?since=${firstTs}`);
    expect(status).toBe(200);
    expect((body as { messages: Array<{ text: string }> }).messages.map((m) => m.text)).toEqual(['second']);
  });

  it('returns empty engagedAgents for DM rooms', async () => {
    await adapter.setup(setup);
    const { status, body } = await httpGet('/api/rooms/dm%3Asarah/threads/main/messages');
    expect(status).toBe(200);
    expect((body as { engagedAgents: string[] }).engagedAgents).toEqual([]);
  });

  it('returns 400 when removing engaged agent from non-lobby room', async () => {
    await adapter.setup(setup);
    const { status } = await httpDelete('/api/rooms/dm%3Asarah/threads/main/engaged/sarah');
    expect(status).toBe(400);
  });

  it('returns 400 when deleting main thread', async () => {
    await adapter.setup(setup);
    const { status } = await httpDelete('/api/rooms/lobby/threads/main');
    expect(status).toBe(400);
  });

  it('returns 404 for unknown attachment', async () => {
    await adapter.setup(setup);
    const { status } = await httpGet(`/api/attachments/missing/file.png?token=${SECRET}`);
    expect(status).toBe(404);
  });

  it('returns 400 for invalid JSON on POST message', async () => {
    await adapter.setup(setup);
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: testPort,
          path: '/api/rooms/lobby/threads/main/messages',
          method: 'POST',
          headers: { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json', Connection: 'close' },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode ?? 0));
        },
      );
      req.on('error', reject);
      req.write('{bad json');
      req.end();
    });
    expect(status).toBe(400);
  });

  it('returns 400 when attachments is not an array', async () => {
    await adapter.setup(setup);
    const status = await httpPost('/api/rooms/lobby/threads/main/messages', { attachments: 'nope' });
    expect(status).toBe(400);
  });

  it('returns 400 for too many attachments', async () => {
    await adapter.setup(setup);
    const attachments = Array.from({ length: 11 }, (_, i) => ({
      name: `f${i}.png`,
      mimeType: 'image/png',
      data: PNG_BASE64,
    }));
    const status = await httpPost('/api/rooms/lobby/threads/main/messages', { text: 'x', attachments });
    expect(status).toBe(400);
  });

  it('accepts multipart upload and message with uploadId reference', async () => {
    await adapter.setup(setup);
    const fileBytes = Buffer.from('uploaded-image-bytes');
    const upload = await httpMultipartUpload(
      '/api/rooms/lobby/threads/main/uploads',
      'photo.png',
      fileBytes,
    );
    expect(upload.status).toBe(200);
    expect(upload.body.uploadId).toBeTruthy();

    const post = await httpPostJson('/api/rooms/lobby/threads/main/messages', {
      text: 'see attached',
      attachments: [
        {
          uploadId: upload.body.uploadId,
          name: 'photo.png',
          mimeType: 'image/png',
          type: 'image',
          size: fileBytes.length,
        },
      ],
    });
    expect(post.status).toBe(200);
    expect(post.body.messageId).toBeTruthy();
    expect(
      (post.body.attachments as Array<{ url?: string; name: string }> | undefined)?.[0]?.url,
    ).toMatch(/^\/api\/attachments\//);

    const { body } = await httpGet('/api/rooms/lobby/threads/main/messages');
    const messages = (body as { messages: Array<{ attachments?: Array<{ url?: string; name: string }> }> }).messages;
    const last = messages.at(-1);
    expect(last?.attachments?.[0]?.name).toBe('photo.png');
    expect(last?.attachments?.[0]?.url).toMatch(/^\/api\/attachments\//);
  });

  it('posts a message referencing a staged upload', async () => {
    await adapter.setup(setup);
    const fileBytes = Buffer.from('hello-upload');
    const upload = await httpMultipartUpload(
      '/api/rooms/lobby/threads/main/uploads',
      'note.txt',
      fileBytes,
    );
    expect(upload.status).toBe(200);

    const status = await httpPost('/api/rooms/lobby/threads/main/messages', {
      text: 'uploaded',
      attachments: [
        {
          uploadId: upload.body.uploadId,
          name: 'note.txt',
          mimeType: 'application/octet-stream',
          type: 'file',
          size: fileBytes.length,
        },
      ],
    });
    expect(status).toBe(200);
    const { body } = await httpGet('/api/rooms/lobby/threads/main/messages');
    const messages = (body as { messages: Array<{ text: string; attachments?: Array<{ name: string }> }> }).messages;
    expect(messages.at(-1)?.text).toBe('uploaded');
    expect(messages.at(-1)?.attachments?.[0]?.name).toBe('note.txt');
  });

  it('accepts chunked upload and rejects invalid uploadId on message post', async () => {
    await adapter.setup(setup);
    const uploadId = '550e8400-e29b-41d4-a716-446655440000';
    const chunkData = Buffer.from('chunk-bytes').toString('base64');
    const chunk = await httpPostJson('/api/rooms/lobby/threads/main/uploads/chunk', {
      uploadId,
      chunkIndex: 0,
      totalChunks: 1,
      filename: 'doc.txt',
      mimeType: 'text/plain',
      data: chunkData,
    });
    expect(chunk.status).toBe(200);
    expect(chunk.body.uploadId).toBe(uploadId);

    const badRef = await httpPost('/api/rooms/lobby/threads/main/messages', {
      text: 'missing upload',
      attachments: [
        {
          uploadId,
          name: 'doc.txt',
          mimeType: 'text/plain',
          type: 'file',
          size: 999,
        },
      ],
    });
    expect(badRef).toBe(400);
  });

  it('reports chunk upload progress before the final chunk', async () => {
    await adapter.setup(setup);
    const uploadId = '550e8400-e29b-41d4-a716-446655440002';
    const first = await httpPostJson('/api/rooms/lobby/threads/main/uploads/chunk', {
      uploadId,
      chunkIndex: 0,
      totalChunks: 2,
      filename: 'two.bin',
      mimeType: 'application/octet-stream',
      data: Buffer.from('aa').toString('base64'),
    });
    expect(first.status).toBe(200);
    expect(first.body.ok).toBe(true);
    expect(first.body.received).toBe(1);

    const second = await httpPostJson('/api/rooms/lobby/threads/main/uploads/chunk', {
      uploadId,
      chunkIndex: 1,
      totalChunks: 2,
      filename: 'two.bin',
      mimeType: 'application/octet-stream',
      data: Buffer.from('bb').toString('base64'),
    });
    expect(second.status).toBe(200);
    expect(second.body.uploadId).toBe(uploadId);
  });

  it('returns 400 for invalid chunk upload payloads', async () => {
    await adapter.setup(setup);
    const res = await httpPostJson('/api/rooms/lobby/threads/main/uploads/chunk', {
      uploadId: '550e8400-e29b-41d4-a716-446655440003',
      filename: 'bad.bin',
      data: Buffer.from('x').toString('base64'),
    });
    expect(res.status).toBe(400);
  });

  it('rejects upload references staged for a different thread', async () => {
    await adapter.setup(setup);
    const createRes = await new Promise<{ status: number; body: { id: string } }>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: testPort,
          path: '/api/rooms/lobby/threads',
          method: 'POST',
          headers: { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json', Connection: 'close' },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) }));
        },
      );
      req.on('error', reject);
      req.write(JSON.stringify({ title: 'Other' }));
      req.end();
    });
    expect(createRes.status).toBe(200);
    const threadId = createRes.body.id;
    const fileBytes = Buffer.from('thread-scoped');
    const upload = await httpMultipartUpload(
      `/api/rooms/lobby/threads/${threadId}/uploads`,
      'scoped.txt',
      fileBytes,
    );
    expect(upload.status).toBe(200);
    const status = await httpPost('/api/rooms/lobby/threads/main/messages', {
      text: 'wrong thread',
      attachments: [
        {
          uploadId: upload.body.uploadId,
          name: 'scoped.txt',
          mimeType: 'application/octet-stream',
          type: 'file',
          size: fileBytes.length,
        },
      ],
    });
    expect(status).toBe(400);
  });

  it('rejects upload references with mismatched metadata', async () => {
    await adapter.setup(setup);
    const fileBytes = Buffer.from('meta-check');
    const upload = await httpMultipartUpload(
      '/api/rooms/lobby/threads/main/uploads',
      'meta.txt',
      fileBytes,
    );
    expect(upload.status).toBe(200);
    const status = await httpPost('/api/rooms/lobby/threads/main/messages', {
      text: 'bad meta',
      attachments: [
        {
          uploadId: upload.body.uploadId,
          name: 'meta.txt',
          mimeType: 'application/octet-stream',
          type: 'file',
          size: fileBytes.length + 1,
        },
      ],
    });
    expect(status).toBe(400);
  });

  it('routes upload-referenced attachments without inline data when disk read fails', async () => {
    await adapter.setup(setup);
    const fileBytes = Buffer.from('route-me');
    const upload = await httpMultipartUpload(
      '/api/rooms/lobby/threads/thread_abc/uploads',
      'route.txt',
      fileBytes,
    );
    expect(upload.status).toBe(200);
    const originalRead = fs.readFileSync.bind(fs);
    vi.spyOn(fs, 'readFileSync').mockImplementation((filePath, ...args) => {
      if (typeof filePath === 'string' && filePath.includes(`${path.sep}webchat${path.sep}files${path.sep}`)) {
        throw new Error('disk read failed');
      }
      return originalRead(filePath, ...args) as ReturnType<typeof fs.readFileSync>;
    });
    captures.length = 0;
    const status = await httpPost('/api/rooms/lobby/threads/thread_abc/messages', {
      text: '@sarah see file',
      attachments: [
        {
          uploadId: upload.body.uploadId,
          name: 'route.txt',
          mimeType: 'application/octet-stream',
          type: 'file',
          size: fileBytes.length,
        },
      ],
    });
    expect(status).toBe(200);
    await flushAgentDeliveries();
    const liveCaptures = captures.filter((c) => c.message.id.includes('-route-'));
    expect(liveCaptures.length).toBeGreaterThan(0);
    const attachments = (liveCaptures[0]!.message.content as { attachments?: Array<{ data?: string; name: string }> })
      .attachments;
    expect(attachments?.[0]?.name).toBe('route.txt');
    expect(attachments?.[0]?.data).toBeUndefined();
  });

  it('routes large uploaded attachments without inline agent data', async () => {
    await adapter.setup(setup);
    const fileBytes = Buffer.alloc(5 * 1024 * 1024 + 1, 1);
    const upload = await httpMultipartUpload(
      '/api/rooms/lobby/threads/thread_abc/uploads',
      'big.bin',
      fileBytes,
    );
    expect(upload.status).toBe(200);
    captures.length = 0;
    const status = await httpPost('/api/rooms/lobby/threads/thread_abc/messages', {
      text: '@sarah big file',
      attachments: [
        {
          uploadId: upload.body.uploadId,
          name: 'big.bin',
          mimeType: 'application/octet-stream',
          type: 'file',
          size: fileBytes.length,
        },
      ],
    });
    expect(status).toBe(200);
    await flushAgentDeliveries();
    const live = captures.find((c) => c.message.id.includes('-route-'));
    expect(live).toBeDefined();
    const attachments = (live!.message.content as { attachments?: Array<{ data?: string; size: number }> })
      .attachments;
    expect(attachments?.[0]?.size).toBeGreaterThan(5 * 1024 * 1024);
    expect(attachments?.[0]?.data).toBeUndefined();
  });

  it('returns 500 when message history loading throws unexpectedly', async () => {
    await adapter.setup(setup);
    vi.spyOn(webchatStore, 'getMessages').mockImplementationOnce(() => {
      throw new Error('database unavailable');
    });
    const { status, body } = await httpGet('/api/rooms/lobby/threads/main/messages');
    expect(status).toBe(500);
    expect(body).toMatchObject({ error: 'Internal server error' });
  });

  it('returns 500 for malformed multipart uploads', async () => {
    await adapter.setup(setup);
    const boundary = '----BrokenBoundary';
    const body = Buffer.from('this is not valid multipart content');
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: testPort,
          path: '/api/rooms/lobby/threads/main/uploads',
          method: 'POST',
          agent: false,
          headers: {
            Authorization: `Bearer ${SECRET}`,
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': body.length,
            Connection: 'close',
          },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode ?? 0));
        },
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    });
    expect(status).toBe(500);
  });

  it('returns 400 for invalid chunk upload JSON', async () => {
    await adapter.setup(setup);
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: testPort,
          path: '/api/rooms/lobby/threads/main/uploads/chunk',
          method: 'POST',
          agent: false,
          headers: {
            Authorization: `Bearer ${SECRET}`,
            'Content-Type': 'application/json',
            Connection: 'close',
          },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode ?? 0));
        },
      );
      req.on('error', reject);
      req.write('{not json');
      req.end();
    });
    expect(status).toBe(400);
  });

  it('returns 400 for malformed uploadId in chunk upload', async () => {
    await adapter.setup(setup);
    const res = await httpPostJson('/api/rooms/lobby/threads/main/uploads/chunk', {
      uploadId: '../escape',
      chunkIndex: 0,
      totalChunks: 1,
      filename: 'x.bin',
      mimeType: 'application/octet-stream',
      data: Buffer.from('x').toString('base64'),
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid uploadId format');
  });

  it('returns 400 when chunk upload body is unreadable', async () => {
    await adapter.setup(setup);
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: testPort,
          path: '/api/rooms/lobby/threads/main/uploads/chunk',
          method: 'POST',
          agent: false,
          headers: {
            Authorization: `Bearer ${SECRET}`,
            'Content-Type': 'application/json',
            'Content-Length': 50,
            Connection: 'close',
          },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode ?? 0));
        },
      );
      req.on('error', reject);
      req.write('{"uploadId":"550e8400-e29b-41d4-a716-446655440006"');
      req.end();
    });
    expect(status).toBe(400);
  });

  it('returns 413 when chunk upload body exceeds limit', async () => {
    await adapter.setup(setup);
    const { CHUNK_SIZE } = await import('../webchat-uploads.js');
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: testPort,
          path: '/api/rooms/lobby/threads/main/uploads/chunk',
          method: 'POST',
          agent: false,
          headers: {
            Authorization: `Bearer ${SECRET}`,
            'Content-Type': 'application/json',
            'Content-Length': CHUNK_SIZE * 2 + 1,
            Connection: 'close',
          },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode ?? 0));
        },
      );
      req.on('error', reject);
      req.end('{}');
    });
    expect(status).toBe(413);
  });

  it('returns 500 and restores staged upload when attachment move fails', async () => {
    await adapter.setup(setup);
    const store = await import('../webchat-store.js');
    const fileBytes = Buffer.from('rollback-me');
    const upload = await httpMultipartUpload(
      '/api/rooms/lobby/threads/main/uploads',
      'rollback.txt',
      fileBytes,
    );
    expect(upload.status).toBe(200);
    const moveSpy = vi.spyOn(store, 'moveAttachmentIntoMessage').mockImplementation(() => {
      throw new Error('move failed');
    });
    const post = await httpPostJson('/api/rooms/lobby/threads/main/messages', {
      text: 'rollback',
      attachments: [
        {
          uploadId: upload.body.uploadId as string,
          name: 'rollback.txt',
          mimeType: 'application/octet-stream',
          type: 'file',
          size: fileBytes.length,
        },
      ],
    });
    moveSpy.mockRestore();
    expect(post.status).toBe(500);
    expect(post.body.error).toBe('attachment processing failed');

    const retry = await httpPostJson('/api/rooms/lobby/threads/main/messages', {
      text: 'retry',
      attachments: [
        {
          uploadId: upload.body.uploadId as string,
          name: 'rollback.txt',
          mimeType: 'application/octet-stream',
          type: 'file',
          size: fileBytes.length,
        },
      ],
    });
    expect(retry.status).toBe(200);
  });

  it('returns 404 for unknown API routes', async () => {
    await adapter.setup(setup);
    const { status } = await httpGet('/api/unknown');
    expect(status).toBe(404);
  });

  it('skips peer fan-out when sender folder cannot be resolved', async () => {
    await adapter.setup(setup);
    await httpPost('/api/rooms/lobby/threads/thread_abc/messages', { text: '@sarah first' });
    await flushAgentDeliveries();
    captures.length = 0;
    await adapter.deliver('lobby', 'thread_abc', {
      kind: 'chat',
      content: { text: 'Anonymous reply', senderName: 'Unknown Person' },
    });
    await flushAgentDeliveries();
    expect(captures.filter((c) => c.message.id.startsWith('web-peer-'))).toHaveLength(0);
  });

  it('skips peer fan-out when sender is the only engaged agent', async () => {
    await adapter.setup(setup);
    await httpPost('/api/rooms/lobby/threads/thread_abc/messages', { text: '@sarah solo' });
    await flushAgentDeliveries();
    captures.length = 0;
    await adapter.deliver('lobby', 'thread_abc', {
      kind: 'chat',
      content: { text: 'Solo reply', senderName: 'Sarah', senderFolder: 'sarah' },
    });
    await flushAgentDeliveries();
    expect(captures.filter((c) => c.message.id.startsWith('web-peer-'))).toHaveLength(0);
  });

  it('logs and continues when thread session cleanup fails', async () => {
    cleanupSessionsMock.mockImplementationOnce(() => {
      throw new Error('cleanup failed');
    });
    await adapter.setup(setup);
    const createRes = await new Promise<{ status: number; body: { id: string } }>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: testPort,
          path: '/api/rooms/lobby/threads',
          method: 'POST',
          headers: { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json', Connection: 'close' },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) }));
        },
      );
      req.on('error', reject);
      req.write(JSON.stringify({ title: 'Temp' }));
      req.end();
    });
    expect(createRes.status).toBe(200);
    const { status } = await httpDelete(`/api/rooms/lobby/threads/${createRes.body.id}`);
    expect(status).toBe(200);
  });

  it('replays outbound agent messages during backfill', async () => {
    await adapter.setup(setup);
    await httpPost('/api/rooms/lobby/threads/thread_abc/messages', { text: 'user msg' });
    await adapter.deliver('lobby', 'thread_abc', {
      kind: 'chat',
      content: { text: 'Agent reply', senderName: 'Sarah', senderFolder: 'sarah' },
    });
    captures.length = 0;
    await httpPost('/api/rooms/lobby/threads/thread_abc/messages', { text: '@diego join' });
    await flushAgentDeliveries();
    const replay = captures.find(
      (c) =>
        c.message.id.includes('backfill-replay') &&
        (c.message.content as { text?: string }).text === 'Agent reply',
    );
    expect(replay).toBeDefined();
    expect(replay!.message.content).toMatchObject({
      historicalReplay: true,
      senderFolder: 'sarah',
    });
  });

  it('rejects WebSocket upgrade on wrong path', async () => {
    await adapter.setup(setup);
    await expect(
      new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${testPort}/wrong?token=${SECRET}`);
        ws.on('open', () => reject(new Error('should not open')));
        ws.on('error', () => resolve());
        ws.on('close', () => resolve());
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects WebSocket upgrade without auth token', async () => {
    await adapter.setup(setup);
    await expect(
      new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${testPort}/api/ws`);
        ws.on('open', () => reject(new Error('should not open')));
        ws.on('error', () => resolve());
        ws.on('close', () => resolve());
      }),
    ).resolves.toBeUndefined();
  });

  it('serves svg and json assets with specialized mime types', async () => {
    const assetDir = '/tmp/nanoclaw-webchat-test-assets';
    fs.writeFileSync(path.join(assetDir, 'icon.svg'), '<svg></svg>');
    fs.writeFileSync(path.join(assetDir, 'data.json'), '{}');
    await adapter.setup(setup);
    const svg = await httpGetText('/icon.svg', testPort);
    const json = await httpGetText('/data.json', testPort);
    expect(svg.status).toBe(200);
    expect(json.status).toBe(200);
  });

  it('returns 400 for attachment size out of range', async () => {
    await adapter.setup(setup);
    const huge = Buffer.alloc(6 * 1024 * 1024).toString('base64');
    const status = await httpPost('/api/rooms/lobby/threads/main/messages', {
      text: 'bad',
      attachments: [{ name: 'big.bin', mimeType: 'application/octet-stream', data: huge }],
    });
    expect(status).toBe(400);
  });

  it('returns 400 for non-object attachment entries', async () => {
    await adapter.setup(setup);
    const status = await httpPost('/api/rooms/lobby/threads/main/messages', {
      text: 'bad',
      attachments: ['nope'],
    });
    expect(status).toBe(400);
  });

  it('returns 400 when patching thread with empty title', async () => {
    await adapter.setup(setup);
    const createRes = await new Promise<{ status: number; body: { id: string } }>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: testPort,
          path: '/api/rooms/lobby/threads',
          method: 'POST',
          headers: { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json', Connection: 'close' },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) }));
        },
      );
      req.on('error', reject);
      req.write(JSON.stringify({ title: 'Topic' }));
      req.end();
    });
    const patchStatus = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: testPort,
          path: `/api/rooms/lobby/threads/${createRes.body.id}`,
          method: 'PATCH',
          headers: { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json', Connection: 'close' },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode ?? 0));
        },
      );
      req.on('error', reject);
      req.write(JSON.stringify({ title: '   ' }));
      req.end();
    });
    expect(patchStatus).toBe(400);
  });

  it('serves index.html for static directory requests', async () => {
    const assetDir = '/tmp/nanoclaw-webchat-test-assets';
    fs.mkdirSync(path.join(assetDir, 'assets'), { recursive: true });
    await adapter.setup(setup);
    const { status, body } = await httpGetText('/assets/', testPort);
    expect(status).toBe(200);
    expect(body).toContain('webchat-token');
  });

  it('leaves index.html unchanged when no head tag exists', async () => {
    const assetDir = '/tmp/nanoclaw-webchat-test-assets';
    fs.writeFileSync(path.join(assetDir, 'index.html'), '<html><body>app</body></html>');
    await adapter.setup(setup);
    const { body } = await httpGetText('/', testPort);
    expect(body).toBe('<html><body>app</body></html>');
  });

  it('recovers agent delivery chain after routeInbound failure', async () => {
    routeInboundMock.mockRejectedValueOnce(new Error('first fail'));
    await adapter.setup(setup);
    await httpPost('/api/rooms/lobby/threads/thread_abc/messages', { text: '@sarah @diego pair' });
    await flushAgentDeliveries();
    expect(routeInboundMock.mock.calls.length).toBeGreaterThan(1);
  });

  it('fails setup when nanoclaw-webchat assets are unavailable', async () => {
    getAssetDirMock.mockImplementationOnce(() => {
      throw new Error('missing package');
    });
    await expect(adapter.setup(setup)).rejects.toThrow('missing package');
  });

  it('serves attachment bytes from GET /api/attachments', async () => {
    await adapter.setup(setup);
    await httpPost('/api/rooms/lobby/threads/thread_abc/messages', {
      text: 'pic',
      attachments: [{ name: 'photo.png', mimeType: 'image/png', type: 'image', data: PNG_BASE64 }],
    });
    const msgs = (await httpGet('/api/rooms/lobby/threads/thread_abc/messages')).body as {
      messages: Array<{ attachments?: Array<{ url: string }> }>;
    };
    const url = msgs.messages[0]!.attachments![0]!.url;
    const { status, body } = await httpGet(url, testPort);
    expect(status).toBe(200);
    expect(String(body).length).toBeGreaterThan(0);
  });

  it('serves attachment bytes when auth is only a query token', async () => {
    await adapter.setup(setup);
    await httpPost('/api/rooms/lobby/threads/thread_abc/messages', {
      text: 'pic',
      attachments: [{ name: 'photo.png', mimeType: 'image/png', type: 'image', data: PNG_BASE64 }],
    });
    const msgs = (await httpGet('/api/rooms/lobby/threads/thread_abc/messages')).body as {
      messages: Array<{ attachments?: Array<{ url: string }> }>;
    };
    const path = `${msgs.messages[0]!.attachments![0]!.url}?token=${SECRET}`;
    const { status, body } = await httpGetText(path, testPort);
    expect(status).toBe(200);
    expect(String(body).length).toBeGreaterThan(0);
  });

  it('returns 401 for attachment GET without auth', async () => {
    await adapter.setup(setup);
    const { status } = await httpGetText('/api/attachments/missing/file.png', testPort);
    expect(status).toBe(401);
  });

  it('deliver extracts text from object content', async () => {
    await adapter.setup(setup);
    await adapter.deliver('lobby', 'thread_abc', {
      kind: 'chat',
      content: { text: 'Object text' },
    });
    const { body } = await httpGet('/api/rooms/lobby/threads/thread_abc/messages');
    expect((body as { messages: Array<{ text: string }> }).messages.at(-1)?.text).toBe('Object text');
  });

  it('returns 500 when message history handler throws', async () => {
    await adapter.setup(setup);
    const getMessagesSpy = vi.spyOn(webchatStore, 'getMessages').mockImplementation(() => {
      throw new Error('db exploded');
    });
    try {
      const { status } = await httpGet('/api/rooms/lobby/threads/main/messages');
      expect(status).toBe(500);
    } finally {
      getMessagesSpy.mockRestore();
    }
  });

  it('returns 404 when static asset and index.html are missing', async () => {
    fs.rmSync(path.join('/tmp/nanoclaw-webchat-test-assets', 'index.html'));
    await adapter.setup(setup);
    const { status } = await httpGetText('/missing.js', testPort);
    expect(status).toBe(404);
  });

  it('returns 400 when POST body exceeds max size via content-length', async () => {
    await adapter.setup(setup);
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: testPort,
          path: '/api/rooms/lobby/threads/main/messages',
          method: 'POST',
          headers: {
            Authorization: `Bearer ${SECRET}`,
            'Content-Type': 'application/json',
            'Content-Length': String(21 * 1024 * 1024),
            Connection: 'close',
          },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode ?? 0));
        },
      );
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(400);
  });

  it('returns 400 when POST has neither text nor attachments', async () => {
    await adapter.setup(setup);
    const status = await httpPost('/api/rooms/lobby/threads/main/messages', { text: '   ' });
    expect(status).toBe(400);
  });

  it('returns 400 when creating thread with invalid JSON', async () => {
    await adapter.setup(setup);
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: testPort,
          path: '/api/rooms/lobby/threads',
          method: 'POST',
          headers: { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json', Connection: 'close' },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode ?? 0));
        },
      );
      req.on('error', reject);
      req.write('{bad');
      req.end();
    });
    expect(status).toBe(400);
  });

  it('returns 400 when patching thread with invalid JSON', async () => {
    await adapter.setup(setup);
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: testPort,
          path: '/api/rooms/lobby/threads/thread_abc',
          method: 'PATCH',
          headers: { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json', Connection: 'close' },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode ?? 0));
        },
      );
      req.on('error', reject);
      req.write('{bad');
      req.end();
    });
    expect(status).toBe(400);
  });

  it('returns 400 when patching thread with non-string title', async () => {
    await adapter.setup(setup);
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: testPort,
          path: '/api/rooms/lobby/threads/thread_abc',
          method: 'PATCH',
          headers: { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json', Connection: 'close' },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode ?? 0));
        },
      );
      req.on('error', reject);
      req.write(JSON.stringify({ title: 123 }));
      req.end();
    });
    expect(status).toBe(400);
  });

  it('calls session cleanup when deleting a thread with a messaging group', async () => {
    await adapter.setup(setup);
    const createRes = await new Promise<{ status: number; body: { id: string } }>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: testPort,
          path: '/api/rooms/lobby/threads',
          method: 'POST',
          headers: { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json', Connection: 'close' },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) }));
        },
      );
      req.on('error', reject);
      req.write(JSON.stringify({ title: 'Temp' }));
      req.end();
    });
    expect(createRes.status).toBe(200);
    cleanupSessionsMock.mockClear();
    const { status } = await httpDelete(`/api/rooms/lobby/threads/${createRes.body.id}`);
    expect(status).toBe(200);
    expect(cleanupSessionsMock).toHaveBeenCalledWith('mg-lobby', createRes.body.id);
  });

  it('skips backfill when agent already received history', async () => {
    await adapter.setup(setup);
    const skipSpy = vi.spyOn(webchatStore, 'hasBackfillDelivered').mockReturnValue(true);
    captures.length = 0;
    try {
      await httpPost('/api/rooms/lobby/threads/thread_abc/messages', { text: '@diego join' });
      await flushAgentDeliveries();
      expect(captures.some((c) => c.message.id.includes('backfill-stub'))).toBe(false);
    } finally {
      skipSpy.mockRestore();
    }
  });

  it('fans out peer replies using senderFolder from deliver content', async () => {
    await adapter.setup(setup);
    await httpPost('/api/rooms/lobby/threads/thread_abc/messages', { text: '@sarah @diego sync' });
    await flushAgentDeliveries();
    captures.length = 0;
    await adapter.deliver('lobby', 'thread_abc', {
      kind: 'chat',
      content: { text: 'Sarah reply', senderFolder: 'sarah' },
    });
    await flushAgentDeliveries();
    expect(captures.some((c) => c.message.id.startsWith('web-peer-'))).toBe(true);
  });

  it('deliver omits senderName when content has no name', async () => {
    await adapter.setup(setup);
    await adapter.deliver('lobby', 'thread_abc', {
      kind: 'chat',
      content: { text: 'Plain outbound' },
    });
    const { body } = await httpGet('/api/rooms/lobby/threads/thread_abc/messages');
    const msg = (body as { messages: Array<{ senderName?: string }> }).messages.at(-1);
    expect(msg?.senderName).toBeUndefined();
  });

  it('deliver returns undefined for non-text object content', async () => {
    await adapter.setup(setup);
    const id = await adapter.deliver('lobby', 'thread_abc', { kind: 'chat', content: { body: 'nope' } });
    expect(id).toBeUndefined();
  });

  it('infers mime type from filename when attachment mimeType is blank', async () => {
    await adapter.setup(setup);
    const status = await httpPost('/api/rooms/lobby/threads/main/messages', {
      text: '@sarah',
      attachments: [{ name: 'photo.webp', mimeType: '', data: PNG_BASE64 }],
    });
    expect(status).toBe(200);
  });

  it('serves woff2 and htm assets with specialized mime types', async () => {
    const assetDir = '/tmp/nanoclaw-webchat-test-assets';
    fs.writeFileSync(path.join(assetDir, 'font.woff2'), Buffer.from('font'));
    fs.writeFileSync(path.join(assetDir, 'legacy.htm'), '<html></html>');
    await adapter.setup(setup);
    const woff = await httpGetText('/font.woff2', testPort);
    const htm = await httpGetText('/legacy.htm', testPort);
    expect(woff.status).toBe(200);
    expect(htm.status).toBe(200);
  });

  it('serves unknown extension assets as octet-stream', async () => {
    const assetDir = '/tmp/nanoclaw-webchat-test-assets';
    fs.writeFileSync(path.join(assetDir, 'blob.xyz'), 'data');
    await adapter.setup(setup);
    const { status } = await httpGetText('/blob.xyz', testPort);
    expect(status).toBe(200);
  });

  it('setTyping broadcasts on main thread when threadId is null', async () => {
    await adapter.setup(setup);
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${testPort}/api/ws?token=${SECRET}`);
      ws.on('open', async () => {
        await adapter.setTyping!('lobby', null);
      });
      ws.on('message', (data) => {
        const event = JSON.parse(data.toString()) as { type: string; threadId: string };
        if (event.type === 'typing') {
          expect(event.threadId).toBe('main');
          ws.close();
          resolve();
        }
      });
      ws.on('error', reject);
    });
  });

  it('returns 400 when POST body stream exceeds max size', async () => {
    await adapter.setup(setup);
    const status = await new Promise<number>((resolve) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: testPort,
          path: '/api/rooms/lobby/threads/main/messages',
          method: 'POST',
          headers: {
            Authorization: `Bearer ${SECRET}`,
            'Content-Type': 'application/json',
            Connection: 'close',
          },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode ?? 0));
        },
      );
      req.on('error', () => resolve(400));
      req.write('{"text":"');
      req.write('x'.repeat(21 * 1024 * 1024));
      req.write('"}');
      req.end();
    });
    expect(status).toBe(400);
  });

  it('returns 400 when patch body read fails', async () => {
    await adapter.setup(setup);
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: testPort,
          path: '/api/rooms/lobby/threads/thread_abc',
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${SECRET}`,
            'Content-Type': 'application/json',
            'Content-Length': String(21 * 1024 * 1024),
            Connection: 'close',
          },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode ?? 0));
        },
      );
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(400);
  });

  it('creates thread with default title when body is empty', async () => {
    await adapter.setup(setup);
    const createRes = await new Promise<{ status: number; body: { title: string } }>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: testPort,
          path: '/api/rooms/lobby/threads',
          method: 'POST',
          headers: { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json', Connection: 'close' },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) }));
        },
      );
      req.on('error', reject);
      req.end();
    });
    expect(createRes.status).toBe(200);
    expect(createRes.body.title).toBe('Thread');
  });

  it('deliver accepts plain string content', async () => {
    await adapter.setup(setup);
    await adapter.deliver('lobby', 'thread_abc', { kind: 'chat', content: 'String body' });
    const { body } = await httpGet('/api/rooms/lobby/threads/thread_abc/messages');
    expect((body as { messages: Array<{ text: string }> }).messages.at(-1)?.text).toBe('String body');
  });

  it('replays history attachments with embedded data during backfill', async () => {
    await adapter.setup(setup);
    await httpPost('/api/rooms/lobby/threads/thread_abc/messages', {
      text: '@sarah look',
      attachments: [{ name: 'photo.png', mimeType: 'image/png', type: 'image', data: PNG_BASE64 }],
    });
    await flushAgentDeliveries();
    captures.length = 0;
    await httpPost('/api/rooms/lobby/threads/thread_abc/messages', { text: '@diego join' });
    await flushAgentDeliveries();
    const replay = captures.find(
      (c) =>
        c.message.id.includes('backfill-replay') &&
        (c.message.content as { text?: string }).text?.includes('look'),
    );
    expect(replay).toBeDefined();
    const att = (replay!.message.content as { attachments: Array<{ data?: string }> }).attachments![0]!;
    expect(att.data).toBe(PNG_BASE64);
  });

  it('replays history attachments without inline data when disk read fails', async () => {
    await adapter.setup(setup);
    await httpPost('/api/rooms/lobby/threads/thread_abc/messages', {
      text: '@sarah look',
      attachments: [{ name: 'photo.png', mimeType: 'image/png', type: 'image', data: PNG_BASE64 }],
    });
    await flushAgentDeliveries();
    const originalRead = fs.readFileSync.bind(fs);
    const readSpy = vi.spyOn(fs, 'readFileSync').mockImplementation((filePath, ...args) => {
      if (typeof filePath === 'string' && filePath.includes('/webchat/')) {
        throw new Error('read failed');
      }
      return originalRead(filePath, ...args);
    });
    captures.length = 0;
    try {
      await httpPost('/api/rooms/lobby/threads/thread_abc/messages', { text: '@diego join' });
      await flushAgentDeliveries();
      const replay = captures.find(
        (c) =>
          c.message.id.includes('backfill-replay') &&
          (c.message.content as { text?: string }).text?.includes('look'),
      );
      expect(replay).toBeDefined();
      const att = (replay!.message.content as { attachments: Array<{ data?: string; name: string }> }).attachments![0]!;
      expect(att.name).toBe('photo.png');
      expect(att.data).toBeUndefined();
    } finally {
      readSpy.mockRestore();
    }
  });

  it('deliver includes senderName when provided in content', async () => {
    await adapter.setup(setup);
    await adapter.deliver('lobby', 'thread_abc', {
      kind: 'chat',
      content: { text: 'Named reply', senderName: 'Sarah' },
    });
    const { body } = await httpGet('/api/rooms/lobby/threads/thread_abc/messages');
    expect((body as { messages: Array<{ senderName?: string }> }).messages.at(-1)?.senderName).toBe('Sarah');
  });

  it('returns 400 when attachment base64 decoding fails', async () => {
    await adapter.setup(setup);
    const origFrom = Buffer.from.bind(Buffer);
    // Only intercept base64 decodes in validateInboundAttachments, not other Buffer.from callers.
    const fromSpy = vi.spyOn(Buffer, 'from').mockImplementation(((
      ...args: unknown[]
    ) => {
      if (args[1] === 'base64') throw new Error('invalid base64');
      return (origFrom as (...a: unknown[]) => Buffer)(...args);
    }) as typeof Buffer.from);
    try {
      const status = await httpPost('/api/rooms/lobby/threads/main/messages', {
        text: '@sarah',
        attachments: [{ name: 'photo.png', mimeType: 'image/png', data: PNG_BASE64 }],
      });
      expect(status).toBe(400);
    } finally {
      fromSpy.mockRestore();
    }
  });

  it('serves standalone html assets with html mime type', async () => {
    const assetDir = '/tmp/nanoclaw-webchat-test-assets';
    fs.writeFileSync(path.join(assetDir, 'about.html'), '<html><body>about</body></html>');
    await adapter.setup(setup);
    const { status, body } = await httpGetText('/about.html', testPort);
    expect(status).toBe(200);
    expect(body).toContain('about');
  });

  it('infers octet-stream for unknown outbound attachment extensions', async () => {
    await adapter.setup(setup);
    await adapter.deliver('lobby', 'thread_abc', {
      kind: 'chat',
      content: { text: 'file' },
      files: [{ filename: 'archive.xyz', data: Buffer.from('data') }],
    });
    const { body } = await httpGet('/api/rooms/lobby/threads/thread_abc/messages');
    const msg = (body as { messages: Array<{ attachments?: Array<{ mimeType: string }> }> }).messages.at(-1);
    expect(msg?.attachments?.[0]?.mimeType).toBe('application/octet-stream');
  });

  it('deletes thread without session cleanup when messaging group is missing', async () => {
    getMessagingGroupMock.mockReturnValueOnce(undefined);
    await adapter.setup(setup);
    const createRes = await new Promise<{ status: number; body: { id: string } }>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: testPort,
          path: '/api/rooms/lobby/threads',
          method: 'POST',
          headers: { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json', Connection: 'close' },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) }));
        },
      );
      req.on('error', reject);
      req.write(JSON.stringify({ title: 'Orphan' }));
      req.end();
    });
    cleanupSessionsMock.mockClear();
    const { status } = await httpDelete(`/api/rooms/lobby/threads/${createRes.body.id}`);
    expect(status).toBe(200);
    expect(cleanupSessionsMock).not.toHaveBeenCalled();
  });

  it('peer fan-out includes senderName when provided without senderFolder', async () => {
    await adapter.setup(setup);
    await httpPost('/api/rooms/lobby/threads/thread_abc/messages', { text: '@sarah @diego sync' });
    await flushAgentDeliveries();
    captures.length = 0;
    await adapter.deliver('lobby', 'thread_abc', {
      kind: 'chat',
      content: { text: 'Sarah reply', senderName: 'Sarah' },
    });
    await flushAgentDeliveries();
    const peer = captures.find((c) => c.message.id.startsWith('web-peer-'));
    expect(peer).toBeDefined();
    expect(peer!.message.content).toMatchObject({ senderName: 'Sarah', senderFolder: 'sarah' });
  });

  it('deliver stores outbound files without text on non-lobby rooms', async () => {
    await adapter.setup(setup);
    const id = await adapter.deliver('dm:sarah', null, {
      kind: 'chat',
      content: { text: '   ' },
      files: [{ filename: 'note.txt', data: Buffer.from('hello') }],
    });
    expect(id).toBeDefined();
    const { body } = await httpGet('/api/rooms/dm%3Asarah/threads/main/messages');
    const msg = (body as { messages: Array<{ attachments?: unknown[] }> }).messages.at(-1);
    expect(msg?.attachments).toHaveLength(1);
  });

  it('deliver on lobby main thread uses main when threadId is null', async () => {
    await adapter.setup(setup);
    await httpPost('/api/rooms/lobby/threads/main/messages', { text: '@sarah @diego sync' });
    await flushAgentDeliveries();
    captures.length = 0;
    await adapter.deliver('lobby', null, {
      kind: 'chat',
      content: { text: 'Sarah reply', senderFolder: 'sarah' },
    });
    await flushAgentDeliveries();
    expect(captures.some((c) => c.message.id.startsWith('web-peer-'))).toBe(true);
  });

  it('returns 404 for unsupported methods on static paths', async () => {
    await adapter.setup(setup);
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: testPort,
          path: '/app.js',
          method: 'POST',
          headers: { Connection: 'close' },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode ?? 0));
        },
      );
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(404);
  });

  it('returns 404 for unsupported methods on message routes', async () => {
    await adapter.setup(setup);
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: testPort,
          path: '/api/rooms/lobby/threads/main/messages',
          method: 'PUT',
          headers: { Authorization: `Bearer ${SECRET}`, Connection: 'close' },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode ?? 0));
        },
      );
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(404);
  });

  it('deliver returns undefined for null chat content', async () => {
    await adapter.setup(setup);
    const id = await adapter.deliver('lobby', 'thread_abc', { kind: 'chat', content: null as unknown as string });
    expect(id).toBeUndefined();
  });

  it('accepts inbound attachments with extension-based mime inference', async () => {
    await adapter.setup(setup);
    const status = await httpPost('/api/rooms/lobby/threads/main/messages', {
      text: '@sarah',
      attachments: [{ name: 'photo.jpg', mimeType: 'image/png', data: PNG_BASE64 }],
    });
    expect(status).toBe(200);
  });

  it('returns 401 when auth token is only provided as a query parameter', async () => {
    await adapter.setup(setup);
    const { status } = await httpGetText('/api/bootstrap?token=' + SECRET, testPort);
    expect(status).toBe(401);
  });

  it('returns 404 for GET on thread routes without a messages suffix', async () => {
    await adapter.setup(setup);
    const { status } = await httpGet('/api/rooms/lobby/threads/thread_abc');
    expect(status).toBe(404);
  });

  it('skips broadcast to WebSocket clients that are no longer open', async () => {
    await adapter.setup(setup);
    const ws = new WebSocket(`ws://127.0.0.1:${testPort}/api/ws?token=${SECRET}`);
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', reject);
    });
    ws.terminate();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const status = await httpPost('/api/rooms/lobby/threads/main/messages', { text: 'hello after terminate' });
    expect(status).toBe(200);
  });

  it('ignores blank senderName and senderFolder on deliver content', async () => {
    await adapter.setup(setup);
    await adapter.deliver('lobby', 'thread_abc', {
      kind: 'chat',
      content: { text: 'Named reply', senderName: '   ', senderFolder: '   ' },
    });
    const { body } = await httpGet('/api/rooms/lobby/threads/thread_abc/messages');
    const msg = (body as { messages: Array<{ senderName?: string }> }).messages.at(-1);
    expect(msg?.senderName).toBeUndefined();
  });

  it('returns 400 when attachment fields are not strings', async () => {
    await adapter.setup(setup);
    const status = await httpPost('/api/rooms/lobby/threads/main/messages', {
      text: 'x',
      attachments: [{ name: 123, mimeType: true, data: false }],
    });
    expect(status).toBe(400);
  });

  it('returns 404 for static assets when package asset dir is empty', async () => {
    getAssetDirMock.mockReturnValueOnce('');
    await adapter.setup(setup);
    const { status } = await httpGetText('/app.js', testPort);
    expect(status).toBe(404);
  });

  it('routes follow-ups for engaged folders missing from the current agent roster', async () => {
    await adapter.setup(setup);
    webchatStore.addEngagedAgents('lobby', 'thread_abc', ['orphan']);
    const groupsSpy = vi.spyOn(agentGroups, 'getAllAgentGroups').mockReturnValue([
      { id: 'ag-sarah', folder: 'sarah', name: 'Sarah', agent_provider: null, created_at: '2020-01-01' },
    ]);
    try {
      await httpPost('/api/rooms/lobby/threads/thread_abc/messages', { text: 'hello everyone' });
      await flushAgentDeliveries();
      expect(captures.some((c) => (c.message.content as { webchatReceiver?: string }).webchatReceiver === 'orphan')).toBe(
        true,
      );
    } finally {
      groupsSpy.mockRestore();
    }
  });

  it('uses Agent as sender when replaying outbound messages without senderName', async () => {
    await adapter.setup(setup);
    await httpPost('/api/rooms/lobby/threads/thread_abc/messages', { text: 'hi' });
    await adapter.deliver('lobby', 'thread_abc', { kind: 'chat', content: { text: 'Unnamed reply' } });
    captures.length = 0;
    await httpPost('/api/rooms/lobby/threads/thread_abc/messages', { text: '@diego join' });
    await flushAgentDeliveries();
    const replay = captures.find(
      (c) =>
        c.message.id.includes('backfill-replay') &&
        (c.message.content as { text?: string }).text === 'Unnamed reply',
    );
    expect(replay).toBeDefined();
    expect((replay!.message.content as { sender?: string }).sender).toBe('Agent');
  });

  it('omits threadMessageSeq from backfill replay when history rows lack thread_seq', async () => {
    await adapter.setup(setup);
    await httpPost('/api/rooms/lobby/threads/thread_abc/messages', { text: 'seed' });
    const recentSpy = vi.spyOn(webchatStore, 'getRecentMessages').mockReturnValueOnce([
      {
        id: 'legacy-msg',
        direction: 'inbound',
        text: 'legacy without seq',
        timestamp: Date.now(),
        platformId: 'lobby',
        threadId: 'thread_abc',
      },
    ]);
    try {
      captures.length = 0;
      await httpPost('/api/rooms/lobby/threads/thread_abc/messages', { text: '@diego join' });
      await flushAgentDeliveries();
      const replay = captures.find(
        (c) =>
          c.message.id.includes('backfill-replay') &&
          (c.message.content as { text?: string }).text === 'legacy without seq',
      );
      expect(replay).toBeDefined();
      expect((replay!.message.content as { threadMessageSeq?: number }).threadMessageSeq).toBeUndefined();
    } finally {
      recentSpy.mockRestore();
    }
  });

  it('omits threadMessageSeq from peer fan-out when stored message has no thread_seq', async () => {
    const origAppend = webchatStore.appendMessage;
    const appendSpy = vi.spyOn(webchatStore, 'appendMessage');
    await adapter.setup(setup);
    await httpPost('/api/rooms/lobby/threads/thread_abc/messages', { text: '@sarah @diego sync' });
    await flushAgentDeliveries();
    appendSpy.mockImplementation((msg) => {
      const stored = origAppend(msg);
      const { threadSeq: _seq, ...withoutSeq } = stored;
      return withoutSeq as typeof stored;
    });
    try {
      captures.length = 0;
      await adapter.deliver('lobby', 'thread_abc', {
        kind: 'chat',
        content: { text: 'Peer without seq', senderFolder: 'sarah' },
      });
      await flushAgentDeliveries();
      const peer = captures.find((c) => c.message.id.startsWith('web-peer-'));
      expect(peer).toBeDefined();
      expect((peer!.message.content as { threadMessageSeq?: number }).threadMessageSeq).toBeUndefined();
    } finally {
      appendSpy.mockRestore();
    }
  });

  it('retries agent delivery when backfill history load throws once', async () => {
    await adapter.setup(setup);
    await httpPost('/api/rooms/lobby/threads/thread_abc/messages', { text: '@sarah seed' });
    await flushAgentDeliveries();
    const recentSpy = vi.spyOn(webchatStore, 'getRecentMessages');
    recentSpy.mockImplementationOnce(() => {
      throw new Error('transient db');
    });
    try {
      captures.length = 0;
      await httpPost('/api/rooms/lobby/threads/thread_abc/messages', { text: '@diego join' });
      await flushAgentDeliveries();
      expect(captures.some((c) => c.message.id.includes('backfill-stub'))).toBe(true);
      expect(recentSpy.mock.calls.length).toBeGreaterThan(1);
    } finally {
      recentSpy.mockRestore();
    }
  });

  it('returns 403 when a static asset resolves outside the asset directory', async () => {
    const assetDir = '/tmp/nanoclaw-webchat-test-assets';
    fs.writeFileSync(path.join(assetDir, '403-probe.txt'), 'secret');
    const origResolve = path.resolve;
    const resolveSpy = vi.spyOn(path, 'resolve').mockImplementation((...args) => {
      const resolved = origResolve(...args);
      if (String(args[0]).endsWith('403-probe.txt')) return '/outside/403-probe.txt';
      return resolved;
    });
    try {
      await adapter.setup(setup);
      const { status } = await httpGetText('/403-probe.txt', testPort);
      expect(status).toBe(403);
    } finally {
      resolveSpy.mockRestore();
    }
  });

  it('returns 404 for non-GET requests to static routes', async () => {
    await adapter.setup(setup);
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: testPort,
          path: '/',
          method: 'POST',
          headers: { Connection: 'close' },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode ?? 0));
        },
      );
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(404);
  });

  it('counts string request body chunks toward the max body size', async () => {
    await adapter.setup(setup);
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: testPort,
          path: '/api/rooms/lobby/threads/main/messages',
          method: 'POST',
          headers: {
            Authorization: `Bearer ${SECRET}`,
            'Content-Type': 'application/json',
            Connection: 'close',
          },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode ?? 0));
        },
      );
      req.on('error', reject);
      req.write('{"text":"');
      req.write('x"}');
      req.end();
    });
    expect(status).toBe(200);
  });

  it('uses folder name in join stub when mentioned agent is absent from roster', async () => {
    const mentionSpy = vi.spyOn(webchatMentions, 'mentionedAgentFolders');
    try {
      await adapter.setup(setup);
      await httpPost('/api/rooms/lobby/threads/thread_abc/messages', { text: '@sarah first' });
      await flushAgentDeliveries();
      captures.length = 0;
      mentionSpy.mockReturnValue(['ghost']);
      await httpPost('/api/rooms/lobby/threads/thread_abc/messages', { text: '@ghost hello' });
      await flushAgentDeliveries();
      const sarahLive = captures.find(
        (c) =>
          c.message.id.includes('-route-') &&
          (c.message.content as { webchatReceiver?: string }).webchatReceiver === 'sarah',
      );
      expect(sarahLive).toBeDefined();
      expect((sarahLive!.message.content as { rosterStub?: string }).rosterStub).toBe('ghost has joined this thread.');
    } finally {
      mentionSpy.mockRestore();
    }
  });

  it('delivers ask_question cards with card metadata over WebSocket', async () => {
    await adapter.setup(setup);

    const received: unknown[] = [];
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${testPort}/api/ws?token=${SECRET}`);
      ws.on('open', async () => {
        await adapter.deliver('inbox', null, {
          kind: 'chat-sdk',
          content: {
            type: 'ask_question',
            questionId: 'approval-1',
            title: 'Install MCP server',
            question: 'Add memory server?',
            options: [
              { label: 'Approve', selectedLabel: '✅ Approved', value: 'approve' },
              { label: 'Reject', selectedLabel: '❌ Rejected', value: 'reject' },
            ],
          },
        });
      });
      ws.on('message', (data) => {
        received.push(JSON.parse(data.toString()));
        ws.close();
        resolve();
      });
      ws.on('error', reject);
    });

    expect(received[0]).toMatchObject({
      type: 'message',
      message: {
        platformId: 'inbox',
        threadId: 'main',
        direction: 'outbound',
        card: {
          type: 'ask_question',
          questionId: 'approval-1',
          title: 'Install MCP server',
          status: 'pending',
        },
      },
    });
  });

  it('POST actions invokes onAction and broadcasts message_update', async () => {
    await adapter.setup(setup);
    await adapter.deliver('inbox', null, {
      kind: 'chat-sdk',
      content: {
        type: 'ask_question',
        questionId: 'approval-2',
        title: 'Restart container',
        question: 'Allow restart?',
        options: [
          { label: 'Approve', value: 'approve' },
          { label: 'Reject', value: 'reject' },
        ],
      },
    });

    const events: unknown[] = [];
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${testPort}/api/ws?token=${SECRET}`);
      ws.on('open', () => {
        void httpPost('/api/rooms/inbox/threads/main/actions', {
          questionId: 'approval-2',
          value: 'approve',
        }).then((status) => {
          expect(status).toBe(200);
        });
      });
      ws.on('message', (data) => {
        events.push(JSON.parse(data.toString()));
        if (events.some((e) => (e as { type?: string }).type === 'message_update')) {
          ws.close();
          resolve();
        }
      });
      ws.on('error', reject);
    });

    expect(actionCaptures).toEqual([
      { questionId: 'approval-2', value: 'approve', userId: 'web:local' },
    ]);
    expect(events.some((e) => (e as { type?: string }).type === 'message_update')).toBe(true);
  });

  it('rejects duplicate action submissions with 409', async () => {
    await adapter.setup(setup);
    await adapter.deliver('inbox', null, {
      kind: 'chat-sdk',
      content: {
        type: 'ask_question',
        questionId: 'approval-dup',
        title: 'Duplicate test',
        question: 'Pick one',
        options: [{ label: 'Yes', value: 'yes' }],
      },
    });

    const first = await httpPost('/api/rooms/inbox/threads/main/actions', {
      questionId: 'approval-dup',
      value: 'yes',
    });
    expect(first).toBe(200);

    const second = await httpPost('/api/rooms/inbox/threads/main/actions', {
      questionId: 'approval-dup',
      value: 'yes',
    });
    expect(second).toBe(409);
  });

  it('openDM returns inbox platform id', async () => {
    await adapter.setup(setup);
    await expect(adapter.openDM!('web:local')).resolves.toBe('inbox');
  });

  it('POST actions returns 500 when onAction throws', async () => {
    setup = {
      ...setup,
      onAction() {
        throw new Error('handler failed');
      },
    };
    await adapter.setup(setup);
    await adapter.deliver('inbox', null, {
      kind: 'chat-sdk',
      content: {
        type: 'ask_question',
        questionId: 'approval-fail',
        title: 'Restart container',
        question: 'Allow restart?',
        options: [{ label: 'Approve', value: 'approve' }],
      },
    });

    const status = await httpPost('/api/rooms/inbox/threads/main/actions', {
      questionId: 'approval-fail',
      value: 'approve',
    });
    expect(status).toBe(500);

    const { body } = await httpGet('/api/rooms/inbox/threads/main/messages');
    const msg = (body as { messages: Array<{ card?: { status?: string } }> }).messages.at(-1);
    expect(msg?.card?.status).toBe('pending');
  });

  it('POST actions returns 409 when claim loses race before onAction', async () => {
    await adapter.setup(setup);
    await adapter.deliver('inbox', null, {
      kind: 'chat-sdk',
      content: {
        type: 'ask_question',
        questionId: 'approval-race-answered',
        title: 'Restart container',
        question: 'Allow restart?',
        options: [{ label: 'Approve', value: 'approve' }],
      },
    });

    actionCaptures.length = 0;
    vi.spyOn(webchatStore, 'answerCardsByQuestionId').mockReturnValue({
      ok: false,
      reason: 'already_answered',
    });

    const status = await httpPost('/api/rooms/inbox/threads/main/actions', {
      questionId: 'approval-race-answered',
      value: 'approve',
    });
    expect(status).toBe(409);
    expect(actionCaptures).toHaveLength(0);
  });

  it('POST actions returns 404 when claim finds no pending card', async () => {
    await adapter.setup(setup);
    await adapter.deliver('inbox', null, {
      kind: 'chat-sdk',
      content: {
        type: 'ask_question',
        questionId: 'approval-race-missing',
        title: 'Restart container',
        question: 'Allow restart?',
        options: [{ label: 'Approve', value: 'approve' }],
      },
    });

    actionCaptures.length = 0;
    vi.spyOn(webchatStore, 'answerCardsByQuestionId').mockReturnValue({
      ok: false,
      reason: 'not_found',
    });

    const status = await httpPost('/api/rooms/inbox/threads/main/actions', {
      questionId: 'approval-race-missing',
      value: 'approve',
    });
    expect(status).toBe(404);
    expect(actionCaptures).toHaveLength(0);
  });

  it('POST actions invokes onAction only once for concurrent mirrored clicks', async () => {
    getPendingApprovalMock.mockReturnValue({
      approval_id: 'approval-once',
      session_id: 'sess-sarah',
    } as never);
    getSessionMock.mockReturnValue({
      id: 'sess-sarah',
      agent_group_id: 'ag-sarah',
      messaging_group_id: 'mg-dm-sarah',
      thread_id: null,
    } as never);
    getMessagingGroupByIdMock.mockReturnValue({
      id: 'mg-dm-sarah',
      channel_type: 'web',
      platform_id: 'dm:sarah',
    } as never);

    await adapter.setup(setup);
    await adapter.deliver('inbox', null, {
      kind: 'chat-sdk',
      content: {
        type: 'ask_question',
        questionId: 'approval-once',
        title: 'Restart container',
        question: 'Allow restart?',
        options: [{ label: 'Approve', selectedLabel: '✅ Approved', value: 'approve' }],
      },
    });

    actionCaptures.length = 0;
    const [inboxStatus, dmStatus] = await Promise.all([
      httpPost('/api/rooms/inbox/threads/main/actions', {
        questionId: 'approval-once',
        value: 'approve',
      }),
      httpPost('/api/rooms/dm%3Asarah/threads/main/actions', {
        questionId: 'approval-once',
        value: 'approve',
      }),
    ]);

    expect(actionCaptures).toHaveLength(1);
    expect([inboxStatus, dmStatus].sort()).toEqual([200, 409]);
  });

  it('POST actions returns 404 when card is missing', async () => {
    await adapter.setup(setup);
    const status = await httpPost('/api/rooms/inbox/threads/main/actions', {
      questionId: 'missing',
      value: 'approve',
    });
    expect(status).toBe(404);
  });

  it('POST actions returns 400 for invalid option value', async () => {
    await adapter.setup(setup);
    await adapter.deliver('inbox', null, {
      kind: 'chat-sdk',
      content: {
        type: 'ask_question',
        questionId: 'approval-invalid',
        title: 'Pick',
        question: 'Choose',
        options: [{ label: 'Yes', value: 'yes' }],
      },
    });
    const status = await httpPost('/api/rooms/inbox/threads/main/actions', {
      questionId: 'approval-invalid',
      value: 'nope',
    });
    expect(status).toBe(400);
  });

  it('POST actions returns 400 when questionId or value is missing', async () => {
    await adapter.setup(setup);
    expect(await httpPost('/api/rooms/inbox/threads/main/actions', { value: 'yes' })).toBe(400);
    expect(await httpPost('/api/rooms/inbox/threads/main/actions', { questionId: 'q' })).toBe(400);
  });

  it('POST actions returns 400 for invalid JSON body', async () => {
    await adapter.setup(setup);
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: testPort,
          path: '/api/rooms/inbox/threads/main/actions',
          method: 'POST',
          headers: {
            Authorization: `Bearer ${SECRET}`,
            'Content-Type': 'application/json',
            Connection: 'close',
          },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode ?? 0));
        },
      );
      req.on('error', reject);
      req.end('{bad json');
    });
    expect(status).toBe(400);
  });

  it('POST actions returns 400 when body read fails', async () => {
    await adapter.setup(setup);
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: testPort,
          path: '/api/rooms/inbox/threads/main/actions',
          method: 'POST',
          headers: {
            Authorization: `Bearer ${SECRET}`,
            'Content-Type': 'application/json',
            'Content-Length': String(21 * 1024 * 1024),
            Connection: 'close',
          },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode ?? 0));
        },
      );
      req.on('error', reject);
      req.write('x'.repeat(1024));
      req.end();
    });
    expect(status).toBe(400);
  });

  it('isConnected is false before setup', () => {
    expect(adapter.isConnected()).toBe(false);
  });

  it('includes senderName on ask_question deliver output', async () => {
    await adapter.setup(setup);
    await adapter.deliver('inbox', null, {
      kind: 'chat-sdk',
      content: {
        type: 'ask_question',
        questionId: 'q-name',
        title: 'Title',
        question: 'Question?',
        options: [{ label: 'Yes', selectedLabel: 'Yes picked', value: 'yes' }],
        senderName: 'Host',
      },
    });
    const { body } = await httpGet('/api/rooms/inbox/threads/main/messages');
    const msg = (body as { messages: Array<{ senderName?: string }> }).messages.at(-1);
    expect(msg?.senderName).toBe('Host');
  });

  it('omits senderName when agent group cannot be resolved for approval cards', async () => {
    getPendingApprovalMock.mockReturnValue({
      approval_id: 'approval-no-agent',
      session_id: 'sess-sarah',
    } as never);
    getSessionMock.mockReturnValue({
      id: 'sess-sarah',
      agent_group_id: 'ag-missing',
      messaging_group_id: 'mg-dm-sarah',
      thread_id: null,
    } as never);
    getMessagingGroupByIdMock.mockReturnValue({
      id: 'mg-dm-sarah',
      channel_type: 'web',
      platform_id: 'dm:sarah',
    } as never);
    getAgentGroupMock.mockReturnValueOnce(undefined);

    await adapter.setup(setup);
    await adapter.deliver('inbox', null, {
      kind: 'chat-sdk',
      content: {
        type: 'ask_question',
        questionId: 'approval-no-agent',
        title: 'Restart container',
        question: 'Allow restart?',
        options: [{ label: 'Approve', value: 'approve' }],
      },
    });

    const { body } = await httpGet('/api/rooms/inbox/threads/main/messages');
    const msg = (body as { messages: Array<{ senderName?: string }> }).messages.at(-1);
    expect(msg?.senderName).toBeUndefined();
  });

  it('resolves senderName from pending approval session agent when omitted', async () => {
    getPendingApprovalMock.mockReturnValue({
      approval_id: 'approval-agent-name',
      session_id: 'sess-sarah',
    } as never);
    getSessionMock.mockReturnValue({
      id: 'sess-sarah',
      agent_group_id: 'ag-sarah',
      messaging_group_id: 'mg-dm-sarah',
      thread_id: null,
    } as never);
    getMessagingGroupByIdMock.mockReturnValue({
      id: 'mg-dm-sarah',
      channel_type: 'web',
      platform_id: 'dm:sarah',
    } as never);

    await adapter.setup(setup);
    await adapter.deliver('inbox', null, {
      kind: 'chat-sdk',
      content: {
        type: 'ask_question',
        questionId: 'approval-agent-name',
        title: 'Restart container',
        question: 'Allow restart?',
        options: [{ label: 'Approve', value: 'approve' }],
      },
    });

    const { body } = await httpGet('/api/rooms/inbox/threads/main/messages');
    const msg = (body as { messages: Array<{ senderName?: string }> }).messages.at(-1);
    expect(msg?.senderName).toBe('Sarah');
  });

  it('delivers inbox ask_question when approval session lookup throws', async () => {
    getDbMock.mockImplementationOnce(() => {
      throw new Error('db unavailable');
    });

    await adapter.setup(setup);
    await adapter.deliver('inbox', null, {
      kind: 'chat-sdk',
      content: {
        type: 'ask_question',
        questionId: 'approval-db-error',
        title: 'Restart container',
        question: 'Allow restart?',
        options: [{ label: 'Approve', value: 'approve' }],
      },
    });

    const { body } = await httpGet('/api/rooms/inbox/threads/main/messages');
    expect((body as { messages: unknown[] }).messages).toHaveLength(1);
    const dm = await httpGet('/api/rooms/dm%3Asarah/threads/main/messages');
    expect((dm.body as { messages: unknown[] }).messages).toHaveLength(0);
  });

  it('does not mirror inbox approval cards when session origin is not web', async () => {
    getPendingApprovalMock.mockReturnValue({
      approval_id: 'approval-telegram',
      session_id: 'sess-telegram',
    } as never);
    getSessionMock.mockReturnValue({
      id: 'sess-telegram',
      agent_group_id: 'ag-sarah',
      messaging_group_id: 'mg-telegram',
      thread_id: null,
    } as never);
    getMessagingGroupByIdMock.mockReturnValue({
      id: 'mg-telegram',
      channel_type: 'telegram',
      platform_id: '8618579250',
    } as never);

    await adapter.setup(setup);
    await adapter.deliver('inbox', null, {
      kind: 'chat-sdk',
      content: {
        type: 'ask_question',
        questionId: 'approval-telegram',
        title: 'Restart container',
        question: 'Allow restart?',
        options: [{ label: 'Approve', value: 'approve' }],
      },
    });

    const inbox = await httpGet('/api/rooms/inbox/threads/main/messages');
    const dm = await httpGet('/api/rooms/dm%3Asarah/threads/main/messages');
    expect((inbox.body as { messages: unknown[] }).messages).toHaveLength(1);
    expect((dm.body as { messages: unknown[] }).messages).toHaveLength(0);
  });

  it('does not mirror when pending approval has no session', async () => {
    getPendingApprovalMock.mockReturnValue({
      approval_id: 'approval-no-session',
    } as never);

    await adapter.setup(setup);
    await adapter.deliver('inbox', null, {
      kind: 'chat-sdk',
      content: {
        type: 'ask_question',
        questionId: 'approval-no-session',
        title: 'Restart container',
        question: 'Allow restart?',
        options: [{ label: 'Approve', value: 'approve' }],
      },
    });

    const dm = await httpGet('/api/rooms/dm%3Asarah/threads/main/messages');
    expect((dm.body as { messages: unknown[] }).messages).toHaveLength(0);
  });

  it('does not mirror when session has no messaging group', async () => {
    getPendingApprovalMock.mockReturnValue({
      approval_id: 'approval-no-mg',
      session_id: 'sess-no-mg',
    } as never);
    getSessionMock.mockReturnValue({
      id: 'sess-no-mg',
      agent_group_id: 'ag-sarah',
      messaging_group_id: null,
      thread_id: null,
    } as never);

    await adapter.setup(setup);
    await adapter.deliver('inbox', null, {
      kind: 'chat-sdk',
      content: {
        type: 'ask_question',
        questionId: 'approval-no-mg',
        title: 'Restart container',
        question: 'Allow restart?',
        options: [{ label: 'Approve', value: 'approve' }],
      },
    });

    const dm = await httpGet('/api/rooms/dm%3Asarah/threads/main/messages');
    expect((dm.body as { messages: unknown[] }).messages).toHaveLength(0);
  });

  it('delivers ask_question cards directly to a web room without inbox mirroring', async () => {
    await adapter.setup(setup);
    await adapter.deliver('dm:sarah', null, {
      kind: 'chat-sdk',
      content: {
        type: 'ask_question',
        questionId: 'approval-dm-only',
        title: 'Question',
        question: 'Pick one?',
        options: [{ label: 'Yes', value: 'yes' }],
        senderName: 'Sarah',
      },
    });

    expect(getPendingApprovalMock).not.toHaveBeenCalled();
    const dm = await httpGet('/api/rooms/dm%3Asarah/threads/main/messages');
    expect((dm.body as { messages: unknown[] }).messages).toHaveLength(1);
    const inbox = await httpGet('/api/rooms/inbox/threads/main/messages');
    expect((inbox.body as { messages: unknown[] }).messages).toHaveLength(0);
  });

  it('mirrors inbox approval cards to the session origin web room', async () => {
    getPendingApprovalMock.mockReturnValue({
      approval_id: 'approval-mirror',
      session_id: 'sess-sarah',
    } as never);
    getSessionMock.mockReturnValue({
      id: 'sess-sarah',
      agent_group_id: 'ag-sarah',
      messaging_group_id: 'mg-dm-sarah',
      thread_id: null,
    } as never);
    getMessagingGroupByIdMock.mockReturnValue({
      id: 'mg-dm-sarah',
      channel_type: 'web',
      platform_id: 'dm:sarah',
    } as never);

    await adapter.setup(setup);
    await adapter.deliver('inbox', null, {
      kind: 'chat-sdk',
      content: {
        type: 'ask_question',
        questionId: 'approval-mirror',
        title: 'Restart container',
        question: 'Allow restart?',
        options: [{ label: 'Approve', value: 'approve' }],
      },
    });

    const inbox = await httpGet('/api/rooms/inbox/threads/main/messages');
    const dm = await httpGet('/api/rooms/dm%3Asarah/threads/main/messages');
    expect((inbox.body as { messages: unknown[] }).messages).toHaveLength(1);
    expect((dm.body as { messages: Array<{ card?: { questionId: string }; senderName?: string }> }).messages).toHaveLength(1);
    expect(
      (dm.body as { messages: Array<{ card?: { questionId: string }; senderName?: string }> }).messages[0]?.card?.questionId,
    ).toBe('approval-mirror');
    expect(
      (dm.body as { messages: Array<{ senderName?: string }> }).messages[0]?.senderName,
    ).toBe('Sarah');
  });

  it('updates mirrored approval cards together when an action is taken', async () => {
    getPendingApprovalMock.mockReturnValue({
      approval_id: 'approval-sync',
      session_id: 'sess-sarah',
    } as never);
    getSessionMock.mockReturnValue({
      id: 'sess-sarah',
      agent_group_id: 'ag-sarah',
      messaging_group_id: 'mg-dm-sarah',
      thread_id: null,
    } as never);
    getMessagingGroupByIdMock.mockReturnValue({
      id: 'mg-dm-sarah',
      channel_type: 'web',
      platform_id: 'dm:sarah',
    } as never);

    await adapter.setup(setup);
    await adapter.deliver('inbox', null, {
      kind: 'chat-sdk',
      content: {
        type: 'ask_question',
        questionId: 'approval-sync',
        title: 'Restart container',
        question: 'Allow restart?',
        options: [{ label: 'Approve', selectedLabel: '✅ Approved', value: 'approve' }],
      },
    });

    const events: unknown[] = [];
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${testPort}/api/ws?token=${SECRET}`);
      ws.on('open', async () => {
        const status = await httpPost('/api/rooms/dm%3Asarah/threads/main/actions', {
          questionId: 'approval-sync',
          value: 'approve',
        });
        expect(status).toBe(200);
      });
      ws.on('message', (data) => {
        events.push(JSON.parse(data.toString()));
        if (events.filter((e) => (e as { type?: string }).type === 'message_update').length >= 2) {
          ws.close();
          resolve();
        }
      });
      ws.on('error', reject);
    });

    const updates = events.filter((e) => (e as { type?: string }).type === 'message_update');
    expect(updates).toHaveLength(2);
    expect(updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.objectContaining({ platformId: 'inbox', card: expect.objectContaining({ status: 'answered' }) }),
        }),
        expect.objectContaining({
          message: expect.objectContaining({ platformId: 'dm:sarah', card: expect.objectContaining({ status: 'answered' }) }),
        }),
      ]),
    );
  });

  it('deliver ignores malformed ask_question payloads', async () => {
    await adapter.setup(setup);
    const cases = [
      { type: 'ask_question', title: 't', question: 'q', options: [] },
      { type: 'ask_question', questionId: 'q1', question: 'q', options: [{ label: 'Yes', value: 'yes' }] },
      {
        type: 'ask_question',
        questionId: 'q2',
        title: 't',
        question: 'q',
        options: [{ label: 1, value: 'yes' }],
      },
      {
        type: 'ask_question',
        questionId: 'q3',
        title: 't',
        question: 'q',
        options: 'nope',
      },
    ] as unknown[];
    for (const content of cases) {
      const id = await adapter.deliver('inbox', null, { kind: 'chat-sdk', content });
      expect(id).toBeUndefined();
    }
  });
});
