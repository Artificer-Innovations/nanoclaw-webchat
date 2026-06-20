import type { Components } from 'react-markdown';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { remarkMentions } from './remark-mentions';

const markdownComponents: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  pre: ({ children }) => <pre className="code-block">{children}</pre>,
  code: ({ children, className, ...props }) => {
    if (className) {
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    }
    const text = String(children);
    if (text.includes('\n')) {
      return <code {...props}>{children}</code>;
    }
    return (
      <code className="inline-code" {...props}>
        {children}
      </code>
    );
  },
};

export function FormattedMessage({ text, className }: { text: string; className?: string }) {
  return (
    <div className={className ?? 'formatted-message'}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks, remarkMentions]} components={markdownComponents}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
