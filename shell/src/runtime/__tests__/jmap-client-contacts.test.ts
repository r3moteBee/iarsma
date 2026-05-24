/**
 * Tests for contact.list and contact.get JMAP client functions.
 *
 * Covers `buildContactListRequest`, `parseContactListResponse`,
 * `buildContactGetRequest`, `parseContactGetResponse`,
 * `fetchContactList`, and `fetchContactGet`.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  buildContactListRequest,
  buildContactGetRequest,
  fetchContactList,
  fetchContactGet,
  parseContactListResponse,
  parseContactGetResponse,
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
// buildContactListRequest
// ──────────────────────────────────────────────────────────────────────

describe('buildContactListRequest', () => {
  it('produces correct JMAP method calls with contacts capability', () => {
    const body = buildContactListRequest({ accountId: 'c' });
    const parsed = JSON.parse(body) as {
      using: string[];
      methodCalls: Array<[string, Record<string, unknown>, string]>;
    };
    expect(parsed.using).toContain('urn:ietf:params:jmap:core');
    expect(parsed.using).toContain('urn:ietf:params:jmap:contacts');
    expect(parsed.methodCalls).toHaveLength(3);
    // First: AddressBook/get
    expect(parsed.methodCalls[0]![0]).toBe('AddressBook/get');
    expect(parsed.methodCalls[0]![1]).toEqual({ accountId: 'c' });
    // Second: ContactCard/query with back-reference
    expect(parsed.methodCalls[1]![0]).toBe('ContactCard/query');
    expect((parsed.methodCalls[1]![1] as Record<string, unknown>).accountId).toBe('c');
    // Third: ContactCard/get with back-reference
    expect(parsed.methodCalls[2]![0]).toBe('ContactCard/get');
    expect((parsed.methodCalls[2]![1] as Record<string, unknown>).accountId).toBe('c');
    expect((parsed.methodCalls[2]![1] as Record<string, unknown>)['#ids']).toEqual({
      resultOf: '1',
      name: 'ContactCard/query',
      path: '/ids',
    });
  });

  it('includes filter when query is provided', () => {
    const body = buildContactListRequest({ accountId: 'c', query: 'alice' });
    const parsed = JSON.parse(body) as {
      methodCalls: Array<[string, Record<string, unknown>, string]>;
    };
    const queryMethod = parsed.methodCalls[1]![1] as Record<string, unknown>;
    expect((queryMethod.filter as Record<string, unknown>).text).toBe('alice');
  });
});

// ──────────────────────────────────────────────────────────────────────
// parseContactListResponse
// ──────────────────────────────────────────────────────────────────────

describe('parseContactListResponse', () => {
  it('extracts contacts from a valid response', () => {
    const response = JSON.stringify({
      methodResponses: [
        ['AddressBook/get', { list: [{ id: 'AB01' }] }, '0'],
        ['ContactCard/query', { ids: ['CC01', 'CC02'], total: 2 }, '1'],
        [
          'ContactCard/get',
          {
            list: [
              {
                id: 'CC01',
                name: { full: 'Alice Smith', given: 'Alice', surname: 'Smith' },
                emails: { e1: { address: 'alice@example.com', label: 'work' } },
                phones: { p1: { number: '+1-555-0101', label: 'mobile' } },
                organizations: { o1: { name: 'Acme Corp', title: 'Engineer' } },
              },
              {
                id: 'CC02',
                name: { full: 'Bob Jones' },
                emails: { e1: { address: 'bob@example.com' } },
              },
            ],
          },
          '2',
        ],
      ],
    });
    const result = parseContactListResponse(response);
    expect(result.contacts).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(result.contacts[0]!.id).toBe('CC01');
    expect(result.contacts[0]!.name?.full).toBe('Alice Smith');
    expect(result.contacts[0]!.emails![0]!.address).toBe('alice@example.com');
    expect(result.contacts[0]!.phones![0]!.number).toBe('+1-555-0101');
    expect(result.contacts[0]!.organizations![0]!.name).toBe('Acme Corp');
    expect(result.contacts[1]!.id).toBe('CC02');
    expect(result.contacts[1]!.emails![0]!.address).toBe('bob@example.com');
  });

  it('handles missing optional fields (no phones, no org)', () => {
    const response = JSON.stringify({
      methodResponses: [
        ['AddressBook/get', { list: [{ id: 'AB01' }] }, '0'],
        ['ContactCard/query', { ids: ['CC01'], total: 1 }, '1'],
        [
          'ContactCard/get',
          {
            list: [
              {
                id: 'CC01',
                name: { full: 'Jane Doe' },
              },
            ],
          },
          '2',
        ],
      ],
    });
    const result = parseContactListResponse(response);
    expect(result.contacts).toHaveLength(1);
    expect(result.contacts[0]!.phones).toBeUndefined();
    expect(result.contacts[0]!.organizations).toBeUndefined();
    expect(result.contacts[0]!.emails).toBeUndefined();
  });

  it('throws on malformed response', () => {
    expect(() => parseContactListResponse('not json')).toThrow();
  });
});

// ──────────────────────────────────────────────────────────────────────
// buildContactGetRequest
// ──────────────────────────────────────────────────────────────────────

describe('buildContactGetRequest', () => {
  it('produces correct JMAP ContactCard/get with explicit ids', () => {
    const body = buildContactGetRequest({ accountId: 'c', contactId: 'CC01' });
    const parsed = JSON.parse(body) as {
      using: string[];
      methodCalls: Array<[string, Record<string, unknown>, string]>;
    };
    expect(parsed.using).toContain('urn:ietf:params:jmap:contacts');
    expect(parsed.methodCalls).toHaveLength(1);
    expect(parsed.methodCalls[0]![0]).toBe('ContactCard/get');
    expect(parsed.methodCalls[0]![1]).toEqual({
      accountId: 'c',
      ids: ['CC01'],
      properties: ['id', 'name', 'emails', 'phones', 'organizations'],
    });
  });
});

// ──────────────────────────────────────────────────────────────────────
// parseContactGetResponse
// ──────────────────────────────────────────────────────────────────────

describe('parseContactGetResponse', () => {
  it('extracts a single contact from response', () => {
    const response = JSON.stringify({
      methodResponses: [
        [
          'ContactCard/get',
          {
            list: [
              {
                id: 'CC01',
                name: { full: 'Alice Smith', given: 'Alice', surname: 'Smith' },
                emails: { e1: { address: 'alice@example.com', label: 'work' } },
                phones: { p1: { number: '+1-555-0101', label: 'mobile' } },
                organizations: { o1: { name: 'Acme Corp', title: 'Engineer' } },
              },
            ],
          },
          '0',
        ],
      ],
    });
    const result = parseContactGetResponse(response);
    expect(result.id).toBe('CC01');
    expect(result.name?.full).toBe('Alice Smith');
    expect(result.emails![0]!.address).toBe('alice@example.com');
  });

  it('throws when contact is not found (empty list)', () => {
    const response = JSON.stringify({
      methodResponses: [
        ['ContactCard/get', { list: [] }, '0'],
      ],
    });
    expect(() => parseContactGetResponse(response)).toThrow();
  });
});

// ──────────────────────────────────────────────────────────────────────
// fetchContactList
// ──────────────────────────────────────────────────────────────────────

describe('fetchContactList', () => {
  it('fetches and parses contacts', async () => {
    const responseBody = JSON.stringify({
      methodResponses: [
        ['AddressBook/get', { list: [{ id: 'AB01' }] }, '0'],
        ['ContactCard/query', { ids: ['CC01'], total: 1 }, '1'],
        [
          'ContactCard/get',
          {
            list: [
              {
                id: 'CC01',
                name: { full: 'Alice Smith' },
                emails: { e1: { address: 'alice@example.com' } },
              },
            ],
          },
          '2',
        ],
      ],
    });
    const fetchSpy = makeFetchSpy(responseBody);
    const result = await fetchContactList({
      baseUrl: 'https://sw-mail.example.net',
      getAuthToken: () => 'tok',
      fetch: fetchSpy,
      session: SAMPLE_SESSION,
    });
    expect(result.contacts).toHaveLength(1);
    expect(result.contacts[0]!.name?.full).toBe('Alice Smith');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('throws unauthorized when no token', async () => {
    try {
      await fetchContactList({
        baseUrl: 'https://sw-mail.example.net',
        getAuthToken: () => null,
        session: SAMPLE_SESSION,
      });
      expect.fail('should throw');
    } catch (e) {
      expect((e as ToolError).code).toBe('unauthorized');
    }
  });

  it('throws on HTTP error', async () => {
    const fetchSpy = makeFetchSpy('', { status: 500, statusText: 'Internal Server Error' });
    try {
      await fetchContactList({
        baseUrl: 'https://sw-mail.example.net',
        getAuthToken: () => 'tok',
        fetch: fetchSpy,
        session: SAMPLE_SESSION,
      });
      expect.fail('should throw');
    } catch (e) {
      expect((e as ToolError).code).toBe('jmap_http_error');
    }
  });
});

// ──────────────────────────────────────────────────────────────────────
// fetchContactGet
// ──────────────────────────────────────────────────────────────────────

describe('fetchContactGet', () => {
  it('fetches and parses a single contact', async () => {
    const responseBody = JSON.stringify({
      methodResponses: [
        [
          'ContactCard/get',
          {
            list: [
              {
                id: 'CC01',
                name: { full: 'Alice Smith' },
              },
            ],
          },
          '0',
        ],
      ],
    });
    const fetchSpy = makeFetchSpy(responseBody);
    const result = await fetchContactGet({
      baseUrl: 'https://sw-mail.example.net',
      getAuthToken: () => 'tok',
      fetch: fetchSpy,
      session: SAMPLE_SESSION,
      contactId: 'CC01',
    });
    expect(result.id).toBe('CC01');
    expect(result.name?.full).toBe('Alice Smith');
  });

  it('throws unauthorized when no token', async () => {
    try {
      await fetchContactGet({
        baseUrl: 'https://sw-mail.example.net',
        getAuthToken: () => null,
        session: SAMPLE_SESSION,
        contactId: 'CC01',
      });
      expect.fail('should throw');
    } catch (e) {
      expect((e as ToolError).code).toBe('unauthorized');
    }
  });
});
