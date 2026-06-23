/**
 * Maps Iarsma agent scopes to Stalwart JMAP permission names.
 *
 * When Iarsma issues an agent token, it creates a Stalwart API key
 * with `Replace` mode permissions matching the agent's scopes. This
 * gives defense-in-depth: even if the agent secret leaks and someone
 * bypasses the MCP server, Stalwart itself enforces the boundary.
 *
 * The permission names come from Stalwart's `/api/account/auth`
 * response and map 1:1 to the `x:ApiKey/set` create payload.
 */

const BASE_PERMISSIONS: Record<string, boolean> = {
  authenticate: true,
  jmapCoreEcho: true,
};

const SCOPE_PERMISSIONS: Readonly<Record<string, Record<string, boolean>>> = {
  'mail:read': {
    jmapMailboxGet: true,
    jmapMailboxQuery: true,
    jmapMailboxChanges: true,
    jmapMailboxQueryChanges: true,
    jmapEmailGet: true,
    jmapEmailQuery: true,
    jmapEmailChanges: true,
    jmapEmailQueryChanges: true,
    jmapThreadGet: true,
    jmapThreadChanges: true,
    jmapIdentityGet: true,
    jmapIdentityChanges: true,
    jmapSearchSnippetGet: true,
    jmapBlobGet: true,
  },
  'mail:draft': {
    jmapEmailCreate: true,
    jmapEmailUpdate: true,
    jmapBlobUpload: true,
  },
  'mail:send': {
    jmapEmailCreate: true,
    jmapEmailSubmissionCreate: true,
    jmapEmailSubmissionGet: true,
    jmapBlobUpload: true,
    emailSend: true,
  },
  'mail:modify': {
    jmapEmailUpdate: true,
  },
  'mail:delete': {
    jmapEmailDestroy: true,
  },
  'mail:mailbox': {
    jmapMailboxCreate: true,
    jmapMailboxUpdate: true,
    jmapMailboxDestroy: true,
  },
};

export function scopesToStalwartPermissions(
  scopes: readonly string[],
): Record<string, boolean> {
  const perms = { ...BASE_PERMISSIONS };
  for (const scope of scopes) {
    const scopePerms = SCOPE_PERMISSIONS[scope];
    if (scopePerms !== undefined) {
      Object.assign(perms, scopePerms);
    }
  }
  return perms;
}

export type StalwartApiKeyResult = {
  readonly id: string;
  readonly secret: string;
};

export async function createStalwartApiKey(opts: {
  readonly jmapUrl: string;
  readonly userToken: string;
  readonly description: string;
  readonly scopes: readonly string[];
  readonly fetch?: typeof fetch;
}): Promise<StalwartApiKeyResult> {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const permissions = scopesToStalwartPermissions(opts.scopes);

  const body = JSON.stringify({
    using: ['urn:ietf:params:jmap:core', 'urn:stalwart:jmap'],
    methodCalls: [
      [
        'x:ApiKey/set',
        {
          create: {
            c0: {
              description: opts.description,
              permissions: {
                '@type': 'Replace',
                permissions,
              },
            },
          },
        },
        '0',
      ],
    ],
  });

  const res = await fetchImpl(opts.jmapUrl, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${opts.userToken}`,
      'content-type': 'application/json',
    },
    body,
  });

  if (!res.ok) {
    throw new Error(`Stalwart JMAP returned ${res.status}`);
  }

  const json = (await res.json()) as {
    methodResponses: Array<[string, Record<string, unknown>, string]>;
  };
  const resp = json.methodResponses[0]?.[1];
  const created = (resp?.created as Record<string, { id: string; secret: string }> | undefined)?.c0;
  if (created === undefined) {
    const notCreated = (resp?.notCreated as Record<string, { description?: string }> | undefined)?.c0;
    throw new Error(
      `Stalwart API key creation failed: ${notCreated?.description ?? 'unknown error'}`,
    );
  }

  return { id: created.id, secret: created.secret };
}

export async function destroyStalwartApiKey(opts: {
  readonly jmapUrl: string;
  readonly userToken: string;
  readonly keyId: string;
  readonly fetch?: typeof fetch;
}): Promise<void> {
  const fetchImpl = opts.fetch ?? globalThis.fetch;

  const body = JSON.stringify({
    using: ['urn:ietf:params:jmap:core', 'urn:stalwart:jmap'],
    methodCalls: [
      ['x:ApiKey/set', { destroy: [opts.keyId] }, '0'],
    ],
  });

  const res = await fetchImpl(opts.jmapUrl, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${opts.userToken}`,
      'content-type': 'application/json',
    },
    body,
  });

  if (!res.ok) {
    throw new Error(`Stalwart JMAP returned ${res.status}`);
  }
}
