/**
 * StalwartApiKeyIssuer — agent token lifecycle via Stalwart API keys
 * (PR 39 / D-058).
 *
 * Replaces the OAuth `client_credentials` flow (PR 36) which Stalwart
 * stores as stateless tokens with no list/per-token-revoke surface.
 * API keys are Stalwart's managed-resource type: each is an `ApiKey`
 * record with an id, description, expiry, and a Replace-mode
 * permission set we derive from the agent's iarsma scopes.
 *
 * Crucially:
 *   - `x:ApiKey/query + x:ApiKey/get` returns every key for the
 *     authenticated principal. Cross-device list is automatic — no
 *     IDB sync, no separate metadata store. Stalwart is the source
 *     of truth.
 *   - `x:ApiKey/set destroy` revokes a single key by id from any
 *     client. Kill-switch works from a fresh browser session.
 *   - The returned `secret` IS the JMAP bearer the agent presents.
 *     Same secret authorises JMAP method calls, gated by the
 *     Replace-mode permissions we set on the key.
 *
 * Permission mapping (scope → JMAP method names) is duplicated from
 * mcp-server/src/stalwart-permissions.ts because the shell can't import
 * from mcp-server. Keep them in sync — drift means the issued key
 * won't have the permissions iarsma scope strings imply.
 */

import type {
  AgentTokenIssuer,
  AgentTokenInfo,
  IntrospectionResult,
  IssuedToken,
} from './agent-token-issuer.js';

// ── Options ───────────────────────────────────────────────────────

export type StalwartApiKeyIssuerOptions = {
  /** JMAP endpoint URL — typically `${baseUrl}/jmap/`. */
  readonly jmapUrl: string;
  /** Bearer the webmail uses to talk to Stalwart on the user's behalf. */
  readonly userToken: string;
  /** Account ID for the principal. Resolved via session — typically `c`. */
  readonly accountId: string;
  /** Override fetch for tests. */
  readonly fetch?: typeof fetch;
  /** Override clock for tests. Returns epoch ms. */
  readonly now?: () => number;
};

// ── Scope → permission map (kept in sync with mcp-server) ────────

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

function scopesToPermissions(
  scopes: readonly string[],
): Record<string, boolean> {
  const perms = { ...BASE_PERMISSIONS };
  for (const scope of scopes) {
    const map = SCOPE_PERMISSIONS[scope];
    if (map !== undefined) Object.assign(perms, map);
  }
  return perms;
}

/**
 * Reverse-map: given the permission set on a Stalwart ApiKey, infer
 * which iarsma scopes it covers. Used by listTokens() to populate
 * the AgentTokenInfo.scopes field from the server-side record.
 *
 * A scope is "covered" iff every permission in its bundle is present
 * in the key's permission map. Loose match (extras don't disqualify)
 * because the API key creation flow may grow new permissions over time.
 */
function permissionsToScopes(
  permissions: Readonly<Record<string, boolean>>,
): string[] {
  const scopes: string[] = [];
  for (const [scope, required] of Object.entries(SCOPE_PERMISSIONS)) {
    const allPresent = Object.entries(required).every(
      ([perm, want]) => permissions[perm] === want,
    );
    if (allPresent) scopes.push(scope);
  }
  return scopes;
}

// ── JMAP wire-shape types ─────────────────────────────────────────

type ApiKeyPermissionsField =
  | { readonly '@type': 'Inherit' }
  | { readonly '@type': 'Disable'; readonly permissions: Record<string, boolean> }
  | { readonly '@type': 'Replace'; readonly permissions: Record<string, boolean> };

type ApiKeyRecord = {
  readonly id: string;
  readonly description: string;
  readonly createdAt: string;
  readonly expiresAt: string | null;
  readonly permissions: ApiKeyPermissionsField;
  readonly secret?: string;
};

type JmapResponse = {
  readonly methodResponses: ReadonlyArray<[string, Record<string, unknown>, string]>;
};

// ── Factory ───────────────────────────────────────────────────────

