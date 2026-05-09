/**
 * Capability: mailbox.list
 *
 * Phase 1 work item 1. First read-only mail capability beyond `session.get`;
 * the mailbox tree is the inbox MVP's left sidebar (work item 2 builds the UI).
 *
 * Output mirrors the `iarsma:jmap-client@0.1.0` mailbox WIT shape
 * (RFC 8621 §2). The component returns a flat list; the host folds it into a
 * tree on `parentId`.
 *
 * Pagination: not applicable per RFC 8621 §2.4 — `Mailbox/get` returns all
 * mailboxes for the account in a single response. (Contrast with Phase 1's
 * upcoming `thread.list` capability which uses the position+limit convention
 * locked in D-041.)
 */

import { z } from 'zod';
import { capability } from '../src/index.js';

const MailboxRights = z.object({
  mayReadItems: z.boolean().describe('May read messages in this mailbox.'),
  mayAddItems: z.boolean().describe('May add (move into) messages.'),
  mayRemoveItems: z.boolean().describe('May remove (move out of / delete) messages.'),
  maySetSeen: z.boolean().describe('May change the read/unread flag on messages here.'),
  maySetKeywords: z.boolean().describe('May change keyword/label flags on messages here.'),
  mayCreateChild: z.boolean().describe('May create child mailboxes under this one.'),
  mayRename: z.boolean().describe('May rename this mailbox.'),
  mayDelete: z.boolean().describe('May delete this mailbox.'),
  maySubmit: z
    .boolean()
    .describe('May submit (send) messages stored in this mailbox via JMAP submission.'),
});

const Mailbox = z.object({
  id: z.string().describe('Server-issued stable identifier.'),
  name: z.string().describe('Display name.'),
  parentId: z
    .string()
    .optional()
    .describe('Parent mailbox id, or absent for top-level mailboxes.'),
  role: z
    .string()
    .optional()
    .describe(
      "Special-use role: 'inbox', 'sent', 'drafts', 'trash', 'junk', 'archive', etc. Absent on user-created folders.",
    ),
  sortOrder: z.number().int().describe('Display sort order — lower comes first.'),
  totalEmails: z.number().int().describe('Total messages in this mailbox.'),
  unreadEmails: z.number().int().describe('Unread messages in this mailbox.'),
  totalThreads: z.number().int().describe('Total threads represented in this mailbox.'),
  unreadThreads: z.number().int().describe('Threads with at least one unread message.'),
  isSubscribed: z.boolean().describe('Whether the user is subscribed to this mailbox.'),
  myRights: MailboxRights,
});

export const mailboxList = capability({
  name: 'mailbox.list',
  version: '0.0.1',
  scopes: ['mail:read.metadata'],
  description:
    'List all mailboxes for the authenticated account. Returns a flat array; ' +
    'consumers fold the tree on `parentId`. JMAP method: Mailbox/get (RFC 8621 §2).',
  input: z.object({}),
  output: z.array(Mailbox),
  examples: [
    {
      title: 'Account with the four standard mailboxes plus one custom subfolder',
      input: {},
      output: [
        {
          id: 'Mb01',
          name: 'Inbox',
          role: 'inbox',
          sortOrder: 0,
          totalEmails: 42,
          unreadEmails: 3,
          totalThreads: 28,
          unreadThreads: 2,
          isSubscribed: true,
          myRights: {
            mayReadItems: true,
            mayAddItems: true,
            mayRemoveItems: true,
            maySetSeen: true,
            maySetKeywords: true,
            mayCreateChild: true,
            mayRename: false,
            mayDelete: false,
            maySubmit: true,
          },
        },
      ],
    },
  ],
});
