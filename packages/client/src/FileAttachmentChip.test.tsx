import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FileAttachmentChip } from './FileAttachmentChip';

describe('FileAttachmentChip', () => {
  it('renders kind label and filename', () => {
    render(
      <FileAttachmentChip
        att={{
          name: 'report.pdf',
          mimeType: 'application/pdf',
          type: 'file',
        }}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText('PDF')).toBeInTheDocument();
    expect(screen.getByText('report.pdf')).toBeInTheDocument();
  });

  it('opens attachment on click', () => {
    const onOpen = vi.fn();
    const att = {
      name: 'notes.md',
      mimeType: 'text/markdown',
      type: 'file' as const,
    };
    render(<FileAttachmentChip att={att} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: 'notes.md' }));
    expect(onOpen).toHaveBeenCalledWith(att);
  });
});
