/**
 * Capability: mail.send
 *
 * Phase 2 work item 3. Second destructive contract; the first one
 * that puts mail on the wire.
 *
 * JMAP method chain (one HTTP request, RFC 8621 §7):
 *   1. `Email/set` create — builds the message and files it under the
 *      Sent mailbox with `$seen`.
 *   2. `EmailSubmission/set` create — back-references the Email/set
 *      creation id (`#c0`) and submits via the configured outbound
 *      relay (`urn:ietf:params:jmap:submission`).
 *
 * `dry_run` returns recipients (visible + envelope rcptTo), subject,
 * a truncated body preview, attachment count + blob ids, and an
 * estimated send time + size — WITHOUT calling the JMAP server. The
 * server's actual send time is server-determined at commit; the
 * preview's `estimatedSendTime` is "now" unless `sendAt` is supplied.
 *
 * Scope is `mail:send` — strictly stricter than `mail:draft`. An agent
 * with `mail:draft` only can write drafts but cannot submit. Phase 3
 * lights up scope enforcement for MCP agents (item 13 of Phase 3); the
 * shell user has every scope by virtue of being the human.
 */

import { z } from 'zod';
import { capability } from '../src/index.js';

const EmailAddress = z.object({
  name: z.string().optional(),
  email: z.string(),
});

const Recipients = z.object({
  to: z.array(EmailAddress),
  cc: z.array(EmailAddress).optional(),
  bcc: z.array(EmailAddress).optional(),
  envelopeRcptTo: z
    .array(z.string())
    .describe(
      'Flattened list of every recipient email (to + cc + bcc). This is the actual SMTP RCPT TO set the relay receives — useful for surfacing "this would also email <bcc> who is not visible in to/cc" in the dry-run UI.',
    ),
});

export const mailSend = capability({
  name: 'mail.send',
  version: '0.0.1',
  scopes: ['mail:send'],
  description:
    'Send an email through the configured outbound relay. JMAP: ' +
    'chained `Email/set` + `EmailSubmission/set` (one HTTP request via ' +
    'back-reference). Dry-run returns recipients (visible + envelope), ' +
    'subject, body preview snippet, attachment count, and estimated ' +
    'send time; commit issues the real submission and returns the ' +
    'created Email + EmailSubmission ids.',
  isDestructive: true,
  input: z.object({
    sentMailboxId: z
      .string()
      .describe(
        'Sent mailbox id — typically resolved via `mailbox.list` (filter by `role: "sent"`). The created Email is filed here on submission.',
      ),
    identityId: z
      .string()
      .describe(
        'JMAP Identity id (from `Identity/get`). Determines the sending identity the relay binds to; the value MUST be registered server-side. Phase 2 item 6 surfaces selection in the UI.',
      ),
    from: EmailAddress.describe(
      'Sender — typically the identity\'s email; can differ when an alias is allowed by the identity. The server validates the relationship at submission.',
    ),
    to: z.array(EmailAddress).min(1).describe('At least one visible recipient.'),
    cc: z.array(EmailAddress).optional(),
    bcc: z.array(EmailAddress).optional(),
    subject: z.string(),
    bodyText: z
      .string()
      .optional()
      .describe(
        'Plain-text body. At least one of `bodyText` / `bodyHtml` must be present; the host path rejects empty bodies at commit time.',
      ),
    bodyHtml: z
      .string()
      .optional()
      .describe(
        'HTML body, already sanitized by the composer (Phase 2 item 1) before reaching here.',
      ),
    inReplyTo: z
      .string()
      .optional()
      .describe('Message-ID this message replies to (RFC 5322 `In-Reply-To` header).'),
    references: z
      .string()
      .optional()
      .describe('Space-separated `References` header value for thread linkage.'),
    sendAt: z
      .string()
      .optional()
      .describe(
        'ISO 8601 timestamp for delayed send. Absent = immediate. The relay rejects past timestamps; the contract does not pre-validate.',
      ),
  }),
  output: z.object({
    emailId: z.string().describe('JMAP Email id of the sent message.'),
    blobId: z.string().describe('Blob id of the underlying RFC 822.'),
    threadId: z.string(),
    size: z
      .number()
      .int()
      .describe('Size of the encoded message in bytes.'),
    submissionId: z
      .string()
      .describe('JMAP EmailSubmission id — handle for retrieving status or cancelling a delayed send.'),
    sendAt: z
      .string()
      .optional()
      .describe(
        'Server-stamped send time (ISO 8601). Absent when the server treated the submission as immediate and did not record a delayed-send time.',
      ),
  }),
  dryRun: {
    preview: z.object({
      recipients: Recipients,
      subject: z.string(),
      bodyPreview: z
        .string()
        .describe(
          'First ~200 chars of the message body (plain text preferred; falls back to HTML with tags stripped). Useful for the confirmation modal so the user sees what would actually be sent.',
        ),
      hasBodyText: z.boolean(),
      hasBodyHtml: z.boolean(),
      attachmentCount: z
        .number()
        .int()
        .describe(
          'Number of attachments that would be sent. Always 0 in Phase 2 until item 7 wires JMAP Blob uploads.',
        ),
      attachmentBlobIds: z
        .array(z.string())
        .describe(
          'Blob ids of attachments that would be referenced. Empty in Phase 2; populated by item 7.',
        ),
      estimatedSendTime: z
        .string()
        .describe(
          'ISO 8601 timestamp the message would be sent at. Equal to `sendAt` if supplied, else "now" stamped at preview construction.',
        ),
      estimatedSize: z
        .number()
        .int()
        .describe('Rough RFC 822 envelope size estimate in bytes.'),
      identityId: z.string().describe('Echoed back so the UI can label the preview "Sending as <identity>".'),
    }),
  },
  examples: [
    {
      title: 'Send a plain-text message to Alice',
      input: {
        sentMailboxId: 'Mb-sent',
        identityId: 'I-brent',
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
        submissionId: 'S-001',
        sendAt: '2026-05-11T18:30:00Z',
      },
    },
  ],
});
