import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  backfillIntroLine,
  buildRoutingMetadata,
  computeResponseExpectation,
  folderFromSenderName,
  readBackfillMessageLimit,
  roomContextStub,
  rosterJoinStub,
  THREAD_MESSAGE_SEQ_FIELD,
  WEBCHAT_RECEIVER_FIELD,
} from './webchat-routing.js';

vi.mock('./env.js', () => ({
  readEnvFile: vi.fn(() => ({})),
}));

import { readEnvFile } from './env.js';

const readEnvFileMock = vi.mocked(readEnvFile);

describe('webchat-routing', () => {
  beforeEach(() => {
    readEnvFileMock.mockReturnValue({});
    delete process.env.WEBCHAT_BACKFILL_MESSAGE_LIMIT;
  });

  afterEach(() => {
    delete process.env.WEBCHAT_BACKFILL_MESSAGE_LIMIT;
  });

  it('computes responseExpectation per receiver', () => {
    expect(computeResponseExpectation('rahul', ['rahul'], [], false)).toBe('expected');
    expect(computeResponseExpectation('rahul', [], ['rahul'], false)).toBe('lean');
    expect(computeResponseExpectation('diego', ['rahul'], [], false)).toBe('defer');
    expect(computeResponseExpectation('diego', [], [], true)).toBe('defer');
  });

  it('builds routing metadata with peer reply flag', () => {
    expect(
      buildRoutingMetadata('diego', [], [], ['diego', 'rahul'], true),
    ).toMatchObject({
      responseExpectation: 'defer',
      isPeerReply: true,
      engagedAgents: ['diego', 'rahul'],
    });
  });

  it('exports webchatReceiver content field name for router bypass', () => {
    expect(WEBCHAT_RECEIVER_FIELD).toBe('webchatReceiver');
  });

  it('exports thread message seq field name', () => {
    expect(THREAD_MESSAGE_SEQ_FIELD).toBe('threadMessageSeq');
  });

  it('formats backfill intro without message bodies', () => {
    const block = backfillIntroLine(
      'Review PR',
      [{ folder: 'diego', displayName: 'Diego' }],
    );
    expect(block).toContain('Review PR');
    expect(block).toContain('Other agents listening: Diego');
    expect(block).toContain('Recent thread messages follow');
    expect(block).not.toContain('--- end context ---');
  });

  it('formats backfill intro without other-agents line when roster empty', () => {
    const block = backfillIntroLine('Solo thread', []);
    expect(block).toContain('Solo thread');
    expect(block).not.toContain('Other agents listening');
  });

  it('builds room context stub for solo vs multi-agent roster', () => {
    expect(roomContextStub([])).toContain('only agent currently listening');
    expect(roomContextStub([{ folder: 'diego', displayName: 'Diego' }])).toContain(
      'Other agents currently listening: Diego',
    );
  });

  it('formats roster join stub', () => {
    expect(rosterJoinStub('Diego')).toBe('Diego has joined this thread.');
  });

  it('maps sender name to agent folder', () => {
    const agents = [
      { folder: 'diego', displayName: 'Diego' },
      { folder: 'sarah', displayName: 'Sarah' },
    ];
    expect(folderFromSenderName('Diego', agents)).toBe('diego');
    expect(folderFromSenderName('sarah', agents)).toBe('sarah');
    expect(folderFromSenderName('Unknown', agents)).toBeNull();
    expect(folderFromSenderName('   ', agents)).toBeNull();
    expect(folderFromSenderName('Diego Agent', [{ folder: 'd1', displayName: 'Diego Agent' }])).toBe('d1');
  });

  describe('readBackfillMessageLimit', () => {
    it('returns parsed WEBCHAT_BACKFILL_MESSAGE_LIMIT from process.env', () => {
      process.env.WEBCHAT_BACKFILL_MESSAGE_LIMIT = '15';
      expect(readBackfillMessageLimit()).toBe(15);
    });

    it('falls back to readEnvFile when env unset', () => {
      readEnvFileMock.mockReturnValue({ WEBCHAT_BACKFILL_MESSAGE_LIMIT: '30' });
      expect(readBackfillMessageLimit()).toBe(30);
    });

    it('ignores invalid or non-positive values and returns 20', () => {
      process.env.WEBCHAT_BACKFILL_MESSAGE_LIMIT = 'nope';
      expect(readBackfillMessageLimit()).toBe(20);
      process.env.WEBCHAT_BACKFILL_MESSAGE_LIMIT = '0';
      expect(readBackfillMessageLimit()).toBe(20);
      readEnvFileMock.mockReturnValue({ WEBCHAT_BACKFILL_MESSAGE_LIMIT: '-5' });
      delete process.env.WEBCHAT_BACKFILL_MESSAGE_LIMIT;
      expect(readBackfillMessageLimit()).toBe(20);
    });
  });
});
