/**
 * Build a `ComposePrefill` for reply / reply-all / forward
 * (Phase 2 work item 5). Pure function — no React, no DOM, no JMAP.
 *
 * Recipient rules (RFC 8621 §3.4 + RFC 5322 §3.6.4):
 *
 *   - reply: `to` = original sender (`from`). `cc` = empty. The
 *     current user is removed from `to` (no point replying to
 *     yourself).
 *   - reply-all: `to` = original sender. `cc` = original `to` + `cc`
 *     minus the current user, deduped by email.
 *   - forward: recipients empty (the user fills them in).
 *
 * Subject prefixing:
 *
 *   - reply / reply-all: prepend `Re: ` unless the subject already
 *     starts with `Re:` (case-insensitive, optional whitespace).
 *   - forward: prepend `Fwd: ` with the same dedup rule.
 *
 * Body prefill:
 *
 *   - Wraps the original body in `<blockquote contenteditable="false">`
 *     with an attribution line (`On <date>, <sender> wrote:`). Squire
 *     respects `contenteditable="false"` so the user can edit around
 *     the quote but not inside it.
 *   - Uses `bodyHtml` when present; falls back to `bodyText` wrapped
 *     in a `<pre>` block. Plain-text-only messages stay plain-text-
 *     readable after the reply is sent.
 *
 * Thread linkage:
 *
 *   - reply / reply-all: `inReplyTo` is the original email's first
 *     `messageId`. `references` is the original `references` + the
 *     same Message-ID (RFC 5322 thread-chain extension).
 *   - forward: no thread linkage (a forward starts a new chain).
 *
 * Returned `ComposePrefill` is consumable directly by `ComposeView`.
 */

import type { ComposePrefill } from '../compose-state.js';
import type { EmailFull } from '../runtime/jmap-client.js';

export type ReplyMode = 'reply' | 'reply-all' | 'forward';

export type BuildReplyPrefillInput = {
  readonly email: EmailFull;
  readonly mode: ReplyMode;
  /** The current user's email — removed from any computed recipient
   *  list so a reply-all doesn't email yourself. */
  readonly userEmail: string;
};

export function buildReplyPrefill(opts: BuildReplyPrefillInput): ComposePrefill {
  const { email, mode, userEmail } = opts;
  const lowerUser = userEmail.toLowerCase();

  const sender = (email.from ?? [])[0];
  const subjectPrefix = mode === 'forward' ? 'Fwd: ' : 'Re: ';
  const subject = prefixSubject(email.subject ?? '', subjectPrefix);
  const quoted = buildQuotedBody(email);

  if (mode === 'forward') {
    return {
      subject,
      bodyHtml: quoted,
    };
  }

  // reply / reply-all: to = sender; reply-all also adds original to+cc.
  const to: Array<{ name?: string; email: string }> = [];
  if (sender !== undefined && sender.email.toLowerCase() !== lowerUser) {
    to.push(sender);
  }
  const ccList: Array<{ name?: string; email: string }> = [];
  if (mode === 'reply-all') {
    const seen = new Set<string>([
      lowerUser,
      ...to.map((a) => a.email.toLowerCase()),
    ]);
    for (const addr of [...(email.to ?? []), ...(email.cc ?? [])]) {
      const k = addr.email.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      ccList.push(addr);
    }
  }

  // Thread linkage. Message-IDs are stable across the wire so we can
  // pass them verbatim; the server's RFC 5322 generator will angle-
  // bracket-render them in the actual headers.
  const inReplyTo = email.messageId.length > 0 ? email.messageId[0] : undefined;
  const refsList = [...email.references];
  if (inReplyTo !== undefined && !refsList.includes(inReplyTo)) {
    refsList.push(inReplyTo);
  }
  const references = refsList.length > 0 ? refsList.join(' ') : undefined;

  return {
    ...(to.length > 0 ? { to } : {}),
    ...(ccList.length > 0 ? { cc: ccList } : {}),
    subject,
    bodyHtml: quoted,
    ...(inReplyTo !== undefined ? { inReplyTo } : {}),
    ...(references !== undefined ? { references } : {}),
  };
}

function prefixSubject(original: string, prefix: string): string {
  const trimmed = original.trim();
  const lowerPrefix = prefix.trim().toLowerCase();
  if (trimmed.toLowerCase().startsWith(lowerPrefix)) {
    return trimmed;
  }
  return `${prefix}${trimmed}`;
}

function buildQuotedBody(email: EmailFull): string {
  const senderLabel = (() => {
    const s = (email.from ?? [])[0];
    if (s === undefined) return '(unknown sender)';
    return s.name !== undefined ? `${s.name} <${s.email}>` : s.email;
  })();
  const dateLabel = email.receivedAt;
  const inner =
    email.bodyHtml !== undefined && email.bodyHtml.length > 0
      ? email.bodyHtml
      : email.bodyText !== undefined && email.bodyText.length > 0
        ? `<pre>${escapeHtml(email.bodyText)}</pre>`
        : '';
  // The wrapping blockquote is `contenteditable="false"` so Squire
  // treats it as a single atomic chunk — the user can place the cursor
  // before or after but not inside. The empty paragraph above gives
  // the cursor a default landing spot when the composer opens.
  return [
    `<p></p>`,
    `<blockquote contenteditable="false">`,
    `<p>On ${escapeHtml(dateLabel)}, ${escapeHtml(senderLabel)} wrote:</p>`,
    inner,
    `</blockquote>`,
  ].join('');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
