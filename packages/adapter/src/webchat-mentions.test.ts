import { describe, expect, it } from 'vitest';
import {
  implicitMentionedFolders,
  mentionedAgentFolders,
  mentionHandleForFolder,
  routingTextForAgent,
} from './webchat-mentions.js';

describe('webchat-mentions', () => {
  const opts = { agentFolders: ['sarah', 'diego', 'mei'], teamFolder: null as string | null };
  const engaged = [
    { folder: 'rahul', displayName: 'Rahul' },
    { folder: 'diego', displayName: 'Diego' },
    { folder: 'mei', displayName: 'Mei' },
  ];

  it('parses known agent folders in order', () => {
    expect(mentionedAgentFolders('@diego and @sarah please review', opts)).toEqual(['diego', 'sarah']);
  });

  it('ignores @here and unknown handles', () => {
    expect(mentionedAgentFolders('@here @unknown @sarah', opts)).toEqual(['sarah']);
  });

  it('dedupes repeated mentions', () => {
    expect(mentionedAgentFolders('@sarah @Sarah hello', opts)).toEqual(['sarah']);
  });

  it('maps @team to team folder when configured', () => {
    expect(
      mentionedAgentFolders('@team sync up', { agentFolders: ['team-coord', 'sarah'], teamFolder: 'team-coord' }),
    ).toEqual(['team-coord']);
  });

  it('ignores @team when team folder is not in agentFolders', () => {
    expect(mentionedAgentFolders('@team sync up', { agentFolders: ['sarah'], teamFolder: 'missing-team' })).toEqual([]);
  });

  it('builds routing text with mention handles', () => {
    expect(routingTextForAgent('any updates?', 'sarah', null)).toBe('@sarah any updates?');
    expect(mentionHandleForFolder('team-coord', 'team-coord')).toBe('@team');
    expect(routingTextForAgent('', 'team-coord', 'team-coord')).toBe('@team');
  });

  it('detects implicit address patterns', () => {
    expect(implicitMentionedFolders('Rahul — did you see the other replies?', engaged)).toEqual(['rahul']);
    expect(implicitMentionedFolders('hey Diego, can you check?', engaged)).toEqual(['diego']);
  });

  it('ignores names that appear only in explicit @mentions', () => {
    expect(implicitMentionedFolders('@diego - what is your take?', engaged)).toEqual([]);
    expect(implicitMentionedFolders('@rahul hey Diego, can you check?', engaged)).toEqual(['diego']);
  });

  it('rejects substring and citation matches', () => {
    expect(implicitMentionedFolders('overhauling the auth module', engaged)).toEqual([]);
    expect(implicitMentionedFolders('as Rahul said earlier', engaged)).toEqual([]);
    expect(implicitMentionedFolders('email me the doc', engaged)).toEqual([]);
    expect(implicitMentionedFolders('`rahul` config updated', engaged)).toEqual([]);
  });
});
