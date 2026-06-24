import { z } from 'zod';
import { capability } from '../src/index.js';

export const labelUpdate = capability({
  name: 'label.update',
  version: '0.0.1',
  scopes: ['mail:label:write'],
  description:
    'Update an existing label — rename it, change its color, or adjust its ' +
    'display order. Edits the FileNode registry document; the label `key` ' +
    '(slug) is immutable and never changes. Resolve the `key` with ' +
    'label.list first. At least one of `name`, `color`, or `order` must be ' +
    'provided; all are optional individually. Refusals (stable codes you can ' +
    'branch on): `label_not_found` (no label exists for that key), ' +
    '`label_name_invalid` (new name is blank or contains forbidden ' +
    'characters), `label_registry_conflict` (rare: concurrent modification ' +
    'detected — retry once).',
  isDestructive: false,
  input: z.object({
    key: z.string().describe('Stable key of the label to update (from label.list).'),
    name: z.string().min(1).optional().describe('New display name. Non-empty if provided.'),
    color: z.string().optional().describe('New CSS hex color (e.g. "#ff9d23"). Pass null or omit to leave unchanged.'),
    order: z.number().int().optional().describe('New display sort order. Lower comes first.'),
  }),
  output: z.object({
    updated: z.boolean().describe('True when the label was updated.'),
  }),
  errors: [
    { code: 'label_not_found', description: 'No label exists for the provided key.' },
    { code: 'label_name_invalid', description: 'New name is blank or contains forbidden characters.' },
    { code: 'label_registry_conflict', description: 'Concurrent modification detected; retry once.' },
  ],
  examples: [
    { title: 'Rename a label', input: { key: 'urgent', name: 'Critical' }, output: { updated: true } },
    { title: 'Change color and order', input: { key: 'read_later', color: '#7ed321', order: 0 }, output: { updated: true } },
  ],
});
