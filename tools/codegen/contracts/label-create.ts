import { z } from 'zod';
import { capability } from '../src/index.js';

export const labelCreate = capability({
  name: 'label.create',
  version: '0.0.1',
  scopes: ['mail:label:write'],
  description:
    'Create a new label on the account. Pass a `name` and an optional ' +
    '`color` (CSS hex string). Returns the stable `key` — a human-readable ' +
    'slug derived from the name (e.g. `work`, `project_acme`), minted once ' +
    'client-side and immutable thereafter; it is the literal JMAP keyword ' +
    'stored on every tagged message. Use that key in label.update, ' +
    'label.delete, and label.apply. The label registry is stored as a ' +
    'FileNode document; this call edits it. Refusals (stable codes you can ' +
    'branch on): `label_name_invalid` (name is blank or contains forbidden ' +
    'characters), `label_key_conflict` (a label with a colliding derived key ' +
    'already exists — try a different name), `label_limit_reached` (the ' +
    'account has hit the maximum of 200 labels), `label_registry_conflict` ' +
    '(rare: concurrent modification detected — retry once).',
  isDestructive: false,
  input: z.object({
    name: z.string().min(1).describe('Display name for the new label. Must be non-empty.'),
    color: z.string().optional().describe('Optional CSS hex color (e.g. "#ff6b35") for UI display.'),
  }),
  output: z.object({
    key: z.string().describe('Stable human-readable slug derived from the label name (e.g. `work`, `read_later`). Minted once and immutable; this is the literal JMAP keyword stored on tagged messages. Use this in label.update, label.delete, and label.apply.'),
  }),
  errors: [
    { code: 'label_name_invalid', description: 'Name is blank or contains forbidden characters.' },
    { code: 'label_key_conflict', description: 'A label with a colliding derived key already exists.' },
    { code: 'label_limit_reached', description: 'Account has reached the server label quota.' },
    { code: 'label_registry_conflict', description: 'Concurrent modification detected; retry once.' },
  ],
  examples: [
    { title: 'Create a colored label', input: { name: 'Urgent', color: '#ff6b35' }, output: { key: 'urgent' } },
    { title: 'Create a plain label', input: { name: 'Read later' }, output: { key: 'read_later' } },
  ],
});
