import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageAttachments } from './MessageAttachments';

const onOpenAttachment = vi.fn();

describe('MessageAttachments', () => {
  afterEach(() => {
    cleanup();
    onOpenAttachment.mockClear();
  });
  it('renders nothing for empty attachments', () => {
    const { container } = render(
      <MessageAttachments attachments={[]} onOpenAttachment={onOpenAttachment} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('skips attachments without encoded data', () => {
    const { container } = render(
      <MessageAttachments
        attachments={[{ name: 'missing.bin', mimeType: 'application/octet-stream', type: 'file' }]}
        onOpenAttachment={onOpenAttachment}
      />,
    );
    expect(container.querySelector('.msg-attachments')?.children.length).toBe(0);
  });

  it('renders image attachments as view buttons', () => {
    const { container } = render(
      <MessageAttachments
        attachments={[
          {
            name: 'photo.png',
            mimeType: 'image/png',
            type: 'image',
            data: 'aGVsbG8=',
          },
        ]}
        onOpenAttachment={onOpenAttachment}
      />,
    );
    expect(container.querySelector('.msg-attachment-image img')).toHaveAttribute(
      'src',
      'data:image/png;base64,aGVsbG8=',
    );
    expect(container.querySelector('.msg-attachment-image img')).toHaveAttribute('alt', '');
    const button = screen.getByRole('button', { name: 'View photo.png' });
    expect(button).toHaveClass('msg-attachment-image');
  });

  it('opens image attachments in the drawer on click', () => {
    const open = vi.fn();
    const { container } = render(
      <MessageAttachments
        attachments={[
          {
            name: 'photo.png',
            mimeType: 'image/png',
            type: 'image',
            data: 'aGVsbG8=',
          },
        ]}
        onOpenAttachment={open}
      />,
    );
    fireEvent.click(container.querySelector('.msg-attachment-image')!);
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'photo.png', mimeType: 'image/png', data: 'aGVsbG8=' }),
    );
  });

  it('renders file attachments as view buttons', () => {
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
        onOpenAttachment={onOpenAttachment}
      />,
    );
    const button = screen.getByRole('button', { name: 'report.pdf' });
    expect(button).toHaveClass('msg-attachment-file');
    expect(button).not.toHaveAttribute('download');
  });

  it('opens file attachments in the drawer on click', () => {
    const open = vi.fn();
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
        onOpenAttachment={open}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'report.pdf' }));
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'report.pdf', mimeType: 'application/pdf' }),
    );
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
        onOpenAttachment={onOpenAttachment}
      />,
    );
    expect(container.querySelector('.msg-attachment-image img')).toBeInTheDocument();
  });

  it('uses distinct keys for duplicate filenames', () => {
    const attachmentList = [
      { name: 'notes.md', mimeType: 'text/markdown', type: 'file' as const, size: 10, data: 'YQ==' },
      { name: 'notes.md', mimeType: 'text/markdown', type: 'file' as const, size: 10, data: 'Yg==' },
    ];
    const { container } = render(
      <MessageAttachments attachments={attachmentList} onOpenAttachment={onOpenAttachment} />,
    );
    expect(container.querySelectorAll('.msg-attachment-file')).toHaveLength(2);
  });
});
