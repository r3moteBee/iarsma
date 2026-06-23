import { z } from 'zod';
import { capability } from '../src/index.js';

export const labelDelete = capability({
  name: 'label.delete',
  version: '0.0.1',
  scopes: ['mail:label:write'],
  description:
    'Delete a label from the account (JMAP Keyword registry destroy). ' +
    'Resolve the `key` with label.list first. This is compound: it removes ' +
    'the label keyword from every tagged message, then destroys the label ' +
    'definition. Dry-run returns how many messages would be untagged ' +
    '(`affectedCount`). The `deleted` flag is true when the label was ' +
    'destroyed; `untagged` reports the count of messages that had the label ' +
    'removed. Refusals (stable codes you can branch on): `label_not_found` ' +
    '(no label exists for that key), `label_registry_conflict` (rare: ' +
    'concurrent modification detected — retry once).',
  isDestructive: true,
  input: z.object({
    key: z.string().describe('Stable key of the label to delete (from label.list).'),
  }),
  output: z.object({
    deleted: z.boolean().describe('True when the label was destroyed.'),
    untagged: z.number().int().describe('Count of messages from which the label was removed.'),
  }),
  dryRun: {
    preview: z.object({
      affectedCount: z.number().int().describe('Messages that would have the label removed before the label is destroyed.'),
    }),
  },
  errors: [
    { code: 'label_not_found', description: 'No label exists for the provided key.' },
    { code: 'label_registry_conflict', description: 'Concurrent modification detected; retry once.' },
  ],
  examples: [
    { title: 'Delete a label with no messages', input: { key: 'Lbl-11' }, output: { deleted: true, untagged: 0 } },
    { title: 'Delete a label with messages', input: { key: 'Lbl-10' }, output: { deleted: true, untagged: 7 } },
  ],
});
