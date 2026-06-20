import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FormattedMessage } from './FormattedMessage';

describe('FormattedMessage', () => {
  it('renders plain text, inline code, and fenced blocks', () => {
    render(<FormattedMessage text={'say `hi`\n```\ncode\n```'} />);

    expect(screen.getByText((_, el) => el?.textContent === 'say ')).toBeInTheDocument();
    expect(screen.getByText('hi')).toHaveClass('inline-code');
    expect(screen.getByText('code')).toBeInTheDocument();
  });

  it('accepts a custom className', () => {
    const { container } = render(<FormattedMessage text="hello" className="custom-message" />);
    expect(container.querySelector('.custom-message')).toBeInTheDocument();
  });
});
