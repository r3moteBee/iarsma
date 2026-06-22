/**
 * Tests for toCalendarViewEvent — the event.list → CalendarViewEvent
 * mapping. Regression cover for U-6: the inline transform mapped
 * `description` but never derived `location` from the JSCalendar
 * `locations` map, so the detail view showed neither reliably.
 */

import { describe, expect, it } from 'vitest';
import { toCalendarViewEvent } from '../calendar-transform.js';

const NO_COLORS = new Map<string, string | undefined>();

describe('toCalendarViewEvent', () => {
  it('derives a flat location from the JSCalendar locations map', () => {
    const out = toCalendarViewEvent(
      {
        id: 'e1',
        title: 'Standup',
        start: '2026-06-25T09:00:00',
        locations: { loc0: { name: 'Room 3B' } },
      },
      NO_COLORS,
    );
    expect(out.location).toBe('Room 3B');
  });

  it('preserves the description', () => {
    const out = toCalendarViewEvent(
      { id: 'e1', title: 'Standup', start: '2026-06-25T09:00:00', description: 'Daily sync' },
      NO_COLORS,
    );
    expect(out.description).toBe('Daily sync');
  });

  it('omits location when there is no named location entry', () => {
    const out = toCalendarViewEvent(
      { id: 'e1', title: 'X', start: '2026-06-25T09:00:00', locations: { loc0: {} } },
      NO_COLORS,
    );
    expect(out.location).toBeUndefined();
  });

  it('maps calendarId + color and flattens participants sorted by email', () => {
    const colors = new Map<string, string | undefined>([['cal-1', '#ff6b35']]);
    const out = toCalendarViewEvent(
      {
        id: 'e1',
        title: 'Planning',
        start: '2026-06-25T09:00:00',
        calendarIds: { 'cal-1': true },
        participants: {
          p0: { email: 'zoe@example.net', name: 'Zoe' },
          p1: { email: 'amy@example.net' },
        },
      },
      colors,
    );
    expect(out.calendarId).toBe('cal-1');
    expect(out.calendarColor).toBe('#ff6b35');
    expect(out.participants?.map((p) => p.email)).toEqual([
      'amy@example.net',
      'zoe@example.net',
    ]);
  });
});
