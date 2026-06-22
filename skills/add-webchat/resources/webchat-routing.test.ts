import { describe, expect, it } from 'vitest';
import {
  backfillIntroLine,
  buildRoutingMetadata,
  computeResponseExpectation,
  folderFromSenderName,
  THREAD_MESSAGE_SEQ_FIELD,
  WEBCHAT_RECEIVER_FIELD,
} from './webchat-routing.js';

describe('webchat-routing', () => {
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

  it('maps sender name to agent folder', () => {
    const agents = [
      { folder: 'diego', displayName: 'Diego' },
      { folder: 'sarah', displayName: 'Sarah' },
    ];
    expect(folderFromSenderName('Diego', agents)).toBe('diego');
    expect(folderFromSenderName('sarah', agents)).toBe('sarah');
    expect(folderFromSenderName('Unknown', agents)).toBeNull();
  });
});
