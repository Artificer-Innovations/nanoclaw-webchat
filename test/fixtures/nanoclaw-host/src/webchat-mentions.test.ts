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
    expect(mentionHandleForFolder('sarah', 'team-coord')).toBe('@sarah');
  });

  it('detects implicit address patterns', () => {
    expect(implicitMentionedFolders('Rahul — did you see the other replies?', engaged)).toEqual(['rahul']);
    expect(implicitMentionedFolders('hey Diego, can you check?', engaged)).toEqual(['diego']);
    expect(implicitMentionedFolders('Diego, please review', engaged)).toEqual(['diego']);
    expect(implicitMentionedFolders('ok Mei what do you think', engaged)).toEqual(['mei']);
    expect(implicitMentionedFolders('so Rahul please review', engaged)).toEqual(['rahul']);
    expect(implicitMentionedFolders('Rahul at start', engaged)).toEqual(['rahul']);
    expect(implicitMentionedFolders('hi Rahul please review', engaged)).toEqual(['rahul']);
    expect(implicitMentionedFolders('Rahul: please review', engaged)).toEqual(['rahul']);
    expect(implicitMentionedFolders('Rahul - please review', engaged)).toEqual(['rahul']);
  });

  it('returns [] for implicitMentionedFolders when engagedAgents is empty', () => {
    expect(implicitMentionedFolders('hey Diego', [])).toEqual([]);
  });

  it('matches implicit mentions by agent folder name', () => {
    expect(implicitMentionedFolders('diego can you help?', [{ folder: 'diego', displayName: 'Diego Agent' }])).toEqual([
      'diego',
    ]);
  });

  it('ignores names that appear only in explicit @mentions', () => {
    expect(implicitMentionedFolders('@diego - what is your take?', engaged)).toEqual([]);
    expect(implicitMentionedFolders('@rahul hey Diego, can you check?', engaged)).toEqual(['diego']);
  });

  it('rejects substring and citation matches', () => {
    expect(implicitMentionedFolders('overhauling the auth module', engaged)).toEqual([]);
    expect(implicitMentionedFolders('as Rahul said earlier', engaged)).toEqual([]);
    expect(implicitMentionedFolders('per Rahul update', engaged)).toEqual([]);
    expect(implicitMentionedFolders('email me the doc', engaged)).toEqual([]);
    expect(implicitMentionedFolders("I heard Rahul's noted the issue", engaged)).toEqual([]);
  });

  it('ignores names inside inline code spans', () => {
    expect(implicitMentionedFolders('use `Rahul` in the snippet', engaged)).toEqual([]);
  });

  it('ignores mid-sentence name mentions that are not address positions', () => {
    expect(implicitMentionedFolders('I think Rahul should review', engaged)).toEqual([]);
  });

  it('dedupes when folder and displayName both match', () => {
    expect(implicitMentionedFolders('rahul and Rahul sync up', engaged)).toEqual(['rahul']);
    expect(implicitMentionedFolders('rahul ok Rahul please review', engaged)).toEqual(['rahul']);
  });

  it('ignores names inside single-quoted strings', () => {
    expect(implicitMentionedFolders("'Rahul' said no", engaged)).toEqual([]);
  });

  it('matches names after a comma in the prior clause', () => {
    expect(implicitMentionedFolders('ok, Rahul please review', engaged)).toEqual(['rahul']);
  });

  it('does not duplicate folders when engaged list repeats an agent', () => {
    const duped = [
      { folder: 'rahul', displayName: 'Rahul' },
      { folder: 'rahul', displayName: 'Rahul' },
    ];
    expect(implicitMentionedFolders('Rahul please review', duped)).toEqual(['rahul']);
  });

  it('ignores names inside fenced code blocks and quoted strings', () => {
    expect(implicitMentionedFolders('```\nRahul fix this\n```', engaged)).toEqual([]);
    expect(implicitMentionedFolders('"Rahul said no"', engaged)).toEqual([]);
    expect(implicitMentionedFolders("'Diego declined'", engaged)).toEqual([]);
  });
});
