import { z } from 'zod';
import { capability } from '../src/index.js';

export const labelApply = capability({
  name: 'label.apply',
  version: '0.0.1',
  scopes: ['mail:label:read', 'mail:modify'],
  description:
    'Add or remove labels on a set of messages in a single operation ' +
    '(JMAP Email/set update, keyword patch). Pass `emailIds` (message ids), ' +
    'and `add` / `remove` arrays of label names or keys — resolution from ' +
    'name to key happens at runtime against the label registry; if you ' +
    'already have the key from label.list, passing it directly is more ' +
    'efficient and avoids ambiguity. At least one of `add` or `remove` must ' +
    'be provided. Dry-run returns how many messages would be modified ' +
    '(`affectedCount`). Refusals (stable codes you can branch on): ' +
    '`label_not_found` (one or more label names/keys in `add` or `remove` ' +
    'could not be resolved), `email_not_found` (one or more `emailIds` do ' +
    'not exist or are not accessible to this agent).',
  isDestructive: true,
  input: z.object({
    emailIds: z.array(z.string()).min(1).describe('Ids of the messages to update. At least one required.'),
    add: z.array(z.string()).optional().describe('Label names or keys to add to all specified messages.'),
    remove: z.array(z.string()).optional().describe('Label names or keys to remove from all specified messages.'),
  }),
  output: z.object({
    modifiedCount: z.number().int().describe('Count of messages successfully modified.'),
  }),
  dryRun: {
    preview: z.object({
      affectedCount: z.number().int().describe('Messages that would be modified if the operation proceeds.'),
    }),
  },
  errors: [
    { code: 'label_not_found', description: 'One or more label names/keys could not be resolved.' },
    { code: 'email_not_found', description: 'One or more emailIds do not exist or are inaccessible.' },
  ],
  examples: [
    {
      title: 'Add a label to two messages by key',
      input: { emailIds: ['Em-01', 'Em-02'], add: ['Lbl-10'] },
      output: { modifiedCount: 2 },
    },
    {
      title: 'Remove a label by name',
      input: { emailIds: ['Em-01'], remove: ['Urgent'] },
      output: { modifiedCount: 1 },
    },
    {
      title: 'Add one label and remove another in one call',
      input: { emailIds: ['Em-03'], add: ['Lbl-11'], remove: ['Lbl-10'] },
      output: { modifiedCount: 1 },
    },
  ],
});
