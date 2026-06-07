/**
 * Capability: mail.delete (soft-delete, D-055)
 *
 * Moves emails to the account's Trash mailbox via `Email/set update`.
 * JMAP method chain (two round-trips):
 *   1. `Mailbox/query` filter `{role: "trash"}` + `Email/get`
 *      properties `["mailboxIds"]` — resolves the destination and
 *      captures each email's current memberships.
 *   2. `Email/set update` — every selected email gets the same
 *      `{trashId: true, ...everySourceMailbox: false}` patch.
 *
 * D-055: `mail.delete` is **not** a destroy. The destroy path is
 * `mail.purge`, which is UI-only — the MCP server does not expose
 * it and the agent-token scope vocabulary does not grant it. Agents
 * calling `mail.delete` always get this safer soft-delete path; a
 * later "restore" can put the messages back from Trash.
 *
 * Scope is `mail:delete` — distinct from `mail:modify` so the user
 * can grant flagging/labeling without granting delete.
 */

import { z } from 'zod';
import { capability } from '../src/index.js';

const PreviewEmail = z.object({
  id: z.string(),
  subject: z.string(),
  from: z
    .string()
    .describe(
      'Pretty-printed first sender, e.g. `Alice <alice@example.net>` or ' +
        'just `alice@example.net` when no display name is set.',
    ),
});

export const mailDelete = capability({
  name: 'mail.delete',
  version: '0.0.2',
  scopes: ['mail:delete'],
  description:
    'Move emails to Trash. Soft-delete only — the messages stay in ' +
    'the account and can be restored. Permanent destruction is ' +
    '`mail.purge`, which is intentionally UI-only and not granted ' +
    'to agents (D-055). Commit issues a two-step JMAP chain: ' +
    'resolve Trash + memberships, then `Email/set update`.',
  isDestructive: true,
  input: z.object({
    emailIds: z
      .array(z.string())
      .min(1)
      .describe(
        'One or more JMAP Email ids. Resolve via thread.list / ' +
          'thread.get / thread.search. Each email is moved to Trash ' +
          'and removed from its previous mailbox(es); none of the ' +
          'fields like subject / from are required from the caller.',
      ),
  }),
  output: z.object({
    deletedCount: z
      .number()
      .int()
      .describe(
        'Number of emails the server reports as successfully moved ' +
          'to Trash (= the size of the `Email/set update.updated` map). ' +
          'Equal to `emailIds.length` on the happy path.',
      ),
  }),
  dryRun: {
    preview: z.object({
      affectedCount: z
        .number()
        .int()
        .describe('Number of emails the move would affect (= emailIds.length).'),
      emails: z
        .array(PreviewEmail)
        .describe(
          'Subject + sender for each id, so an approval surface can ' +
            'render "you are about to move N messages to Trash" with ' +
            'enough context to confirm intent.',
        ),
    }),
  },
  examples: [
    {
      title: 'Move two messages to Trash',
      input: { emailIds: ['E-001', 'E-002'] },
      output: { deletedCount: 2 },
    },
  ],
});
