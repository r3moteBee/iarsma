import { describe, expect, it, vi } from 'vitest';
import { stalwartApiKeyIssuer } from '../stalwart-apikey-issuer.js';

const JMAP_URL = 'https://sw-mail.example.test/jmap/';
const USER = 'user-bearer-abc';
const ACCT = 'c';

type Route = (init: RequestInit | undefined) => Promise<Response> | Response;

function makeFetch(handler: Route): typeof fetch {
  return vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url !== JMAP_URL) throw new Error(`unmocked fetch: ${url}`);
    return handler(init);
  }) as unknown as typeof fetch;
}

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function bodyOf(init: RequestInit | undefined): {
  using: string[];
  methodCalls: Array<[string, Record<string, unknown>, string]>;
} {
  return JSON.parse(String(init?.body ?? '{}'));
}

const FIXED_NOW = Date.parse('2026-06-06T12:00:00Z');

describe('stalwartApiKeyIssuer.issueToken', () => {
  it('POSTs x:ApiKey/set create with Replace permissions derived from scopes', async () => {
    let received: ReturnType<typeof bodyOf> | undefined;
    const fetchFn = makeFetch((init) => {
      received = bodyOf(init);
      return jsonRes({
        methodResponses: [
          ['x:ApiKey/set', {
            created: {
              c0: {
                id: 'apikey-1',
                description: 'my-agent',
                createdAt: '2026-06-06T12:00:00Z',
                expiresAt: '2027-06-06T12:00:00Z',
                permissions: { '@type': 'Replace', permissions: {} },
                secret: 'API_zzz',
              },
            },
          }, '0'],
        ],
      });
    });
    const issuer = stalwartApiKeyIssuer({
      jmapUrl: JMAP_URL,
      userToken: USER,
      accountId: ACCT,
      fetch: fetchFn,
      now: () => FIXED_NOW,
    });
    const result = await issuer.issueToken({
      name: 'my-agent',
      scopes: ['mail:read', 'mail:send'],
      lifetimeSec: 365 * 24 * 60 * 60,
    });
    expect(result.tokenId).toBe('apikey-1');
    expect(result.clientId).toBe('apikey-1');
    expect(result.clientSecret).toBe('API_zzz');
    expect(result.expiresAt).toBe('2027-06-06T12:00:00Z');

    // Wire-format spot-checks.
    expect(received?.using).toContain('urn:stalwart:jmap');
    const [method, args] = received!.methodCalls[0]!;
    expect(method).toBe('x:ApiKey/set');
    const created = (args.create as Record<string, Record<string, unknown>>).c0!;
    expect(created.description).toBe('my-agent');
    const perms = (created.permissions as { permissions: Record<string, boolean> }).permissions;
    // mail:read perms present
    expect(perms.jmapEmailGet).toBe(true);
    expect(perms.jmapMailboxQuery).toBe(true);
    // mail:send perms present
    expect(perms.jmapEmailSubmissionCreate).toBe(true);
    expect(perms.emailSend).toBe(true);
    // base perms present
    expect(perms.authenticate).toBe(true);
    expect(perms.jmapCoreEcho).toBe(true);
    // mail:delete perms absent
    expect(perms.jmapEmailDestroy).toBeUndefined();
  });

  it('throws when Stalwart returns notCreated', async () => {
    const fetchFn = makeFetch(() => jsonRes({
      methodResponses: [
        ['x:ApiKey/set', {
          notCreated: {
            c0: { type: 'overQuota', description: 'too many keys' },
          },
        }, '0'],
      ],
    }));
    const issuer = stalwartApiKeyIssuer({
      jmapUrl: JMAP_URL,
      userToken: USER,
      accountId: ACCT,
      fetch: fetchFn,
      now: () => FIXED_NOW,
    });
    await expect(
      issuer.issueToken({ name: 'x', scopes: ['mail:read'], lifetimeSec: 60 }),
    ).rejects.toThrow(/too many keys/);
  });
});

