import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FormattedMessage } from './FormattedMessage';

describe('FormattedMessage', () => {
  afterEach(() => {
    cleanup();
  });
  it('renders plain text, inline code, and fenced blocks', () => {
    render(<FormattedMessage text={'say `hi`\n```\ncode\n```'} />);

    expect(screen.getByText('say')).toBeInTheDocument();
    expect(screen.getByText('hi')).toHaveClass('inline-code');
    expect(screen.getByText('code')).toBeInTheDocument();
    expect(document.querySelector('.code-block')).toBeInTheDocument();
  });

  it('accepts a custom className', () => {
    const { container } = render(<FormattedMessage text="hello" className="custom-message" />);
    expect(container.querySelector('.custom-message')).toBeInTheDocument();
  });

  it('renders inline code in plain text', () => {
    render(<FormattedMessage text="use `npm install` here" />);
    expect(screen.getByText('npm install')).toHaveClass('inline-code');
  });

  it('renders fenced code blocks with surrounding text', () => {
    render(<FormattedMessage text={'before\n```\nline one\nline two\n```\nafter'} />);
    expect(screen.getByText('before')).toBeInTheDocument();
    expect(screen.getByText(/line one/)).toBeInTheDocument();
    expect(screen.getByText('after')).toBeInTheDocument();
  });

  it('renders inline code around a fenced block', () => {
    render(<FormattedMessage text={'run `foo` then:\n```\nbar\n```'} />);
    expect(screen.getByText('foo')).toHaveClass('inline-code');
    expect(screen.getByText('bar')).toBeInTheDocument();
  });

  it('renders compact fenced blocks without newlines as inline code', () => {
    const { container } = render(<FormattedMessage text="```code```" />);
    expect(container.querySelector('.inline-code')?.textContent).toBe('code');
    expect(container.querySelector('.code-block')).not.toBeInTheDocument();
  });

  it('renders bold, italic, and strikethrough', () => {
    render(<FormattedMessage text="**bold** *italic* ~~strike~~" />);
    expect(screen.getByText('bold').tagName).toBe('STRONG');
    expect(screen.getByText('italic').tagName).toBe('EM');
    expect(screen.getByText('strike').tagName).toBe('DEL');
  });

  it('renders headers', () => {
    render(<FormattedMessage text="# Title" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Title' })).toBeInTheDocument();
  });

  it('renders bullet lists', () => {
    render(<FormattedMessage text={`- one
- two`} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('one');
    expect(items[1]).toHaveTextContent('two');
  });

  it('renders markdown links', () => {
    render(<FormattedMessage text="[docs](https://example.com/docs)" />);
    const link = screen.getByRole('link', { name: 'docs' });
    expect(link).toHaveAttribute('href', 'https://example.com/docs');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('autolinks bare URLs', () => {
    render(<FormattedMessage text="see https://example.com now" />);
    const link = screen.getByRole('link', { name: 'https://example.com' });
    expect(link).toHaveAttribute('href', 'https://example.com');
  });

  it('styles user mentions as pills', () => {
    render(<FormattedMessage text="hello @sarah" />);
    const mention = screen.getByText('@sarah');
    expect(mention).toHaveClass('mention', 'mention-user');
  });

  it('styles @here mentions differently', () => {
    render(<FormattedMessage text="ping @here please" />);
    const mention = screen.getByText('@here');
    expect(mention).toHaveClass('mention', 'mention-here');
  });

  it('preserves line breaks in plain text', () => {
    const { container } = render(<FormattedMessage text={`line one
line two`} />);
    expect(container.querySelector('br')).toBeInTheDocument();
  });

  it('renders fenced code blocks with a language class', () => {
    const { container } = render(
      <FormattedMessage text={'```javascript\nconst x = 1;\n```'} />,
    );
    expect(container.querySelector('code.language-javascript')?.textContent).toContain('const x = 1');
  });

  it('does not style mentions inside inline code', () => {
    const { container } = render(<FormattedMessage text="`@sarah`" />);
    const code = container.querySelector('.inline-code');
    expect(code?.textContent).toBe('@sarah');
    expect(container.querySelector('.mention')).not.toBeInTheDocument();
  });
});
