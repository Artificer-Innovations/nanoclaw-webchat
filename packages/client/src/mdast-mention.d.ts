import type { Parent, Text } from 'mdast';

declare module 'mdast' {
  interface Mention extends Parent {
    type: 'mention';
    data?: {
      hName?: string;
      hProperties?: { className?: string[] };
    };
    children: [Text];
  }

  interface PhrasingContentMap {
    mention: Mention;
  }
}