describe('stalwartApiKeyIssuer.listTokens', () => {
  it('calls x:ApiKey/query + x:ApiKey/get and maps records back to AgentTokenInfo', async () => {
    const fetchFn = makeFetch(() => jsonRes({
      methodResponses: [
        ['x:ApiKey/query', { ids: ['k1', 'k2'] }, '0'],
        ['x:ApiKey/get', {
          list: [
            {
              id: 'k1',
              description: 'reader',
              createdAt: '2026-06-01T00:00:00Z',
              expiresAt: '2027-06-01T00:00:00Z',
              permissions: {
                '@type': 'Replace',
                permissions: {
                  authenticate: true,
                  jmapCoreEcho: true,
                  jmapEmailGet: true,
                  jmapEmailQuery: true,
                  jmapEmailChanges: true,
                  jmapEmailQueryChanges: true,
                  jmapMailboxGet: true,
                  jmapMailboxQuery: true,
                  jmapMailboxChanges: true,
                  jmapMailboxQueryChanges: true,
                  jmapThreadGet: true,
                  jmapThreadChanges: true,
                  jmapIdentityGet: true,
                  jmapIdentityChanges: true,
                  jmapSearchSnippetGet: true,
                  jmapBlobGet: true,
                },
              },
            },
            {
              id: 'k2',
              description: 'sender',
              createdAt: '2026-06-02T00:00:00Z',
              expiresAt: null,
              permissions: { '@type': 'Inherit' },
            },
          ],
        }, '1'],
      ],
    }));
    const issuer = stalwartApiKeyIssuer({
      jmapUrl: JMAP_URL,
      userToken: USER,
      accountId: ACCT,
      fetch: fetchFn,
      now: () => FIXED_NOW,
    });
    const list = await issuer.listTokens();
    expect(list).toHaveLength(2);

    const reader = list.find((t) => t.tokenId === 'k1')!;
    expect(reader.name).toBe('reader');
    expect(reader.scopes).toContain('mail:read');
    expect(reader.scopes).not.toContain('mail:send');
    expect(reader.expiresAt).toBe('2027-06-01T00:00:00Z');
    expect(reader.revoked).toBe(false);

    const sender = list.find((t) => t.tokenId === 'k2')!;
    expect(sender.name).toBe('sender');
    // Inherit-mode keys can't be inferred to specific scopes.
    expect(sender.scopes).toEqual([]);
    // Null expiry → far-future placeholder, not "expired now".
    expect(Date.parse(sender.expiresAt)).toBeGreaterThan(FIXED_NOW);
  });

  it('returns an empty list when query returns no ids', async () => {
    const fetchFn = makeFetch(() => jsonRes({
      methodResponses: [
        ['x:ApiKey/query', { ids: [] }, '0'],
        ['x:ApiKey/get', { list: [] }, '1'],
      ],
    }));
    const issuer = stalwartApiKeyIssuer({
      jmapUrl: JMAP_URL,
      userToken: USER,
      accountId: ACCT,
      fetch: fetchFn,
      now: () => FIXED_NOW,
    });
    expect(await issuer.listTokens()).toEqual([]);
  });
});

describe('stalwartApiKeyIssuer.revokeToken', () => {
  it('calls x:ApiKey/set destroy and returns on success', async () => {
    let received: ReturnType<typeof bodyOf> | undefined;
    const fetchFn = makeFetch((init) => {
      received = bodyOf(init);
      return jsonRes({
        methodResponses: [
          ['x:ApiKey/set', { destroyed: ['k1'] }, '0'],
        ],
      });
    });
    const issuer = stalwartApiKeyIssuer({
      jmapUrl: JMAP_URL,
      userToken: USER,
      accountId: ACCT,
      fetch: fetchFn,
    });
    await expect(issuer.revokeToken('k1')).resolves.toBeUndefined();
    const call = received!.methodCalls[0]!;
    const args = call[1];
    expect((args.destroy as string[])).toEqual(['k1']);
  });

  it('throws with the not-destroyed reason when Stalwart refuses', async () => {
    const fetchFn = makeFetch(() => jsonRes({
      methodResponses: [
        ['x:ApiKey/set', {
          notDestroyed: { k1: { type: 'forbidden', description: 'not yours' } },
        }, '0'],
      ],
    }));
    const issuer = stalwartApiKeyIssuer({
      jmapUrl: JMAP_URL,
      userToken: USER,
      accountId: ACCT,
      fetch: fetchFn,
    });
    await expect(issuer.revokeToken('k1')).rejects.toThrow(/not yours/);
  });
});

describe('stalwartApiKeyIssuer.introspectToken', () => {
  it('always returns null — API keys are validated by JMAP, not introspection', async () => {
    const fetchFn = makeFetch(() => {
      throw new Error('introspectToken must not call out');
    });
    const issuer = stalwartApiKeyIssuer({
      jmapUrl: JMAP_URL,
      userToken: USER,
      accountId: ACCT,
      fetch: fetchFn,
    });
    expect(await issuer.introspectToken('whatever')).toBeNull();
  });
});

// ── Scope→permission map assertions (Task 6) ─────────────────────────

/** Helper: issue a token with given scopes and return the permissions
 *  that were sent to Stalwart on the wire. */
