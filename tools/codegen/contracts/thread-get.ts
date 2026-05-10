/**
 * Capability: thread.get
 *
 * Phase 1 work item 6. Full thread payload — every email in the thread,
 * with body parts and attachment metadata.
 *
 * Wire shape: chained `Thread/get` + `Email/get` (RFC 8620 §3.7
 * back-reference). One JMAP request per call. The Rust parser
 * flattens JMAP's `bodyValues` + `textBody` / `htmlBody` arrays into
 * concatenated `bodyText` / `bodyHtml` strings — Phase 1 MessageView
 * doesn't need the structured tree, and a future minor bump can add
 * a richer surface if a use case emerges.
 *
 * Scope is `mail:read` (not `mail:read.metadata`) because the response
 * carries body content. An agent with only `mail:read.metadata` can
 * call `thread.list` but not `thread.get`.
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

const Attachment = z.object({
  id: z
    .string()
    .describe(
      'JMAP blob id. The future `mail.attachment.download` capability fetches the bytes by this id.',
    ),
  name: z.string().optional().describe('Filename advertised by the sender. Often absent for inline images.'),
  type: z.string().describe('MIME type, e.g. `application/pdf`, `image/png`.'),
  size: z.number().int().describe('Decoded size in bytes.'),
  cid: z
    .string()
    .optional()
    .describe(
      'Content-ID — present on inline-referenced parts (matches `<img src="cid:...">` references in the html body).',
    ),
  disposition: z
    .string()
    .optional()
    .describe(
      "`attachment` (download chrome) or `inline` (rendered alongside the body, e.g. inline images). Absent when the server didn't classify.",
    ),
});

const EmailFull = z.object({
  id: z.string(),
  threadId: z.string(),
  from: z.array(EmailAddress).optional(),
  to: z.array(EmailAddress).optional(),
  cc: z.array(EmailAddress).optional(),
  bcc: z.array(EmailAddress).optional(),
  subject: z.string().optional(),
  preview: z.string().optional(),
  receivedAt: z.string().describe('Server ingestion time, ISO 8601.'),
  sentAt: z
    .string()
    .optional()
    .describe('Sender-stamped send time. Optional because some legacy messages omit `Date:`.'),
  keywords: z.array(Keyword),
  size: z.number().int(),
  bodyText: z
    .string()
    .optional()
    .describe(
      "Concatenated plain-text body (each `text/plain` part joined by `\\n\\n`). Absent when the message has no `text/plain` part.",
    ),
  bodyHtml: z
    .string()
    .optional()
    .describe(
      "Concatenated HTML body (each `text/html` part joined by `\\n`). Absent when the message has no `text/html` part. Hosts MUST run this through `iarsma:html-sanitizer` before rendering.",
    ),
  attachments: z.array(Attachment),
});

const Thread = z.object({
  id: z.string(),
  emailIds: z.array(z.string()).describe('Email ids in chronological order (RFC 8621 §3.4).'),
});

export const threadGet = capability({
  name: 'thread.get',
  version: '0.0.1',
  scopes: ['mail:read'],
  description:
    'Fetch a full thread: every message in the thread with body parts (text + html) ' +
    'and attachment metadata. JMAP methods: Thread/get + Email/get (chained via ' +
    'back-reference, one roundtrip).',
  input: z.object({
    threadId: z.string().describe('JMAP thread id, e.g. from `thread.list`.'),
  }),
  output: z.object({
    thread: Thread,
    emails: z.array(EmailFull).describe(
      'Full email payloads, ordered to match `thread.emailIds` (chronological).',
    ),
  }),
  examples: [
    {
      title: 'Two-message thread with body parts and an inline image',
      input: { threadId: 'T1' },
      output: {
        thread: { id: 'T1', emailIds: ['E1', 'E2'] },
        emails: [
          {
            id: 'E1',
            threadId: 'T1',
            from: [{ name: 'Bob', email: 'bob@example.net' }],
            to: [{ name: 'Alice', email: 'alice@example.net' }],
            subject: 'Project plan',
            preview: 'Hi Alice — please find the schedule attached.',
            receivedAt: '2026-05-09T15:42:11Z',
            sentAt: '2026-05-09T15:41:50Z',
            keywords: [{ name: '$seen', value: true }],
            size: 4321,
            bodyText: 'Hi Alice,\n\nPlease find the schedule attached.\n\nBob',
            bodyHtml:
              '<p>Hi Alice,</p><p>Please find the schedule attached.</p><p>Bob</p>',
            attachments: [],
          },
        ],
      },
    },
  ],
});
