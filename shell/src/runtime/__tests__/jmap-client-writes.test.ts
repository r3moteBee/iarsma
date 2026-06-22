/**
 * Tests for calendar + contact write capabilities (CalendarEvent/set,
 * ContactCard/set) — event.create, event.update, event.delete,
 * contact.create, contact.update, contact.delete.
 *
 * Covers:
 *   - build*Request: produces the correct JMAP payload.
 *   - parse*Response: extracts result / throws on notCreated/notUpdated/notDestroyed.
 *   - fetch*Commit: auth check → POST → parse round-trip.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  buildEventCreateRequest,
  buildEventDeleteRequest,
  buildEventUpdateRequest,
  buildContactCreateRequest,
  buildContactDeleteRequest,
  buildContactUpdateRequest,
  parseEventCreateResponse,
  parseEventDeleteResponse,
  parseEventUpdateResponse,
  parseContactCreateResponse,
  parseContactDeleteResponse,
  parseContactUpdateResponse,
  fetchEventCreateCommit,
  fetchEventDeleteCommit,
  fetchEventUpdateCommit,
  fetchContactCreateCommit,
  fetchContactDeleteCommit,
  fetchContactUpdateCommit,
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

// ══════════════════════════════════════════════════════════════════════
// CalendarEvent/set — event.create
// ══════════════════════════════════════════════════════════════════════

describe('buildEventCreateRequest', () => {
  it('produces CalendarEvent/set with correct create payload', () => {
    const body = buildEventCreateRequest({
      accountId: 'c',
      params: {
        calendarId: 'cal-1',
        title: 'Team standup',
        start: '2026-05-25T09:00:00',
        duration: 'PT1H',
        timeZone: 'America/New_York',
        description: 'Daily standup meeting',
        location: 'Room 3B',
      },
    });
    const parsed = JSON.parse(body) as {
      using: string[];
      methodCalls: Array<[string, Record<string, unknown>, string]>;
    };
    expect(parsed.using).toEqual([
      'urn:ietf:params:jmap:core',
      'urn:ietf:params:jmap:calendars',
    ]);
    expect(parsed.methodCalls).toHaveLength(1);
    expect(parsed.methodCalls[0]![0]).toBe('CalendarEvent/set');
    const args = parsed.methodCalls[0]![1]!;
    expect(args.accountId).toBe('c');
    const create = args.create as Record<string, Record<string, unknown>>;
    const c0 = create['c0']!;
    expect(c0['@type']).toBe('Event');
    expect(c0.calendarIds).toEqual({ 'cal-1': true });
    expect(c0.title).toBe('Team standup');
    expect(c0.start).toBe('2026-05-25T09:00:00');
    expect(c0.duration).toBe('PT1H');
    expect(c0.timeZone).toBe('America/New_York');
    expect(c0.description).toBe('Daily standup meeting');
    expect(c0.locations).toEqual({ loc0: { name: 'Room 3B' } });
  });

  it('omits optional fields when not provided', () => {
    const body = buildEventCreateRequest({
      accountId: 'c',
      params: {
        calendarId: 'cal-1',
        title: 'Quick event',
        start: '2026-05-25T14:00:00',
      },
    });
    const parsed = JSON.parse(body) as {
      methodCalls: Array<[string, Record<string, unknown>, string]>;
    };
    const create = parsed.methodCalls[0]![1]!.create as Record<string, Record<string, unknown>>;
    const c0 = create['c0']!;
    expect(c0.duration).toBeUndefined();
    expect(c0.timeZone).toBeUndefined();
    expect(c0.description).toBeUndefined();
    expect(c0.locations).toBeUndefined();
    expect(c0.participants).toBeUndefined();
  });

  // PR 54 / CoWork #7 — JSCalendar participants serialization.
  it('serializes participants with sendTo.imip so Stalwart fires iTIP REQUEST', () => {
    const body = buildEventCreateRequest({
      accountId: 'c',
      params: {
        calendarId: 'cal-1',
        title: 'Planning',
        start: '2026-06-01T15:00:00',
        participants: [
          {
            email: 'brent@r3motely.com',
            name: 'Brent',
            roles: { owner: true, chair: true },
            participationStatus: 'accepted',
            expectReply: false,
          },
          {
            email: 'alice@example.invalid',
            roles: { attendee: true },
          },
          {
            email: 'bob@example.invalid',
            name: 'Bob',
            roles: { attendee: true, optional: true },
          },
        ],
      },
    });
    const parsed = JSON.parse(body) as {
      methodCalls: Array<[string, Record<string, unknown>, string]>;
    };
    const create = parsed.methodCalls[0]![1]!.create as Record<string, Record<string, unknown>>;
    const participants = create['c0']!.participants as Record<string, Record<string, unknown>>;
    const p0 = participants['p0']!;
    expect(p0['@type']).toBe('Participant');
    expect(p0.email).toBe('brent@r3motely.com');
    expect(p0.sendTo).toEqual({ imip: 'mailto:brent@r3motely.com' });
    expect(p0.roles).toEqual({ owner: true, chair: true });
    expect(p0.participationStatus).toBe('accepted');
    expect(p0.expectReply).toBe(false);

    const p1 = participants['p1']!;
    expect(p1.email).toBe('alice@example.invalid');
    expect(p1.sendTo).toEqual({ imip: 'mailto:alice@example.invalid' });
    expect(p1.roles).toEqual({ attendee: true });
    // Defaults applied — needs-action + expectReply=true for non-owners
    expect(p1.participationStatus).toBe('needs-action');
    expect(p1.expectReply).toBe(true);

    const p2 = participants['p2']!;
    expect(p2.roles).toEqual({ attendee: true, optional: true });
    expect(p2.name).toBe('Bob');
  });

  it('omits the participants field on create when the input is empty', () => {
    const body = buildEventCreateRequest({
      accountId: 'c',
      params: {
        calendarId: 'cal-1',
        title: 'Solo block',
        start: '2026-06-01T15:00:00',
        participants: [],
      },
    });
    const create = JSON.parse(body).methodCalls[0][1].create.c0;
    expect(create.participants).toBeUndefined();
  });
});

const EVENT_CREATE_OK_BODY = JSON.stringify({
  methodResponses: [
    [
      'CalendarEvent/set',
      {
        accountId: 'c',
        created: { c0: { id: 'evt-123' } },
      },
      '0',
    ],
  ],
});

describe('parseEventCreateResponse', () => {
  it('extracts eventId from created["c0"]', () => {
    const result = parseEventCreateResponse(EVENT_CREATE_OK_BODY);
    expect(result).toEqual({ eventId: 'evt-123' });
  });

  it('throws code=jmap_set_error when notCreated contains entries', () => {
    const body = JSON.stringify({
      methodResponses: [
        [
          'CalendarEvent/set',
          {
            accountId: 'c',
            notCreated: {
              c0: { type: 'invalidProperties', description: 'Bad start time' },
            },
          },
          '0',
        ],
      ],
    });
    try {
      parseEventCreateResponse(body);
      throw new Error('expected throw');
    } catch (e) {
      const err = e as ToolError;
      expect(err.code).toBe('jmap_set_error');
      expect(err.message).toContain('invalidProperties');
      expect(err.message).toContain('Bad start time');
    }
  });

  it('throws code=jmap_parse_error on malformed JSON', () => {
    try {
      parseEventCreateResponse('not json');
      throw new Error('expected throw');
    } catch (e) {
      expect((e as ToolError).code).toBe('jmap_parse_error');
    }
  });

  it('throws code=jmap_parse_error when methodResponses is empty', () => {
    const body = JSON.stringify({ methodResponses: [] });
    try {
      parseEventCreateResponse(body);
      throw new Error('expected throw');
    } catch (e) {
      expect((e as ToolError).code).toBe('jmap_parse_error');
    }
  });

  it('throws code=jmap_parse_error when first methodResponse is not CalendarEvent/set', () => {
    const body = JSON.stringify({
      methodResponses: [['error', { type: 'unknownMethod' }, '0']],
    });
    try {
      parseEventCreateResponse(body);
      throw new Error('expected throw');
    } catch (e) {
      expect((e as ToolError).code).toBe('jmap_parse_error');
    }
  });
});

describe('fetchEventCreateCommit', () => {
  it('POSTs CalendarEvent/set create and returns eventId', async () => {
    const fetchSpy: FetchSpy = makeFetchSpy(EVENT_CREATE_OK_BODY);
    const result = await fetchEventCreateCommit({
      baseUrl: 'https://x',
      getAuthToken: () => 'tok',
      fetch: fetchSpy,
      session: SAMPLE_SESSION,
      params: {
        calendarId: 'cal-1',
        title: 'Lunch',
        start: '2026-05-25T12:00:00',
      },
    });
    expect(result).toEqual({ eventId: 'evt-123' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(SAMPLE_SESSION.apiUrl);
    expect(init?.method).toBe('POST');
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.authorization).toBe('Bearer tok');
  });

  it('rejects with code=unauthorized when no token is available', async () => {
    await expect(
      fetchEventCreateCommit({
        baseUrl: 'https://x',
        getAuthToken: () => null,
        fetch: makeFetchSpy(EVENT_CREATE_OK_BODY),
        session: SAMPLE_SESSION,
        params: { calendarId: 'cal-1', title: 'x', start: '2026-05-25T09:00:00' },
      }),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('rejects with code=jmap_http_error on a non-2xx response', async () => {
    await expect(
      fetchEventCreateCommit({
        baseUrl: 'https://x',
        getAuthToken: () => 'tok',
        fetch: makeFetchSpy('err', { status: 500, statusText: 'Server Error' }),
        session: SAMPLE_SESSION,
        params: { calendarId: 'cal-1', title: 'x', start: '2026-05-25T09:00:00' },
      }),
    ).rejects.toMatchObject({ code: 'jmap_http_error' });
  });
});

// ══════════════════════════════════════════════════════════════════════
// CalendarEvent/set — event.update
// ══════════════════════════════════════════════════════════════════════

describe('buildEventUpdateRequest', () => {
  it('produces CalendarEvent/set with correct update patch', () => {
    const body = buildEventUpdateRequest({
      accountId: 'c',
      params: {
        eventId: 'evt-123',
        title: 'Updated title',
        start: '2026-05-26T10:00:00',
        duration: 'PT2H',
        description: 'New description',
        location: 'Room 5A',
      },
    });
    const parsed = JSON.parse(body) as {
      using: string[];
      methodCalls: Array<[string, Record<string, unknown>, string]>;
    };
    expect(parsed.using).toEqual([
      'urn:ietf:params:jmap:core',
      'urn:ietf:params:jmap:calendars',
    ]);
    expect(parsed.methodCalls).toHaveLength(1);
    expect(parsed.methodCalls[0]![0]).toBe('CalendarEvent/set');
    const args = parsed.methodCalls[0]![1]!;
    expect(args.accountId).toBe('c');
    const update = args.update as Record<string, Record<string, unknown>>;
    const patch = update['evt-123']!;
    expect(patch.title).toBe('Updated title');
    expect(patch.start).toBe('2026-05-26T10:00:00');
    expect(patch.duration).toBe('PT2H');
    expect(patch.description).toBe('New description');
    expect(patch.locations).toEqual({ loc0: { name: 'Room 5A' } });
  });

  it('only includes provided fields in the patch', () => {
    const body = buildEventUpdateRequest({
      accountId: 'c',
      params: {
        eventId: 'evt-123',
        title: 'Only title',
      },
    });
    const parsed = JSON.parse(body) as {
      methodCalls: Array<[string, Record<string, unknown>, string]>;
    };
    const update = parsed.methodCalls[0]![1]!.update as Record<string, Record<string, unknown>>;
    const patch = update['evt-123']!;
    expect(patch.title).toBe('Only title');
    expect(patch.start).toBeUndefined();
    expect(patch.duration).toBeUndefined();
    expect(patch.description).toBeUndefined();
    expect(patch.locations).toBeUndefined();
    expect(patch.participants).toBeUndefined();
  });

  // PR 54 — participants update.
  it('serializes a participants list on update (replace semantics)', () => {
    const body = buildEventUpdateRequest({
      accountId: 'c',
      params: {
        eventId: 'evt-123',
        participants: [
          {
            email: 'brent@r3motely.com',
            roles: { owner: true, chair: true },
          },
          {
            email: 'alice@example.invalid',
            roles: { attendee: true },
          },
        ],
      },
    });
    const patch = JSON.parse(body).methodCalls[0][1].update['evt-123'];
    expect(patch.participants).toEqual({
      p0: expect.objectContaining({
        email: 'brent@r3motely.com',
        sendTo: { imip: 'mailto:brent@r3motely.com' },
        roles: { owner: true, chair: true },
        participationStatus: 'accepted',
        expectReply: false,
      }),
      p1: expect.objectContaining({
        email: 'alice@example.invalid',
        roles: { attendee: true },
        participationStatus: 'needs-action',
        expectReply: true,
      }),
    });
  });

  it('clears participants via null when an explicit empty array is passed on update', () => {
    const body = buildEventUpdateRequest({
      accountId: 'c',
      params: {
        eventId: 'evt-123',
        participants: [],
      },
    });
    const patch = JSON.parse(body).methodCalls[0][1].update['evt-123'];
    // JMAP path-patch — null clears the field on the server.
    expect(patch.participants).toBeNull();
  });
});

const EVENT_UPDATE_OK_BODY = JSON.stringify({
  methodResponses: [
    [
      'CalendarEvent/set',
      {
        accountId: 'c',
        updated: { 'evt-123': null },
      },
      '0',
    ],
  ],
});

describe('parseEventUpdateResponse', () => {
  it('returns updated: true when the update succeeds', () => {
    const result = parseEventUpdateResponse(EVENT_UPDATE_OK_BODY);
    expect(result).toEqual({ updated: true });
  });

  it('throws code=jmap_set_error when notUpdated contains entries', () => {
    const body = JSON.stringify({
      methodResponses: [
        [
          'CalendarEvent/set',
          {
            accountId: 'c',
            notUpdated: {
              'evt-123': { type: 'notFound', description: 'Event does not exist' },
            },
          },
          '0',
        ],
      ],
    });
    try {
      parseEventUpdateResponse(body);
      throw new Error('expected throw');
    } catch (e) {
      const err = e as ToolError;
      expect(err.code).toBe('jmap_set_error');
      expect(err.message).toContain('notFound');
    }
  });

  it('throws code=jmap_parse_error on malformed JSON', () => {
    try {
      parseEventUpdateResponse('not json');
      throw new Error('expected throw');
    } catch (e) {
      expect((e as ToolError).code).toBe('jmap_parse_error');
    }
  });
});

describe('fetchEventUpdateCommit', () => {
  it('POSTs CalendarEvent/set update and returns result', async () => {
    const fetchSpy: FetchSpy = makeFetchSpy(EVENT_UPDATE_OK_BODY);
    const result = await fetchEventUpdateCommit({
      baseUrl: 'https://x',
      getAuthToken: () => 'tok',
      fetch: fetchSpy,
      session: SAMPLE_SESSION,
      params: { eventId: 'evt-123', title: 'New title' },
    });
    expect(result).toEqual({ updated: true });
  });

  it('rejects with code=unauthorized when no token is available', async () => {
    await expect(
      fetchEventUpdateCommit({
        baseUrl: 'https://x',
        getAuthToken: () => null,
        fetch: makeFetchSpy(EVENT_UPDATE_OK_BODY),
        session: SAMPLE_SESSION,
        params: { eventId: 'evt-123', title: 'x' },
      }),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });
});

// ══════════════════════════════════════════════════════════════════════
// CalendarEvent/set — event.delete
// ══════════════════════════════════════════════════════════════════════

describe('buildEventDeleteRequest', () => {
  it('produces CalendarEvent/set with a destroy array', () => {
    const body = buildEventDeleteRequest({
      accountId: 'c',
      eventId: 'evt-123',
    });
    const parsed = JSON.parse(body) as {
      using: string[];
      methodCalls: Array<[string, Record<string, unknown>, string]>;
    };
    expect(parsed.using).toEqual([
      'urn:ietf:params:jmap:core',
      'urn:ietf:params:jmap:calendars',
    ]);
    expect(parsed.methodCalls).toHaveLength(1);
    expect(parsed.methodCalls[0]![0]).toBe('CalendarEvent/set');
    const args = parsed.methodCalls[0]![1]!;
    expect(args.accountId).toBe('c');
    expect(args.destroy).toEqual(['evt-123']);
  });
});

const EVENT_DELETE_OK_BODY = JSON.stringify({
  methodResponses: [
    [
      'CalendarEvent/set',
      {
        accountId: 'c',
        destroyed: ['evt-123'],
      },
      '0',
    ],
  ],
});

describe('parseEventDeleteResponse', () => {
  it('returns deleted: true when the destroy succeeds', () => {
    const result = parseEventDeleteResponse(EVENT_DELETE_OK_BODY);
    expect(result).toEqual({ deleted: true });
  });

  it('throws code=jmap_set_error when notDestroyed contains entries', () => {
    const body = JSON.stringify({
      methodResponses: [
        [
          'CalendarEvent/set',
          {
            accountId: 'c',
            destroyed: [],
            notDestroyed: {
              'evt-123': { type: 'notFound' },
            },
          },
          '0',
        ],
      ],
    });
    try {
      parseEventDeleteResponse(body);
      throw new Error('expected throw');
    } catch (e) {
      const err = e as ToolError;
      expect(err.code).toBe('jmap_set_error');
      expect(err.message).toContain('notDestroyed');
      expect(err.message).toContain('evt-123');
    }
  });

  it('throws code=jmap_parse_error on malformed JSON', () => {
    try {
      parseEventDeleteResponse('not json');
      throw new Error('expected throw');
    } catch (e) {
      expect((e as ToolError).code).toBe('jmap_parse_error');
    }
  });
});

describe('fetchEventDeleteCommit', () => {
  it('POSTs CalendarEvent/set destroy and returns result', async () => {
    const fetchSpy: FetchSpy = makeFetchSpy(EVENT_DELETE_OK_BODY);
    const result = await fetchEventDeleteCommit({
      baseUrl: 'https://x',
      getAuthToken: () => 'tok',
      fetch: fetchSpy,
      session: SAMPLE_SESSION,
      eventId: 'evt-123',
    });
    expect(result).toEqual({ deleted: true });
  });

  it('rejects with code=unauthorized when no token is available', async () => {
    await expect(
      fetchEventDeleteCommit({
        baseUrl: 'https://x',
        getAuthToken: () => null,
        fetch: makeFetchSpy(EVENT_DELETE_OK_BODY),
        session: SAMPLE_SESSION,
        eventId: 'evt-123',
      }),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });
});

// ══════════════════════════════════════════════════════════════════════
// ContactCard/set — contact.create
// ══════════════════════════════════════════════════════════════════════

describe('buildContactCreateRequest', () => {
  it('produces ContactCard/set with correct JSContact structure', () => {
    const body = buildContactCreateRequest({
      accountId: 'c',
      params: {
        name: { full: 'Jane Smith', given: 'Jane', surname: 'Smith' },
        emails: [{ address: 'jane@example.com', label: 'work' }],
        phones: [{ number: '+1-555-0123', label: 'mobile' }],
        organizations: [{ name: 'Acme Inc', title: 'Engineer' }],
      },
    });
    const parsed = JSON.parse(body) as {
      using: string[];
      methodCalls: Array<[string, Record<string, unknown>, string]>;
    };
    expect(parsed.using).toEqual([
      'urn:ietf:params:jmap:core',
      'urn:ietf:params:jmap:contacts',
    ]);
    expect(parsed.methodCalls).toHaveLength(1);
    expect(parsed.methodCalls[0]![0]).toBe('ContactCard/set');
    const args = parsed.methodCalls[0]![1]!;
    expect(args.accountId).toBe('c');
    const create = args.create as Record<string, Record<string, unknown>>;
    const c0 = create['c0']!;
    expect(c0['@type']).toBe('Card');
    expect(c0.name).toEqual({ full: 'Jane Smith', given: 'Jane', surname: 'Smith' });
    // JSContact stores emails as a map keyed by arbitrary IDs
    const emails = c0.emails as Record<string, unknown>;
    expect(Object.keys(emails)).toHaveLength(1);
    const emailEntry = Object.values(emails)[0] as Record<string, unknown>;
    expect(emailEntry.address).toBe('jane@example.com');
    expect(emailEntry.label).toBe('work');
    // Phones as map
    const phones = c0.phones as Record<string, unknown>;
    expect(Object.keys(phones)).toHaveLength(1);
    const phoneEntry = Object.values(phones)[0] as Record<string, unknown>;
    expect(phoneEntry.number).toBe('+1-555-0123');
    expect(phoneEntry.label).toBe('mobile');
    // Organizations as map
    const orgs = c0.organizations as Record<string, unknown>;
    expect(Object.keys(orgs)).toHaveLength(1);
    const orgEntry = Object.values(orgs)[0] as Record<string, unknown>;
    expect(orgEntry.name).toBe('Acme Inc');
    expect(orgEntry.title).toBe('Engineer');
  });

  it('includes addressBookIds when addressBookId is provided', () => {
    const body = buildContactCreateRequest({
      accountId: 'c',
      params: {
        addressBookId: 'ab-1',
        name: { full: 'Bob' },
      },
    });
    const parsed = JSON.parse(body) as {
      methodCalls: Array<[string, Record<string, unknown>, string]>;
    };
    const create = parsed.methodCalls[0]![1]!.create as Record<string, Record<string, unknown>>;
    const c0 = create['c0']!;
    expect(c0.addressBookIds).toEqual({ 'ab-1': true });
  });

  it('omits optional fields when not provided', () => {
    const body = buildContactCreateRequest({
      accountId: 'c',
      params: {
        name: { given: 'Alice' },
      },
    });
    const parsed = JSON.parse(body) as {
      methodCalls: Array<[string, Record<string, unknown>, string]>;
    };
    const create = parsed.methodCalls[0]![1]!.create as Record<string, Record<string, unknown>>;
    const c0 = create['c0']!;
    expect(c0.emails).toBeUndefined();
    expect(c0.phones).toBeUndefined();
    expect(c0.organizations).toBeUndefined();
    expect(c0.addressBookIds).toBeUndefined();
  });
});

const CONTACT_CREATE_OK_BODY = JSON.stringify({
  methodResponses: [
    [
      'ContactCard/set',
      {
        accountId: 'c',
        created: { c0: { id: 'card-456' } },
      },
      '0',
    ],
  ],
});

describe('parseContactCreateResponse', () => {
  it('extracts contactId from created["c0"]', () => {
    const result = parseContactCreateResponse(CONTACT_CREATE_OK_BODY);
    expect(result).toEqual({ contactId: 'card-456' });
  });

  it('throws code=jmap_set_error when notCreated contains entries', () => {
    const body = JSON.stringify({
      methodResponses: [
        [
          'ContactCard/set',
          {
            accountId: 'c',
            notCreated: {
              c0: { type: 'invalidProperties', description: 'Name required' },
            },
          },
          '0',
        ],
      ],
    });
    try {
      parseContactCreateResponse(body);
      throw new Error('expected throw');
    } catch (e) {
      const err = e as ToolError;
      expect(err.code).toBe('jmap_set_error');
      expect(err.message).toContain('invalidProperties');
      expect(err.message).toContain('Name required');
    }
  });

  it('throws code=jmap_parse_error on malformed JSON', () => {
    try {
      parseContactCreateResponse('not json');
      throw new Error('expected throw');
    } catch (e) {
      expect((e as ToolError).code).toBe('jmap_parse_error');
    }
  });

  it('throws code=jmap_parse_error when methodResponses is empty', () => {
    const body = JSON.stringify({ methodResponses: [] });
    try {
      parseContactCreateResponse(body);
      throw new Error('expected throw');
    } catch (e) {
      expect((e as ToolError).code).toBe('jmap_parse_error');
    }
  });

  it('throws code=jmap_parse_error when first methodResponse is not ContactCard/set', () => {
    const body = JSON.stringify({
      methodResponses: [['error', { type: 'unknownMethod' }, '0']],
    });
    try {
      parseContactCreateResponse(body);
      throw new Error('expected throw');
    } catch (e) {
      expect((e as ToolError).code).toBe('jmap_parse_error');
    }
  });
});

describe('fetchContactCreateCommit', () => {
  it('POSTs ContactCard/set create and returns contactId', async () => {
    const fetchSpy: FetchSpy = makeFetchSpy(CONTACT_CREATE_OK_BODY);
    const result = await fetchContactCreateCommit({
      baseUrl: 'https://x',
      getAuthToken: () => 'tok',
      fetch: fetchSpy,
      session: SAMPLE_SESSION,
      params: { name: { full: 'Jane Smith' } },
    });
    expect(result).toEqual({ contactId: 'card-456' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(SAMPLE_SESSION.apiUrl);
    expect(init?.method).toBe('POST');
  });

  it('rejects with code=unauthorized when no token is available', async () => {
    await expect(
      fetchContactCreateCommit({
        baseUrl: 'https://x',
        getAuthToken: () => null,
        fetch: makeFetchSpy(CONTACT_CREATE_OK_BODY),
        session: SAMPLE_SESSION,
        params: { name: { full: 'x' } },
      }),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('rejects with code=jmap_http_error on a non-2xx response', async () => {
    await expect(
      fetchContactCreateCommit({
        baseUrl: 'https://x',
        getAuthToken: () => 'tok',
        fetch: makeFetchSpy('err', { status: 500, statusText: 'Server Error' }),
        session: SAMPLE_SESSION,
        params: { name: { full: 'x' } },
      }),
    ).rejects.toMatchObject({ code: 'jmap_http_error' });
  });
});

// ══════════════════════════════════════════════════════════════════════
// ContactCard/set — contact.update
// ══════════════════════════════════════════════════════════════════════

describe('buildContactUpdateRequest', () => {
  it('produces ContactCard/set with correct update patch', () => {
    const body = buildContactUpdateRequest({
      accountId: 'c',
      params: {
        contactId: 'card-456',
        name: { full: 'Jane Doe', surname: 'Doe' },
        emails: [{ address: 'jane.doe@example.com' }],
        phones: [{ number: '+1-555-9999' }],
      },
    });
    const parsed = JSON.parse(body) as {
      using: string[];
      methodCalls: Array<[string, Record<string, unknown>, string]>;
    };
    expect(parsed.using).toEqual([
      'urn:ietf:params:jmap:core',
      'urn:ietf:params:jmap:contacts',
    ]);
    expect(parsed.methodCalls).toHaveLength(1);
    expect(parsed.methodCalls[0]![0]).toBe('ContactCard/set');
    const args = parsed.methodCalls[0]![1]!;
    const update = args.update as Record<string, Record<string, unknown>>;
    const patch = update['card-456']!;
    expect(patch.name).toEqual({ full: 'Jane Doe', surname: 'Doe' });
    expect(patch.emails).toBeDefined();
    expect(patch.phones).toBeDefined();
  });

  it('only includes provided fields in the patch', () => {
    const body = buildContactUpdateRequest({
      accountId: 'c',
      params: {
        contactId: 'card-456',
        name: { given: 'Updated' },
      },
    });
    const parsed = JSON.parse(body) as {
      methodCalls: Array<[string, Record<string, unknown>, string]>;
    };
    const update = parsed.methodCalls[0]![1]!.update as Record<string, Record<string, unknown>>;
    const patch = update['card-456']!;
    // `full` (FN) is derived from the given/surname parts so JSContact
    // accepts the name (U-2) — see normalizeContactName.
    expect(patch.name).toEqual({ full: 'Updated', given: 'Updated' });
    expect(patch.emails).toBeUndefined();
    expect(patch.phones).toBeUndefined();
  });
});

const CONTACT_UPDATE_OK_BODY = JSON.stringify({
  methodResponses: [
    [
      'ContactCard/set',
      {
        accountId: 'c',
        updated: { 'card-456': null },
      },
      '0',
    ],
  ],
});

describe('parseContactUpdateResponse', () => {
  it('returns updated: true when the update succeeds', () => {
    const result = parseContactUpdateResponse(CONTACT_UPDATE_OK_BODY);
    expect(result).toEqual({ updated: true });
  });

  it('throws code=jmap_set_error when notUpdated contains entries', () => {
    const body = JSON.stringify({
      methodResponses: [
        [
          'ContactCard/set',
          {
            accountId: 'c',
            notUpdated: {
              'card-456': { type: 'notFound', description: 'Card not found' },
            },
          },
          '0',
        ],
      ],
    });
    try {
      parseContactUpdateResponse(body);
      throw new Error('expected throw');
    } catch (e) {
      const err = e as ToolError;
      expect(err.code).toBe('jmap_set_error');
      expect(err.message).toContain('notFound');
    }
  });

  it('throws code=jmap_parse_error on malformed JSON', () => {
    try {
      parseContactUpdateResponse('not json');
      throw new Error('expected throw');
    } catch (e) {
      expect((e as ToolError).code).toBe('jmap_parse_error');
    }
  });
});

describe('fetchContactUpdateCommit', () => {
  it('POSTs ContactCard/set update and returns result', async () => {
    const fetchSpy: FetchSpy = makeFetchSpy(CONTACT_UPDATE_OK_BODY);
    const result = await fetchContactUpdateCommit({
      baseUrl: 'https://x',
      getAuthToken: () => 'tok',
      fetch: fetchSpy,
      session: SAMPLE_SESSION,
      params: { contactId: 'card-456', name: { full: 'Jane Doe' } },
    });
    expect(result).toEqual({ updated: true });
  });

  it('rejects with code=unauthorized when no token is available', async () => {
    await expect(
      fetchContactUpdateCommit({
        baseUrl: 'https://x',
        getAuthToken: () => null,
        fetch: makeFetchSpy(CONTACT_UPDATE_OK_BODY),
        session: SAMPLE_SESSION,
        params: { contactId: 'card-456', name: { full: 'x' } },
      }),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });
});

// ══════════════════════════════════════════════════════════════════════
// ContactCard/set — contact.delete
// ══════════════════════════════════════════════════════════════════════

describe('buildContactDeleteRequest', () => {
  it('produces ContactCard/set with a destroy array', () => {
    const body = buildContactDeleteRequest({
      accountId: 'c',
      contactId: 'card-456',
    });
    const parsed = JSON.parse(body) as {
      using: string[];
      methodCalls: Array<[string, Record<string, unknown>, string]>;
    };
    expect(parsed.using).toEqual([
      'urn:ietf:params:jmap:core',
      'urn:ietf:params:jmap:contacts',
    ]);
    expect(parsed.methodCalls).toHaveLength(1);
    expect(parsed.methodCalls[0]![0]).toBe('ContactCard/set');
    const args = parsed.methodCalls[0]![1]!;
    expect(args.accountId).toBe('c');
    expect(args.destroy).toEqual(['card-456']);
  });
});

const CONTACT_DELETE_OK_BODY = JSON.stringify({
  methodResponses: [
    [
      'ContactCard/set',
      {
        accountId: 'c',
        destroyed: ['card-456'],
      },
      '0',
    ],
  ],
});

describe('parseContactDeleteResponse', () => {
  it('returns deleted: true when the destroy succeeds', () => {
    const result = parseContactDeleteResponse(CONTACT_DELETE_OK_BODY);
    expect(result).toEqual({ deleted: true });
  });

  it('throws code=jmap_set_error when notDestroyed contains entries', () => {
    const body = JSON.stringify({
      methodResponses: [
        [
          'ContactCard/set',
          {
            accountId: 'c',
            destroyed: [],
            notDestroyed: {
              'card-456': { type: 'notFound' },
            },
          },
          '0',
        ],
      ],
    });
    try {
      parseContactDeleteResponse(body);
      throw new Error('expected throw');
    } catch (e) {
      const err = e as ToolError;
      expect(err.code).toBe('jmap_set_error');
      expect(err.message).toContain('notDestroyed');
      expect(err.message).toContain('card-456');
    }
  });

  it('throws code=jmap_parse_error on malformed JSON', () => {
    try {
      parseContactDeleteResponse('not json');
      throw new Error('expected throw');
    } catch (e) {
      expect((e as ToolError).code).toBe('jmap_parse_error');
    }
  });
});

describe('fetchContactDeleteCommit', () => {
  it('POSTs ContactCard/set destroy and returns result', async () => {
    const fetchSpy: FetchSpy = makeFetchSpy(CONTACT_DELETE_OK_BODY);
    const result = await fetchContactDeleteCommit({
      baseUrl: 'https://x',
      getAuthToken: () => 'tok',
      fetch: fetchSpy,
      session: SAMPLE_SESSION,
      contactId: 'card-456',
    });
    expect(result).toEqual({ deleted: true });
  });

  it('rejects with code=unauthorized when no token is available', async () => {
    await expect(
      fetchContactDeleteCommit({
        baseUrl: 'https://x',
        getAuthToken: () => null,
        fetch: makeFetchSpy(CONTACT_DELETE_OK_BODY),
        session: SAMPLE_SESSION,
        contactId: 'card-456',
      }),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });
});
