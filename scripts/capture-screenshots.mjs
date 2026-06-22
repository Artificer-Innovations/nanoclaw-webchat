#!/usr/bin/env node
/**
 * Capture README screenshots using the built SPA + mock API.
 * Usage: node scripts/capture-screenshots.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clientDir = path.join(root, 'dist/client');
const outDir = path.join(root, 'docs/screenshots');
const TOKEN = 'screenshot-token';

const agents = [
  { folder: 'sarah', name: 'Sarah', mention: '@sarah' },
  { folder: 'alex', name: 'Alex', mention: '@alex' },
  { folder: 'research', name: 'Research', mention: '@research' },
];

const rooms = [
  {
    platformId: 'lobby',
    name: 'Lobby',
    kind: 'lobby',
    threads: [
      { id: 'main', title: 'Main' },
      { id: 't-design', title: 'Design review' },
      { id: 't-bugs', title: 'Bug triage' },
    ],
  },
  {
    platformId: 'dm:sarah',
    name: 'Sarah',
    kind: 'dm',
    folder: 'sarah',
    threads: [{ id: 'main', title: 'Main' }],
  },
  {
    platformId: 'dm:alex',
    name: 'Alex',
    kind: 'dm',
    folder: 'alex',
    threads: [{ id: 'main', title: 'Main' }],
  },
];

const lobbyMessages = [
  {
    id: 'm1',
    direction: 'inbound',
    text: '@sarah Can you review the auth flow changes?',
    timestamp: Date.now() - 120_000,
    platformId: 'lobby',
    threadId: 'main',
    senderName: 'You',
  },
  {
    id: 'm2',
    direction: 'outbound',
    text: 'On it — I will check token refresh and session expiry in `src/auth.ts`.',
    timestamp: Date.now() - 90_000,
    platformId: 'lobby',
    threadId: 'main',
    senderName: 'Sarah',
  },
  {
    id: 'm3',
    direction: 'outbound',
    text: 'Found one edge case: expired refresh tokens were not rotated. Patch incoming.',
    timestamp: Date.now() - 60_000,
    platformId: 'lobby',
    threadId: 'main',
    senderName: 'Sarah',
  },
];

const dmMessages = [
  {
    id: 'd1',
    direction: 'inbound',
    text: 'Summarize the open PRs for this repo.',
    timestamp: Date.now() - 45_000,
    platformId: 'dm:sarah',
    threadId: 'main',
    senderName: 'You',
  },
  {
    id: 'd2',
    direction: 'outbound',
    text: 'Three open PRs: CI fix (#42), attachment drawer (#38), and MCP bundling (#45).',
    timestamp: Date.now() - 30_000,
    platformId: 'dm:sarah',
    threadId: 'main',
    senderName: 'Sarah',
  },
];

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
  });
}

function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');

    if (url.pathname === '/api/bootstrap') {
      return json(res, 200, {
        user: { id: 'web:local', displayName: 'Local' },
        rooms,
        agents,
      });
    }

    const messagesMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/threads\/([^/]+)\/messages$/);
    if (messagesMatch) {
      const [, platformId, threadId] = messagesMatch;
      const messages =
        platformId === 'dm:sarah'
          ? dmMessages
          : platformId === 'lobby' && threadId === 'main'
            ? lobbyMessages
            : [];
      return json(res, 200, {
        messages,
        engagedAgents: platformId === 'lobby' && threadId === 'main' ? ['sarah'] : [],
      });
    }

    if (url.pathname === '/api/engaged' && req.method === 'GET') {
      return json(res, 200, { agents: ['sarah'] });
    }

    if (url.pathname.startsWith('/api/')) {
      if (req.method === 'POST') await readBody(req);
      return json(res, 200, { ok: true });
    }

    let filePath = path.join(clientDir, url.pathname === '/' ? 'index.html' : url.pathname);
    if (!filePath.startsWith(clientDir)) {
      res.writeHead(403).end();
      return;
    }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(clientDir, 'index.html');
    }
    const ext = path.extname(filePath);
    const types = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.svg': 'image/svg+xml',
    };
    res.writeHead(200, { 'Content-Type': types[ext] ?? 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });
}

async function main() {
  if (!fs.existsSync(clientDir)) {
    console.error('Run pnpm run build first');
    process.exit(1);
  }

  fs.mkdirSync(outDir, { recursive: true });

  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.addInitScript((t) => {
    sessionStorage.setItem('webchat_token', t);
    class MockWS {
      constructor() {
        this.readyState = 1;
        queueMicrotask(() => this.onopen?.({}));
      }
      close() {}
      send() {}
    }
    MockWS.CONNECTING = 0;
    MockWS.OPEN = 1;
    window.WebSocket = MockWS;
  }, TOKEN);

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(outDir, 'lobby.png') });
  await page.screenshot({ path: path.join(outDir, 'sidebar.png') });

  const sarah = page.getByRole('button', { name: 'Sarah' }).first();
  if (await sarah.count()) {
    await sarah.click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(outDir, 'dm.png') });
  }

  await page.screenshot({ path: path.join(outDir, 'attachments.png') });
  await browser.close();
  server.close();

  console.log(`Screenshots written to ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
