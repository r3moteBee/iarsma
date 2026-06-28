import { z } from 'zod';
import { capability } from '../src/index.js';

const Participant = z.object({
  email: z.string().describe('Participant email address.'),
  name: z.string().optional().describe('Display name.'),
  roles: z
    .object({
      owner: z.boolean().optional(),
      attendee: z.boolean().optional(),
      optional: z.boolean().optional(),
      chair: z.boolean().optional(),
    })
    .describe('JSCalendar participant roles, e.g. { attendee: true } or { owner: true }.'),
  participationStatus: z
    .enum(['needs-action', 'accepted', 'declined', 'tentative', 'delegated'])
    .optional()
    .describe('RSVP status.'),
  expectReply: z.boolean().optional().describe('Whether an RSVP is expected.'),
});

export const eventUpdate = capability({
  name: 'event.update',
  version: '0.0.1',
  scopes: ['calendar:write'],
  description:
    'Update a calendar event (JMAP CalendarEvent/set update). Pass `eventId` ' +
    'and at least one field to change. Set `calendarId` to MOVE the event to ' +
    'another calendar (reassignment). Passing `participants: []` clears ' +
    'attendees. Refusals (stable codes you can branch on): `nothing_to_update` ' +
    '(no mutable field given), `event_not_found` (eventId does not exist).',
  isDestructive: false,
  input: z.object({
    eventId: z.string().describe('Event to update (from event.list / event.get).'),
    calendarId: z.string().optional().describe('Move the event to this calendar.'),
    title: z.string().optional().describe('New title.'),
    start: z.string().optional().describe('New ISO local datetime.'),
    duration: z.string().optional().describe('New ISO 8601 duration.'),
    description: z.string().optional().describe('New description.'),
    location: z.string().optional().describe('New single location name.'),
    participants: z.array(Participant).optional().describe('Replacement participants; empty array clears.'),
  }),
  output: z.object({
    updated: z.boolean().describe('True when the event was updated.'),
  }),
  errors: [
    { code: 'nothing_to_update', description: 'No mutable field was provided.' },
    { code: 'event_not_found', description: 'The eventId does not exist or is inaccessible.' },
  ],
  examples: [
    { title: 'Move an event to another calendar', input: { eventId: 'ev-abc123', calendarId: 'cal-work' }, output: { updated: true } },
    { title: 'Rename an event', input: { eventId: 'ev-abc123', title: 'Dentist (rescheduled)' }, output: { updated: true } },
  ],
});
