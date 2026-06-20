import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import * as attachments from './attachments';
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
      />,
    );
    expect(container.querySelector('.msg-attachment-image img')).toHaveAttribute(
      'src',
      'data:image/png;base64,aGVsbG8=',
    );
    expect(container.querySelector('.msg-attachment-image img')).toHaveAttribute('alt', '');
    const link = screen.getByRole('link', { name: 'Open photo.png in new tab' });
    expect(link).toHaveAttribute('href', 'data:image/png;base64,aGVsbG8=');
    expect(link).not.toHaveAttribute('target');
  });

  it('opens image attachments via blob URL on click', () => {
    const openSpy = vi.spyOn(attachments, 'openAttachmentInNewTab').mockReturnValue(true);
    const preventDefaultSpy = vi.spyOn(Event.prototype, 'preventDefault');
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
      />,
    );
    fireEvent.click(container.querySelector('.msg-attachment-image')!);
    expect(openSpy).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'photo.png', mimeType: 'image/png', data: 'aGVsbG8=' }),
    );
    expect(preventDefaultSpy).toHaveBeenCalled();
    openSpy.mockRestore();
    preventDefaultSpy.mockRestore();
  });

  it('falls back to the href when opening in a new tab fails', () => {
    const openSpy = vi.spyOn(attachments, 'openAttachmentInNewTab').mockReturnValue(false);
    const preventDefaultSpy = vi.spyOn(Event.prototype, 'preventDefault');
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
      />,
    );
    fireEvent.click(container.querySelector('.msg-attachment-image')!);
    expect(preventDefaultSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
    preventDefaultSpy.mockRestore();
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
    const attachmentList = [
      { name: 'notes.md', mimeType: 'text/markdown', type: 'file' as const, size: 10, data: 'YQ==' },
      { name: 'notes.md', mimeType: 'text/markdown', type: 'file' as const, size: 10, data: 'Yg==' },
    ];
    const { container } = render(<MessageAttachments attachments={attachmentList} />);
    expect(container.querySelectorAll('.msg-attachment-file')).toHaveLength(2);
  });
});
