/**
 * Capability: thread.list
 *
 * Phase 1 work item 3. Pagination per D-041 (`position` + `limit`).
 *
 * Wire shape: the host sends a single JMAP request with two methodCalls
 * (RFC 8620 §3.7) — `Email/query` (sorted by `receivedAt desc`,
 * `collapseThreads: true` so each thread surfaces its most recent email)
 * followed by `Email/get` with a `#ids` back-reference into the query
 * result. One roundtrip; metadata-only properties on `Email/get` keep
 * the response compact (subject, sender, preview, date, keywords, size).
 *
 * Output: an array of thread summaries, each carrying its latest
 * email's metadata. Body parts come later via `thread.get`.
 *
 * Out of scope today:
 *   - More expressive filters (search query, date range, has-attachment).
 *     Contract takes only `mailboxId`; future minor bumps add optional
 *     filter fields, gated by per-tool capability checks.
 *   - Actual aggregate counts (`messageCount`, `unreadCount`) per thread.
 *     A future `Thread/get` chain adds them when the per-thread view
 *     warrants the extra roundtrip.
 */

import { z } from 'zod';
import { capability } from '../src/index.js';

const EmailAddress = z.object({
  name: z.string().optional().describe('Display name, if the JMAP server has one.'),
  email: z.string().describe('addr-spec — the canonical email address.'),
});

const Keyword = z.object({
  name: z.string().describe(
    'Keyword name — RFC 8621 §4.1.1 reserves `$seen`, `$flagged`, `$answered`, ' +
      '`$draft`, `$forwarded`, `$junk`, `$notjunk`, `$phishing`. Servers may ' +
      'surface custom keywords too.',
  ),
  value: z.boolean().describe('Whether the keyword is set on the email.'),
});

const EmailSummary = z.object({
  id: z.string().describe('JMAP email id.'),
  threadId: z.string().describe('JMAP thread id this email belongs to.'),
  from: z.array(EmailAddress).optional(),
  to: z.array(EmailAddress).optional(),
  subject: z.string().optional(),
  preview: z.string().optional().describe(
    'Server-computed snippet for inbox-row display. Length / wording is ' +
      'server-decided — Stalwart returns the first ~256 chars of the body.',
  ),
  receivedAt: z.string().describe('ISO 8601 / RFC 3339 timestamp from the server.'),
  keywords: z
    .array(Keyword)
    .describe(
      'Keyword flags. Modeled as a list of `{name, value}` rather than a ' +
        'dictionary because the WIT contract is the source of truth and WIT ' +
        "doesn't have an open-shape map type. Consumers that want " +
        'dictionary-style access can build a `Map<string, boolean>` on read.',
    ),
  size: z.number().int().describe('Total RFC 5322 message size in bytes.'),
});

const ThreadSummary = z.object({
  id: z.string().describe('JMAP thread id.'),
  latestEmail: EmailSummary.describe(
    'Metadata for the most-recent email in the thread (per `receivedAt desc` ' +
      'sort). The thread may contain other emails not surfaced here; ' +
      '`thread.get` is the upcoming capability that fetches the full set.',
  ),
});

export const threadList = capability({
  name: 'thread.list',
  version: '0.0.1',
  scopes: ['mail:read.metadata'],
  description:
    'List threads in a mailbox, most recent first, paginated by position+limit ' +
    '(D-041). One thread per row — JMAP collapses the thread server-side. JMAP ' +
    'methods: Email/query + Email/get (chained via back-reference, one roundtrip).',
  input: z.object({
    mailboxId: z.string().describe('JMAP mailbox id from `mailbox.list`.'),
    position: z
      .number()
      .int()
      .optional()
      .describe('Zero-indexed offset into the result set. Defaults to 0 when omitted.'),
    limit: z
      .number()
      .int()
      .optional()
      .describe(
        'Page size. Defaults to 50; capped server-side at 200 to keep the ' +
          'metadata response under the JMAP request size budget.',
      ),
  }),
  output: z.object({
    threads: z.array(ThreadSummary),
    position: z
      .number()
      .int()
      .describe('Echoed from the JMAP `Email/query` response.'),
    total: z
      .number()
      .int()
      .optional()
      .describe(
        'Total threads matching the filter when the host requested ' +
          '`calculateTotal`. Servers may legally omit it; consumers fall back ' +
          'to "load until empty page."',
      ),
  }),
  examples: [
    {
      title: 'First page of 50 threads in the inbox',
      input: { mailboxId: 'Mb01', position: 0, limit: 50 },
      output: {
        threads: [
          {
            id: 'T1',
            latestEmail: {
              id: 'E1',
              threadId: 'T1',
              from: [{ name: 'Alice', email: 'alice@example.net' }],
              to: [{ name: 'User', email: 'user@example.net' }],
              subject: 'Re: project plan',
              preview: "Looks good — let's go with the schedule we agreed on Tuesday.",
              receivedAt: '2026-05-09T15:42:11Z',
              keywords: [
                { name: '$seen', value: true },
                { name: '$flagged', value: true },
              ],
              size: 8190,
            },
          },
        ],
        position: 0,
        total: 42,
      },
    },
  ],
});
