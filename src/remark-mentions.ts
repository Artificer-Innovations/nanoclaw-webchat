import type { Root } from 'mdast';
import { visit } from 'unist-util-visit';

const MENTION_PATTERN = /@(\w+)/g;

interface MentionNode {
  type: 'mention';
  data: {
    hName: 'span';
    hProperties: { className: string[] };
  };
  children: [{ type: 'text'; value: string }];
}

type TextNode = { type: 'text'; value: string };
type PhrasingNode = TextNode | MentionNode;

function hasMention(text: string): boolean {
  return /@\w+/.test(text);
}

function splitTextWithMentions(value: string): PhrasingNode[] {
  const nodes: PhrasingNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const pattern = new RegExp(MENTION_PATTERN.source, MENTION_PATTERN.flags);

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

export function remarkMentions() {
  return (tree: Root) => {
    visit(tree, 'text', (node, index, parent) => {
      if (index === undefined || !parent || parent.type === 'mention') return;
      if (!hasMention(node.value)) return;

      const nodes = splitTextWithMentions(node.value);
      parent.children.splice(index, 1, ...(nodes as Root['children']));
    });
  };
}
