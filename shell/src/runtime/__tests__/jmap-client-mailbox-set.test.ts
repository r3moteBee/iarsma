import { describe, expect, it, vi } from 'vitest';
import {
  buildMailboxCreateRequest,
  parseMailboxCreateResponse,
  fetchMailboxCreateCommit,
  buildMailboxUpdateRequest,
  parseMailboxUpdateResponse,
  fetchMailboxUpdateCommit,
} from '../jmap-client.js';

// ──────────────────────────────────────────────────────────────────────
// buildMailboxCreateRequest
// ──────────────────────────────────────────────────────────────────────

describe('buildMailboxCreateRequest', () => {
  it('builds a Mailbox/set create with name + parentId', () => {
    const body = buildMailboxCreateRequest({ accountId: 'c', params: { name: 'Projects', parentId: 'Mb-1' } });
    const p = JSON.parse(body);
    expect(p.methodCalls[0][0]).toBe('Mailbox/set');
    const create = p.methodCalls[0][1].create.n0;
    expect(create).toEqual({ name: 'Projects', parentId: 'Mb-1' });
  });
  it('omits parentId for a top-level folder', () => {
    const body = buildMailboxCreateRequest({ accountId: 'c', params: { name: 'Top' } });
    expect(JSON.parse(body).methodCalls[0][1].create.n0).toEqual({ name: 'Top' });
  });
  it('includes JMAP mail capabilities in using array', () => {
    const body = buildMailboxCreateRequest({ accountId: 'acc1', params: { name: 'Foo' } });
    const p = JSON.parse(body);
    expect(p.using).toContain('urn:ietf:params:jmap:core');
    expect(p.using).toContain('urn:ietf:params:jmap:mail');
  });
  it('sets the accountId on the method args', () => {
    const body = buildMailboxCreateRequest({ accountId: 'myacct', params: { name: 'X' } });
    const p = JSON.parse(body);
    expect(p.methodCalls[0][1].accountId).toBe('myacct');
  });
});

// ──────────────────────────────────────────────────────────────────────
// parseMailboxCreateResponse
// ──────────────────────────────────────────────────────────────────────

describe('parseMailboxCreateResponse', () => {
  it('returns mailboxId from created.n0.id', () => {
    const body = JSON.stringify({
      methodResponses: [
        ['Mailbox/set', { created: { n0: { id: 'Mb-new-1' } } }, '0'],
      ],
    });
    expect(parseMailboxCreateResponse(body)).toEqual({ mailboxId: 'Mb-new-1' });
  });

  it('throws mailbox_name_conflict on notCreated with duplicate-like description', () => {
    const body = JSON.stringify({
      methodResponses: [
        ['Mailbox/set', {
          notCreated: {
            n0: { type: 'invalidArguments', description: 'A mailbox with that name already exists' },
          },
        }, '0'],
      ],
    });
    expect(() => parseMailboxCreateResponse(body)).toThrow();
    try {
      parseMailboxCreateResponse(body);
    } catch (e) {
      expect((e as { code?: string }).code).toBe('mailbox_name_conflict');
    }
  });

  it('throws mailbox_set_failed on notCreated with non-conflict error', () => {
    const body = JSON.stringify({
      methodResponses: [
        ['Mailbox/set', {
          notCreated: {
            n0: { type: 'overQuota', description: 'Mailbox limit reached' },
          },
        }, '0'],
      ],
    });
    try {
      parseMailboxCreateResponse(body);
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as { code?: string }).code).toBe('mailbox_set_failed');
    }
  });

  it('throws jmap_parse_error when no result present', () => {
    const body = JSON.stringify({
      methodResponses: [
        ['Mailbox/set', {}, '0'],
      ],
    });
    try {
      parseMailboxCreateResponse(body);
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as { code?: string }).code).toBe('jmap_parse_error');
    }
  });
});

// ──────────────────────────────────────────────────────────────────────
// fetchMailboxCreateCommit
// ──────────────────────────────────────────────────────────────────────

