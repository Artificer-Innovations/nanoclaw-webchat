import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getStoredAttachmentDrawerWidth,
  setStoredAttachmentDrawerWidth,
  attachmentDrawerWidthFromDrag,
  attachmentDrawerWidthFromKeyboard,
  ATTACHMENT_DRAWER_MIN_WIDTH,
  clampAttachmentDrawerWidth,
  maxAttachmentDrawerWidth,
  resetDrawerBodyScroll,
} from './attachment-drawer-layout';
import { codeLanguageFromAttachment } from './attachment-code';
import {
  attachmentDataUrl,
  attachmentIframeSandbox,
  attachmentIsAudio,
  attachmentIsVideo,
  attachmentPreviewMode,
  attachmentSupportsPopOut,
  attachmentSupportsPreviewToggle,
  attachmentTextCategory,
  attachmentUsesAudioPreview,
  attachmentUsesFormattedMessagePreview,
  attachmentUsesIframePreview,
  attachmentUsesVideoPreview,
  ATTACHMENT_HTML_IFRAME_SANDBOX,
  copyAttachmentForPreview,
  downloadAttachment,
  formatAttachmentSize,
  attachmentTypeLabel,
  normalizeAttachment,
  openAttachmentInNewTab,
  openCodeAttachmentInNewTab,
  openCsvAttachmentInNewTab,
  openHtmlAttachmentInNewTab,
  openMarkdownAttachmentInNewTab,
  openPlainTextAttachmentInNewTab,
  openVideoAttachmentInNewTab,
  openAudioAttachmentInNewTab,
  fetchAttachmentText,
} from './attachments';
import { CodePreview } from './CodePreview';
import { CsvPreview } from './CsvPreview';
import { FormattedMessage } from './FormattedMessage';
import { CloseIcon, CopyIcon, DownloadIcon, ExternalLinkIcon } from './nav-icons';
import type { WebChatAttachment } from './types';

export type TextAttachmentView = 'preview' | 'raw';

