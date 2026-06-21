import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CodePreview } from './CodePreview';

describe('CodePreview', () => {
  it('renders highlighted code', () => {
    const { container } = render(
      <CodePreview text={'const x = 1;'} language="typescript" />,
    );
    const code = container.querySelector('.attachment-drawer-code code.hljs');
    expect(code).toBeTruthy();
    expect(code?.className).toContain('language-typescript');
    expect(screen.getByText(/x/)).toBeInTheDocument();
  });
});