async function permissionsForScopes(scopes: readonly string[]): Promise<Record<string, boolean>> {
  let received: ReturnType<typeof bodyOf> | undefined;
  const fetchFn = makeFetch((init) => {
    received = bodyOf(init);
    return jsonRes({
      methodResponses: [
        ['x:ApiKey/set', {
          created: {
            c0: {
              id: 'apikey-test',
              description: 'test',
              createdAt: '2026-06-06T12:00:00Z',
              expiresAt: '2027-06-06T12:00:00Z',
              permissions: { '@type': 'Replace', permissions: {} },
              secret: 'API_test_secret',
            },
          },
        }, '0'],
      ],
    });
  });
  const issuer = stalwartApiKeyIssuer({
    jmapUrl: JMAP_URL,
    userToken: USER,
    accountId: ACCT,
    fetch: fetchFn,
    now: () => FIXED_NOW,
  });
  await issuer.issueToken({ name: 'test', scopes, lifetimeSec: 3600 });
  const [, args] = received!.methodCalls[0]!;
  const created = (args.create as Record<string, Record<string, unknown>>).c0!;
  return (created.permissions as { permissions: Record<string, boolean> }).permissions;
}

describe('SCOPE_PERMISSIONS map — mail:label scopes (Task 6)', () => {
  it('mail:label:read maps to jmapFileNodeGet + jmapBlobGet only (FileNode perms)', async () => {
    const perms = await permissionsForScopes(['mail:label:read']);
    expect(perms.jmapFileNodeGet).toBe(true);
    expect(perms.jmapBlobGet).toBe(true);
    // write perms absent
    expect(perms.jmapFileNodeCreate).toBeUndefined();
    expect(perms.jmapFileNodeUpdate).toBeUndefined();
    expect(perms.jmapBlobUpload).toBeUndefined();
    expect(perms.jmapFileNodeDestroy).toBeUndefined();
  });

  it('mail:label:write maps to FileNodeGet/Create/Update + BlobUpload/Get', async () => {
    const perms = await permissionsForScopes(['mail:label:write']);
    expect(perms.jmapFileNodeGet).toBe(true);
    expect(perms.jmapFileNodeCreate).toBe(true);
    expect(perms.jmapFileNodeUpdate).toBe(true);
    expect(perms.jmapBlobUpload).toBe(true);
    expect(perms.jmapBlobGet).toBe(true);
    // destroy absent — labels are never destroyed via the registry node
    expect(perms.jmapFileNodeDestroy).toBeUndefined();
  });

  it('mail:label:write does not include jmapEmailUpdate (comes from mail:modify)', async () => {
    const perms = await permissionsForScopes(['mail:label:write']);
    expect(perms.jmapEmailUpdate).toBeUndefined();
  });

  it('listTokens reverse-maps mail:label:read from Replace permissions', async () => {
    const fetchFn = makeFetch(() => jsonRes({
      methodResponses: [
        ['x:ApiKey/query', { ids: ['k-label-r'] }, '0'],
        ['x:ApiKey/get', {
          list: [
            {
              id: 'k-label-r',
              description: 'label-reader',
              createdAt: '2026-06-06T12:00:00Z',
              expiresAt: '2027-06-06T12:00:00Z',
              permissions: {
                '@type': 'Replace',
                permissions: {
                  authenticate: true,
                  jmapCoreEcho: true,
                  jmapFileNodeGet: true,
                  jmapBlobGet: true,
                },
              },
            },
          ],
        }, '1'],
      ],
    }));
    const issuer = stalwartApiKeyIssuer({
      jmapUrl: JMAP_URL,
      userToken: USER,
      accountId: ACCT,
      fetch: fetchFn,
      now: () => FIXED_NOW,
    });
    const list = await issuer.listTokens();
    const token = list.find((t) => t.tokenId === 'k-label-r')!;
    expect(token.scopes).toContain('mail:label:read');
    expect(token.scopes).not.toContain('mail:label:write');
  });

  it('listTokens reverse-maps mail:label:write from Replace permissions', async () => {
    const fetchFn = makeFetch(() => jsonRes({
      methodResponses: [
        ['x:ApiKey/query', { ids: ['k-label-w'] }, '0'],
        ['x:ApiKey/get', {
          list: [
            {
              id: 'k-label-w',
              description: 'label-writer',
              createdAt: '2026-06-06T12:00:00Z',
              expiresAt: '2027-06-06T12:00:00Z',
              permissions: {
                '@type': 'Replace',
                permissions: {
                  authenticate: true,
                  jmapCoreEcho: true,
                  jmapFileNodeGet: true,
                  jmapFileNodeCreate: true,
                  jmapFileNodeUpdate: true,
                  jmapBlobUpload: true,
                  jmapBlobGet: true,
                },
              },
            },
          ],
        }, '1'],
      ],
    }));
    const issuer = stalwartApiKeyIssuer({
      jmapUrl: JMAP_URL,
      userToken: USER,
      accountId: ACCT,
      fetch: fetchFn,
      now: () => FIXED_NOW,
    });
    const list = await issuer.listTokens();
    const token = list.find((t) => t.tokenId === 'k-label-w')!;
    expect(token.scopes).toContain('mail:label:write');
  });
});