const API_URL = 'https://jmap.example.test/api/';
const TOKEN = 'bearer-xyz';

const MOCK_SESSION = {
  username: 'user@example.test',
  apiUrl: API_URL,
  downloadUrl: '',
  uploadUrl: '',
  eventSourceUrl: '',
  state: 's1',
  primaryAccountIdMail: 'acct1',
};

function makeFetch(handler: (init: RequestInit | undefined) => Response): typeof fetch {
  return vi.fn(async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    return handler(init);
  }) as unknown as typeof fetch;
}

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('fetchMailboxCreateCommit', () => {
  it('POSTs Mailbox/set create and returns mailboxId', async () => {
    let captured: RequestInit | undefined;
    const fetchFn = makeFetch((init) => {
      captured = init;
      return jsonRes({
        methodResponses: [
          ['Mailbox/set', { created: { n0: { id: 'Mb-abc' } } }, '0'],
        ],
      });
    });
    const result = await fetchMailboxCreateCommit({
      baseUrl: 'https://jmap.example.test',
      getAuthToken: () => TOKEN,
      fetch: fetchFn,
      session: MOCK_SESSION,
      params: { name: 'Archive', parentId: 'Mb-root' },
    });
    expect(result).toEqual({ mailboxId: 'Mb-abc' });
    expect(captured?.method).toBe('POST');
    const sentBody = JSON.parse(String(captured?.body ?? '{}'));
    expect(sentBody.methodCalls[0][0]).toBe('Mailbox/set');
    expect(sentBody.methodCalls[0][1].create.n0).toEqual({ name: 'Archive', parentId: 'Mb-root' });
  });

  it('throws unauthorized when no token', async () => {
    const fetchFn = makeFetch(() => jsonRes({}));
    await expect(
      fetchMailboxCreateCommit({
        baseUrl: 'https://jmap.example.test',
        getAuthToken: () => null,
        fetch: fetchFn,
        session: MOCK_SESSION,
        params: { name: 'X' },
      }),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('throws jmap_http_error on non-ok HTTP response', async () => {
    const fetchFn = makeFetch(() => jsonRes({}, 500));
    await expect(
      fetchMailboxCreateCommit({
        baseUrl: 'https://jmap.example.test',
        getAuthToken: () => TOKEN,
        fetch: fetchFn,
        session: MOCK_SESSION,
        params: { name: 'Y' },
      }),
    ).rejects.toMatchObject({ code: 'jmap_http_error' });
  });
});

// ──────────────────────────────────────────────────────────────────────
// buildMailboxUpdateRequest
// ──────────────────────────────────────────────────────────────────────

describe('buildMailboxUpdateRequest', () => {
  it('builds a Mailbox/set update for rename', () => {
    const body = buildMailboxUpdateRequest({ accountId: 'c', params: { mailboxId: 'Mb-9', name: 'Renamed' } });
    const p = JSON.parse(body);
    expect(p.methodCalls[0][0]).toBe('Mailbox/set');
    expect(p.methodCalls[0][1].update).toEqual({ 'Mb-9': { name: 'Renamed' } });
  });
  it('includes JMAP mail capabilities in using array', () => {
    const body = buildMailboxUpdateRequest({ accountId: 'acc1', params: { mailboxId: 'Mb-1', name: 'Foo' } });
    const p = JSON.parse(body);
    expect(p.using).toContain('urn:ietf:params:jmap:core');
    expect(p.using).toContain('urn:ietf:params:jmap:mail');
  });
  it('sets the accountId on the method args', () => {
    const body = buildMailboxUpdateRequest({ accountId: 'myacct', params: { mailboxId: 'Mb-x', name: 'X' } });
    const p = JSON.parse(body);
    expect(p.methodCalls[0][1].accountId).toBe('myacct');
  });
});

// ──────────────────────────────────────────────────────────────────────
// parseMailboxUpdateResponse
// ──────────────────────────────────────────────────────────────────────

describe('parseMailboxUpdateResponse', () => {
  it('returns { updated: true } when mailboxId appears in updated', () => {
    const body = JSON.stringify({
      methodResponses: [
        ['Mailbox/set', { updated: { 'Mb-9': {} } }, '0'],
      ],
    });
    expect(parseMailboxUpdateResponse(body, 'Mb-9')).toEqual({ updated: true });
  });

  it('throws mailbox_name_conflict on notUpdated with duplicate-like description', () => {
    const body = JSON.stringify({
      methodResponses: [
        ['Mailbox/set', {
          notUpdated: {
            'Mb-9': { type: 'invalidArguments', description: 'A mailbox with that name already exists' },
          },
        }, '0'],
      ],
    });
    try {
      parseMailboxUpdateResponse(body, 'Mb-9');
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as { code?: string }).code).toBe('mailbox_name_conflict');
    }
  });

  it('throws mailbox_set_failed on notUpdated with non-conflict error', () => {
    const body = JSON.stringify({
      methodResponses: [
        ['Mailbox/set', {
          notUpdated: {
            'Mb-9': { type: 'forbidden', description: 'Not allowed' },
          },
        }, '0'],
      ],
    });
    try {
      parseMailboxUpdateResponse(body, 'Mb-9');
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as { code?: string }).code).toBe('mailbox_set_failed');
    }
  });

  it('throws jmap_parse_error when no result present', () => {
    const body = JSON.stringify({
      methodResponses: [
        ['Mailbox/set', {}, '0'],
      ],
    });
    try {
      parseMailboxUpdateResponse(body, 'Mb-9');
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as { code?: string }).code).toBe('jmap_parse_error');
    }
  });
});

