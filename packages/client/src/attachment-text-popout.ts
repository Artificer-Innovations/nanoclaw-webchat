import { highlightCodeHtml } from './code-highlight';
import { CODE_HIGHLIGHT_STYLES } from './code-highlight-styles';
import { csvDelimiterFromAttachment, limitCsvPreviewRows, parseCsv, renderCsvTableHtml } from './csv-preview';
import { escapeHtml } from './html-escape';

/**
 * HTML previews: run JS in an isolated origin; never add allow-same-origin (parent/token access).
 *
 * `allow-popups-to-escape-sandbox` lets a `target="_blank"` link (or right-click →
 * "open in new tab") open a normal, un-sandboxed page. Without it the new tab inherits
 * this iframe's sandbox — no cookies/storage — so SPA destinations never hydrate.
 */
export const ATTACHMENT_HTML_IFRAME_SANDBOX =
  'allow-scripts allow-popups allow-popups-to-escape-sandbox allow-modals';

/** SVG previews: static display only — no scripts (SVG can embed executable content). */
export const ATTACHMENT_SVG_IFRAME_SANDBOX = 'allow-popups allow-modals';

const POPOUT_STYLES = `
:root {
  color-scheme: light dark;
  --bg: #f4f4f4;
  --panel: #ffffff;
  --border: #e0e0e0;
  --text: #1a1a1a;
  --muted: #666;
  --accent: #3d7a9e;
  --code-bg: #ececec;
  --code-border: #c8c8c8;
  --inline-code-fg: #c05621;
  --mention-user-fg: #2563eb;
  --mention-user-bg: rgba(37, 99, 235, 0.12);
  --mention-here-fg: #b45309;
  --mention-here-bg: rgba(234, 179, 8, 0.18);
  --link: #3d7a9e;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #1a1a1a;
    --panel: #252525;
    --border: #3a3a3a;
    --text: #f0f0f0;
    --muted: #aaa;
    --accent: #6db3e8;
    --code-bg: #2a2a2a;
    --code-border: #444;
    --inline-code-fg: #e99547;
    --mention-user-fg: #6db3e8;
    --mention-user-bg: rgba(59, 130, 246, 0.25);
    --mention-here-fg: #e2a828;
    --mention-here-bg: rgba(234, 179, 8, 0.2);
    --link: #6db3e8;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 16px/1.45 system-ui, sans-serif;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 12px 20px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
  position: sticky;
  top: 0;
}
h1 {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.view-toggle {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  flex-shrink: 0;
}
.view-toggle button {
  border: none;
  background: transparent;
  color: var(--muted);
  padding: 6px 12px;
  font: inherit;
  cursor: pointer;
}
.view-toggle button[aria-pressed='true'] {
  background: color-mix(in srgb, var(--accent) 12%, var(--panel));
  color: var(--text);
}
main { padding: 20px; }
.view.hidden { display: none; }
.raw-text {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.875rem;
}
.formatted-message { word-break: break-word; }
.formatted-message p { margin: 0.15em 0; }
.formatted-message p:first-child { margin-top: 0; }
.formatted-message p:last-child { margin-bottom: 0; }
.formatted-message h1, .formatted-message h2, .formatted-message h3,
.formatted-message h4, .formatted-message h5, .formatted-message h6 {
  font-size: 1em;
  font-weight: 700;
  margin: 0.5em 0 0.25em;
}
.formatted-message ul, .formatted-message ol { margin: 0.25em 0; padding-left: 1.25em; }
.formatted-message a { color: var(--link); }
.formatted-message strong { font-weight: 700; }
.formatted-message em { font-style: italic; }
.formatted-message del { text-decoration: line-through; opacity: 0.85; }
.mention { font-weight: 700; border-radius: 3px; padding: 0 0.2em; }
.mention-user { color: var(--mention-user-fg); background: var(--mention-user-bg); }
.mention-here { color: var(--mention-here-fg); background: var(--mention-here-bg); }
.inline-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.875em;
  color: var(--inline-code-fg);
  background: var(--code-bg);
  border: 1px solid var(--code-border);
  border-radius: 4px;
  padding: 0.1em 0.35em;
}
.code-block {
  display: block;
  margin: 0.35rem 0;
  padding: 0.65rem 0.75rem;
  background: var(--code-bg);
  border: 1px solid var(--code-border);
  border-radius: 6px;
  overflow-x: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.8125rem;
  line-height: 1.45;
  white-space: pre;
}
.code-block code { font-family: inherit; background: none; border: none; padding: 0; }
.markdown-table-wrap { overflow-x: auto; max-width: 100%; margin: 0.35em 0; }
.formatted-message table { border-collapse: collapse; width: auto; }
.formatted-message th, .formatted-message td {
  border: 1px solid var(--border);
  padding: 0.35rem 0.6rem;
  text-align: left;
}
.formatted-message th { font-weight: 600; background: color-mix(in srgb, var(--border) 35%, transparent); }
.html-preview {
  display: block;
  width: 100%;
  min-height: 70vh;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
}
.csv-table-wrap { overflow: auto; max-width: 100%; }
.csv-table {
  border-collapse: collapse;
  width: max-content;
  min-width: 100%;
  font-size: 0.875rem;
}
.csv-table th,
.csv-table td {
  border: 1px solid var(--border);
  padding: 0.4rem 0.65rem;
  text-align: left;
  vertical-align: top;
  white-space: pre-wrap;
  word-break: break-word;
}
.csv-table th {
  position: sticky;
  top: 0;
  background: color-mix(in srgb, var(--border) 35%, var(--panel));
  font-weight: 600;
}
.csv-table tbody tr:nth-child(even) {
  background: color-mix(in srgb, var(--border) 18%, transparent);
}
.csv-empty { color: var(--muted); margin: 0; }
.csv-truncated { color: var(--muted); margin: 0 0 0.75rem; font-size: 0.8125rem; }
.video-preview {
  display: block;
  width: 100%;
  max-width: 100%;
  max-height: calc(100vh - 96px);
  margin: 0 auto;
  border-radius: 8px;
  background: #000;
}
.video-fallback {
  text-align: center;
  padding: 2rem 1rem;
  color: var(--muted);
}
.video-fallback a {
  color: var(--accent);
}
.audio-preview {
  display: block;
  width: min(100%, 640px);
  margin: 0 auto;
}
${CODE_HIGHLIGHT_STYLES}
`;

