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
 *
 * Wire-up note: this contract was the plain `contract = {...}` shape until
 * PR 42, which is why the codegen walker (which only picks up `capability()`
 * exports) silently skipped it and the tool never reached agents.
 */

import { z } from 'zod';
import { capability } from '../src/index.js';

const EmailKeywordsPatch = z
  .object({
    mailboxIds: z
      .string()
      .optional()
      .describe(
        'JSON-encoded `{mailboxId: boolean}` map. `true` adds the email to ' +
          'that mailbox; `false` removes it. Empty / missing entries leave a ' +
          "mailbox membership untouched. Use mailbox.list to resolve ids by role.",
      ),
    keywords: z
      .string()
      .optional()
      .describe(
        'JSON-encoded `{keyword: boolean}` map. Standard JMAP keywords ' +
          'include `$seen`, `$flagged`, `$answered`, `$draft`. Custom labels ' +
          '(no $ prefix) are also supported.',
      ),
  })
  .describe(
    'Path-style patch. Both fields are serialized as JSON strings because ' +
      'WIT records (D-036) require fixed-shape, statically-typed fields — ' +
      'open-ended maps from id → boolean go on the wire as JSON. The handler ' +
      'parses them at the invocation boundary.',
  );

export const mailModify = capability({
  name: 'mail.modify',
  version: '0.0.1',
  scopes: ['mail:modify'],
  description:
    'Move emails between mailboxes or toggle keywords (`$seen`, `$flagged`, ' +
    '`$answered`, etc.). JMAP: `Email/set` `update`. Dry-run returns the ' +
    'patch that would be applied; commit issues the real update.',
  isDestructive: true,
  input: z.object({
    emailIds: z
      .array(z.string())
      .min(1)
      .describe(
        'One or more JMAP Email ids to update. Resolve via thread.list / ' +
          'thread.get / thread.search.',
      ),
    patch: EmailKeywordsPatch,
  }),
  output: z.object({
    modifiedCount: z
      .number()
      .int()
      .describe('Number of emails the server reports as successfully updated.'),
  }),
  dryRun: {
    preview: z.object({
      affectedCount: z
        .number()
        .int()
        .describe('Number of emails the patch would touch (= emailIds.length).'),
      changes: z
        .array(
          z.object({
            emailId: z.string(),
            patchApplied: EmailKeywordsPatch,
          }),
        )
        .describe(
          'Per-email expansion of the patch. The handler echoes back what ' +
            'WOULD be sent so agents can confirm before committing.',
        ),
    }),
  },
  examples: [
    {
      title: 'Mark a thread as read',
      input: {
        emailIds: ['E-001', 'E-002'],
        patch: { keywords: '{"$seen":true}' },
      },
      output: { modifiedCount: 2 },
    },
    {
      title: 'Move a message from Inbox to a project mailbox',
      input: {
        emailIds: ['E-001'],
        patch: { mailboxIds: '{"Mb-inbox":false,"Mb-project":true}' },
      },
      output: { modifiedCount: 1 },
    },
  ],
});
