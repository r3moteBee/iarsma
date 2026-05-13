/**
 * Capability: mail.draft
 *
 * Phase 2 work item 2. First destructive contract — creates a draft
 * message in the user's Drafts mailbox. JMAP: `Email/set` create with
 * the `$draft` keyword (RFC 8621 §4.4).
 *
 * Wire envelope (D-046): destructive contracts get their input wrapped
 * as `{ mode: 'preview' | 'commit', params }` and their output wrapped
 * as `{ mode: 'preview', preview } | { mode: 'commit', result, logEntryRef }`.
 * The codegen produces both shapes from the natural `input` / `output` /
 * `dryRun.preview` schemas declared here.
 *
 * `dry_run` semantics: returns the proposed Email object (the same
 * structure JMAP would commit) plus an estimated RFC 822 size, WITHOUT
 * touching the JMAP server. The dry-run path runs entirely client-side
 * so previews are free.
 *
 * Scope is `mail:draft` (Phase 3 will gate it; Phase 2 only the human
 * UI uses it). Distinct from `mail:send` — a draft never leaves the
 * server's drafts folder until `mail.send` (Phase 2 item 3) commits.
 */

import { z } from 'zod';
import { capability } from '../src/index.js';

const EmailAddress = z.object({
  name: z.string().optional(),
  email: z.string(),
});

const AttachmentRef = z.object({
  blobId: z.string().describe('JMAP blob id from `attachment.upload`.'),
  name: z.string().describe('Filename shown to the recipient.'),
  type: z.string().describe('MIME type, e.g. `application/pdf`.'),
  size: z.number().int().describe('Bytes — echoed back from the upload response.'),
  disposition: z
    .string()
    .optional()
    .describe(
      "`attachment` (default) or `inline` for cid-referenced images. Phase 2 item 7 supports `attachment` only; inline rewriting is reserved.",
    ),
  cid: z
    .string()
    .optional()
    .describe(
      'Content-ID for inline references. Required when `disposition: inline`; the body html should contain `<img src="cid:...">` matching.',
    ),
});

const ProposedEmail = z.object({
  mailboxId: z
    .string()
    .describe(
      'Drafts mailbox id the message would be filed under. Maps to `mailboxIds: { [id]: true }` in the JMAP `Email/set` create payload.',
    ),
  keywords: z
    .array(z.string())
    .describe(
      'Keyword names that would be set true on the JMAP `keywords` map. Always includes `$draft`; the codegen-supported shape uses a sorted name list rather than an open-ended `<name>: true` map so the WIT bindings stay strongly typed.',
    ),
  from: z.array(EmailAddress),
  to: z.array(EmailAddress),
  cc: z.array(EmailAddress).optional(),
  bcc: z.array(EmailAddress).optional(),
  subject: z.string(),
  hasBodyText: z.boolean(),
  hasBodyHtml: z.boolean(),
  bodyTextSize: z
    .number()
    .int()
    .describe('Length of the proposed bodyText in characters; 0 if absent.'),
  bodyHtmlSize: z
    .number()
    .int()
    .describe('Length of the proposed bodyHtml in characters; 0 if absent.'),
  inReplyTo: z.string().optional(),
  references: z.string().optional(),
  attachmentCount: z
    .number()
    .int()
    .describe('Number of attachments that would be filed with the draft.'),
  attachmentBlobIds: z
    .array(z.string())
    .describe('Blob ids that would be referenced from the draft.'),
});

export const mailDraft = capability({
  name: 'mail.draft',
  version: '0.0.1',
  scopes: ['mail:draft'],
  description:
    'Create a draft message in the user\'s Drafts mailbox. JMAP: ' +
    '`Email/set` create with the `$draft` keyword. Dry-run returns ' +
    'the proposed Email object without contacting the JMAP server; ' +
    'commit issues the real Email/set request.',
  isDestructive: true,
  input: z.object({
    mailboxId: z
      .string()
      .describe(
        'Drafts mailbox id — typically resolved via `mailbox.list` (filter by `role: "drafts"`).',
      ),
    from: EmailAddress.describe(
      'Sender. Phase 2 ships with this set by the UI; Phase 2 item 6 (identity selector) wires it from `Identity/get` so the value lines up with a registered JMAP identity.',
    ),
    to: z.array(EmailAddress),
    cc: z.array(EmailAddress).optional(),
    bcc: z.array(EmailAddress).optional(),
    subject: z.string(),
    bodyText: z
      .string()
      .optional()
      .describe(
        'Plain-text body. At least one of `bodyText` / `bodyHtml` must be present; the contract codegen does not enforce that today, but the host path rejects empty bodies at commit time.',
      ),
    bodyHtml: z
      .string()
      .optional()
      .describe(
        'HTML body. The composer (Phase 2 item 1) already routes paste through the `iarsma:html-sanitizer` component, so values arriving here are pre-sanitized; the host re-sanitizes defensively on commit.',
      ),
    inReplyTo: z
      .string()
      .optional()
      .describe('Message-ID this draft replies to (RFC 5322 `In-Reply-To` header).'),
    references: z
      .string()
      .optional()
      .describe(
        'Space-separated `References` header value for thread linkage (RFC 5322 §3.6.4).',
      ),
    attachments: z
      .array(AttachmentRef)
      .optional()
      .describe(
        'Attachments by blob id. Each entry MUST come from a prior `attachment.upload` call against the same JMAP account.',
      ),
  }),
  output: z.object({
    emailId: z.string().describe('JMAP Email id of the created draft.'),
    blobId: z
      .string()
      .describe(
        'Blob id of the underlying RFC 822 — used by future attachment operations.',
      ),
    threadId: z.string(),
    size: z.number().int().describe('Size of the encoded message in bytes.'),
  }),
  dryRun: {
    preview: z.object({
      proposedEmail: ProposedEmail,
      estimatedSize: z
        .number()
        .int()
        .describe(
          'Rough RFC 822 envelope size estimate in bytes. Useful for showing the user "would-create a draft of size N" without round-tripping the server.',
        ),
    }),
  },
  examples: [
    {
      title: 'Compose a new draft to alice@example.net',
      input: {
        mailboxId: 'Mb-drafts',
        from: { name: 'Brent', email: 'brent@example.net' },
        to: [{ name: 'Alice', email: 'alice@example.net' }],
        subject: 'project plan',
        bodyText: 'Hi Alice — here\'s the schedule.',
      },
      output: {
        emailId: 'E-001',
        blobId: 'B-001',
        threadId: 'T-001',
        size: 256,
      },
    },
  ],
});
