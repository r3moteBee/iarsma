import { describe, it, expect } from 'vitest';
import { buildEventUpdateRequest } from '../jmap-client.js';

describe('buildEventUpdateRequest — calendar reassignment', () => {
  it('includes a calendarIds patch when calendarId is provided', () => {
    const body = JSON.parse(
      buildEventUpdateRequest({
        accountId: 'b',
        params: { eventId: 'ev1', calendarId: 'cal2', title: 'Renamed' },
      }),
    );
    const patch = body.methodCalls[0][1].update.ev1;
    expect(patch.calendarIds).toEqual({ cal2: true });
    expect(patch.title).toBe('Renamed');
  });

  it('omits calendarIds when calendarId is absent', () => {
    const body = JSON.parse(
      buildEventUpdateRequest({
        accountId: 'b',
        params: { eventId: 'ev1', title: 'Only title' },
      }),
    );
    const patch = body.methodCalls[0][1].update.ev1;
    expect(patch.calendarIds).toBeUndefined();
  });
});
