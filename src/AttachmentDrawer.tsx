import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ATTACHMENT_DRAWER_MIN_WIDTH,
  attachmentDrawerWidthFromDrag,
  attachmentDrawerWidthFromKeyboard,
  getStoredAttachmentDrawerWidth,
  clampAttachmentDrawerWidth,
  maxAttachmentDrawerWidth,
  resetDrawerBodyScroll,
  setStoredAttachmentDrawerWidth,
} from './attachment-drawer-layout';
import {
  attachmentDataUrl,
  attachmentIframeSandbox,
  attachmentPreviewMode,
  attachmentUsesIframePreview,
  copyAttachmentForPreview,
  downloadAttachment,
  formatAttachmentSize,
  attachmentTypeLabel,
  normalizeAttachment,
  openAttachmentInNewTab,
  fetchAttachmentText,
} from './attachments';
import { FormattedMessage } from './FormattedMessage';
import { CloseIcon, CopyIcon, DownloadIcon, ExternalLinkIcon } from './nav-icons';
import type { WebChatAttachment } from './types';

export function AttachmentDrawer({
  attachment,
  token,
  onClose,
}: {
  attachment: WebChatAttachment;
  token: string;
  onClose: () => void;
}) {
  const att = useMemo(() => normalizeAttachment(attachment), [attachment]);
  const mode = attachmentPreviewMode(att.mimeType);
  const embedUrl = mode === 'embed' ? attachmentDataUrl(att, token) : null;

  const bodyRef = useRef<HTMLDivElement>(null);
  const copiedTimeoutRef = useRef<number | null>(null);
  const [width, setWidth] = useState(getStoredAttachmentDrawerWidth);
  const [markdownText, setMarkdownText] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(mode === 'markdown');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    resetDrawerBodyScroll(bodyRef.current);
  }, [att.name, att.mimeType, att.data, att.url]);

  useEffect(() => {
    const onResize = () => {
      setWidth((current) => clampAttachmentDrawerWidth(current));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    setCopied(false);
    if (mode !== 'markdown') {
      setLoading(false);
      setLoadError(null);
      setMarkdownText(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setMarkdownText(null);
    void fetchAttachmentText(att, token).then((text) => {
      if (cancelled) return;
      setLoading(false);
      if (text == null) {
        setLoadError('Could not load attachment content.');
        return;
      }
      setMarkdownText(text);
    });
    return () => {
      cancelled = true;
    };
  }, [att.data, att.mimeType, att.name, att.url, mode, token]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(
    () => () => {
      if (copiedTimeoutRef.current != null) {
        window.clearTimeout(copiedTimeoutRef.current);
      }
    },
    [],
  );

  const showCopiedFeedback = useCallback(() => {
    setCopied(true);
    if (copiedTimeoutRef.current != null) {
      window.clearTimeout(copiedTimeoutRef.current);
    }
    copiedTimeoutRef.current = window.setTimeout(() => {
      copiedTimeoutRef.current = null;
      setCopied(false);
    }, 2000);
  }, []);

  const handleCopy = useCallback(() => {
    void copyAttachmentForPreview(att, showCopiedFeedback, token);
  }, [att, showCopiedFeedback, token]);

  const handleDownload = useCallback(() => {
    void downloadAttachment(att, token);
  }, [att, token]);

  const handlePopOut = useCallback(() => {
    openAttachmentInNewTab(att, token);
  }, [att, token]);

  const persistWidth = useCallback((nextWidth: number) => {
    setWidth(nextWidth);
    setStoredAttachmentDrawerWidth(nextWidth);
  }, []);

  const handleResizeKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const nextWidth = attachmentDrawerWidthFromKeyboard(width, event.key);
      if (nextWidth == null) return;
      event.preventDefault();
      persistWidth(nextWidth);
    },
    [persistWidth, width],
  );

  const handleResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const handle = event.currentTarget;
      const startX = event.clientX;
      const startWidth = width;
      let lastClientX = startX;
      handle.setPointerCapture(event.pointerId);
      document.body.classList.add('attachment-drawer-resizing');

      const onPointerMove = (moveEvent: PointerEvent) => {
        lastClientX = moveEvent.clientX;
        setWidth(attachmentDrawerWidthFromDrag(startWidth, startX, lastClientX));
      };

      const finishResize = () => {
        handle.releasePointerCapture(event.pointerId);
        handle.removeEventListener('pointermove', onPointerMove);
        handle.removeEventListener('pointerup', onPointerUp);
        handle.removeEventListener('pointercancel', onPointerCancel);
        document.body.classList.remove('attachment-drawer-resizing');
        persistWidth(attachmentDrawerWidthFromDrag(startWidth, startX, lastClientX));
      };

      const onPointerUp = () => {
        finishResize();
      };

      const onPointerCancel = () => {
        finishResize();
      };

      handle.addEventListener('pointermove', onPointerMove);
      handle.addEventListener('pointerup', onPointerUp);
      handle.addEventListener('pointercancel', onPointerCancel);
    },
    [persistWidth, width],
  );

  return (
    <aside
      className="attachment-drawer"
      style={{ width }}
      aria-label={`Attachment preview: ${att.name}`}
    >
      <div
        className="attachment-drawer-resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize attachment preview"
        aria-valuemin={ATTACHMENT_DRAWER_MIN_WIDTH}
        aria-valuemax={Math.round(maxAttachmentDrawerWidth())}
        aria-valuenow={width}
        tabIndex={0}
        onKeyDown={handleResizeKeyDown}
        onPointerDown={handleResizePointerDown}
      />
      <header className="attachment-drawer-header">
        <h3 className="attachment-drawer-title" title={att.name}>
          {att.name}
        </h3>
        <div className="attachment-drawer-actions">
          <button
            type="button"
            className="attachment-drawer-action"
            aria-label={copied ? 'Copied' : mode === 'markdown' ? 'Copy content' : 'Copy link'}
            onClick={() => void handleCopy()}
          >
            <CopyIcon />
            {copied ? <span className="attachment-drawer-copied">Copied</span> : null}
          </button>
          <button
            type="button"
            className="attachment-drawer-action"
            aria-label={`Download ${att.name}`}
            onClick={handleDownload}
          >
            <DownloadIcon />
          </button>
          {mode === 'embed' ? (
            <button
              type="button"
              className="attachment-drawer-action"
              aria-label={`Open ${att.name} in new tab`}
              onClick={handlePopOut}
            >
              <ExternalLinkIcon />
            </button>
          ) : null}
          <button
            type="button"
            className="attachment-drawer-action"
            aria-label="Close attachment preview"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>
      </header>
      <div ref={bodyRef} className="attachment-drawer-body">
        {mode === 'markdown' && loading ? (
          <p className="attachment-drawer-status">Loading…</p>
        ) : null}
        {mode === 'markdown' && !loading && loadError ? (
          <p className="attachment-drawer-error">{loadError}</p>
        ) : null}
        {mode === 'markdown' && !loading && !loadError ? (
          <FormattedMessage text={markdownText ?? ''} />
        ) : null}
        {mode === 'embed' && embedUrl ? (
          attachmentUsesIframePreview(att.mimeType) ? (
            <iframe
              className="attachment-drawer-embed"
              title={att.name}
              src={embedUrl}
              sandbox={attachmentIframeSandbox(att.mimeType)}
            />
          ) : (
            <img className="attachment-drawer-image" src={embedUrl} alt={att.name} />
          )
        ) : null}
        {mode === 'embed' && !embedUrl ? (
          <p className="attachment-drawer-error">Could not load attachment preview.</p>
        ) : null}
        {mode === 'metadata' ? (
          <dl className="attachment-drawer-meta">
            <div>
              <dt>Filename</dt>
              <dd>{att.name}</dd>
            </div>
            <div>
              <dt>MIME type</dt>
              <dd>{att.mimeType}</dd>
            </div>
            <div>
              <dt>Size</dt>
              <dd>{formatAttachmentSize(att.size)}</dd>
            </div>
            <div>
              <dt>Type</dt>
              <dd>{attachmentTypeLabel(att.type)}</dd>
            </div>
          </dl>
        ) : null}
      </div>
    </aside>
  );
}
