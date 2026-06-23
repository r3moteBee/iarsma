import { z } from 'zod';
import { capability } from '../src/index.js';

export const mailboxDelete = capability({
  name: 'mailbox.delete',
  version: '0.0.1',
  scopes: ['mail:mailbox'],
  description:
    'Delete a mail folder safely. This is compound: it moves every message ' +
    'in the folder to Trash (JMAP Email/set), then destroys the now-empty ' +
    'folder (Mailbox/set destroy). Resolve `mailboxId` with mailbox.list. ' +
    'Dry-run returns how many messages would move to Trash (`affectedCount`). ' +
    'Refusals (stable codes you can branch on): `mailbox_has_children` (the ' +
    'folder has subfolders — delete those first), `mailbox_protected` (system ' +
    'folder), `mailbox_forbidden` (no delete permission), `trash_not_found` ' +
    '(no Trash folder on the account).',
  isDestructive: true,
  input: z.object({
    mailboxId: z.string().describe('Id of the folder to delete (from mailbox.list).'),
  }),
  output: z.object({
    deleted: z.boolean().describe('True when the folder was destroyed.'),
    movedToTrash: z.number().int().describe('Count of messages moved to Trash before deletion.'),
  }),
  dryRun: {
    preview: z.object({
      affectedCount: z.number().int().describe('Messages that would move to Trash before the folder is destroyed.'),
    }),
  },
  examples: [
    { title: 'Delete an empty folder', input: { mailboxId: 'Mb-100' }, output: { deleted: true, movedToTrash: 0 } },
    { title: 'Delete a folder with mail', input: { mailboxId: 'Mb-99' }, output: { deleted: true, movedToTrash: 12 } },
  ],
});