export function stalwartApiKeyIssuer(
  opts: StalwartApiKeyIssuerOptions,
): AgentTokenIssuer {
  const {
    jmapUrl,
    userToken,
    accountId,
    fetch: fetchFn = globalThis.fetch,
    now = Date.now,
  } = opts;

  async function jmapCall(methodCalls: unknown[]): Promise<JmapResponse> {
    const res = await fetchFn(jmapUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${userToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        using: ['urn:ietf:params:jmap:core', 'urn:stalwart:jmap'],
        methodCalls,
      }),
    });
    if (!res.ok) {
      throw new Error(`Stalwart JMAP ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as JmapResponse;
  }

  function isoOrEpoch(value: string | null, fallbackMs: number): string {
    return value ?? new Date(fallbackMs).toISOString();
  }

  return {
    async issueToken({ name, scopes, lifetimeSec }): Promise<IssuedToken> {
      const expiresAtMs = now() + lifetimeSec * 1000;
      const expiresAt = new Date(expiresAtMs).toISOString();
      const permissions = scopesToPermissions(scopes);

      const json = await jmapCall([
        [
          'x:ApiKey/set',
          {
            accountId,
            create: {
              c0: {
                description: name,
                expiresAt,
                permissions: { '@type': 'Replace', permissions },
              },
            },
          },
          '0',
        ],
      ]);

      const resp = json.methodResponses[0]?.[1];
      const created =
        (resp?.created as Record<string, ApiKeyRecord> | undefined)?.c0;
      if (created === undefined) {
        const notCreated = (resp?.notCreated as Record<string, { description?: string; type?: string }> | undefined)?.c0;
        throw new Error(
          `Stalwart x:ApiKey/set create failed: ${notCreated?.description ?? notCreated?.type ?? 'unknown'}`,
        );
      }
      if (created.secret === undefined || created.secret.length === 0) {
        throw new Error('Stalwart x:ApiKey/set returned no secret on create');
      }

      return {
        tokenId: created.id,
        clientId: created.id,
        clientSecret: created.secret,
        expiresAt: isoOrEpoch(created.expiresAt, expiresAtMs),
      };
    },

    async revokeToken(tokenId: string): Promise<void> {
      const json = await jmapCall([
        ['x:ApiKey/set', { accountId, destroy: [tokenId] }, '0'],
      ]);
      const resp = json.methodResponses[0]?.[1];
      const destroyed = resp?.destroyed as string[] | undefined;
      const notDestroyed = resp?.notDestroyed as
        | Record<string, { description?: string; type?: string }>
        | undefined;
      if (destroyed?.includes(tokenId) === true) return;
      const reason = notDestroyed?.[tokenId];
      throw new Error(
        `Stalwart x:ApiKey/set destroy failed for ${tokenId}: ${reason?.description ?? reason?.type ?? 'unknown'}`,
      );
    },

    async listTokens(): Promise<readonly AgentTokenInfo[]> {
      const json = await jmapCall([
        ['x:ApiKey/query', { accountId }, '0'],
        [
          'x:ApiKey/get',
          {
            accountId,
            '#ids': {
              resultOf: '0',
              name: 'x:ApiKey/query',
              path: '/ids',
            },
          },
          '1',
        ],
      ]);

      const getResp = json.methodResponses.find(
        (mr) => mr[0] === 'x:ApiKey/get',
      )?.[1];
      const list = (getResp?.list as readonly ApiKeyRecord[] | undefined) ?? [];

      const nowMs = now();
      return list.map((rec): AgentTokenInfo => {
        const permsField = rec.permissions;
        const scopes =
          permsField['@type'] === 'Replace'
            ? permissionsToScopes(permsField.permissions)
            : [];
        const expiresAt =
          rec.expiresAt ??
          // Stalwart returns null when the key never expires. Surface
          // that as a far-future ISO so the UI's expiry-based status
          // logic doesn't false-positive "expired".
          new Date(nowMs + 365 * 100 * 24 * 60 * 60 * 1000).toISOString();
        return {
          tokenId: rec.id,
          name: rec.description,
          scopes,
          issuedAt: rec.createdAt,
          expiresAt,
          revoked: false,
        };
      });
    },

    async introspectToken(_bearerToken: string): Promise<IntrospectionResult> {
      // API keys are not introspectable through the OAuth surface; the
      // bearer itself IS the JMAP credential and Stalwart validates it
      // on every method call. The MCP server's new validation path
      // (PR 39 / D-058) calls JMAP `/.well-known/jmap` and treats a
      // 200 response as "valid". This issuer has no work to do.
      return null;
    },
  };
}
