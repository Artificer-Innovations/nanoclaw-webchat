import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyDeliverySenderAttributionContent,
  applyDeliverySenderAttributionPatch,
  applyRouterLobbyRoutingContent,
  applyRouterLobbyRoutingPatch,
  DELIVERY_PATCH_MARKER,
  hasEquivalentDeliverySenderAttribution,
  hasEquivalentRouterLobbyRouting,
  removeDeliverySenderAttributionContent,
  removeDeliverySenderAttributionPatch,
  removeRouterLobbyRoutingContent,
  removeRouterLobbyRoutingPatch,
  ROUTER_PATCH_MARKER,
  STOCK_DELIVERY_FIXTURE,
  STOCK_ROUTER_FIXTURE,
  writeStockHostModules,
} from './host-patches.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('router lobby-routing patch', () => {
  it('applies, is idempotent, and uninstall restores stock', () => {
    const applied = applyRouterLobbyRoutingContent(STOCK_ROUTER_FIXTURE);
    expect(applied.status).toBe('applied');
    expect(applied.next).toContain(ROUTER_PATCH_MARKER);
    expect(applied.next).toContain('resolveWebchatReceiver');
    expect(applied.next).toContain('isWebchatContextOnly');
    expect(applied.next).toContain('skipCommandGate');
    expect(applied.next).toContain('agentGroup.folder === webchatReceiver');

    const again = applyRouterLobbyRoutingContent(applied.next);
    expect(again.status).toBe('already');

    const removed = removeRouterLobbyRoutingContent(applied.next);
    expect(removed.status).toBe('removed');
    expect(removed.next).not.toContain(ROUTER_PATCH_MARKER);
    expect(removed.next).toContain(
      'const engages = evaluateEngage(agent, messageText, isMention, mg, effectiveThreadId);',
    );
  });

  it('leaves MyNanoClaw-equivalent hosts alone', () => {
    const equivalent = `
      const webchatReceiver = typeof parsed.webchatReceiver === 'string' ? parsed.webchatReceiver : null;
      const isPeerReply = true;
      const isSynthetic = false;
      const isHistoricalReplay = false;
      const engages = webchatReceiver ? agentGroup.folder === webchatReceiver : evaluateEngage();
      const shouldWake = !isPeerReply && !isSynthetic && !isHistoricalReplay;
      const skipCommandGate = isPeerReply || isSynthetic || isHistoricalReplay;
    `;
    expect(hasEquivalentRouterLobbyRouting(equivalent)).toBe(true);
    expect(applyRouterLobbyRoutingContent(equivalent).status).toBe('already-equivalent');
    expect(removeRouterLobbyRoutingContent(equivalent).status).toBe('absent');
  });

  it('throws on unsupported router shapes', () => {
    expect(() => applyRouterLobbyRoutingContent('export async function routeInbound() {}')).toThrow(
      /unsupported host shape/,
    );
  });

  it('patches files on disk via writeStockHostModules', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'host-patch-router-'));
    tempDirs.push(root);
    writeStockHostModules(root);
    expect(applyRouterLobbyRoutingPatch(root).status).toBe('applied');
    expect(applyRouterLobbyRoutingPatch(root).status).toBe('already');
    expect(removeRouterLobbyRoutingPatch(root).status).toBe('removed');
    expect(removeRouterLobbyRoutingPatch(root).status).toBe('absent');
  });

  it('throws when router.ts is missing on disk', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'host-patch-router-missing-'));
    tempDirs.push(root);
    expect(() => applyRouterLobbyRoutingPatch(root)).toThrow(/missing .*router\.ts/);
  });

  it('returns absent when removing from a tree without router.ts', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'host-patch-router-absent-'));
    tempDirs.push(root);
    expect(removeRouterLobbyRoutingPatch(root).status).toBe('absent');
  });

  it('prepends the routing import when the host file has no imports', () => {
    const noImports = STOCK_ROUTER_FIXTURE.replace(/^import .+\n/gm, '');
    const applied = applyRouterLobbyRoutingContent(noImports);
    expect(applied.status).toBe('applied');
    expect(applied.next.startsWith('import { isWebchatContextOnly')).toBe(true);
  });

  it('skips inserting the routing import when it is already present', () => {
    const withImport = `import { isWebchatContextOnly, resolveWebchatReceiver, WEBCHAT_RECEIVER_FIELD } from './webchat-routing.js';\n${STOCK_ROUTER_FIXTURE}`;
    const applied = applyRouterLobbyRoutingContent(withImport);
    expect(applied.status).toBe('applied');
    expect(applied.next.split("from './webchat-routing.js';").length - 1).toBe(1);
  });

  it('throws when managed markers cannot be fully removed', () => {
    expect(() =>
      removeRouterLobbyRoutingContent(`// ${ROUTER_PATCH_MARKER}\nexport async function routeInbound() {}\n`),
    ).toThrow(/Failed to fully remove/);
  });
});