// ──────────────────────────────────────────────────────────────────────
// fetchMailboxUpdateCommit
// ──────────────────────────────────────────────────────────────────────

describe('fetchMailboxUpdateCommit', () => {
  it('POSTs Mailbox/set update and returns { updated: true }', async () => {
    let captured: RequestInit | undefined;
    const fetchFn = makeFetch((init) => {
      captured = init;
      return jsonRes({
        methodResponses: [
          ['Mailbox/set', { updated: { 'Mb-9': {} } }, '0'],
        ],
      });
    });
    const result = await fetchMailboxUpdateCommit({
      baseUrl: 'https://jmap.example.test',
      getAuthToken: () => TOKEN,
      fetch: fetchFn,
      session: MOCK_SESSION,
      params: { mailboxId: 'Mb-9', name: 'Renamed' },
    });
    expect(result).toEqual({ updated: true });
    expect(captured?.method).toBe('POST');
    const sentBody = JSON.parse(String(captured?.body ?? '{}'));
    expect(sentBody.methodCalls[0][0]).toBe('Mailbox/set');
    expect(sentBody.methodCalls[0][1].update).toEqual({ 'Mb-9': { name: 'Renamed' } });
  });

  it('throws unauthorized when no token', async () => {
    const fetchFn = makeFetch(() => jsonRes({}));
    await expect(
      fetchMailboxUpdateCommit({
        baseUrl: 'https://jmap.example.test',
        getAuthToken: () => null,
        fetch: fetchFn,
        session: MOCK_SESSION,
        params: { mailboxId: 'Mb-9', name: 'Renamed' },
      }),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('throws jmap_http_error on non-ok HTTP response', async () => {
    const fetchFn = makeFetch(() => jsonRes({}, 500));
    await expect(
      fetchMailboxUpdateCommit({
        baseUrl: 'https://jmap.example.test',
        getAuthToken: () => TOKEN,
        fetch: fetchFn,
        session: MOCK_SESSION,
        params: { mailboxId: 'Mb-9', name: 'Renamed' },
      }),
    ).rejects.toMatchObject({ code: 'jmap_http_error' });
  });
});