const POPOUT_SCRIPT = `
(function () {
  var previewBtn = document.getElementById('preview-btn');
  var rawBtn = document.getElementById('raw-btn');
  var preview = document.getElementById('preview-view');
  var raw = document.getElementById('raw-view');
  function setView(mode) {
    var isPreview = mode === 'preview';
    previewBtn.setAttribute('aria-pressed', isPreview ? 'true' : 'false');
    rawBtn.setAttribute('aria-pressed', isPreview ? 'false' : 'true');
    preview.classList.toggle('hidden', !isPreview);
    raw.classList.toggle('hidden', isPreview);
  }
  previewBtn.addEventListener('click', function () { setView('preview'); });
  rawBtn.addEventListener('click', function () { setView('raw'); });
})();
`;

export async function buildMarkdownPopoutDocument(title: string, text: string): Promise<string> {
  const { renderFormattedMessageHtml } = await import('./formatted-message-html');
  const previewHtml = renderFormattedMessageHtml(text);
  const safeTitle = escapeHtml(title);
  const safeRaw = escapeHtml(text);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<style>${POPOUT_STYLES}</style>
</head>
<body>
<header>
  <h1>${safeTitle}</h1>
  <div class="view-toggle" role="group" aria-label="View mode">
    <button type="button" id="preview-btn" aria-pressed="true">Preview</button>
    <button type="button" id="raw-btn" aria-pressed="false">Raw</button>
  </div>
</header>
<main>
  <div id="preview-view" class="view">${previewHtml}</div>
  <pre id="raw-view" class="view raw-text hidden">${safeRaw}</pre>
</main>
<script>${POPOUT_SCRIPT}<\/script>
</body>
</html>`;
}

export function buildPlainTextPopoutDocument(title: string, text: string): string {
  const safeTitle = escapeHtml(title);
  const safeText = escapeHtml(text);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<style>${POPOUT_STYLES}</style>
</head>
<body>
<header>
  <h1>${safeTitle}</h1>
</header>
<main>
  <pre class="raw-text">${safeText}</pre>
</main>
</body>
</html>`;
}

