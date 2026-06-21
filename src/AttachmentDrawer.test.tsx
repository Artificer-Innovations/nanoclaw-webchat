import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

  it('renders html attachments in a sandboxed iframe with pop-out', () => {
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
    const iframe = container.querySelector('.attachment-drawer-embed');
    expect(iframe).toHaveAttribute('src', 'data:text/html;base64,PGgxPkhlbGxvPC9oMT4=');
    expect(iframe).toHaveAttribute('sandbox', attachments.ATTACHMENT_HTML_IFRAME_SANDBOX);
    expect(screen.getByRole('button', { name: 'Open page.html in new tab' })).toBeInTheDocument();
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
      expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: 'Copied' }));
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

  it('cleans up resize state when the pointer is cancelled', () => {
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
    const handle = container.querySelector('.attachment-drawer-resize-handle') as HTMLElement;
    handle.setPointerCapture = vi.fn();
    handle.releasePointerCapture = vi.fn();
    fireEvent.pointerDown(handle, { clientX: 900, pointerId: 1 });
    fireEvent.pointerCancel(handle, { pointerId: 1 });
    expect(document.body.classList.contains('attachment-drawer-resizing')).toBe(false);
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
});