export function AttachmentDrawer({
  attachment,
  token,
  onClose,
  width: controlledWidth,
  onWidthChange,
  maxWidth,
}: {
  attachment: WebChatAttachment;
  token: string;
  onClose: () => void;
  width?: number;
  onWidthChange?: (width: number) => void;
  maxWidth?: number;
}) {
  const att = useMemo(() => normalizeAttachment(attachment), [attachment]);
  const category = attachmentTextCategory(att.mimeType, att.name);
  const mode = attachmentPreviewMode(att.mimeType, att.name);
  const embedUrl = mode === 'embed' ? attachmentDataUrl(att, token) : null;
  const copyActionLabel = mode === 'text' ? 'Copy content' : 'Copy link';

  const bodyRef = useRef<HTMLDivElement>(null);
  const copiedTimeoutRef = useRef<number | null>(null);
  const [uncontrolledWidth, setUncontrolledWidth] = useState(getStoredAttachmentDrawerWidth);
  const width = controlledWidth ?? uncontrolledWidth;
  const drawerMaxWidth = maxWidth ?? maxAttachmentDrawerWidth();
  const [textContent, setTextContent] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(mode === 'text');
  const [copied, setCopied] = useState(false);
  const [textView, setTextView] = useState<TextAttachmentView>('preview');
  const supportsPreviewToggle = attachmentSupportsPreviewToggle(att.mimeType, att.name);
  const supportsPopOut = attachmentSupportsPopOut(att.mimeType, att.name);
  const codeLanguage = category === 'code' ? codeLanguageFromAttachment(att.name, att.mimeType) : null;

  useEffect(() => {
    resetDrawerBodyScroll(bodyRef.current);
    setTextView('preview');
  }, [att.name, att.mimeType, att.data, att.url]);

  useEffect(() => {
    if (controlledWidth != null) return;
    const onResize = () => {
      setUncontrolledWidth((current) => clampAttachmentDrawerWidth(current));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [controlledWidth]);

  useEffect(() => {
    setCopied(false);
    if (mode !== 'text') {
      setLoading(false);
      setLoadError(null);
      setTextContent(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setTextContent(null);
    void fetchAttachmentText(att, token).then((text) => {
      if (cancelled) return;
      setLoading(false);
      if (text == null) {
        setLoadError('Could not load attachment content.');
        return;
      }
      setTextContent(text);
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
    if (category === 'markdown') {
      void openMarkdownAttachmentInNewTab(att, token);
      return;
    }
    if (category === 'plain') {
      void openPlainTextAttachmentInNewTab(att, token);
      return;
    }
    if (category === 'code') {
      void openCodeAttachmentInNewTab(att, token);
      return;
    }
    if (category === 'html') {
      void openHtmlAttachmentInNewTab(att, token);
      return;
    }
    if (category === 'csv') {
      void openCsvAttachmentInNewTab(att, token);
      return;
    }
    if (attachmentIsVideo(att.mimeType)) {
      openVideoAttachmentInNewTab(att, token);
      return;
    }
    if (attachmentIsAudio(att.mimeType)) {
      openAudioAttachmentInNewTab(att, token);
      return;
    }
    openAttachmentInNewTab(att, token);
  }, [att, category, token]);

  const persistWidth = useCallback(
    (nextWidth: number) => {
      if (onWidthChange) {
        onWidthChange(nextWidth);
        return;
      }
      setUncontrolledWidth(nextWidth);
      setStoredAttachmentDrawerWidth(nextWidth);
    },
    [onWidthChange],
  );

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
        persistWidth(attachmentDrawerWidthFromDrag(startWidth, startX, lastClientX));
      };

      const cleanupResize = () => {
        handle.releasePointerCapture(event.pointerId);
        handle.removeEventListener('pointermove', onPointerMove);
        handle.removeEventListener('pointerup', onPointerUp);
        handle.removeEventListener('pointercancel', onPointerCancel);
        document.body.classList.remove('attachment-drawer-resizing');
      };

      const onPointerUp = () => {
        cleanupResize();
        persistWidth(attachmentDrawerWidthFromDrag(startWidth, startX, lastClientX));
      };

      const onPointerCancel = () => {
        cleanupResize();
        persistWidth(startWidth);
      };

      handle.addEventListener('pointermove', onPointerMove);
      handle.addEventListener('pointerup', onPointerUp);
      handle.addEventListener('pointercancel', onPointerCancel);
    },
    [persistWidth, width],
  );

  const showTextLoading = mode === 'text' && loading;
  const showTextError = mode === 'text' && !loading && loadError != null;

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
        aria-valuemax={Math.round(drawerMaxWidth)}
        aria-valuenow={width}
        tabIndex={0}
        onKeyDown={handleResizeKeyDown}
        onPointerDown={handleResizePointerDown}
      />
      <header className="attachment-drawer-header">
        <h3 className="attachment-drawer-title" title={att.name}>
          {att.name}
        </h3>
        {supportsPreviewToggle ? (
          <div className="attachment-drawer-view-toggle" role="group" aria-label="View mode">
            <button
              type="button"
              className="attachment-drawer-view-toggle-btn"
              aria-pressed={textView === 'preview'}
              onClick={() => setTextView('preview')}
            >
              Preview
            </button>
            <button
              type="button"
              className="attachment-drawer-view-toggle-btn"
              aria-pressed={textView === 'raw'}
              onClick={() => setTextView('raw')}
            >
              Raw
            </button>
          </div>
        ) : null}
        <div className="attachment-drawer-actions">
          <button
            type="button"
            className="attachment-drawer-action"
            aria-label={copied ? `${copyActionLabel} (copied)` : copyActionLabel}
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
          {supportsPopOut ? (
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
        {showTextLoading ? <p className="attachment-drawer-status">Loading…</p> : null}
        {showTextError ? <p className="attachment-drawer-error">{loadError}</p> : null}
        {mode === 'text' && category === 'html' && textView === 'preview' && textContent !== null ? (
          <iframe
            className="attachment-drawer-embed"
            title={att.name}
            srcDoc={textContent}
            sandbox={ATTACHMENT_HTML_IFRAME_SANDBOX}
          />
        ) : null}
        {mode === 'text' && !loading && !loadError && textContent !== null ? (
          category === 'html' && textView === 'raw' ? (
            <pre className="attachment-drawer-raw">{textContent}</pre>
          ) : category === 'markdown' && attachmentUsesFormattedMessagePreview(att.mimeType, att.name) ? (
            textView === 'raw' ? (
              <pre className="attachment-drawer-raw">{textContent}</pre>
            ) : (
              <FormattedMessage
                text={textContent}
                className="formatted-message attachment-drawer-formatted"
              />
            )
          ) : category === 'code' ? (
            textView === 'raw' || !codeLanguage ? (
              <pre className="attachment-drawer-raw">{textContent}</pre>
            ) : (
              <CodePreview text={textContent} language={codeLanguage} />
            )
          ) : category === 'csv' ? (
            textView === 'raw' ? (
              <pre className="attachment-drawer-raw">{textContent}</pre>
            ) : (
              <CsvPreview text={textContent} name={att.name} />
            )
          ) : category === 'plain' ? (
            <pre className="attachment-drawer-text">{textContent}</pre>
          ) : null
        ) : null}
        {mode === 'embed' && embedUrl ? (
          attachmentUsesIframePreview(att.mimeType) ? (
            <iframe
              className="attachment-drawer-embed"
              title={att.name}
              src={embedUrl}
              sandbox={attachmentIframeSandbox(att.mimeType)}
            />
          ) : attachmentUsesVideoPreview(att.mimeType) ? (
            <video
              className="attachment-drawer-video"
              src={embedUrl}
              controls
              playsInline
            />
          ) : attachmentUsesAudioPreview(att.mimeType) ? (
            <audio className="attachment-drawer-audio" src={embedUrl} controls preload="metadata" />
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
              <dd>{attachmentTypeLabel(att.type, att.mimeType)}</dd>
            </div>
          </dl>
        ) : null}
      </div>
    </aside>
  );
}
