import { useMemo } from 'react';
import { highlightCodeHtml } from './code-highlight';

export function CodePreview({ text, language }: { text: string; language: string }) {
  const html = useMemo(() => highlightCodeHtml(text, language), [language, text]);
  return (
    <pre className="attachment-drawer-code">
      <code
        className={`hljs language-${language}`}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </pre>
  );
}
