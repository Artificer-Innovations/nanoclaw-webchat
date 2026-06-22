import type { Root } from 'mdast';
import { describe, expect, it } from 'vitest';
import { remarkMentions } from './remark-mentions';

function paragraphText(text: string): Root {
  return {
    type: 'root',
    children: [{ type: 'paragraph', children: [{ type: 'text', value: text }] }],
  };
}

function runPlugin(tree: Root): Root {
  remarkMentions()(tree);
  return tree;
}

describe('remarkMentions', () => {
  it('wraps user mentions in custom nodes', () => {
    const tree = runPlugin(paragraphText('hello @sarah'));
    const paragraph = tree.children[0];
    expect(paragraph?.type).toBe('paragraph');
    if (paragraph?.type !== 'paragraph') return;

    expect(paragraph.children[0]).toEqual({ type: 'text', value: 'hello ' });
    expect(paragraph.children[1]).toMatchObject({
      type: 'mention',
      data: { hProperties: { className: ['mention', 'mention-user'] } },
    });
  });

  it('uses mention-here styling for @here', () => {
    const tree = runPlugin(paragraphText('ping @here'));
    const paragraph = tree.children[0];
    if (paragraph?.type !== 'paragraph') return;

    expect(paragraph.children[1]).toMatchObject({
      type: 'mention',
      data: { hProperties: { className: ['mention', 'mention-here'] } },
    });
  });

  it('keeps trailing text after a mention', () => {
    const tree = runPlugin(paragraphText('@sarah ok'));
    const paragraph = tree.children[0];
    if (paragraph?.type !== 'paragraph') return;

    expect(paragraph.children).toHaveLength(2);
    expect(paragraph.children[1]).toEqual({ type: 'text', value: ' ok' });
  });

  it('splits multiple mentions in one text node', () => {
    const tree = runPlugin(paragraphText('@a then @b'));
    const paragraph = tree.children[0];
    if (paragraph?.type !== 'paragraph') return;

    expect(paragraph.children).toHaveLength(3);
    expect(paragraph.children[0]?.type).toBe('mention');
    expect(paragraph.children[1]).toEqual({ type: 'text', value: ' then ' });
    expect(paragraph.children[2]?.type).toBe('mention');
  });

  it('leaves text without mentions unchanged', () => {
    const tree = runPlugin(paragraphText('plain text'));
    const paragraph = tree.children[0];
    if (paragraph?.type !== 'paragraph') return;

    expect(paragraph.children).toEqual([{ type: 'text', value: 'plain text' }]);
  });

  it('does not re-process text inside existing mention nodes', () => {
    const tree: Root = {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            {
              type: 'mention',
              data: {
                hName: 'span',
                hProperties: { className: ['mention', 'mention-user'] },
              },
              children: [{ type: 'text', value: '@sarah' }],
            },
          ],
        },
      ],
    };

    runPlugin(tree);
    const paragraph = tree.children[0];
    if (paragraph?.type !== 'paragraph') return;

    expect(paragraph.children).toHaveLength(1);
    expect(paragraph.children[0]?.type).toBe('mention');
  });

  it('processes mentions independently across multiple text nodes', () => {
    const tree: Root = {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: '@sarah' },
            { type: 'text', value: ' and @diego' },
          ],
        },
      ],
    };

    runPlugin(tree);
    const paragraph = tree.children[0];
    if (paragraph?.type !== 'paragraph') return;

    expect(paragraph.children.filter((node) => node.type === 'mention')).toHaveLength(2);
  });
});
