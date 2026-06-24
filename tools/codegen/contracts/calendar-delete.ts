import { z } from 'zod';
import { capability } from '../src/index.js';

export const calendarDelete = capability({
  name: 'calendar.delete',
  version: '0.0.1',
  scopes: ['calendar:write'],
  description:
    'Delete a calendar (JMAP Calendar/set destroy). Refuses the default ' +
    'calendar. A non-empty calendar is refused unless `removeEvents:true`, ' +
    'which cascade-deletes its events. No undo. Idempotent: deleting an ' +
    'already-gone calendar returns `{deleted:true}` without error. Dry-run ' +
    'returns whether the target is the default calendar. Refusals (stable ' +
    'codes you can branch on): `calendar_is_default` (the default calendar ' +
    'cannot be deleted), `calendar_not_empty` (calendar has events and ' +
    'removeEvents was not set).',
  isDestructive: true,
  input: z.object({
    calendarId: z.string().describe('Calendar to delete.'),
    removeEvents: z.boolean().optional().describe('When true, also delete all events in the calendar (cascade). Required to delete a non-empty calendar.'),
  }),
  output: z.object({
    deleted: z.boolean().describe('True when the calendar was destroyed.'),
  }),
  dryRun: {
    preview: z.object({
      isDefault: z.boolean().describe('Whether the target is the default calendar (deletion will be refused).'),
    }),
  },
  errors: [
    { code: 'calendar_is_default', description: 'The default calendar cannot be deleted.' },
    { code: 'calendar_not_empty', description: 'Calendar has events; pass removeEvents:true to cascade-delete.' },
  ],
  examples: [
    { title: 'Delete an empty calendar', input: { calendarId: 'cal-abc123' }, output: { deleted: true } },
    { title: 'Delete a non-empty calendar', input: { calendarId: 'cal-def456', removeEvents: true }, output: { deleted: true } },
  ],
});
