import { z } from 'zod';
import { capability } from '../src/index.js';

const Label = z.object({
  key: z.string().describe('Stable server-issued identifier for the label. Use this key in label.update, label.delete, and label.apply.'),
  name: z.string().describe('Display name of the label.'),
  color: z.string().optional().describe('Optional display color, as a CSS hex string (e.g. "#ff6b35"). Absent when not set.'),
  order: z.number().int().optional().describe('Display sort order — lower comes first. Absent when not set.'),
});

export const labelList = capability({
  name: 'label.list',
  version: '0.0.1',
  scopes: ['mail:label:read'],
  description:
    'List all labels defined on the authenticated account. Returns a flat ' +
    'array of label objects; each has a stable `key` you can pass to ' +
    'label.update, label.delete, and label.apply. Non-destructive read; ' +
    'no refusals in normal operation.',
  isDestructive: false,
  input: z.object({}),
  output: z.object({
    labels: z.array(Label).describe('All labels on the account, in display order.'),
  }),
  examples: [
    {
      title: 'Account with two labels',
      input: {},
      output: {
        labels: [
          { key: 'Lbl-01', name: 'Work', color: '#4a90d9', order: 0 },
          { key: 'Lbl-02', name: 'Personal', color: '#7ed321', order: 1 },
        ],
      },
    },
  ],
});
