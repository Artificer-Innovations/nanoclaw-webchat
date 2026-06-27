import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as attachments from './attachments';
import {
  ComposerAudioPreview,
  composerAudioPreviewUsesFileChip,
  ComposerImagePreview,
  composerImagePreviewUsesFileChip,
  ComposerVideoPreview,
  composerPreviewClassName,
  composerVideoPreviewUsesFileChip,
  MessageAudioAttachment,
  MessageImageAttachment,
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
    expect(composerAudioPreviewUsesFileChip('audio/flac')).toBe(
      !attachments.audioMimeTypePlayable('audio/flac'),
    );
  });

  it('builds composer preview class names from attachment metadata', () => {
    expect(
      composerPreviewClassName({
        type: 'file',
        mimeType: 'application/pdf',
        name: 'report.pdf',
      }),
    ).toBe('composer-preview composer-preview-file');
    expect(
      composerPreviewClassName({
        type: 'file',
        mimeType: 'text/markdown',
        name: 'notes.md',
      }),
    ).toBe('composer-preview composer-preview-text');
    expect(
      composerPreviewClassName({
        type: 'file',
        mimeType: 'audio/mpeg',
        name: 'song.mp3',
      }),
    ).toBe('composer-preview composer-preview-audio');
  });

  it('renders composer video fallback on unsupported playback', () => {
    vi.spyOn(attachments, 'videoMimeTypePlayable').mockReturnValue(false);
    render(
      <ComposerVideoPreview previewUrl="blob:video" mimeType="video/quicktime" name="clip.mov" />,
    );
    expect(screen.getByText('clip.mov')).toHaveClass('composer-preview-name');
  });

  it('renders composer audio fallback on unsupported playback', () => {
    vi.spyOn(attachments, 'audioMimeTypePlayable').mockReturnValue(false);
    render(
      <ComposerAudioPreview previewUrl="blob:audio" mimeType="audio/flac" name="song.flac" />,
    );
    expect(screen.getByText('song.flac')).toHaveClass('composer-preview-name');
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

  it('opens the drawer from the message audio fallback chip', () => {
    const onOpen = vi.fn();
    vi.spyOn(attachments, 'audioMimeTypePlayable').mockReturnValue(false);
    render(
      <MessageAudioAttachment
        att={{ name: 'song.flac', mimeType: 'audio/flac', type: 'file' }}
        previewUrl="data:audio/flac;base64,aa=="
        onOpenAttachment={onOpen}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'song.flac' }));
    expect(onOpen).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'song.flac', mimeType: 'audio/flac' }),
    );
  });

  it('falls back to a file chip when HEIC is not displayable in this browser', () => {
    vi.spyOn(attachments, 'imageMimeTypeDisplayable').mockReturnValue(false);
    const onOpen = vi.fn();
    render(
      <MessageImageAttachment
        att={{ name: 'photo.heic', mimeType: 'image/heic', type: 'image' }}
        previewUrl="data:image/heic;base64,aa=="
        onOpenAttachment={onOpen}
      />,
    );
    expect(screen.getByText('Image')).toBeInTheDocument();
    expect(screen.getByText('photo.heic')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /photo\.heic/ }));
    expect(onOpen).toHaveBeenCalled();
  });

  it('falls back when message image preview fails to load', () => {
    vi.spyOn(attachments, 'imageMimeTypeDisplayable').mockReturnValue(true);
    const onOpen = vi.fn();
    const { container } = render(
      <MessageImageAttachment
        att={{ name: 'photo.heic', mimeType: 'image/heic', type: 'image' }}
        previewUrl="data:image/heic;base64,aa=="
        onOpenAttachment={onOpen}
      />,
    );
    fireEvent.error(container.querySelector('img')!);
    fireEvent.click(screen.getByRole('button', { name: 'View photo.heic' }));
    expect(onOpen).toHaveBeenCalled();
    expect(screen.getByText('photo.heic')).toBeInTheDocument();
    expect(screen.getByText('Image')).toBeInTheDocument();
  });

  it('reports when composer image previews should use the file chip styling', () => {
    expect(composerImagePreviewUsesFileChip('image/heic')).toBe(
      !attachments.imageMimeTypeDisplayable('image/heic'),
    );
  });

  it('renders composer image fallback when HEIC is not displayable', () => {
    vi.spyOn(attachments, 'imageMimeTypeDisplayable').mockReturnValue(false);
    render(
      <ComposerImagePreview previewUrl="blob:img" mimeType="image/heic" name="photo.heic" />,
    );
    expect(screen.getByText('photo.heic')).toHaveClass('composer-preview-name');
  });

  it('renders composer image fallback after a load error', () => {
    vi.spyOn(attachments, 'imageMimeTypeDisplayable').mockReturnValue(true);
    const { container } = render(
      <ComposerImagePreview previewUrl="blob:img" mimeType="image/png" name="photo.png" />,
    );
    fireEvent.error(container.querySelector('img')!);
    expect(screen.getByText('photo.png')).toHaveClass('composer-preview-name');
  });

  it('renders inline message audio when playable', () => {
    const onOpen = vi.fn();
    const { container } = render(
      <MessageAudioAttachment
        att={{ name: 'song.mp3', mimeType: 'audio/mpeg', type: 'file' }}
        previewUrl="data:audio/mpeg;base64,aa=="
        onOpenAttachment={onOpen}
      />,
    );
    expect(container.querySelector('.msg-attachment-audio audio')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View song.mp3' }));
    expect(onOpen).toHaveBeenCalled();
  });

  it('falls back when inline message audio hits a playback error', () => {
    const { container } = render(
      <MessageAudioAttachment
        att={{ name: 'song.mp3', mimeType: 'audio/mpeg', type: 'file' }}
        previewUrl="data:audio/mpeg;base64,aa=="
        onOpenAttachment={vi.fn()}
      />,
    );
    const audio = container.querySelector('audio') as HTMLAudioElement;
    Object.defineProperty(audio, 'error', { value: { code: 4 }, configurable: true });
    fireEvent.error(audio);
    expect(screen.getByText('song.mp3')).toBeInTheDocument();
    expect(screen.getByText('File')).toBeInTheDocument();
  });

  it('opens the drawer from an inline message video preview', () => {
    const onOpen = vi.fn();
    render(
      <MessageVideoAttachment
        att={{ name: 'clip.mp4', mimeType: 'video/mp4', type: 'file' }}
        previewUrl="data:video/mp4;base64,aa=="
        onOpenAttachment={onOpen}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'View clip.mp4' }));
    expect(onOpen).toHaveBeenCalled();
  });

  it('renders message image preview when load succeeds', () => {
    const { container } = render(
      <MessageImageAttachment
        att={{ name: 'photo.png', mimeType: 'image/png', type: 'image' }}
        previewUrl="data:image/png;base64,aa=="
        onOpenAttachment={vi.fn()}
      />,
    );
    expect(container.querySelector('.msg-attachment-image img')).toBeInTheDocument();
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

  it('renders composer audio fallback after a load error', () => {
    const { container } = render(
      <ComposerAudioPreview previewUrl="blob:audio" mimeType="audio/mpeg" name="song.mp3" />,
    );
    const audio = container.querySelector('audio') as HTMLAudioElement;
    Object.defineProperty(audio, 'error', { value: { code: 4 }, configurable: true });
    fireEvent.error(audio);
    expect(screen.getByText('song.mp3')).toHaveClass('composer-preview-name');
  });
});