describe('delivery sender-attribution patch', () => {
  it('applies preserve-if-present stamp, is idempotent, and uninstall restores stock', () => {
    const applied = applyDeliverySenderAttributionContent(STOCK_DELIVERY_FIXTURE);
    expect(applied.status).toBe('applied');
    expect(applied.next).toContain(DELIVERY_PATCH_MARKER);
    expect(applied.next).toContain('deliveryContent');
    expect(applied.next).toContain("msg.channel_type === 'web'");
    expect(applied.next).toContain('senderFolder: agentGroup.folder');
    expect(applied.next).toMatch(/deliveryAdapter\.deliver\([\s\S]*deliveryContent/);

    const again = applyDeliverySenderAttributionContent(applied.next);
    expect(again.status).toBe('already');

    const removed = removeDeliverySenderAttributionContent(applied.next);
    expect(removed.status).toBe('removed');
    expect(removed.next).not.toContain(DELIVERY_PATCH_MARKER);
    expect(removed.next).toMatch(/deliveryAdapter\.deliver\([\s\S]*msg\.content/);
  });

  it('leaves hosts that already stamp sender identity alone', () => {
    const equivalent = `
      if (msg.channel_type === 'web') {
        deliverContent = JSON.stringify({ ...content, senderName: agent.name, senderFolder: agent.folder });
      }
    `;
    expect(hasEquivalentDeliverySenderAttribution(equivalent)).toBe(true);
    expect(
      hasEquivalentDeliverySenderAttribution(`
        if (msg.channel_type === 'web') {
          deliverContent = JSON.stringify({ senderName: agentGroup.name, senderFolder: agentGroup.folder });
        }
      `),
    ).toBe(true);
    expect(
      hasEquivalentDeliverySenderAttribution(`
        if (msg.channel_type === 'web') {
          const name = agent.name;
          deliverContent = JSON.stringify({ senderFolder: 'sarah' });
        }
      `),
    ).toBe(true);
    expect(
      hasEquivalentDeliverySenderAttribution(`
        if (msg.channel_type === 'web') {
          deliverContent = JSON.stringify({ senderFolder: 'sarah' });
        }
      `),
    ).toBe(false);
    expect(hasEquivalentDeliverySenderAttribution('senderFolder only')).toBe(false);
    expect(applyDeliverySenderAttributionContent(equivalent).status).toBe('already-equivalent');
    expect(removeDeliverySenderAttributionContent(equivalent).status).toBe('absent');
  });

  it('throws on unsupported delivery shapes', () => {
    expect(() => applyDeliverySenderAttributionContent('export async function deliverMessage() {}')).toThrow(
      /unsupported host shape/,
    );
  });

  it('patches files on disk via writeStockHostModules', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'host-patch-delivery-'));
    tempDirs.push(root);
    writeStockHostModules(root);
    expect(applyDeliverySenderAttributionPatch(root).status).toBe('applied');
    expect(applyDeliverySenderAttributionPatch(root).status).toBe('already');
    expect(removeDeliverySenderAttributionPatch(root).status).toBe('removed');
  });

  it('throws when delivery.ts is missing on disk', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'host-patch-delivery-missing-'));
    tempDirs.push(root);
    expect(() => applyDeliverySenderAttributionPatch(root)).toThrow(/missing .*delivery\.ts/);
  });

  it('returns absent when removing from a tree without delivery.ts', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'host-patch-delivery-absent-'));
    tempDirs.push(root);
    expect(removeDeliverySenderAttributionPatch(root).status).toBe('absent');
  });

  it('adds getAgentGroup import when the stock host lacks it', () => {
    const withoutImport = STOCK_DELIVERY_FIXTURE.replace(
      "import { getAgentGroup } from './db/agent-groups.js';\n",
      '',
    ).replace('\nvoid getAgentGroup;\n', '\n');
    const applied = applyDeliverySenderAttributionContent(withoutImport);
    expect(applied.status).toBe('applied');
    expect(applied.next).toContain("import { getAgentGroup } from './db/agent-groups.js';");
  });

  it('throws when managed delivery markers cannot be reversed', () => {
    expect(() =>
      removeDeliverySenderAttributionContent(`// ${DELIVERY_PATCH_MARKER}\nexport async function deliverMessage() {}\n`),
    ).toThrow(/Failed to remove/);
  });

  it('removes a getAgentGroup import that was only used by the stamp', () => {
    const withoutImport = STOCK_DELIVERY_FIXTURE.replace(
      "import { getAgentGroup } from './db/agent-groups.js';\n",
      '',
    ).replace('\nvoid getAgentGroup;\n', '\n');
    const applied = applyDeliverySenderAttributionContent(withoutImport);
    const removed = removeDeliverySenderAttributionContent(applied.next);
    expect(removed.status).toBe('removed');
    expect(removed.next).not.toContain("from './db/agent-groups.js'");
  });

  it('keeps getAgentGroup import when other references remain after uninstall', () => {
    const applied = applyDeliverySenderAttributionContent(STOCK_DELIVERY_FIXTURE);
    const removed = removeDeliverySenderAttributionContent(applied.next);
    expect(removed.status).toBe('removed');
    // STOCK fixture keeps `void getAgentGroup;` so the import must stay.
    expect(removed.next).toContain("import { getAgentGroup } from './db/agent-groups.js';");
  });

  it('keeps getAgentGroup import when a call site remains after uninstall', () => {
    const withCall = STOCK_DELIVERY_FIXTURE.replace(
      '\nvoid getAgentGroup;\n',
      '\nvoid getAgentGroup("ag-1");\n',
    );
    const applied = applyDeliverySenderAttributionContent(withCall);
    const removed = removeDeliverySenderAttributionContent(applied.next);
    expect(removed.status).toBe('removed');
    expect(removed.next).toContain("import { getAgentGroup } from './db/agent-groups.js';");
    expect(removed.next).toContain('getAgentGroup("ag-1")');
  });
});

describe('writeStockHostModules', () => {
  it('is idempotent when host modules already exist', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'host-patch-stock-'));
    tempDirs.push(root);
    writeStockHostModules(root);
    const routerBefore = fs.readFileSync(path.join(root, 'src/router.ts'), 'utf8');
    writeStockHostModules(root);
    expect(fs.readFileSync(path.join(root, 'src/router.ts'), 'utf8')).toBe(routerBefore);
    expect(fs.existsSync(path.join(root, 'src/db/agent-groups.ts'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'src/session-manager.ts'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'src/types.ts'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'src/channels/adapter.ts'))).toBe(true);
  });
});
