import { describe, expect, it } from 'vitest';
import { engagedStateAfterSend, mentionFromText, mentionsInOrder, mergeEngagedAgents, mentionedFoldersInOrder, messageSenderLabel } from './message-sender';
import type { WebChatAgent, WebChatMessage, WebChatRoom } from './types';

const agents: WebChatAgent[] = [
  { folder: 'sarah', name: 'Sarah', mention: '@sarah' },
  { folder: 'diego', name: 'Diego', mention: '@diego' },
  { folder: 'mei', name: 'Mei', mention: '@mei' },
  { folder: 'team', name: 'Team', mention: '@team' },
];

const lobby: WebChatRoom = { platformId: 'lobby', name: 'Lobby', kind: 'lobby' };
const dmSarah: WebChatRoom = { platformId: 'dm:sarah', name: 'Sarah', kind: 'dm', folder: 'sarah' };

describe('message-sender', () => {
  it('labels inbound messages as You', () => {
    const msg: WebChatMessage = {
      id: '1',
      direction: 'inbound',
      text: 'hi',
      timestamp: 1,
      platformId: 'lobby',
      threadId: 'main',
    };
    expect(messageSenderLabel(msg, [msg], lobby, agents)).toBe('You');
  });

  it('uses the DM room name for outbound messages', () => {
    const msg: WebChatMessage = {
      id: '2',
      direction: 'outbound',
      text: 'hello',
      timestamp: 2,
      platformId: 'dm:sarah',
      threadId: 'main',
    };
    expect(messageSenderLabel(msg, [msg], dmSarah, agents)).toBe('Sarah');
  });

  it('uses senderName when provided by the API', () => {
    const msg: WebChatMessage = {
      id: '3',
      direction: 'outbound',
      text: 'hello',
      timestamp: 3,
      platformId: 'lobby',
      threadId: 'main',
      senderName: 'Andy',
    };
    expect(messageSenderLabel(msg, [msg], lobby, agents)).toBe('Andy');
  });

  it('infers lobby agent from the latest prior @mention', () => {
    const messages: WebChatMessage[] = [
      {
        id: '1',
        direction: 'inbound',
        text: '@sarah please review',
        timestamp: 1,
        platformId: 'lobby',
        threadId: 'main',
      },
      {
        id: '2',
        direction: 'outbound',
        text: 'On it',
        timestamp: 2,
        platformId: 'lobby',
        threadId: 'main',
      },
    ];
    expect(messageSenderLabel(messages[1]!, messages, lobby, agents)).toBe('Sarah');
  });

  it('falls back to Agent when lobby context is unknown', () => {
    const msg: WebChatMessage = {
      id: '4',
      direction: 'outbound',
      text: 'hello',
      timestamp: 4,
      platformId: 'lobby',
      threadId: 'main',
    };
    expect(messageSenderLabel(msg, [msg], lobby, agents)).toBe('Agent');
  });

  it('parses mentions case-insensitively', () => {
    expect(mentionFromText('Hey @Sarah can you help?', agents)).toBe('Sarah');
  });

  it('orders mentions by appearance in the message', () => {
    expect(mentionsInOrder('@diego, @mei, @sarah - did you get this?', agents)).toEqual([
      'Diego',
      'Mei',
      'Sarah',
    ]);
  });

  it('assigns lobby replies to mentioned agents in order when senderName is missing', () => {
    const messages: WebChatMessage[] = [
      {
        id: '1',
        direction: 'inbound',
        text: '@diego, @mei, @sarah - did you get this?',
        timestamp: 1,
        platformId: 'lobby',
        threadId: 'main',
      },
      {
        id: '2',
        direction: 'outbound',
        text: 'Got it.',
        timestamp: 2,
        platformId: 'lobby',
        threadId: 'main',
      },
      {
        id: '3',
        direction: 'outbound',
        text: 'Yep, got it.',
        timestamp: 3,
        platformId: 'lobby',
        threadId: 'main',
      },
      {
        id: '4',
        direction: 'outbound',
        text: 'Here.',
        timestamp: 4,
        platformId: 'lobby',
        threadId: 'main',
      },
    ];
    expect(messageSenderLabel(messages[1]!, messages, lobby, agents)).toBe('Diego');
    expect(messageSenderLabel(messages[2]!, messages, lobby, agents)).toBe('Mei');
    expect(messageSenderLabel(messages[3]!, messages, lobby, agents)).toBe('Sarah');
  });

  it('reuses the only mentioned agent for extra lobby replies', () => {
    const messages: WebChatMessage[] = [
      {
        id: '1',
        direction: 'inbound',
        text: '@sarah ping',
        timestamp: 1,
        platformId: 'lobby',
        threadId: 'main',
      },
      {
        id: '2',
        direction: 'outbound',
        text: 'First',
        timestamp: 2,
        platformId: 'lobby',
        threadId: 'main',
      },
      {
        id: '3',
        direction: 'outbound',
        text: 'Second',
        timestamp: 3,
        platformId: 'lobby',
        threadId: 'main',
      },
    ];
    expect(messageSenderLabel(messages[1]!, messages, lobby, agents)).toBe('Sarah');
    expect(messageSenderLabel(messages[2]!, messages, lobby, agents)).toBe('Sarah');
  });

  it('falls back to Agent when there are more replies than mentions', () => {
    const messages: WebChatMessage[] = [
      {
        id: '1',
        direction: 'inbound',
        text: '@diego @mei hello',
        timestamp: 1,
        platformId: 'lobby',
        threadId: 'main',
      },
      {
        id: '2',
        direction: 'outbound',
        text: 'one',
        timestamp: 2,
        platformId: 'lobby',
        threadId: 'main',
      },
      {
        id: '3',
        direction: 'outbound',
        text: 'two',
        timestamp: 3,
        platformId: 'lobby',
        threadId: 'main',
      },
      {
        id: '4',
        direction: 'outbound',
        text: 'three',
        timestamp: 4,
        platformId: 'lobby',
        threadId: 'main',
      },
    ];
    expect(messageSenderLabel(messages[3]!, messages, lobby, agents)).toBe('Agent');
  });

  it('ignores unknown mentions and duplicate agent folders', () => {
    expect(mentionsInOrder('@unknown @sarah @sarah', agents)).toEqual(['Sarah']);
  });

  it('uses senderName even when whitespace padded', () => {
    const msg: WebChatMessage = {
      id: '5',
      direction: 'outbound',
      text: 'hello',
      timestamp: 5,
      platformId: 'lobby',
      threadId: 'main',
      senderName: '  Andy  ',
    };
    expect(messageSenderLabel(msg, [msg], lobby, agents)).toBe('Andy');
  });

  it('returns null when no mention is found', () => {
    expect(mentionFromText('hello everyone', agents)).toBeNull();
  });

  it('skips inbound messages without mentions when inferring lobby sender', () => {
    const messages: WebChatMessage[] = [
      {
        id: '1',
        direction: 'inbound',
        text: 'no mention here',
        timestamp: 1,
        platformId: 'lobby',
        threadId: 'main',
      },
      {
        id: '2',
        direction: 'inbound',
        text: '@mei follow up',
        timestamp: 2,
        platformId: 'lobby',
        threadId: 'main',
      },
      {
        id: '3',
        direction: 'outbound',
        text: 'reply',
        timestamp: 3,
        platformId: 'lobby',
        threadId: 'main',
      },
    ];
    expect(messageSenderLabel(messages[2]!, messages, lobby, agents)).toBe('Mei');
  });

  it('ignores non-outbound messages when counting lobby replies', () => {
    const messages: WebChatMessage[] = [
      {
        id: '1',
        direction: 'inbound',
        text: '@sarah ping',
        timestamp: 1,
        platformId: 'lobby',
        threadId: 'main',
      },
      {
        id: '2',
        direction: 'inbound',
        text: 'clarification',
        timestamp: 2,
        platformId: 'lobby',
        threadId: 'main',
      },
      {
        id: '3',
        direction: 'outbound',
        text: 'reply',
        timestamp: 3,
        platformId: 'lobby',
        threadId: 'main',
      },
    ];
    expect(messageSenderLabel(messages[2]!, messages, lobby, agents)).toBe('Sarah');
  });

  it('uses the full transcript when the message id is missing from the list', () => {
    const messages: WebChatMessage[] = [
      {
        id: '1',
        direction: 'inbound',
        text: '@diego ping',
        timestamp: 1,
        platformId: 'lobby',
        threadId: 'main',
      },
      {
        id: '2',
        direction: 'outbound',
        text: 'reply',
        timestamp: 2,
        platformId: 'lobby',
        threadId: 'main',
      },
    ];
    const orphan: WebChatMessage = { ...messages[1]!, id: 'missing' };
    expect(messageSenderLabel(orphan, messages, lobby, agents)).toBe('Diego');
  });

  it('parses mentioned agent folders including @team alias', () => {
    const teamAgents: WebChatAgent[] = [
      { folder: 'team-coord', name: 'Team', mention: '@team' },
      { folder: 'sarah', name: 'Sarah', mention: '@sarah' },
    ];
    expect(mentionedFoldersInOrder('@team and @sarah', teamAgents)).toEqual([
      'team-coord',
      'sarah',
    ]);
  });

  it('merges newly mentioned folders into engaged list', () => {
    expect(mergeEngagedAgents(['sarah'], '@diego please', agents)).toEqual(['sarah', 'diego']);
    expect(mergeEngagedAgents(['sarah'], 'no mentions', agents)).toEqual(['sarah']);
    expect(mergeEngagedAgents(['sarah'], '@sarah again', agents)).toEqual(['sarah']);
  });

  it('ignores @here when parsing folder mentions', () => {
    expect(mentionedFoldersInOrder('@here @sarah', agents)).toEqual(['sarah']);
    expect(mentionsInOrder('@here @sarah', agents)).toEqual(['Sarah']);
    expect(mentionedFoldersInOrder('@unknown @sarah', agents)).toEqual(['sarah']);
  });

  it('updates engaged state maps after send', () => {
    expect(
      engagedStateAfterSend({}, 'lobby|main', '@sarah hello', agents),
    ).toEqual({ 'lobby|main': ['sarah'] });
    expect(
      engagedStateAfterSend({ 'lobby|main': ['sarah'] }, 'lobby|main', '@team join', agents),
    ).toEqual({ 'lobby|main': ['sarah', 'team'] });
  });
});
