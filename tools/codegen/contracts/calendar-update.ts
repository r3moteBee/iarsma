import { z } from 'zod';
import { capability } from '../src/index.js';

export const calendarUpdate = capability({
  name: 'calendar.update',
  version: '0.0.1',
  scopes: ['calendar:write'],
  description:
    'Rename and/or recolor a calendar (JMAP Calendar/set update). At least ' +
    'one of `name` or `color` must be provided; all are optional individually. ' +
    'Refusals (stable codes you can branch on): `calendar_not_found` (no ' +
    'calendar exists for that id), `calendar_name_invalid` (new name is blank ' +
    'or contains forbidden characters), `nothing_to_update` (no fields provided).',
  isDestructive: false,
  input: z.object({
    calendarId: z.string().describe('Calendar to update.'),
    name: z.string().min(1).optional().describe('New display name. Non-empty if provided.'),
    color: z.string().optional().describe('New CSS color (e.g. "#ff9d23"). Pass null or omit to leave unchanged.'),
  }),
  output: z.object({
    updated: z.boolean().describe('True when the calendar was updated.'),
  }),
  errors: [
    { code: 'calendar_not_found', description: 'No calendar exists for the provided id.' },
    { code: 'calendar_name_invalid', description: 'New name is blank or contains forbidden characters.' },
    { code: 'nothing_to_update', description: 'No fields were provided to update.' },
  ],
  examples: [
    { title: 'Rename a calendar', input: { calendarId: 'cal-abc123', name: 'Work Projects' }, output: { updated: true } },
    { title: 'Change color', input: { calendarId: 'cal-abc123', color: '#7ed321' }, output: { updated: true } },
  ],
});
