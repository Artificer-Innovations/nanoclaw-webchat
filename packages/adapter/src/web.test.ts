import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import http from 'http';
import path from 'path';
import WebSocket from 'ws';

vi.mock('../config.js', async () => {
  const actual = await vi.importActual<typeof import('../config.js')>('../config.js');
  return { ...actual, DATA_DIR: '/tmp/nanoclaw-web-adapter-test' };
});

const TEST_DATA = '/tmp/nanoclaw-web-adapter-test';

vi.mock('nanoclaw-webchat', () => ({
  getAssetDir: () => '/tmp/nanoclaw-webchat-test-assets',
}));

vi.mock('../webchat-sync.js', () => ({
  buildWebchatBootstrap: () => ({
    user: { id: 'web:local', displayName: 'Local' },
    rooms: [
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
}));

vi.mock('../db/agent-groups.js', () => ({
  getAllAgentGroups: () => [
    { id: 'ag-sarah', folder: 'sarah', name: 'Sarah', agent_provider: null, created_at: '2020-01-01' },
    { id: 'ag-diego', folder: 'diego', name: 'Diego', agent_provider: null, created_at: '2020-01-01' },
    { id: 'ag-rahul', folder: 'rahul', name: 'Rahul', agent_provider: null, created_at: '2020-01-01' },
  ],
}));

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

const SECRET = 'test-secret';
let testPort = 38462;

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

  beforeEach(() => {
    clearWebAdapterTestState();
    captures.length = 0;
    testPort += 1;
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
      onAction() {},
    };
    adapter = createWebAdapter({
      port: testPort,
      authToken: SECRET,
      userId: 'web:local',
      displayName: 'Local',
    });
  });

  afterEach(async () => {
    if (adapter.isConnected()) await adapter.teardown();
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
});
