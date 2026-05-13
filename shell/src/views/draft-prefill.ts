/**
 * Build a `ComposePrefill` for reopening an existing draft in the
 * composer (Phase 2 work item 8). Pure function — no React, no DOM,
 * no JMAP.
 *
 * Differs from `buildReplyPrefill` in three ways:
 *   1. No `Re:` / `Fwd:` subject prefix — this is editing the draft
 *      the user already typed, not replying to anyone.
 *   2. No quoted body wrapping — the body is the draft body verbatim.
 *   3. Preserves the draft's own thread linkage (`inReplyTo` and
 *      `references` if present) so a draft started as a reply
 *      reopens with the same threading.
 *
 * Known limitation (documented in docs/compose-ui.md): saving the
 * reopened draft creates a NEW draft and orphans the original. A
 * future `mail.draft.update` capability will update-in-place; until
 * then operators see two draft rows after every edit.
 */

import type { ComposePrefill } from '../compose-state.js';
import type { EmailFull } from '../runtime/jmap-client.js';

export function buildDraftPrefill(email: EmailFull): ComposePrefill {
  return {
    ...(email.to !== undefined && email.to.length > 0 ? { to: email.to } : {}),
    ...(email.cc !== undefined && email.cc.length > 0 ? { cc: email.cc } : {}),
    ...(email.bcc !== undefined && email.bcc.length > 0
      ? { bcc: email.bcc }
      : {}),
    ...(email.subject !== undefined ? { subject: email.subject } : {}),
    ...(email.bodyHtml !== undefined ? { bodyHtml: email.bodyHtml } : {}),
    ...(email.bodyText !== undefined ? { bodyText: email.bodyText } : {}),
    // Preserve threading headers when the draft was started as a
    // reply. JMAP returns them as arrays; we use the first entry.
    ...(email.inReplyTo.length > 0
      ? { inReplyTo: email.inReplyTo[0] }
      : {}),
    ...(email.references.length > 0
      ? { references: email.references.join(' ') }
      : {}),
  };
}
