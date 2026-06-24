import { describe, expect, it } from 'vitest';
import { parseCalendarListResponse } from '../jmap-client.js';

function resp(list: unknown[]): string {
  return JSON.stringify({
    methodResponses: [['Calendar/get', { accountId: 'b', list }, '0']],
  });
}

describe('parseCalendar isDefault', () => {
  it('captures isDefault:true', () => {
    const out = parseCalendarListResponse(resp([
      { id: 'b', name: 'Personal', isDefault: true },
    ]));
    expect(out[0]).toMatchObject({ id: 'b', name: 'Personal', isDefault: true });
  });
  it('defaults isDefault to false when absent', () => {
    const out = parseCalendarListResponse(resp([{ id: 'c', name: 'Work' }]));
    expect(out[0]!.isDefault).toBe(false);
  });
});
