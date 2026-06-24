import { describe, expect, it, vi } from 'vitest';
import { buildCalendarDeleteRequest, fetchCalendarDeleteCommit, type Session } from '../jmap-client.js';

function fakeSession(): Session {
  return { apiUrl: 'https://jmap.example/api', primaryAccountIdMail: 'b' } as unknown as Session;
}
function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('Calendar/set destroy', () => {
  it('omits onDestroyRemoveEvents when removeEvents is false', () => {
    const b = JSON.parse(buildCalendarDeleteRequest({ accountId: 'b', calendarId: 'c', removeEvents: false }));
    expect(b.methodCalls[0][1].destroy).toEqual(['c']);
    expect(b.methodCalls[0][1].onDestroyRemoveEvents).toBeUndefined();
  });
  it('sets onDestroyRemoveEvents:true when removeEvents is true', () => {
    const b = JSON.parse(buildCalendarDeleteRequest({ accountId: 'b', calendarId: 'c', removeEvents: true }));
    expect(b.methodCalls[0][1].onDestroyRemoveEvents).toBe(true);
  });

  it('maps calendarHasEvent refusal to calendar_not_empty', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ methodResponses: [['Calendar/set', { notDestroyed: { c: { type: 'calendarHasEvent', description: 'Calendar is not empty.' } } }, '0']] }));
    await expect(fetchCalendarDeleteCommit({
      baseUrl: 'x', getAuthToken: () => 'tok', fetch: fetchImpl as unknown as typeof fetch,
      session: fakeSession(), calendarId: 'c', removeEvents: false,
    })).rejects.toMatchObject({ code: 'calendar_not_empty' });
  });

  it('maps non-calendarHasEvent notDestroyed type to jmap_set_error', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ methodResponses: [['Calendar/set', { notDestroyed: { c: { type: 'forbidden', description: 'Not allowed.' } } }, '0']] }));
    await expect(fetchCalendarDeleteCommit({
      baseUrl: 'x', getAuthToken: () => 'tok', fetch: fetchImpl as unknown as typeof fetch,
      session: fakeSession(), calendarId: 'c', removeEvents: false,
    })).rejects.toMatchObject({ code: 'jmap_set_error' });
  });

  it('resolves on successful destroy', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ methodResponses: [['Calendar/set', { destroyed: ['c'] }, '0']] }));
    const out = await fetchCalendarDeleteCommit({
      baseUrl: 'x', getAuthToken: () => 'tok', fetch: fetchImpl as unknown as typeof fetch,
      session: fakeSession(), calendarId: 'c', removeEvents: true,
    });
    expect(out).toEqual({ deleted: true });
  });
});
