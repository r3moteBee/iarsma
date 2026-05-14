/**
 * Capability: thread.search
 *
 * Phase 2 work item 9. Server-side full-text search across the user's
 * mailboxes.
 *
 * Wire shape: JMAP `Email/query` with a `text` filter, chained with
 * `Email/get` (RFC 8620 §3.7 back-reference) — same chain as
 * `thread.list`, just a different filter. The output shape matches
 * `thread.list` so the existing ThreadList component can render
 * either, controlled by a search-state atom.
 *
 * Scope is `mail:read` — the response carries metadata only (subject,
 * preview, addresses, dates, keywords) — no body bytes. An agent
 * scoped to `mail:read.metadata` can search but can't open a result
 * (that needs `thread.get` which carries body content under
 * `mail:read`).
 *
 * Phase 2 ships text-only search. Targeted filters (from/to/subject/
 * body/keyword), date ranges, attachment-only — all reserved for a
 * future contract version.
 */

import { z } from 'zod';
import { capability } from '../src/index.js';

const EmailAddress = z.object({
  name: z.string().optional(),
  email: z.string(),
});

const Keyword = z.object({
  name: z.string(),
  value: z.boolean(),
});

const EmailSummary = z.object({
  id: z.string(),
  threadId: z.string(),
  from: z.array(EmailAddress).optional(),
  to: z.array(EmailAddress).optional(),
  subject: z.string().optional(),
  preview: z.string().optional(),
  receivedAt: z.string().describe('Server ingestion time, ISO 8601.'),
  keywords: z.array(Keyword),
  size: z.number().int(),
});

const ThreadSummary = z.object({
  id: z.string(),
  latestEmail: EmailSummary,
});

export const threadSearch = capability({
  name: 'thread.search',
  version: '0.0.1',
  scopes: ['mail:read'],
  description:
    'Server-side full-text search across the user\'s mailboxes. ' +
    'JMAP: `Email/query` with a `text` filter, chained with ' +
    '`Email/get` (one round-trip via back-reference). Response is ' +
    'the same `{threads, position, total}` shape as `thread.list` so ' +
    'the ThreadList UI can render either.',
  input: z.object({
    query: z
      .string()
      .min(1)
      .describe(
        'Search text. The server matches against subject, body, and ' +
          'header fields. The exact match rules are server-defined ' +
          '(Stalwart uses tantivy under the hood) — clients should ' +
          'treat results as "best-effort, ranked by the server."',
      ),
    inMailboxId: z
      .string()
      .optional()
      .describe(
        'Scope the search to a single mailbox. Omit to search every ' +
          'mailbox the account can read.',
      ),
    position: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Zero-indexed offset. Defaults to 0.'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .describe('Page size. Defaults to 50; capped server-side at 200.'),
  }),
  output: z.object({
    threads: z.array(ThreadSummary).describe('Threads matching the search, ordered by server-side relevance.'),
    position: z.number().int(),
    total: z
      .number()
      .int()
      .optional()
      .describe('Total matches when the server reports it. Stalwart sometimes omits this on expensive queries.'),
  }),
  examples: [
    {
      title: 'Find threads mentioning "project plan"',
      input: { query: 'project plan' },
      output: {
        threads: [
          {
            id: 'T1',
            latestEmail: {
              id: 'E1',
              threadId: 'T1',
              from: [{ name: 'Alice', email: 'alice@example.net' }],
              subject: 'Re: Project plan',
              preview: 'Looks good — see embedded logo.',
              receivedAt: '2026-05-09T16:10:00Z',
              keywords: [
                { name: '$seen', value: true },
                { name: '$flagged', value: true },
              ],
              size: 8190,
            },
          },
        ],
        position: 0,
        total: 1,
      },
    },
  ],
});
