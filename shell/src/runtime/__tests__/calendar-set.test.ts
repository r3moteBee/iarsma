import { describe, expect, it, vi } from 'vitest';
import {
  buildCalendarCreateRequest,
  buildCalendarUpdateRequest,
  fetchCalendarCreateCommit,
  fetchCalendarUpdateCommit,
  type Session,
} from '../jmap-client.js';

const JMAP_USING_CALENDARS = ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:calendars'];

function fakeSession(): Session {
  return { apiUrl: 'https://jmap.example/api', primaryAccountIdMail: 'b' } as unknown as Session;
}
function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('Calendar/set create + update request shapes', () => {
  it('create request carries name + color under create', () => {
    const body = JSON.parse(buildCalendarCreateRequest({ accountId: 'b', name: 'Work', color: '#ff6b35' }));
    expect(body.methodCalls[0][0]).toBe('Calendar/set');
    expect(body.using).toEqual(JMAP_USING_CALENDARS);
    const create = body.methodCalls[0][1].create;
    const obj = create[Object.keys(create)[0]!];
    expect(obj).toMatchObject({ name: 'Work', color: '#ff6b35' });
  });
  it('update request patches only provided fields', () => {
    const body = JSON.parse(buildCalendarUpdateRequest({ accountId: 'b', calendarId: 'c', name: 'Renamed' }));
    expect(body.using).toEqual(JMAP_USING_CALENDARS);
    expect(body.methodCalls[0][1].update).toEqual({ c: { name: 'Renamed' } });
  });
});

describe('fetchCalendarCreateCommit', () => {
  it('returns the created calendar id', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ methodResponses: [['Calendar/set', { created: { c0: { id: 'c' } } }, '0']] }));
    const out = await fetchCalendarCreateCommit({
      baseUrl: 'https://jmap.example', getAuthToken: () => 'tok',
      fetch: fetchImpl as unknown as typeof fetch, session: fakeSession(), name: 'Work', color: '#ff6b35',
    });
    expect(out).toEqual({ calendarId: 'c' });
  });
});

describe('fetchCalendarUpdateCommit', () => {
  it('resolves { updated: true } on success', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ methodResponses: [['Calendar/set', { updated: { c: null } }, '0']] }));
    const out = await fetchCalendarUpdateCommit({
      baseUrl: 'https://jmap.example', getAuthToken: () => 'tok',
      fetch: fetchImpl as unknown as typeof fetch, session: fakeSession(),
      calendarId: 'c', name: 'Renamed',
    });
    expect(out).toEqual({ updated: true });
  });

  it('rejects with jmap_set_error when notUpdated is non-empty (different key)', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        methodResponses: [[
          'Calendar/set',
          { notUpdated: { c: { type: 'forbidden', description: 'not allowed' } } },
          '0',
        ]],
      }));
    await expect(
      fetchCalendarUpdateCommit({
        baseUrl: 'https://jmap.example', getAuthToken: () => 'tok',
        fetch: fetchImpl as unknown as typeof fetch, session: fakeSession(),
        calendarId: 'c', name: 'Renamed',
      }),
    ).rejects.toMatchObject({ code: 'jmap_set_error' });
  });
});
