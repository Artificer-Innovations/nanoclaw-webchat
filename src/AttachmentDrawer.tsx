import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  attachmentDataUrl,
  attachmentPreviewMode,
  copyAttachmentForPreview,
  downloadAttachment,
  formatAttachmentSize,
  normalizeAttachment,
  openAttachmentInNewTab,
  fetchAttachmentText,
} from './attachments';
import { FormattedMessage } from './FormattedMessage';
import { CloseIcon, CopyIcon, DownloadIcon, ExternalLinkIcon } from './nav-icons';
import type { WebChatAttachment } from './types';

export function AttachmentDrawer({
  attachment,
  onClose,
}: {
  attachment: WebChatAttachment;
  onClose: () => void;
}) {
  const att = useMemo(() => normalizeAttachment(attachment), [attachment]);
  const mode = attachmentPreviewMode(att.mimeType);
  const embedUrl = mode === 'embed' ? attachmentDataUrl(att) : null;

  const [markdownText, setMarkdownText] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(mode === 'markdown');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setCopied(false);
    if (mode !== 'markdown') {
      setLoading(false);
      setLoadError(null);
      setMarkdownText(null);
    } else {
      setLoading(true);
      setLoadError(null);
      setMarkdownText(null);
    }
  }, [att.name, att.mimeType, att.data, att.url, mode]);

  useEffect(() => {
    if (mode !== 'markdown') return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setMarkdownText(null);
    void fetchAttachmentText(att).then((text) => {
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
  }, [att.data, att.mimeType, att.name, att.url, mode]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const handleCopy = useCallback(() => {
    void copyAttachmentForPreview(att, () => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  }, [att]);

  const handleDownload = useCallback(() => {
    void downloadAttachment(att);
  }, [att]);

  const handlePopOut = useCallback(() => {
    openAttachmentInNewTab(att);
  }, [att]);

  return (
    <aside className="attachment-drawer" aria-label={`Attachment preview: ${att.name}`}>
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
      <div className="attachment-drawer-body">
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
          att.mimeType === 'application/pdf' ? (
            <iframe className="attachment-drawer-embed" title={att.name} src={embedUrl} />
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
              <dd>{attachment.type === 'image' ? 'Image' : 'File'}</dd>
            </div>
          </dl>
        ) : null}
      </div>
    </aside>
  );
}
