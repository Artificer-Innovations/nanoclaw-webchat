import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as attachments from './attachments';
import { MessageAttachments } from './MessageAttachments';

const onOpenAttachment = vi.fn();

describe('MessageAttachments', () => {
  afterEach(() => {
    cleanup();
    onOpenAttachment.mockClear();
    vi.restoreAllMocks();
  });
  it('renders nothing for empty attachments', () => {
    const { container } = render(
      <MessageAttachments attachments={[]} onOpenAttachment={onOpenAttachment} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('skips attachments without a display source', () => {
    const { container } = render(
      <MessageAttachments
        attachments={[{ name: 'missing.bin', mimeType: 'application/octet-stream', type: 'file' }]}
        onOpenAttachment={onOpenAttachment}
      />,
    );
    expect(container.querySelector('.msg-attachments')?.children.length).toBe(0);
  });

  it('renders file attachments from server URLs without inline data', () => {
    render(
      <MessageAttachments
        attachments={[
          {
            name: 'notes.md',
            mimeType: 'text/markdown',
            type: 'file',
            url: '/api/attachments/msg-1/notes.md',
          },
        ]}
        onOpenAttachment={onOpenAttachment}
      />,
    );
    expect(screen.getByRole('button', { name: 'notes.md' })).toBeInTheDocument();
  });

  it('skips image attachments without a preview source', () => {
    const { container } = render(
      <MessageAttachments
        attachments={[
          {
            name: 'photo.png',
            mimeType: 'image/png',
            type: 'image',
          },
        ]}
        onOpenAttachment={onOpenAttachment}
      />,
    );
    expect(container.querySelector('.msg-attachment-image')).toBeNull();
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

  it('skips video attachments without a preview source', () => {
    const { container } = render(
      <MessageAttachments
        attachments={[
          {
            name: 'clip.mp4',
            mimeType: 'video/mp4',
            type: 'file',
          },
        ]}
        onOpenAttachment={onOpenAttachment}
      />,
    );
    expect(container.querySelector('.msg-attachment-video')).toBeNull();
  });

  it('renders video attachments as view buttons', () => {
    const { container } = render(
      <MessageAttachments
        attachments={[
          {
            name: 'clip.mp4',
            mimeType: 'video/mp4',
            type: 'file',
            data: 'aGVsbG8=',
          },
        ]}
        onOpenAttachment={onOpenAttachment}
      />,
    );
    expect(container.querySelector('.msg-attachment-video video')).toHaveAttribute(
      'src',
      'data:video/mp4;base64,aGVsbG8=',
    );
    const button = screen.getByRole('button', { name: 'View clip.mp4' });
    expect(button).toHaveClass('msg-attachment-video');
    expect(container.querySelector('.msg-attachment-video video')).toHaveAttribute('preload', 'none');
  });

  it('falls back to a file button when the browser cannot play the video container', () => {
    vi.spyOn(attachments, 'videoMimeTypePlayable').mockReturnValue(false);
    const { container } = render(
      <MessageAttachments
        attachments={[
          {
            name: 'clip.mov',
            mimeType: 'video/quicktime',
            type: 'file',
            data: 'aGVsbG8=',
          },
        ]}
        onOpenAttachment={onOpenAttachment}
      />,
    );
    expect(container.querySelector('.msg-attachment-video')).toBeNull();
    expect(screen.getByRole('button', { name: 'clip.mov' })).toHaveClass('msg-attachment-file');
    fireEvent.click(screen.getByRole('button', { name: 'clip.mov' }));
    expect(onOpenAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'clip.mov', mimeType: 'video/quicktime' }),
    );
  });

  it('falls back to a file button when video playback is not supported', () => {
    const { container } = render(
      <MessageAttachments
        attachments={[
          {
            name: 'clip.mp4',
            mimeType: 'video/mp4',
            type: 'file',
            data: 'aGVsbG8=',
          },
        ]}
        onOpenAttachment={onOpenAttachment}
      />,
    );
    const video = container.querySelector('.msg-attachment-video video') as HTMLVideoElement;
    Object.defineProperty(video, 'error', { value: { code: 4 }, configurable: true });
    fireEvent.error(video);
    expect(container.querySelector('.msg-attachment-video')).toBeNull();
    expect(screen.getByRole('button', { name: 'clip.mp4' })).toHaveClass('msg-attachment-file');
  });

  it('opens video attachments in the drawer on click', () => {
    const open = vi.fn();
    const { container } = render(
      <MessageAttachments
        attachments={[
          {
            name: 'clip.mp4',
            mimeType: 'video/mp4',
            type: 'file',
            data: 'aGVsbG8=',
          },
        ]}
        onOpenAttachment={open}
      />,
    );
    fireEvent.click(container.querySelector('.msg-attachment-video')!);
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'clip.mp4', mimeType: 'video/mp4', data: 'aGVsbG8=' }),
    );
  });

  it('skips audio attachments without a preview source', () => {
    const { container } = render(
      <MessageAttachments
        attachments={[
          {
            name: 'song.mp3',
            mimeType: 'audio/mpeg',
            type: 'file',
          },
        ]}
        onOpenAttachment={onOpenAttachment}
      />,
    );
    expect(container.querySelector('.msg-attachment-audio')).toBeNull();
  });

  it('renders audio attachments with inline controls', () => {
    const { container } = render(
      <MessageAttachments
        attachments={[
          {
            name: 'song.mp3',
            mimeType: 'audio/mpeg',
            type: 'file',
            data: 'aGVsbG8=',
          },
        ]}
        onOpenAttachment={onOpenAttachment}
      />,
    );
    expect(container.querySelector('.msg-attachment-audio audio')).toHaveAttribute(
      'src',
      'data:audio/mpeg;base64,aGVsbG8=',
    );
    expect(screen.getByRole('button', { name: 'View song.mp3' })).toHaveClass(
      'msg-attachment-audio-title',
    );
  });

  it('opens audio attachments in the drawer from the title button', () => {
    const open = vi.fn();
    render(
      <MessageAttachments
        attachments={[
          {
            name: 'song.mp3',
            mimeType: 'audio/mpeg',
            type: 'file',
            data: 'aGVsbG8=',
          },
        ]}
        onOpenAttachment={open}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'View song.mp3' }));
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'song.mp3', mimeType: 'audio/mpeg', data: 'aGVsbG8=' }),
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

  it('renders mp3 attachments with generic mime types using filename inference', () => {
    const { container } = render(
      <MessageAttachments
        attachments={[
          {
            name: 'song.mp3',
            mimeType: 'application/octet-stream',
            type: 'file',
            data: 'aGVsbG8=',
          },
        ]}
        onOpenAttachment={onOpenAttachment}
      />,
    );
    expect(container.querySelector('.msg-attachment-audio audio')).toHaveAttribute(
      'src',
      'data:audio/mpeg;base64,aGVsbG8=',
    );
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
