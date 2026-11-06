// postMessage channel that lets an HTML attachment preview push text into the
// chat composer. This is deliberately narrow: an attachment can *suggest* text
// for the input box, and that is all. It can never send a message, read chat
// history, or reach any other host state — the parent only ever calls setDraft.
//
// Security note: HTML previews render in a sandboxed iframe WITHOUT
// allow-same-origin, so their postMessages arrive with a null (`"null"`)
// origin. That makes an `event.origin` allowlist useless here. The trust check
// that actually works is source-window identity: the caller compares
// `event.source` against the specific iframe's contentWindow. This module owns
// the *shape* validation; the caller owns the *source* validation.

export const ATTACHMENT_MESSAGE_CHANNEL = 'nanoclaw-attachment';

// Composer text is a suggestion for a human to review, not a payload. Cap it so
// a preview can't shove a novel into the input box.
export const MAX_COMPOSE_TEXT_LENGTH = 4000;

export interface AttachmentComposeMessage {
  channel: typeof ATTACHMENT_MESSAGE_CHANNEL;
  type: 'compose';
  text: string;
}

/**
 * Validate an untrusted postMessage payload from an attachment preview.
 * Returns the normalized compose text, or null if the message is not a
 * well-formed compose request. Never throws.
 *
 * Rejects: non-objects, wrong channel/type, non-string or empty text, and text
 * over MAX_COMPOSE_TEXT_LENGTH. Text is trimmed of trailing whitespace but
 * otherwise passed through verbatim — the composer, not this parser, decides
 * how to insert it.
 */
export function parseAttachmentComposeMessage(data: unknown): { text: string } | null {
  if (typeof data !== 'object' || data === null) return null;
  const msg = data as Record<string, unknown>;
  if (msg.channel !== ATTACHMENT_MESSAGE_CHANNEL) return null;
  if (msg.type !== 'compose') return null;
  if (typeof msg.text !== 'string') return null;

  const text = msg.text.replace(/\s+$/, '');
  if (text.length === 0) return null;
  if (text.length > MAX_COMPOSE_TEXT_LENGTH) return null;

  return { text };
}
