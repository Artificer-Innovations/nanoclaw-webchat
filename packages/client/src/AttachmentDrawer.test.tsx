import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as attachmentCode from './attachment-code';
import * as attachments from './attachments';
import { AttachmentDrawer } from './AttachmentDrawer';

describe('AttachmentDrawer', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.classList.remove('attachment-drawer-resizing');
  });

  it('renders markdown preview after loading text', async () => {
    vi.spyOn(attachments, 'fetchAttachmentText').mockResolvedValue('# Hello');
    render(
      <AttachmentDrawer
        attachment={{
          name: 'notes.md',
          mimeType: 'text/markdown',
          type: 'file',
          data: 'IyBIZWxsbw==',
        }}
        token="secret"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 1, name: 'Hello' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'View mode' })).toBeInTheDocument();
  });

  it('toggles markdown attachments between preview and raw views', async () => {
    vi.spyOn(attachments, 'fetchAttachmentText').mockResolvedValue('# Hello');
    render(
      <AttachmentDrawer
        attachment={{
          name: 'notes.md',
          mimeType: 'text/markdown',
          type: 'file',
          data: 'IyBIZWxsbw==',
        }}
        token="secret"
        onClose={vi.fn()}
      />,
    );
    await screen.findByRole('heading', { level: 1, name: 'Hello' });
    fireEvent.click(screen.getByRole('button', { name: 'Raw' }));
    expect(screen.getByText('# Hello')).toHaveClass('attachment-drawer-raw');
    expect(screen.queryByRole('heading', { level: 1, name: 'Hello' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Hello' })).toBeInTheDocument();
  });

  it('shows pop-out for plain text attachments', async () => {
    vi.spyOn(attachments, 'fetchAttachmentText').mockResolvedValue('hello');
    const openSpy = vi.spyOn(attachments, 'openPlainTextAttachmentInNewTab').mockResolvedValue(true);
    render(
      <AttachmentDrawer
        attachment={{
          name: 'notes.txt',
          mimeType: 'text/plain',
          type: 'file',
          data: 'aGVsbG8=',
        }}
        token="secret"
        onClose={vi.fn()}
      />,
    );
    expect(await screen.findByText('hello')).toHaveClass('attachment-drawer-text');
    fireEvent.click(screen.getByRole('button', { name: 'Open notes.txt in new tab' }));
    expect(openSpy).toHaveBeenCalled();
    expect(screen.queryByRole('group', { name: 'View mode' })).not.toBeInTheDocument();
  });

  it('preserves blank lines in plain text previews', async () => {
    vi.spyOn(attachments, 'fetchAttachmentText').mockResolvedValue('first\n\nsecond');
    render(
      <AttachmentDrawer
        attachment={{
          name: 'notes.txt',
          mimeType: 'text/plain',
          type: 'file',
          data: btoa('first\n\nsecond'),
        }}
        token="secret"
        onClose={vi.fn()}
      />,
    );
    const preview = await screen.findByText(/first/);
    expect(preview).toHaveClass('attachment-drawer-text');
    expect(preview.textContent).toBe('first\n\nsecond');
  });

  it('opens markdown attachments in a rendered pop-out tab', async () => {
    vi.spyOn(attachments, 'fetchAttachmentText').mockResolvedValue('# Popout');
    const openSpy = vi.spyOn(attachments, 'openMarkdownAttachmentInNewTab').mockResolvedValue(true);
    render(
      <AttachmentDrawer
        attachment={{
          name: 'notes.md',
          mimeType: 'text/markdown',
          type: 'file',
          data: 'IyBIZWxsbw==',
        }}
        token="secret"
        onClose={vi.fn()}
      />,
    );
    await screen.findByRole('heading', { level: 1, name: 'Popout' });
    fireEvent.click(screen.getByRole('button', { name: 'Open notes.md in new tab' }));
    expect(openSpy).toHaveBeenCalled();
  });

  it('resets text view to preview when switching attachments', async () => {
    const { rerender } = render(
      <AttachmentDrawer
        attachment={{
          name: 'first.md',
          mimeType: 'text/markdown',
          type: 'file',
          data: 'IyBGaXJzdA==',
        }}
        token="secret"
        onClose={vi.fn()}
      />,
    );
    await screen.findByRole('heading', { level: 1, name: 'First' });
    fireEvent.click(screen.getByRole('button', { name: 'Raw' }));
    expect(screen.getByText('# First')).toBeInTheDocument();
    rerender(
      <AttachmentDrawer
        attachment={{
          name: 'second.md',
          mimeType: 'text/markdown',
          type: 'file',
          data: 'IyBTZWNvbmQ=',
        }}
        token="secret"
        onClose={vi.fn()}
      />,
    );
    expect(await screen.findByRole('heading', { level: 1, name: 'Second' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows an error when markdown content cannot load', async () => {
    vi.spyOn(attachments, 'fetchAttachmentText').mockResolvedValue(null);
    render(
      <AttachmentDrawer
        attachment={{
          name: 'notes.md',
          mimeType: 'text/markdown',
          type: 'file',
          url: '/api/attachments/msg-1/notes.md',
        }}
        token="secret"
        onClose={vi.fn()}
      />,
    );
    expect(await screen.findByText('Could not load attachment content.')).toBeInTheDocument();
  });

  it('renders embedded images', () => {
    render(
      <AttachmentDrawer
        attachment={{
          name: 'photo.png',
          mimeType: 'image/png',
          type: 'image',
          data: 'aGVsbG8=',
        }}
        token="secret"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('img', { name: 'photo.png' })).toHaveAttribute(
      'src',
      'data:image/png;base64,aGVsbG8=',
    );
    expect(screen.getByRole('button', { name: 'Open photo.png in new tab' })).toBeInTheDocument();
  });

  it('renders embedded videos with controls', () => {
    const { container } = render(
      <AttachmentDrawer
        attachment={{
          name: 'clip.mp4',
          mimeType: 'video/mp4',
          type: 'file',
          data: 'aGVsbG8=',
        }}
        token="secret"
        onClose={vi.fn()}
      />,
    );
    const video = container.querySelector('.attachment-drawer-video');
    expect(video).toHaveAttribute('src', 'data:video/mp4;base64,aGVsbG8=');
    expect(video).toHaveAttribute('controls');
    expect(video).toHaveAttribute('preload', 'metadata');
    expect(screen.getByRole('button', { name: 'Open clip.mp4 in new tab' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download clip.mp4' })).toBeInTheDocument();
  });

  it('shows a download fallback when the browser cannot play the video container', () => {
    vi.spyOn(attachments, 'videoMimeTypePlayable').mockReturnValue(false);
    render(
      <AttachmentDrawer
        attachment={{
          name: 'clip.mov',
          mimeType: 'video/quicktime',
          type: 'file',
          data: 'aGVsbG8=',
        }}
        token="secret"
        onClose={vi.fn()}
      />,
    );
    expect(document.querySelector('.attachment-drawer-download-fallback')).toBeInTheDocument();
    expect(screen.getByText('Preview unavailable in this browser.')).toBeInTheDocument();
    expect(document.querySelector('.attachment-drawer-video')).toBeNull();
  });

  it('shows a download fallback when video playback is not supported', () => {
    const { container } = render(
      <AttachmentDrawer
        attachment={{
          name: 'clip.mp4',
          mimeType: 'video/mp4',
          type: 'file',
          data: 'aGVsbG8=',
        }}
        token="secret"
        onClose={vi.fn()}
      />,
    );
    const video = container.querySelector('.attachment-drawer-video') as HTMLVideoElement;
    Object.defineProperty(video, 'error', { value: { code: 4 }, configurable: true });
    fireEvent.error(video);
    expect(document.querySelector('.attachment-drawer-download-fallback')).toBeInTheDocument();
    expect(container.querySelector('.attachment-drawer-video')).toBeNull();
  });

  it('opens video attachments in a viewer pop-out tab', () => {
    const openSpy = vi.spyOn(attachments, 'openVideoAttachmentInNewTab').mockReturnValue(true);
    render(
      <AttachmentDrawer
        attachment={{
          name: 'clip.mp4',
          mimeType: 'video/mp4',
          type: 'file',
          data: 'aGVsbG8=',
        }}
        token="secret"
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open clip.mp4 in new tab' }));
    expect(openSpy).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'clip.mp4', mimeType: 'video/mp4' }),
      'secret',
    );
  });

  it('renders embedded audio with controls', () => {
    const { container } = render(
      <AttachmentDrawer
        attachment={{
          name: 'song.mp3',
          mimeType: 'audio/mpeg',
          type: 'file',
          data: 'aGVsbG8=',
        }}
        token="secret"
        onClose={vi.fn()}
      />,
    );
    const audio = container.querySelector('.attachment-drawer-audio');
    expect(audio).toHaveAttribute('src', 'data:audio/mpeg;base64,aGVsbG8=');
    expect(audio).toHaveAttribute('controls');
    expect(screen.getByRole('button', { name: 'Open song.mp3 in new tab' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download song.mp3' })).toBeInTheDocument();
  });

  it('opens audio attachments in a viewer pop-out tab', () => {
    const openSpy = vi.spyOn(attachments, 'openAudioAttachmentInNewTab').mockReturnValue(true);
    render(
      <AttachmentDrawer
        attachment={{
          name: 'song.mp3',
          mimeType: 'audio/mpeg',
          type: 'file',
          data: 'aGVsbG8=',
        }}
        token="secret"
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open song.mp3 in new tab' }));
    expect(openSpy).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'song.mp3', mimeType: 'audio/mpeg' }),
      'secret',
    );
  });

  it('renders embedded pdfs in an iframe', () => {
    const { container } = render(
      <AttachmentDrawer
        attachment={{
          name: 'report.pdf',
          mimeType: 'application/pdf',
          type: 'file',
          data: 'aGVsbG8=',
        }}
        token="secret"
        onClose={vi.fn()}
      />,
    );
    const iframe = container.querySelector('.attachment-drawer-embed');
    expect(iframe).toHaveAttribute('src', 'data:application/pdf;base64,aGVsbG8=');
    expect(iframe).not.toHaveAttribute('sandbox');
  });

  it('renders html attachments in a sandboxed iframe with preview/raw toggle', async () => {
    vi.spyOn(attachments, 'fetchAttachmentText').mockResolvedValue('<h1>Hello</h1>');
    const { container } = render(
      <AttachmentDrawer
        attachment={{
          name: 'page.html',
          mimeType: 'text/html',
          type: 'file',
          data: 'PGgxPkhlbGxvPC9oMT4=',
        }}
        token="secret"
        onClose={vi.fn()}
      />,
    );
    const iframe = await waitFor(() => {
      const element = container.querySelector('iframe.attachment-drawer-embed');
      if (!element) throw new Error('iframe not found');
      return element;
    });
    expect(iframe).toHaveAttribute('srcdoc', '<h1>Hello</h1>');
    expect(iframe).toHaveAttribute('sandbox', attachments.ATTACHMENT_HTML_IFRAME_SANDBOX);
    expect(screen.getByRole('group', { name: 'View mode' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Raw' }));
    expect(await screen.findByText('<h1>Hello</h1>')).toHaveClass('attachment-drawer-raw');
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(container.querySelector('.attachment-drawer-embed')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open page.html in new tab' })).toBeInTheDocument();
  });

  it('opens html attachments in a preview/raw pop-out tab', async () => {
    vi.spyOn(attachments, 'fetchAttachmentText').mockResolvedValue('<h1>Popout</h1>');
    const openSpy = vi.spyOn(attachments, 'openHtmlAttachmentInNewTab').mockResolvedValue(true);
    render(
      <AttachmentDrawer
        attachment={{
          name: 'page.html',
          mimeType: 'text/html',
          type: 'file',
          data: 'PGgxPkhlbGxvPC9oMT4=',
        }}
        token="secret"
        onClose={vi.fn()}
      />,
    );
    await screen.findByRole('group', { name: 'View mode' });
    fireEvent.click(screen.getByRole('button', { name: 'Open page.html in new tab' }));
    expect(openSpy).toHaveBeenCalled();
  });

  it('shows an error when html preview content fails to load', async () => {
    vi.spyOn(attachments, 'fetchAttachmentText').mockResolvedValue(null);
    render(
      <AttachmentDrawer
        attachment={{
          name: 'page.html',
          mimeType: 'text/html',
          type: 'file',
          data: 'PGgxPkhlbGxvPC9oMT4=',
        }}
        token="secret"
        onClose={vi.fn()}
      />,
    );
    expect(await screen.findByText('Could not load attachment content.')).toBeInTheDocument();
    expect(document.querySelector('iframe.attachment-drawer-embed')).toBeNull();
  });

  it('shows loading for html raw view while content is fetched', async () => {
    let resolveText: (value: string | null) => void = () => {};
    vi.spyOn(attachments, 'fetchAttachmentText').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveText = resolve;
        }),
    );
    render(
      <AttachmentDrawer
        attachment={{
          name: 'page.html',
          mimeType: 'text/html',
          type: 'file',
          url: '/api/attachments/msg-1/page.html',
        }}
        token="secret"
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Raw' }));
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    await act(async () => {
      resolveText('<p>Loaded</p>');
    });
    expect(await screen.findByText('<p>Loaded</p>')).toBeInTheDocument();
  });

  it('shows an error for html attachments without a preview url', async () => {
    vi.spyOn(attachments, 'fetchAttachmentText').mockResolvedValue(null);
    render(
      <AttachmentDrawer
        attachment={{
          name: 'page.html',
          mimeType: 'text/html',
          type: 'file',
        }}
        token="secret"
        onClose={vi.fn()}
      />,
    );
    expect(await screen.findByText('Could not load attachment content.')).toBeInTheDocument();
  });

  it('renders csv attachments as a table with preview/raw toggle', async () => {
    vi.spyOn(attachments, 'fetchAttachmentText').mockResolvedValue('Name,Count\nAlpha,1');
    const openSpy = vi.spyOn(attachments, 'openCsvAttachmentInNewTab').mockResolvedValue(true);
    render(
      <AttachmentDrawer
        attachment={{
          name: 'data.csv',
          mimeType: 'text/csv',
          type: 'file',
          data: btoa('Name,Count\nAlpha,1'),
        }}
        token="secret"
        onClose={vi.fn()}
      />,
    );
    expect(await screen.findByRole('columnheader', { name: 'Name' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Alpha' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Raw' }));
    expect(screen.getByText(/Name,Count/)).toHaveClass('attachment-drawer-raw');
    fireEvent.click(screen.getByRole('button', { name: 'Open data.csv in new tab' }));
    expect(openSpy).toHaveBeenCalled();
  });

  it('falls back to raw text when code language cannot be resolved', async () => {
    vi.spyOn(attachments, 'fetchAttachmentText').mockResolvedValue('hello');
    vi.spyOn(attachmentCode, 'codeLanguageFromAttachment').mockReturnValue(null);
    render(
      <AttachmentDrawer
        attachment={{
          name: 'app.ts',
          mimeType: 'text/typescript',
          type: 'file',
          data: btoa('hello'),
        }}
        token="secret"
        onClose={vi.fn()}
      />,
    );
    expect(await screen.findByText('hello')).toHaveClass('attachment-drawer-raw');
  });

  it('renders syntax-highlighted code with preview/raw toggle', async () => {
    vi.spyOn(attachments, 'fetchAttachmentText').mockResolvedValue('const x = 1;');
    const openSpy = vi.spyOn(attachments, 'openCodeAttachmentInNewTab').mockResolvedValue(true);
    const { container } = render(
      <AttachmentDrawer
        attachment={{
          name: 'app.ts',
          mimeType: 'text/typescript',
          type: 'file',
          data: btoa('const x = 1;'),
        }}
        token="secret"
        onClose={vi.fn()}
      />,
    );
    expect(await screen.findByRole('group', { name: 'View mode' })).toBeInTheDocument();
    expect(container.querySelector('.attachment-drawer-code .hljs')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Raw' }));
    expect(screen.getByText('const x = 1;')).toHaveClass('attachment-drawer-raw');
    fireEvent.click(screen.getByRole('button', { name: 'Open app.ts in new tab' }));
    expect(openSpy).toHaveBeenCalled();
  });

  it('shows metadata for unsupported file types', () => {
    render(
      <AttachmentDrawer
        attachment={{
          name: 'archive.zip',
          mimeType: 'application/zip',
          type: 'file',
          size: 2048,
        }}
        token="secret"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('heading', { name: 'archive.zip', level: 3 })).toBeInTheDocument();
    expect(screen.getByText('application/zip')).toBeInTheDocument();
    expect(screen.getByText('2.0 KB')).toBeInTheDocument();
    expect(screen.getByText('File')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Open .* in new tab/ })).not.toBeInTheDocument();
  });

  it('copies markdown content and shows feedback', async () => {
    vi.spyOn(attachments, 'fetchAttachmentText').mockResolvedValue('hello');
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    render(
      <AttachmentDrawer
        attachment={{
          name: 'notes.txt',
          mimeType: 'text/plain',
          type: 'file',
          data: 'aGVsbG8=',
        }}
        token="secret"
        onClose={vi.fn()}
      />,
    );
    await screen.findByText('hello');
    fireEvent.click(screen.getByRole('button', { name: 'Copy content' }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('hello');
      expect(screen.getByText('Copied')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Copy content (copied)' })).toBeInTheDocument();
    });
  });

  it('copies attachment links for non-markdown files', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    render(
      <AttachmentDrawer
        attachment={{
          name: 'archive.zip',
          mimeType: 'application/zip',
          type: 'file',
          url: '/api/attachments/msg-1/archive.zip',
        }}
        token="secret"
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        new URL('/api/attachments/msg-1/archive.zip', window.location.origin).href,
      );
    });
  });

  it('downloads attachments and opens embeddable files in a new tab', () => {
    const downloadSpy = vi.spyOn(attachments, 'downloadAttachment').mockResolvedValue(true);
    const openSpy = vi.spyOn(attachments, 'openAttachmentInNewTab').mockReturnValue(true);
    const onClose = vi.fn();
    render(
      <AttachmentDrawer
        attachment={{
          name: 'photo.png',
          mimeType: 'image/png',
          type: 'image',
          data: 'aGVsbG8=',
        }}
        token="secret"
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Download photo.png' }));
    expect(downloadSpy).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Open photo.png in new tab' }));
    expect(openSpy).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close attachment preview' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(
      <AttachmentDrawer
        attachment={{
          name: 'archive.zip',
          mimeType: 'application/zip',
          type: 'file',
        }}
        token="secret"
        onClose={onClose}
      />,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('shows an error when embed preview url is unavailable', () => {
    render(
      <AttachmentDrawer
        attachment={{
          name: 'photo.png',
          mimeType: 'image/png',
          type: 'image',
        }}
        token="secret"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Could not load attachment preview.')).toBeInTheDocument();
  });

  it('ignores non-escape key presses', () => {
    const onClose = vi.fn();
    render(
      <AttachmentDrawer
        attachment={{
          name: 'archive.zip',
          mimeType: 'application/zip',
          type: 'file',
        }}
        token="secret"
        onClose={onClose}
      />,
    );
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not show copied feedback when copy fails', async () => {
    vi.spyOn(attachments, 'fetchAttachmentText').mockResolvedValue('hello');
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    render(
      <AttachmentDrawer
        attachment={{
          name: 'notes.txt',
          mimeType: 'text/plain',
          type: 'file',
          data: 'aGVsbG8=',
        }}
        token="secret"
        onClose={vi.fn()}
      />,
    );
    await screen.findByText('hello');
    fireEvent.click(screen.getByRole('button', { name: 'Copy content' }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalled();
    });
    expect(screen.queryByText('Copied')).not.toBeInTheDocument();
  });

  it('does not show copied feedback when markdown copy fails', async () => {
    vi.spyOn(attachments, 'fetchAttachmentText').mockResolvedValue('hello');
    vi.spyOn(attachments, 'copyAttachmentForPreview').mockImplementation(async (_att, onSuccess) => {
      void onSuccess;
    });
    render(
      <AttachmentDrawer
        attachment={{
          name: 'notes.txt',
          mimeType: 'text/plain',
          type: 'file',
          data: 'aGVsbG8=',
        }}
        token="secret"
        onClose={vi.fn()}
      />,
    );
    await screen.findByText('hello');
    fireEvent.click(screen.getByRole('button', { name: 'Copy content' }));
    await waitFor(() => {
      expect(attachments.copyAttachmentForPreview).toHaveBeenCalled();
    });
    expect(screen.queryByText('Copied')).not.toBeInTheDocument();
  });

  it('does not show copied feedback when link copy fails', async () => {
    vi.spyOn(attachments, 'copyAttachmentForPreview').mockResolvedValue(undefined);
    render(
      <AttachmentDrawer
        attachment={{
          name: 'archive.zip',
          mimeType: 'application/zip',
          type: 'file',
          url: '/api/attachments/msg-1/archive.zip',
        }}
        token="secret"
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await waitFor(() => {
      expect(attachments.copyAttachmentForPreview).toHaveBeenCalled();
    });
    expect(screen.queryByText('Copied')).not.toBeInTheDocument();
  });

  it('resets preview state when switching between attachment types', async () => {
    vi.spyOn(attachments, 'fetchAttachmentText').mockResolvedValue('# Switched');
    const { rerender } = render(
      <AttachmentDrawer
        attachment={{
          name: 'archive.zip',
          mimeType: 'application/zip',
          type: 'file',
          size: 10,
        }}
        token="secret"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('application/zip')).toBeInTheDocument();
    rerender(
      <AttachmentDrawer
        attachment={{
          name: 'notes.md',
          mimeType: 'text/markdown',
          type: 'file',
          data: 'IyBTd2l0Y2hlZA==',
        }}
        token="secret"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 1, name: 'Switched' })).toBeInTheDocument();
  });

  it('cancels markdown loading when unmounted', async () => {
    let resolveText: (value: string) => void = () => {};
    vi.spyOn(attachments, 'fetchAttachmentText').mockReturnValue(
      new Promise((resolve) => {
        resolveText = resolve;
      }),
    );
    const { unmount } = render(
      <AttachmentDrawer
        attachment={{
          name: 'notes.md',
          mimeType: 'text/markdown',
          type: 'file',
          url: '/api/attachments/msg-1/notes.md',
        }}
        token="secret"
        onClose={vi.fn()}
      />,
    );
    unmount();
    resolveText('late');
    await Promise.resolve();
  });

  it('clears copied feedback after a delay', async () => {
    vi.spyOn(attachments, 'fetchAttachmentText').mockResolvedValue('hello');
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const timeoutSpy = vi.spyOn(window, 'setTimeout');
    render(
      <AttachmentDrawer
        attachment={{
          name: 'notes.txt',
          mimeType: 'text/plain',
          type: 'file',
          data: 'aGVsbG8=',
        }}
        token="secret"
        onClose={vi.fn()}
      />,
    );
    await screen.findByText('hello');
    fireEvent.click(screen.getByRole('button', { name: 'Copy content' }));
    await waitFor(() => {
      expect(screen.getByText('Copied')).toBeInTheDocument();
    });
    expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), 2000);
    const clearCopied = timeoutSpy.mock.calls.find(([, delay]) => delay === 2000)?.[0] as
      | (() => void)
      | undefined;
    expect(clearCopied).toBeTypeOf('function');
    act(() => {
      clearCopied!();
    });
    expect(screen.queryByText('Copied')).not.toBeInTheDocument();
    timeoutSpy.mockRestore();
  });

  it('scrolls drawer body to top when the attachment changes', async () => {
    vi.spyOn(attachments, 'fetchAttachmentText').mockResolvedValue('# First');
    const { container, rerender } = render(
      <AttachmentDrawer
        attachment={{
          name: 'first.md',
          mimeType: 'text/markdown',
          type: 'file',
          data: 'IyBGaXJzdA==',
        }}
        token="secret"
        onClose={vi.fn()}
      />,
    );
    await screen.findByRole('heading', { level: 1, name: 'First' });
    const body = container.querySelector('.attachment-drawer-body') as HTMLDivElement;
    body.scrollTop = 240;
    rerender(
      <AttachmentDrawer
        attachment={{
          name: 'second.md',
          mimeType: 'text/markdown',
          type: 'file',
          data: 'IyBTZWNvbmQ=',
        }}
        token="secret"
        onClose={vi.fn()}
      />,
    );
    expect(body.scrollTop).toBe(0);
  });

  it('clamps drawer width when the window is resized', () => {
    localStorage.setItem('webchat_attachment_drawer_width', '900');
    const { container } = render(
      <AttachmentDrawer
        attachment={{
          name: 'photo.png',
          mimeType: 'image/png',
          type: 'image',
          data: 'aGVsbG8=',
        }}
        token="secret"
        onClose={vi.fn()}
      />,
    );
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800, writable: true });
    fireEvent(window, new Event('resize'));
    expect((container.querySelector('.attachment-drawer') as HTMLElement).style.width).toBe('640px');
  });

  it('updates width while dragging the resize handle', () => {
    const { container } = render(
      <AttachmentDrawer
        attachment={{
          name: 'photo.png',
          mimeType: 'image/png',
          type: 'image',
          data: 'aGVsbG8=',
        }}
        token="secret"
        onClose={vi.fn()}
      />,
    );
    const drawer = container.querySelector('.attachment-drawer') as HTMLElement;
    const handle = container.querySelector('.attachment-drawer-resize-handle') as HTMLElement;
    const initialWidth = Number.parseInt(drawer.style.width, 10);
    handle.setPointerCapture = vi.fn();
    handle.releasePointerCapture = vi.fn();
    fireEvent.pointerDown(handle, { clientX: 900, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 850, pointerId: 1 });
    expect(drawer.style.width).toBe(`${Math.round(initialWidth + 50)}px`);
    fireEvent.pointerUp(handle, { clientX: 850, pointerId: 1 });
    expect(localStorage.getItem('webchat_attachment_drawer_width')).toBe(
      String(Math.round(initialWidth + 50)),
    );
  });

  it('replaces copied feedback timeout when copy succeeds again', async () => {
    vi.spyOn(attachments, 'fetchAttachmentText').mockResolvedValue('hello');
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');
    render(
      <AttachmentDrawer
        attachment={{
          name: 'notes.txt',
          mimeType: 'text/plain',
          type: 'file',
          data: 'aGVsbG8=',
        }}
        token="secret"
        onClose={vi.fn()}
      />,
    );
    await screen.findByText('hello');
    fireEvent.click(screen.getByRole('button', { name: 'Copy content' }));
    await waitFor(() => {
      expect(screen.getByText('Copied')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Copy content (copied)' }));
    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });

  it('clears copied feedback timeout on unmount', async () => {
    vi.spyOn(attachments, 'fetchAttachmentText').mockResolvedValue('hello');
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');
    const { unmount } = render(
      <AttachmentDrawer
        attachment={{
          name: 'notes.txt',
          mimeType: 'text/plain',
          type: 'file',
          data: 'aGVsbG8=',
        }}
        token="secret"
        onClose={vi.fn()}
      />,
    );
    await screen.findByText('hello');
    fireEvent.click(screen.getByRole('button', { name: 'Copy content' }));
    await waitFor(() => {
      expect(screen.getByText('Copied')).toBeInTheDocument();
    });
    unmount();
    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });

  it('cleans up resize state and reverts width when the pointer is cancelled', () => {
    localStorage.setItem('webchat_attachment_drawer_width', '400');
    const { container } = render(
      <AttachmentDrawer
        attachment={{
          name: 'photo.png',
          mimeType: 'image/png',
          type: 'image',
          data: 'aGVsbG8=',
        }}
        token="secret"
        onClose={vi.fn()}
      />,
    );
    const drawer = container.querySelector('.attachment-drawer') as HTMLElement;
    const handle = container.querySelector('.attachment-drawer-resize-handle') as HTMLElement;
    handle.setPointerCapture = vi.fn();
    handle.releasePointerCapture = vi.fn();
    fireEvent.pointerDown(handle, { clientX: 900, pointerId: 1 });
    act(() => {
      handle.dispatchEvent(new PointerEvent('pointermove', { clientX: 800, pointerId: 1, bubbles: true }));
    });
    expect(drawer.style.width).toBe('500px');
    act(() => {
      handle.dispatchEvent(new PointerEvent('pointercancel', { clientX: 800, pointerId: 1, bubbles: true }));
    });
    expect(document.body.classList.contains('attachment-drawer-resizing')).toBe(false);
    expect(drawer.style.width).toBe('400px');
    expect(localStorage.getItem('webchat_attachment_drawer_width')).toBe('400');
  });

  it('resizes drawer width with keyboard arrows', () => {
    const { container } = render(
      <AttachmentDrawer
        attachment={{
          name: 'photo.png',
          mimeType: 'image/png',
          type: 'image',
          data: 'aGVsbG8=',
        }}
        token="secret"
        onClose={vi.fn()}
      />,
    );
    const drawer = container.querySelector('.attachment-drawer') as HTMLElement;
    const handle = container.querySelector('.attachment-drawer-resize-handle') as HTMLElement;
    const initialWidth = Number.parseInt(drawer.style.width, 10);
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(drawer.style.width).toBe(`${initialWidth + 20}px`);
    expect(localStorage.getItem('webchat_attachment_drawer_width')).toBe(String(initialWidth + 20));
  });

  it('ignores unrelated keys on the resize handle', () => {
    const { container } = render(
      <AttachmentDrawer
        attachment={{
          name: 'photo.png',
          mimeType: 'image/png',
          type: 'image',
          data: 'aGVsbG8=',
        }}
        token="secret"
        onClose={vi.fn()}
      />,
    );
    const drawer = container.querySelector('.attachment-drawer') as HTMLElement;
    const handle = container.querySelector('.attachment-drawer-resize-handle') as HTMLElement;
    const initialWidth = drawer.style.width;
    fireEvent.keyDown(handle, { key: 'Enter' });
    expect(drawer.style.width).toBe(initialWidth);
  });

  it('shows normalized type in metadata when server type disagrees with mime', () => {
    render(
      <AttachmentDrawer
        attachment={{
          name: 'unknown.bin',
          mimeType: 'application/octet-stream',
          type: 'image',
          size: 10,
        }}
        token="secret"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('File')).toBeInTheDocument();
  });

  it('delegates width changes to onWidthChange when controlled', () => {
    const onWidthChange = vi.fn();
    const { container } = render(
      <AttachmentDrawer
        attachment={{
          name: 'photo.png',
          mimeType: 'image/png',
          type: 'image',
          data: 'aGVsbG8=',
        }}
        token="secret"
        onClose={vi.fn()}
        width={420}
        onWidthChange={onWidthChange}
      />,
    );
    const handle = container.querySelector('.attachment-drawer-resize-handle') as HTMLElement;
    handle.setPointerCapture = vi.fn();
    handle.releasePointerCapture = vi.fn();
    fireEvent.pointerDown(handle, { clientX: 900, pointerId: 1, buttons: 1 });
    handle.dispatchEvent(new PointerEvent('pointerup', { clientX: 850, pointerId: 1, bubbles: true }));
    expect(onWidthChange).toHaveBeenCalled();
  });
});
