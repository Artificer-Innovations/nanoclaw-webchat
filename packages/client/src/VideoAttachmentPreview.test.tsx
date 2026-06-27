import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as attachments from './attachments';
import {
  ComposerVideoPreview,
  composerVideoPreviewUsesFileChip,
  MessageVideoAttachment,
} from './VideoAttachmentPreview';

describe('VideoAttachmentPreview', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('reports when composer previews should use the file chip styling', () => {
    expect(composerVideoPreviewUsesFileChip('video/quicktime')).toBe(
      !attachments.videoMimeTypePlayable('video/quicktime'),
    );
  });

  it('renders composer video fallback on unsupported playback', () => {
    vi.spyOn(attachments, 'videoMimeTypePlayable').mockReturnValue(false);
    render(
      <ComposerVideoPreview previewUrl="blob:video" mimeType="video/quicktime" name="clip.mov" />,
    );
    expect(screen.getByText('clip.mov')).toHaveClass('composer-preview-name');
  });

  it('opens the drawer from the message video fallback chip', () => {
    const onOpen = vi.fn();
    vi.spyOn(attachments, 'videoMimeTypePlayable').mockReturnValue(false);
    render(
      <MessageVideoAttachment
        att={{ name: 'clip.mov', mimeType: 'video/quicktime', type: 'file' }}
        previewUrl="data:video/quicktime;base64,aa=="
        onOpenAttachment={onOpen}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'clip.mov' }));
    expect(onOpen).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'clip.mov', mimeType: 'video/quicktime' }),
    );
  });

  it('renders composer video fallback after a load error', () => {
    const { container } = render(
      <ComposerVideoPreview previewUrl="blob:video" mimeType="video/mp4" name="clip.mp4" />,
    );
    const video = container.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'error', { value: { code: 4 }, configurable: true });
    fireEvent.error(video);
    expect(screen.getByText('clip.mp4')).toHaveClass('composer-preview-name');
  });
});
