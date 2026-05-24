/**
 * Capability: calendar.list
 *
 * Phase 4b work item 1. Lists all calendars for the authenticated account.
 *
 * Wire shape: `Calendar/get` (no ids → fetch all) under the
 * `urn:ietf:params:jmap:calendars` capability. The response carries
 * a flat list of calendar records; no body content, no chained methods.
 *
 * Scope is `calendar:read` — only callers permitted to read calendar
 * data need to enumerate calendars.
 *
 * RFC 8984 §5.1.
 */

import { z } from 'zod';
import { capability } from '../src/index.js';

const Calendar = z.object({
  id: z.string().describe('Server-issued stable calendar identifier.'),
  name: z.string().describe('Display name of the calendar.'),
  color: z
    .string()
    .optional()
    .describe('CSS color value for the calendar (e.g., "#1a73e8"). Optional.'),
  isVisible: z.boolean().describe('Whether the calendar is visible in the UI by default.'),
});

export const calendarList = capability({
  name: 'calendar.list',
  version: '0.0.1',
  scopes: ['calendar:read'],
  description:
    'List all calendars for the authenticated account. Returns a flat array of ' +
    'calendar records. JMAP method: Calendar/get (RFC 8984 §5.1).',
  input: z.object({}),
  output: z.array(Calendar),
  examples: [
    {
      title: 'Account with a personal and work calendar',
      input: {},
      output: [
        {
          id: 'Cal01',
          name: 'Personal',
          color: '#1a73e8',
          isVisible: true,
        },
        {
          id: 'Cal02',
          name: 'Work',
          color: '#e67c73',
          isVisible: true,
        },
      ],
    },
  ],
});
