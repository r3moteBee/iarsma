import { z } from 'zod';
import { capability } from '../src/index.js';

export const mailboxCreate = capability({
  name: 'mailbox.create',
  version: '0.0.1',
  scopes: ['mail:mailbox'],
  description:
    'Create a mail folder (JMAP Mailbox/set create). Pass `name` and an ' +
    'optional `parentId` to nest it under an existing folder — resolve ids ' +
    'with mailbox.list first. Returns the new mailbox id. Fails with ' +
    '`mailbox_name_conflict` if a sibling folder already has that name, or ' +
    '`mailbox_name_invalid` if the name is blank.',
  isDestructive: false,
  input: z.object({
    name: z.string().min(1).describe('Folder display name. Must be non-empty and unique among its siblings.'),
    parentId: z.string().optional().describe('Parent mailbox id (from mailbox.list). Omit for a top-level folder.'),
  }),
  output: z.object({
    mailboxId: z.string().describe('Id of the newly created mailbox.'),
  }),
  examples: [
    { title: 'Top-level folder', input: { name: 'Projects' }, output: { mailboxId: 'Mb-99' } },
    { title: 'Nested subfolder', input: { name: 'Acme', parentId: 'Mb-99' }, output: { mailboxId: 'Mb-100' } },
  ],
});
