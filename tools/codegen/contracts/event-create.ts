import { z } from 'zod';
import { capability } from '../src/index.js';

const Participant = z.object({
  email: z.string().describe('Participant email address.'),
  name: z.string().optional().describe('Display name.'),
  roles: z.string().describe('JSON-serialized roles map, e.g. "{\\"attendee\\":true}" or "{\\"owner\\":true}". Parsed at runtime.'),
  participationStatus: z
    .enum(['needs-action', 'accepted', 'declined', 'tentative', 'delegated'])
    .optional()
    .describe('RSVP status. Defaults server-side.'),
  expectReply: z.boolean().optional().describe('Whether an RSVP is expected.'),
});

export const eventCreate = capability({
  name: 'event.create',
  version: '0.0.1',
  scopes: ['calendar:write'],
  description:
    'Create a calendar event (JMAP CalendarEvent/set create). The event is ' +
    'placed on `calendarId` — resolve writable calendars via calendar.list. ' +
    '`start` is an ISO local datetime (e.g. "2026-07-01T10:00:00"); pass ' +
    '`timeZone` to anchor it. Returns the server-issued `eventId`.',
  isDestructive: false,
  input: z.object({
    calendarId: z.string().describe('Calendar to create the event on (from calendar.list).'),
    title: z.string().min(1).describe('Event title / summary.'),
    start: z.string().describe('ISO local datetime, e.g. "2026-07-01T10:00:00".'),
    duration: z.string().optional().describe('ISO 8601 duration, e.g. "PT1H", "P1D".'),
    timeZone: z.string().optional().describe('IANA time zone, e.g. "America/New_York".'),
    description: z.string().optional().describe('Event description / notes.'),
    location: z.string().optional().describe('Single location name.'),
    participants: z.array(Participant).optional().describe('Attendees + organizer; triggers iTIP when emails resolve.'),
  }),
  output: z.object({
    eventId: z.string().describe('Server-issued id of the created event.'),
  }),
  examples: [
    {
      title: 'Create an event on a specific calendar',
      input: { calendarId: 'cal-personal', title: 'Dentist', start: '2026-07-01T10:00:00', timeZone: 'America/New_York', duration: 'PT1H' },
      output: { eventId: 'ev-abc123' },
    },
  ],
});
