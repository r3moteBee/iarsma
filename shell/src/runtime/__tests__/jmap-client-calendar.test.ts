import { describe, expect, it, vi } from 'vitest';
import {
  buildCalendarListRequest,
  buildEventGetRequest,
  buildEventListRequest,
  fetchCalendarList,
  fetchEventGet,
  fetchEventList,
  parseCalendarListResponse,
  parseEventGetResponse,
  parseEventListResponse,
  type Session,
} from '../jmap-client.js';
import type { ToolError } from '../types.js';

const SAMPLE_SESSION: Session = {
  username: 'user@example.net',
  apiUrl: 'https://sw-mail.example.net/jmap/',
  downloadUrl: 'https://sw-mail.example.net/jmap/download/{accountId}/{blobId}/{name}?accept={type}',
  uploadUrl: 'https://sw-mail.example.net/jmap/upload/{accountId}/',
  eventSourceUrl:
    'https://sw-mail.example.net/jmap/eventsource/?types={types}&closeafter={closeafter}&ping={ping}',
  state: '817d3028',
  primaryAccountIdMail: 'c',
};

type FetchSpy = ReturnType<typeof makeFetchSpy>;

function makeFetchSpy(
  body: string,
  init: { status?: number; statusText?: string } = {},
) {
  const status = init.status ?? 200;
  const impl: typeof fetch = async () =>
    new Response(body, {
      status,
      statusText: init.statusText ?? (status >= 200 && status < 300 ? 'OK' : 'Error'),
    });
  return vi.fn<typeof fetch>(impl);
}

// ──────────────────────────────────────────────────────────────────────
// calendar.list — Phase 4b
// ──────────────────────────────────────────────────────────────────────

const CALENDAR_LIST_RESPONSE = JSON.stringify({
  methodResponses: [
    [
      'Calendar/get',
      {
        accountId: 'c',
        state: 'cal-state-1',
        list: [
          { id: 'Cal01', name: 'Personal', color: '#1a73e8', isVisible: true },
          { id: 'Cal02', name: 'Work', color: '#e67c73', isVisible: true },
          { id: 'Cal03', name: 'Birthdays', isVisible: false },
        ],
        notFound: [],
      },
      '0',
    ],
  ],
});

describe('buildCalendarListRequest', () => {
  it('produces correct JMAP Calendar/get request', () => {
    const body = buildCalendarListRequest({ accountId: 'c' });
    const parsed = JSON.parse(body);
    expect(parsed.using).toEqual([
      'urn:ietf:params:jmap:core',
      'urn:ietf:params:jmap:calendars',
    ]);
    expect(parsed.methodCalls).toHaveLength(1);
    expect(parsed.methodCalls[0][0]).toBe('Calendar/get');
    expect(parsed.methodCalls[0][1]).toMatchObject({
      accountId: 'c',
      ids: null,
    });
  });
});

describe('parseCalendarListResponse', () => {
  it('extracts calendar array from JMAP response', () => {
    const calendars = parseCalendarListResponse(CALENDAR_LIST_RESPONSE);
    expect(calendars).toHaveLength(3);
    expect(calendars[0]).toEqual({
      id: 'Cal01',
      name: 'Personal',
      color: '#1a73e8',
      isVisible: true,
      isDefault: false,
    });
    expect(calendars[1]).toEqual({
      id: 'Cal02',
      name: 'Work',
      color: '#e67c73',
      isVisible: true,
      isDefault: false,
    });
    expect(calendars[2]).toEqual({
      id: 'Cal03',
      name: 'Birthdays',
      isVisible: false,
      isDefault: false,
    });
  });

  it('handles missing optional color field gracefully', () => {
    const calendars = parseCalendarListResponse(CALENDAR_LIST_RESPONSE);
    expect(calendars[2]!.color).toBeUndefined();
  });

  it('throws ToolError on malformed JSON', () => {
    try {
      parseCalendarListResponse('{not json');
      throw new Error('expected throw');
    } catch (e) {
      const err = e as ToolError;
      expect(err.code).toBe('jmap_parse_error');
    }
  });

  it('throws when methodResponses is empty', () => {
    try {
      parseCalendarListResponse(JSON.stringify({ methodResponses: [] }));
      throw new Error('expected throw');
    } catch (e) {
      const err = e as ToolError;
      expect(err.code).toBe('jmap_parse_error');
    }
  });

  it('throws when first response is not Calendar/get', () => {
    const body = JSON.stringify({
      methodResponses: [['error', { type: 'accountNotFound' }, '0']],
    });
    try {
      parseCalendarListResponse(body);
      throw new Error('expected throw');
    } catch (e) {
      const err = e as ToolError;
      expect(err.code).toBe('jmap_parse_error');
    }
  });
});

