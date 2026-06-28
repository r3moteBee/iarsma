import { z } from 'zod';
import { capability } from '../src/index.js';

export const eventDelete = capability({
  name: 'event.delete',
  version: '0.0.1',
  scopes: ['calendar:write'],
  description:
    'Delete a calendar event (JMAP CalendarEvent/set destroy). No undo. ' +
    'Dry-run echoes the eventId that would be deleted. Refusals (stable codes ' +
    'you can branch on): `event_not_found` (eventId does not exist).',
  isDestructive: true,
  input: z.object({
    eventId: z.string().describe('Event to delete.'),
  }),
  output: z.object({
    deleted: z.boolean().describe('True when the event was destroyed.'),
  }),
  dryRun: {
    preview: z.object({
      eventId: z.string().describe('The event id that would be deleted.'),
    }),
  },
  errors: [
    { code: 'event_not_found', description: 'The eventId does not exist or is inaccessible.' },
  ],
  examples: [
    { title: 'Delete an event', input: { eventId: 'ev-abc123' }, output: { deleted: true } },
  ],
});
