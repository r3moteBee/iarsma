/**
 * Capability: mail.modify
 *
 * Move emails between mailboxes or toggle keywords ($seen, $flagged, etc.).
 * JMAP: `Email/set` with an `update` map using path-based patch syntax
 * (RFC 8621 §4.4).
 *
 * Destructive contract — dry-run returns a preview of the patch that would
 * be applied without touching the JMAP server; commit issues the real
 * Email/set update request.
 *
 * Scope is `mail:modify` — distinct from `mail:draft` and `mail:send`.
 */

import { z } from 'zod';

export const MailModifyInputSchema = z.object({
  emailIds: z.array(z.string()).min(1),
  patch: z.object({
    mailboxIds: z.record(z.string(), z.boolean()).optional(),
    keywords: z.record(z.string(), z.boolean()).optional(),
  }),
});

export const MailModifyOutputSchema = z.object({
  modifiedCount: z.number(),
});

export const contract = {
  name: 'mail.modify',
  description: 'Move emails between mailboxes or toggle keywords ($seen, $flagged, etc.).',
  input: MailModifyInputSchema,
  output: MailModifyOutputSchema,
  isDestructive: true,
};
