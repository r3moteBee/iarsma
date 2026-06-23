import { z } from 'zod';
import { capability } from '../src/index.js';

export const mailboxUpdate = capability({
  name: 'mailbox.update',
  version: '0.0.1',
  scopes: ['mail:mailbox'],
  description:
    'Rename a mail folder (JMAP Mailbox/set update). Pass the `mailboxId` ' +
    '(from mailbox.list) and the new `name`. System folders (inbox, sent, ' +
    'drafts, trash, junk, archive) cannot be renamed — those return ' +
    '`mailbox_protected`. A blank name returns `mailbox_name_invalid`; a ' +
    'sibling-name clash returns `mailbox_name_conflict`.',
  isDestructive: false,
  input: z.object({
    mailboxId: z.string().describe('Id of the folder to rename (from mailbox.list).'),
    name: z.string().min(1).describe('New display name. Non-empty, unique among siblings.'),
  }),
  output: z.object({ updated: z.boolean().describe('True when the rename was applied.') }),
  examples: [{ title: 'Rename', input: { mailboxId: 'Mb-99', name: 'Archive 2025' }, output: { updated: true } }],
});
