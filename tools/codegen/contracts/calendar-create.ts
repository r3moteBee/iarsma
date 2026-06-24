import { z } from 'zod';
import { capability } from '../src/index.js';

export const calendarCreate = capability({
  name: 'calendar.create',
  version: '0.0.1',
  scopes: ['calendar:write'],
  description:
    'Create a new calendar (JMAP Calendar/set create). Pass a `name` and an ' +
    'optional `color` (CSS hex string). Returns the server-issued `calendarId`. ' +
    'Refusals (stable codes you can branch on): `calendar_name_invalid` (name ' +
    'is blank or contains forbidden characters).',
  isDestructive: false,
  input: z.object({
    name: z.string().min(1).describe('Display name for the new calendar.'),
    color: z.string().optional().describe('CSS color, e.g. "#ff6b35". Optional.'),
  }),
  output: z.object({
    calendarId: z.string().describe('Server-issued id of the created calendar.'),
  }),
  errors: [
    { code: 'calendar_name_invalid', description: 'Name is blank or contains forbidden characters.' },
  ],
  examples: [
    { title: 'Create a colored calendar', input: { name: 'Work', color: '#ff6b35' }, output: { calendarId: 'cal-abc123' } },
    { title: 'Create a plain calendar', input: { name: 'Personal' }, output: { calendarId: 'cal-def456' } },
  ],
});
