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
  });
});
