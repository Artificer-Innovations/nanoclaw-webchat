import type { Mention, PhrasingContent, Root } from 'mdast';
import { visit } from 'unist-util-visit';
import { MENTION_HANDLE_PATTERN, textHasMention } from './mention-pattern';

function splitTextWithMentions(value: string): PhrasingContent[] {
  const nodes: PhrasingContent[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const pattern = new RegExp(MENTION_HANDLE_PATTERN.source, MENTION_HANDLE_PATTERN.flags);

  while ((match = pattern.exec(value)) !== null) {
    if (match.index > lastIndex) {
      nodes.push({ type: 'text', value: value.slice(lastIndex, match.index) });
    }
    const word = match[1]!.toLowerCase();
    const className = word === 'here' ? ['mention', 'mention-here'] : ['mention', 'mention-user'];
    nodes.push({
      type: 'mention',
      data: {
        hName: 'span',
        hProperties: { className },
      },
      children: [{ type: 'text', value: match[0]! }],
    });
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < value.length) {
    nodes.push({ type: 'text', value: value.slice(lastIndex) });
  }

  return nodes;
}

function isMentionParent(parent: { type: string }): parent is Mention {
  return parent.type === 'mention';
}

export function remarkMentions() {
  return (tree: Root) => {
    visit(tree, 'text', (node, index, parent) => {
      if (index === undefined || !parent || isMentionParent(parent)) return;
      if (!textHasMention(node.value)) return;

      const nodes = splitTextWithMentions(node.value);
      parent.children.splice(index, 1, ...nodes);
    });
  };
}
