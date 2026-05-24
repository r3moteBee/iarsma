/**
 * Capability: event.list
 *
 * Phase 4b work item 2. Lists calendar events within a date range,
 * paginated by position+limit.
 *
 * Wire shape: chained `CalendarEvent/query` + `CalendarEvent/get`
 * (RFC 8620 §3.7 back-reference). One roundtrip. The query uses
 * `after` / `before` date filters and sorts by `start` ascending.
 *
 * Scope is `calendar:read`.
 *
 * RFC 8984 §5.3 (CalendarEvent/query) + §5.2 (CalendarEvent/get).
 */

import { z } from 'zod';
import { capability } from '../src/index.js';

const Participant = z.object({
  name: z.string().optional().describe('Display name of the participant.'),
  email: z.string().describe('Email address of the participant.'),
  kind: z.string().optional().describe('Role kind — e.g., "individual", "group".'),
  participationStatus: z
    .string()
    .optional()
    .describe('Participation status — "accepted", "declined", "tentative", "needs-action".'),
});

const Location = z.object({
  name: z.string().optional().describe('Human-readable location name.'),
});

const CalendarEvent = z.object({
  id: z.string().describe('Server-issued stable event identifier.'),
  calendarIds: z
    .string()
    .describe('JSON-serialized map of calendarId → true. Parsed at runtime.'),
  title: z.string().describe('Event title / summary.'),
  description: z.string().optional().describe('Full event description or notes.'),
  start: z
    .string()
    .describe('Start time as ISO local datetime (e.g., "2026-05-24T09:00:00").'),
  duration: z
    .string()
    .optional()
    .describe('ISO 8601 duration (e.g., "PT1H", "P1D"). Absent for zero-duration events.'),
  timeZone: z.string().optional().describe('IANA time zone (e.g., "America/New_York").'),
  status: z
    .enum(['confirmed', 'tentative', 'cancelled'])
    .optional()
    .describe('Event status.'),
  participants: z
    .string()
    .optional()
    .describe('JSON-serialized map of participantId → participant. Parsed at runtime.'),
  locations: z
    .string()
    .optional()
    .describe('JSON-serialized map of locationId → location. Parsed at runtime.'),
});

export const eventList = capability({
  name: 'event.list',
  version: '0.0.1',
  scopes: ['calendar:read'],
  description:
    'List calendar events within a date range, sorted by start time ascending, ' +
    'paginated by position+limit. JMAP methods: CalendarEvent/query + ' +
    'CalendarEvent/get (chained via back-reference, one roundtrip).',
  input: z.object({
    calendarId: z
      .string()
      .optional()
      .describe('Filter to a specific calendar. Omit to list events from all calendars.'),
    after: z
      .string()
      .describe('Start of the date range (ISO 8601 UTC, e.g., "2026-05-24T00:00:00Z").'),
    before: z
      .string()
      .describe('End of the date range (ISO 8601 UTC, e.g., "2026-05-31T00:00:00Z").'),
    position: z
      .number()
      .int()
      .optional()
      .describe('Zero-indexed offset into the result set. Defaults to 0 when omitted.'),
    limit: z
      .number()
      .int()
      .optional()
      .describe('Page size. Defaults to 50; capped server-side at 200.'),
  }),
  output: z.object({
    events: z.array(CalendarEvent),
    position: z
      .number()
      .int()
      .describe('Echoed from the JMAP CalendarEvent/query response.'),
    total: z
      .number()
      .int()
      .optional()
      .describe(
        'Total events matching the filter when the host requested ' +
          '`calculateTotal`. Servers may legally omit it.',
      ),
  }),
  examples: [
    {
      title: 'Events in the next week',
      input: {
        after: '2026-05-24T00:00:00Z',
        before: '2026-05-31T00:00:00Z',
        position: 0,
        limit: 50,
      },
      output: {
        events: [
          {
            id: 'Ev01',
            calendarIds: { Cal01: true },
            title: 'Team standup',
            start: '2026-05-24T09:00:00',
            duration: 'PT30M',
            timeZone: 'America/New_York',
            status: 'confirmed',
          },
        ],
        position: 0,
        total: 7,
      },
    },
  ],
});