export function buildVideoPopoutDocument(
  title: string,
  videoSrc: string,
  mimeType = 'video/mp4',
): string {
  const safeTitle = escapeHtml(title);
  const safeSrc = escapeHtml(videoSrc);
  const mimeJson = JSON.stringify(mimeType);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<style>${POPOUT_STYLES}</style>
</head>
<body>
<header>
  <h1>${safeTitle}</h1>
</header>
<main>
  <video id="attachment-video" class="video-preview" src="${safeSrc}" controls playsinline preload="metadata"></video>
  <div id="attachment-video-fallback" class="video-fallback" hidden>
    <p>Preview unavailable in this browser.</p>
    <a href="${safeSrc}" download="${safeTitle}">Download ${safeTitle}</a>
  </div>
</main>
<script>
(function () {
  var video = document.getElementById('attachment-video');
  var fallback = document.getElementById('attachment-video-fallback');
  function showFallback() {
    video.hidden = true;
    fallback.hidden = false;
  }
  if (video.canPlayType(${mimeJson}) === '') {
    showFallback();
    return;
  }
  video.addEventListener('error', function () {
    if (video.error && video.error.code === 4) showFallback();
  });
})();
</script>
</body>
</html>`;
}

export function buildAudioPopoutDocument(title: string, audioSrc: string): string {
  const safeTitle = escapeHtml(title);
  const safeSrc = escapeHtml(audioSrc);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<style>${POPOUT_STYLES}</style>
</head>
<body>
<header>
  <h1>${safeTitle}</h1>
</header>
<main>
  <audio class="audio-preview" src="${safeSrc}" controls preload="metadata"></audio>
</main>
</body>
</html>`;
}

export function buildCodePopoutDocument(title: string, text: string, language: string): string {
  const safeTitle = escapeHtml(title);
  const safeRaw = escapeHtml(text);
  const highlighted = highlightCodeHtml(text, language);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<style>${POPOUT_STYLES}</style>
</head>
<body>
<header>
  <h1>${safeTitle}</h1>
  <div class="view-toggle" role="group" aria-label="View mode">
    <button type="button" id="preview-btn" aria-pressed="true">Preview</button>
    <button type="button" id="raw-btn" aria-pressed="false">Raw</button>
  </div>
</header>
<main>
  <pre id="preview-view" class="view code-preview"><code class="hljs language-${escapeHtml(language)}">${highlighted}</code></pre>
  <pre id="raw-view" class="view raw-text hidden">${safeRaw}</pre>
</main>
<script>${POPOUT_SCRIPT}<\/script>
</body>
</html>`;
}

export function buildHtmlPopoutDocument(title: string, html: string): string {
  const safeTitle = escapeHtml(title);
  const safeRaw = escapeHtml(html);
  const safeSrcdoc = escapeHtml(html);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<style>${POPOUT_STYLES}</style>
</head>
<body>
<header>
  <h1>${safeTitle}</h1>
  <div class="view-toggle" role="group" aria-label="View mode">
    <button type="button" id="preview-btn" aria-pressed="true">Preview</button>
    <button type="button" id="raw-btn" aria-pressed="false">Raw</button>
  </div>
</header>
<main>
  <iframe
    id="preview-view"
    class="view html-preview"
    title="${safeTitle}"
    sandbox="${ATTACHMENT_HTML_IFRAME_SANDBOX}"
    srcdoc="${safeSrcdoc}"
  ></iframe>
  <pre id="raw-view" class="view raw-text hidden">${safeRaw}</pre>
</main>
<script>${POPOUT_SCRIPT}<\/script>
</body>
</html>`;
}

export function buildCsvPopoutDocument(title: string, text: string, name: string): string {
  const safeTitle = escapeHtml(title);
  const safeRaw = escapeHtml(text);
  const delimiter = csvDelimiterFromAttachment(name);
  const parsed = parseCsv(text, delimiter);
  const { rows, truncated } = limitCsvPreviewRows(parsed);
  const previewHtml = renderCsvTableHtml(rows, truncated);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<style>${POPOUT_STYLES}</style>
</head>
<body>
<header>
  <h1>${safeTitle}</h1>
  <div class="view-toggle" role="group" aria-label="View mode">
    <button type="button" id="preview-btn" aria-pressed="true">Preview</button>
    <button type="button" id="raw-btn" aria-pressed="false">Raw</button>
  </div>
</header>
<main>
  <div id="preview-view" class="view">${previewHtml}</div>
  <pre id="raw-view" class="view raw-text hidden">${safeRaw}</pre>
</main>
<script>${POPOUT_SCRIPT}<\/script>
</body>
</html>`;
}

export function openHtmlDocumentInNewTab(html: string): boolean {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const tab = window.open(url, '_blank', 'noopener,noreferrer');
  if (!tab) {
    URL.revokeObjectURL(url);
    return false;
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}
