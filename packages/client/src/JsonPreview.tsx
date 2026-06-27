import { useMemo } from 'react';

function formatJsonLeaf(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  return String(value);
}

function JsonTreeNode({
  name,
  value,
  depth = 0,
}: {
  name: string;
  value: unknown;
  depth?: number;
}) {
  if (value !== null && typeof value === 'object') {
    const entries = Array.isArray(value)
      ? value.map((entry, index) => [String(index), entry] as const)
      : Object.entries(value as Record<string, unknown>);
    const open = depth < 2;
    return (
      <details className="attachment-drawer-json-node" open={open}>
        <summary className="attachment-drawer-json-summary">
          <span className="attachment-drawer-json-key">{name}</span>
          <span className="attachment-drawer-json-meta">
            {Array.isArray(value) ? `[${value.length}]` : `{${entries.length}}`}
          </span>
        </summary>
        <div className="attachment-drawer-json-children">
          {entries.map(([key, child]) => (
            <JsonTreeNode key={key} name={key} value={child} depth={depth + 1} />
          ))}
        </div>
      </details>
    );
  }

  return (
    <div className="attachment-drawer-json-leaf">
      <span className="attachment-drawer-json-key">{name}</span>
      <span className="attachment-drawer-json-value">{formatJsonLeaf(value)}</span>
    </div>
  );
}

export function parseJsonForPreview(text: string): unknown | null {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export function JsonPreview({ text }: { text: string }) {
  const parsed = useMemo(() => parseJsonForPreview(text), [text]);
  if (parsed === null) {
    return <pre className="attachment-drawer-raw">{text}</pre>;
  }
  return (
    <div className="attachment-drawer-json">
      <JsonTreeNode name="root" value={parsed} />
    </div>
  );
}
