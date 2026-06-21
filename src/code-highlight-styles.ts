/** Shared styles for highlight.js output in drawer and popouts. */
export const CODE_HIGHLIGHT_STYLES = `
.hljs {
  display: block;
  overflow-x: auto;
  padding: 0;
  background: transparent;
  color: inherit;
}
.attachment-drawer-code,
.code-preview {
  margin: 0;
  padding: 0.75rem;
  overflow: auto;
  background: var(--code-bg);
  border: 1px solid var(--code-border);
  border-radius: 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.8125rem;
  line-height: 1.45;
}
.attachment-drawer-code code,
.code-preview code {
  font-family: inherit;
  white-space: pre;
}
.hljs-comment,
.hljs-quote { color: #7a8490; font-style: italic; }
.hljs-keyword,
.hljs-selector-tag,
.hljs-subst { color: #c678dd; }
.hljs-number,
.hljs-literal,
.hljs-variable,
.hljs-template-variable,
.hljs-tag .hljs-attr { color: #d19a66; }
.hljs-string,
.hljs-doctag,
.hljs-regexp { color: #98c379; }
.hljs-title,
.hljs-section,
.hljs-selector-id,
.hljs-selector-class { color: #61afef; }
.hljs-type,
.hljs-class .hljs-title { color: #e5c07b; }
.hljs-symbol,
.hljs-bullet,
.hljs-link { color: #56b6c2; }
.hljs-meta { color: #abb2bf; }
.hljs-built_in,
.hljs-builtin-name { color: #e06c75; }
.hljs-addition { color: #98c379; }
.hljs-deletion { color: #e06c75; }
`;
