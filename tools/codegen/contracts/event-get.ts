/**
 * Capability: event.get
 *
 * Phase 4b work item 3. Fetches a single calendar event by id.
 *
 * Wire shape: `CalendarEvent/get` with a single id in the `ids` array.
 * One roundtrip.
 *
 * Scope is `calendar:read`.
 *
 * RFC 8984 §5.2.
 */

import { z } from 'zod';
import { capability } from '../src/index.js';


const CalendarEvent = z.object({
  id: z.string().describe('Server-issued stable event identifier.'),
  calendarIds: z
    .string()
    .describe('JSON-serialized map of calendarId → true. Parsed as Record<string, boolean> at runtime.'),
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

export const eventGet = capability({
  name: 'event.get',
  version: '0.0.1',
  scopes: ['calendar:read'],
  description:
    'Fetch a single calendar event by id. Returns the full event record ' +
    'with all properties. JMAP method: CalendarEvent/get (RFC 8984 §5.2).',
  input: z.object({
    eventId: z.string().describe('JMAP CalendarEvent id, e.g. from `event.list`.'),
  }),
  output: CalendarEvent,
  examples: [
    {
      title: 'Fetch a single confirmed event with participants',
      input: { eventId: 'Ev01' },
      output: {
        id: 'Ev01',
        calendarIds: { Cal01: true },
        title: 'Team standup',
        description: 'Daily sync-up with the engineering team.',
        start: '2026-05-24T09:00:00',
        duration: 'PT30M',
        timeZone: 'America/New_York',
        status: 'confirmed',
        participants: {
          p1: { name: 'Brent', email: 'brent@r3motely.com', participationStatus: 'accepted' },
          p2: { name: 'Alice', email: 'alice@example.net', participationStatus: 'tentative' },
        },
        locations: {
          loc1: { name: 'Conference Room A' },
        },
      },
    },
  ],
});
