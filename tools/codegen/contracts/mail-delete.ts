/**
 * Capability: mail.delete
 *
 * Permanently destroy emails by ID. Emails must be in Trash first.
 * JMAP: `Email/set` with a `destroy` array (RFC 8621 §5.3).
 *
 * Destructive contract — dry-run returns a preview of the affected
 * email count without touching the JMAP server; commit issues the
 * real Email/set destroy request.
 *
 * Scope is `mail:delete` — distinct from `mail:modify` (trash) and
 * `mail:draft` (create).
 */

import { z } from 'zod';

export const MailDeleteInputSchema = z.object({
  emailIds: z.array(z.string()).min(1),
});

export const MailDeleteOutputSchema = z.object({
  deletedCount: z.number(),
});

export const contract = {
  name: 'mail.delete',
  description: 'Permanently destroy emails by ID. Emails must be in Trash first.',
  input: MailDeleteInputSchema,
  output: MailDeleteOutputSchema,
  isDestructive: true,
};
