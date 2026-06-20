import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MessageAttachments } from './MessageAttachments';

describe('MessageAttachments', () => {
  it('renders nothing for empty attachments', () => {
    const { container } = render(<MessageAttachments attachments={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('skips attachments without encoded data', () => {
    const { container } = render(
      <MessageAttachments
        attachments={[{ name: 'missing.bin', mimeType: 'application/octet-stream', type: 'file' }]}
      />,
    );
    expect(container.querySelector('.msg-attachments')?.children.length).toBe(0);
  });

  it('renders image attachments', () => {
    render(
      <MessageAttachments
        attachments={[
          {
            name: 'photo.png',
            mimeType: 'image/png',
            type: 'image',
            data: 'aGVsbG8=',
          },
        ]}
      />,
    );
    expect(screen.getByRole('img', { name: 'photo.png' })).toHaveAttribute(
      'src',
      'data:image/png;base64,aGVsbG8=',
    );
  });

  it('renders file attachments as download links', () => {
    render(
      <MessageAttachments
        attachments={[
          {
            name: 'report.pdf',
            mimeType: 'application/pdf',
            type: 'file',
            data: 'aGVsbG8=',
          },
        ]}
      />,
    );
    const link = screen.getByRole('link', { name: 'report.pdf' });
    expect(link).toHaveAttribute('download', 'report.pdf');
    expect(link).toHaveAttribute('href', 'data:application/pdf;base64,aGVsbG8=');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('renders mismatched server type using mimeType', () => {
    const { container } = render(
      <MessageAttachments
        attachments={[
          {
            name: 'mismatch.png',
            mimeType: 'image/png',
            type: 'file',
            data: 'aGVsbG8=',
          },
        ]}
      />,
    );
    expect(container.querySelector('.msg-attachment-image img')).toBeInTheDocument();
  });

  it('uses distinct keys for duplicate filenames', () => {
    const attachments = [
      { name: 'notes.md', mimeType: 'text/markdown', type: 'file' as const, size: 10, data: 'YQ==' },
      { name: 'notes.md', mimeType: 'text/markdown', type: 'file' as const, size: 10, data: 'Yg==' },
    ];
    const { container } = render(<MessageAttachments attachments={attachments} />);
    expect(container.querySelectorAll('.msg-attachment-file')).toHaveLength(2);
  });
});