describe('fetchCalendarList', () => {
  it('POSTs Calendar/get with correct using array and returns parsed calendars', async () => {
    const fetchSpy: FetchSpy = makeFetchSpy(CALENDAR_LIST_RESPONSE);
    const calendars = await fetchCalendarList({
      baseUrl: 'https://sw-mail.example.net',
      getAuthToken: () => 'tok',
      fetch: fetchSpy,
      session: SAMPLE_SESSION,
    });
    expect(calendars).toHaveLength(3);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(SAMPLE_SESSION.apiUrl);
    expect(init?.method).toBe('POST');
    const body = JSON.parse(String(init?.body));
    expect(body.using).toEqual([
      'urn:ietf:params:jmap:core',
      'urn:ietf:params:jmap:calendars',
    ]);
    expect(body.methodCalls[0][0]).toBe('Calendar/get');
    expect(body.methodCalls[0][1].accountId).toBe('c');
  });

  it('rejects with code=unauthorized when no token is available', async () => {
    await expect(
      fetchCalendarList({
        baseUrl: 'https://x',
        getAuthToken: () => null,
        fetch: makeFetchSpy(CALENDAR_LIST_RESPONSE),
        session: SAMPLE_SESSION,
      }),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('rejects with code=unauthorized on a 401 response', async () => {
    await expect(
      fetchCalendarList({
        baseUrl: 'https://x',
        getAuthToken: () => 'tok',
        fetch: makeFetchSpy('nope', { status: 401, statusText: 'Unauthorized' }),
        session: SAMPLE_SESSION,
      }),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });
});

// ──────────────────────────────────────────────────────────────────────
// event.list — Phase 4b
// ──────────────────────────────────────────────────────────────────────

const EVENT_LIST_RESPONSE = JSON.stringify({
  methodResponses: [
    [
      'CalendarEvent/query',
      {
        accountId: 'c',
        queryState: 'ev-query-1',
        canCalculateChanges: false,
        position: 0,
        total: 3,
        ids: ['Ev01', 'Ev02', 'Ev03'],
      },
      '0',
    ],
    [
      'CalendarEvent/get',
      {
        accountId: 'c',
        state: 'ev-state-1',
        list: [
          {
            id: 'Ev01',
            calendarIds: { Cal01: true },
            title: 'Team standup',
            start: '2026-05-24T09:00:00',
            duration: 'PT30M',
            timeZone: 'America/New_York',
            status: 'confirmed',
            participants: {
              p1: { name: 'Brent', email: 'brent@r3motely.com', participationStatus: 'accepted' },
            },
            locations: {
              loc1: { name: 'Conference Room A' },
            },
          },
          {
            id: 'Ev02',
            calendarIds: { Cal01: true },
            title: 'Lunch',
            description: 'Lunch with Bob',
            start: '2026-05-24T12:00:00',
            duration: 'PT1H',
            timeZone: 'America/New_York',
            status: 'tentative',
          },
          {
            id: 'Ev03',
            calendarIds: { Cal02: true },
            title: 'All-day review',
            start: '2026-05-25T00:00:00',
          },
        ],
        notFound: [],
      },
      '1',
    ],
  ],
});

describe('buildEventListRequest', () => {
  it('produces correct CalendarEvent/query + CalendarEvent/get with date range filter', () => {
    const body = buildEventListRequest({
      accountId: 'c',
      after: '2026-05-24T00:00:00Z',
      before: '2026-05-31T00:00:00Z',
    });
    const parsed = JSON.parse(body);
    expect(parsed.using).toEqual([
      'urn:ietf:params:jmap:core',
      'urn:ietf:params:jmap:calendars',
    ]);
    expect(parsed.methodCalls).toHaveLength(2);
    expect(parsed.methodCalls[0][0]).toBe('CalendarEvent/query');
    expect(parsed.methodCalls[0][1].filter).toEqual({
      after: '2026-05-24T00:00:00Z',
      before: '2026-05-31T00:00:00Z',
    });
    expect(parsed.methodCalls[0][1].sort).toEqual([{ property: 'start', isAscending: true }]);
    expect(parsed.methodCalls[0][1].position).toBe(0);
    expect(parsed.methodCalls[0][1].limit).toBe(50);
    expect(parsed.methodCalls[0][1].calculateTotal).toBe(true);
    expect(parsed.methodCalls[1][0]).toBe('CalendarEvent/get');
    expect(parsed.methodCalls[1][1]['#ids']).toEqual({
      resultOf: '0',
      name: 'CalendarEvent/query',
      path: '/ids',
    });
  });

  it('includes inCalendars filter when calendarId is provided', () => {
    const body = buildEventListRequest({
      accountId: 'c',
      after: '2026-05-24T00:00:00Z',
      before: '2026-05-31T00:00:00Z',
      calendarId: 'Cal01',
    });
    const parsed = JSON.parse(body);
    expect(parsed.methodCalls[0][1].filter.inCalendars).toEqual(['Cal01']);
  });

  it('caps the limit at 200', () => {
    const body = buildEventListRequest({
      accountId: 'c',
      after: '2026-05-24T00:00:00Z',
      before: '2026-05-31T00:00:00Z',
      limit: 5000,
    });
    const parsed = JSON.parse(body);
    expect(parsed.methodCalls[0][1].limit).toBe(200);
  });

  it('uses provided position', () => {
    const body = buildEventListRequest({
      accountId: 'c',
      after: '2026-05-24T00:00:00Z',
      before: '2026-05-31T00:00:00Z',
      position: 10,
    });
    const parsed = JSON.parse(body);
    expect(parsed.methodCalls[0][1].position).toBe(10);
  });
});

describe('parseEventListResponse', () => {
  it('extracts events with correct types', () => {
    const result = parseEventListResponse(EVENT_LIST_RESPONSE);
    expect(result.events).toHaveLength(3);
    expect(result.position).toBe(0);
    expect(result.total).toBe(3);

    const first = result.events[0]!;
    expect(first.id).toBe('Ev01');
    expect(first.calendarIds).toEqual({ Cal01: true });
    expect(first.title).toBe('Team standup');
    expect(first.start).toBe('2026-05-24T09:00:00');
    expect(first.duration).toBe('PT30M');
    expect(first.timeZone).toBe('America/New_York');
    expect(first.status).toBe('confirmed');
    expect(first.participants).toBeDefined();
    expect(first.participants!['p1']).toEqual({
      name: 'Brent',
      email: 'brent@r3motely.com',
      participationStatus: 'accepted',
    });
    expect(first.locations!['loc1']).toEqual({ name: 'Conference Room A' });
  });

  it('handles missing optional fields gracefully', () => {
    const result = parseEventListResponse(EVENT_LIST_RESPONSE);
    const third = result.events[2]!;
    expect(third.id).toBe('Ev03');
    expect(third.title).toBe('All-day review');
    expect(third.duration).toBeUndefined();
    expect(third.status).toBeUndefined();
    expect(third.participants).toBeUndefined();
    expect(third.locations).toBeUndefined();
    expect(third.description).toBeUndefined();
  });

  it('parses description when present', () => {
    const result = parseEventListResponse(EVENT_LIST_RESPONSE);
    const second = result.events[1]!;
    expect(second.description).toBe('Lunch with Bob');
  });

  // PR 54 — participant role + expectReply parsing.
  it('parses participant roles, expectReply, and sendTo.imip fallback', () => {
    const body = JSON.stringify({
      methodResponses: [
        ['CalendarEvent/query', { accountId: 'c', ids: ['Ev99'], total: 1 }, '0'],
        [
          'CalendarEvent/get',
          {
            accountId: 'c',
            state: 's',
            list: [
              {
                id: 'Ev99',
                calendarIds: { Cal01: true },
                title: 'Mixed participants',
                start: '2026-06-10T09:00:00',
                participants: {
                  organizer: {
                    name: 'Brent',
                    email: 'brent@r3motely.com',
                    roles: { owner: true, chair: true },
                    participationStatus: 'accepted',
                    expectReply: false,
                  },
                  required: {
                    email: 'alice@example.invalid',
                    roles: { attendee: true },
                    participationStatus: 'needs-action',
                    expectReply: true,
                  },
                  // No `email` property — only sendTo.imip. We accept
                  // this shape so REPLY ingest doesn't need a separate
                  // path (PR 55).
                  fallback: {
                    sendTo: { imip: 'mailto:bob@example.invalid' },
                    roles: { attendee: true, optional: true },
                  },
                  // No identifiable email anywhere — dropped from the
                  // parsed result rather than crashing.
                  malformed: { name: 'Mystery' },
                },
              },
            ],
            notFound: [],
          },
          '0',
        ],
      ],
    });
    const result = parseEventListResponse(body);
    const ev = result.events[0]!;
    expect(ev.participants).toBeDefined();
    expect(ev.participants!['organizer']!.roles).toEqual({ owner: true, chair: true });
    expect(ev.participants!['organizer']!.expectReply).toBe(false);
    expect(ev.participants!['required']!.roles).toEqual({ attendee: true });
    expect(ev.participants!['fallback']!.email).toBe('bob@example.invalid');
    expect(ev.participants!['fallback']!.roles).toEqual({ attendee: true, optional: true });
    expect(ev.participants!['malformed']).toBeUndefined();
  });

  it('throws ToolError on malformed JSON', () => {
    try {
      parseEventListResponse('{not json');
      throw new Error('expected throw');
    } catch (e) {
      const err = e as ToolError;
      expect(err.code).toBe('jmap_parse_error');
    }
  });

  it('throws when methodResponses has fewer than 2 entries', () => {
    const body = JSON.stringify({
      methodResponses: [['CalendarEvent/query', {}, '0']],
    });
    try {
      parseEventListResponse(body);
      throw new Error('expected throw');
    } catch (e) {
      const err = e as ToolError;
      expect(err.code).toBe('jmap_parse_error');
    }
  });
});

describe('fetchEventList', () => {
  it('POSTs CalendarEvent/query + CalendarEvent/get and returns parsed events', async () => {
    const fetchSpy: FetchSpy = makeFetchSpy(EVENT_LIST_RESPONSE);
    const result = await fetchEventList({
      baseUrl: 'https://sw-mail.example.net',
      getAuthToken: () => 'tok',
      fetch: fetchSpy,
      session: SAMPLE_SESSION,
      after: '2026-05-24T00:00:00Z',
      before: '2026-05-31T00:00:00Z',
    });
    expect(result.events).toHaveLength(3);
    expect(result.position).toBe(0);
    expect(result.total).toBe(3);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(SAMPLE_SESSION.apiUrl);
    expect(init?.method).toBe('POST');
    const body = JSON.parse(String(init?.body));
    expect(body.using).toEqual([
      'urn:ietf:params:jmap:core',
      'urn:ietf:params:jmap:calendars',
    ]);
    expect(body.methodCalls[0][0]).toBe('CalendarEvent/query');
    expect(body.methodCalls[0][1].filter).toEqual({
      after: '2026-05-24T00:00:00Z',
      before: '2026-05-31T00:00:00Z',
    });
  });

  it('rejects with code=unauthorized when no token is available', async () => {
    await expect(
      fetchEventList({
        baseUrl: 'https://x',
        getAuthToken: () => null,
        fetch: makeFetchSpy(EVENT_LIST_RESPONSE),
        session: SAMPLE_SESSION,
        after: '2026-05-24T00:00:00Z',
        before: '2026-05-31T00:00:00Z',
      }),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('rejects with code=unauthorized on a 401 response', async () => {
    await expect(
      fetchEventList({
        baseUrl: 'https://x',
        getAuthToken: () => 'tok',
        fetch: makeFetchSpy('nope', { status: 401, statusText: 'Unauthorized' }),
        session: SAMPLE_SESSION,
        after: '2026-05-24T00:00:00Z',
        before: '2026-05-31T00:00:00Z',
      }),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });
});

// ──────────────────────────────────────────────────────────────────────
// event.get — Phase 4b
// ──────────────────────────────────────────────────────────────────────

const EVENT_GET_RESPONSE = JSON.stringify({
  methodResponses: [
    [
      'CalendarEvent/get',
      {
        accountId: 'c',
        state: 'ev-state-1',
        list: [
          {
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
        ],
        notFound: [],
      },
      '0',
    ],
  ],
});

describe('buildEventGetRequest', () => {
  it('produces correct CalendarEvent/get request for a single event', () => {
    const body = buildEventGetRequest({ accountId: 'c', eventId: 'Ev01' });
    const parsed = JSON.parse(body);
    expect(parsed.using).toEqual([
      'urn:ietf:params:jmap:core',
      'urn:ietf:params:jmap:calendars',
    ]);
    expect(parsed.methodCalls).toHaveLength(1);
    expect(parsed.methodCalls[0][0]).toBe('CalendarEvent/get');
    expect(parsed.methodCalls[0][1]).toMatchObject({
      accountId: 'c',
      ids: ['Ev01'],
    });
    expect(parsed.methodCalls[0][1].properties).toEqual(
      expect.arrayContaining(['id', 'calendarIds', 'title', 'start', 'participants']),
    );
  });
});

describe('parseEventGetResponse', () => {
  it('extracts a single event from the response', () => {
    const event = parseEventGetResponse(EVENT_GET_RESPONSE);
    expect(event.id).toBe('Ev01');
    expect(event.title).toBe('Team standup');
    expect(event.description).toBe('Daily sync-up with the engineering team.');
    expect(event.start).toBe('2026-05-24T09:00:00');
    expect(event.duration).toBe('PT30M');
    expect(event.timeZone).toBe('America/New_York');
    expect(event.status).toBe('confirmed');
    expect(event.participants!['p1']).toEqual({
      name: 'Brent',
      email: 'brent@r3motely.com',
      participationStatus: 'accepted',
    });
    expect(event.participants!['p2']).toEqual({
      name: 'Alice',
      email: 'alice@example.net',
      participationStatus: 'tentative',
    });
    expect(event.locations!['loc1']).toEqual({ name: 'Conference Room A' });
  });

  it('throws not_found when the event is in notFound', () => {
    const body = JSON.stringify({
      methodResponses: [
        [
          'CalendarEvent/get',
          {
            accountId: 'c',
            state: 'ev-state-1',
            list: [],
            notFound: ['Ev-nonexistent'],
          },
          '0',
        ],
      ],
    });
    try {
      parseEventGetResponse(body);
      throw new Error('expected throw');
    } catch (e) {
      const err = e as ToolError;
      expect(err.code).toBe('not_found');
      expect(err.message).toContain('Ev-nonexistent');
    }
  });

  it('throws not_found when list is empty', () => {
    const body = JSON.stringify({
      methodResponses: [
        ['CalendarEvent/get', { list: [], notFound: [] }, '0'],
      ],
    });
    try {
      parseEventGetResponse(body);
      throw new Error('expected throw');
    } catch (e) {
      const err = e as ToolError;
      expect(err.code).toBe('not_found');
    }
  });

  it('throws ToolError on malformed JSON', () => {
    try {
      parseEventGetResponse('{not json');
      throw new Error('expected throw');
    } catch (e) {
      const err = e as ToolError;
      expect(err.code).toBe('jmap_parse_error');
    }
  });
});

describe('fetchEventGet', () => {
  it('POSTs CalendarEvent/get and returns the parsed event', async () => {
    const fetchSpy: FetchSpy = makeFetchSpy(EVENT_GET_RESPONSE);
    const event = await fetchEventGet({
      baseUrl: 'https://sw-mail.example.net',
      getAuthToken: () => 'tok',
      fetch: fetchSpy,
      session: SAMPLE_SESSION,
      eventId: 'Ev01',
    });
    expect(event.id).toBe('Ev01');
    expect(event.title).toBe('Team standup');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(SAMPLE_SESSION.apiUrl);
    expect(init?.method).toBe('POST');
    const body = JSON.parse(String(init?.body));
    expect(body.using).toEqual([
      'urn:ietf:params:jmap:core',
      'urn:ietf:params:jmap:calendars',
    ]);
    expect(body.methodCalls[0][0]).toBe('CalendarEvent/get');
    expect(body.methodCalls[0][1].ids).toEqual(['Ev01']);
  });

  it('rejects with code=unauthorized when no token is available', async () => {
    await expect(
      fetchEventGet({
        baseUrl: 'https://x',
        getAuthToken: () => null,
        fetch: makeFetchSpy(EVENT_GET_RESPONSE),
        session: SAMPLE_SESSION,
        eventId: 'Ev01',
      }),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('rejects with code=unauthorized on a 401 response', async () => {
    await expect(
      fetchEventGet({
        baseUrl: 'https://x',
        getAuthToken: () => 'tok',
        fetch: makeFetchSpy('nope', { status: 401, statusText: 'Unauthorized' }),
        session: SAMPLE_SESSION,
        eventId: 'Ev01',
      }),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });
});
