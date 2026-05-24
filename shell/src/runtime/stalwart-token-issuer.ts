/**
 * StalwartTokenIssuer — default AgentTokenIssuer backed by Stalwart's
 * OIDC endpoints.
 *
 * Uses OIDC discovery (`/.well-known/openid-configuration`) to locate
 * the token, revocation, and introspection endpoints. Endpoints are
 * discovered lazily on first use and cached for the lifetime of the
 * issuer instance.
 *
 * Token issuance uses the `client_credentials` OAuth 2.0 grant type.
 * Revocation follows RFC 7009, introspection follows RFC 7662.
 */

import type { AgentMetadataStore } from './agent-metadata-store.js';
import type {
  AgentTokenIssuer,
  AgentTokenInfo,
  IntrospectionResult,
  IssuedToken,
} from './agent-token-issuer.js';

// ── Options ───────────────────────────────────────────────────────

export type StalwartTokenIssuerOptions = {
  /** OIDC issuer URL, e.g. `https://sw-mail.r3motely.net`. */
  readonly issuerUrl: string;
  /** Bearer token for admin API calls. */
  readonly adminToken: string;
  /** Metadata store for local bookkeeping. */
  readonly metadataStore: AgentMetadataStore;
  /** Override `fetch` for tests. */
  readonly fetch?: typeof fetch;
  /** Override clock for tests. Returns epoch millis. */
  readonly now?: () => number;
};

// ── OIDC discovery types (subset) ─────────────────────────────────

type OidcEndpoints = {
  readonly tokenEndpoint: string;
  readonly revocationEndpoint: string;
  readonly introspectionEndpoint: string;
};

// ── Factory ───────────────────────────────────────────────────────

export function stalwartTokenIssuer(
  opts: StalwartTokenIssuerOptions,
): AgentTokenIssuer {
  const {
    issuerUrl,
    adminToken,
    metadataStore,
    fetch: fetchFn = globalThis.fetch,
    now = Date.now,
  } = opts;

  let endpointsPromise: Promise<OidcEndpoints> | null = null;

  // In-memory secret store — populated by issueToken, consumed by
  // revokeToken. Secrets never leave this closure. Revocation only
  // works within the same session that issued the token.
  const secrets = new Map<string, string>();

  // ── OIDC discovery (cached) ───────────────────────────────────

  async function discover(): Promise<OidcEndpoints> {
    const url = `${issuerUrl}/.well-known/openid-configuration`;
    const res = await fetchFn(url);
    if (!res.ok) {
      throw new Error(
        `OIDC discovery failed: ${res.status} ${res.statusText}`,
      );
    }
    const json = (await res.json()) as Record<string, unknown>;
    const tokenEndpoint = json['token_endpoint'];
    const revocationEndpoint = json['revocation_endpoint'];
    const introspectionEndpoint = json['introspection_endpoint'];

    if (
      typeof tokenEndpoint !== 'string' ||
      typeof revocationEndpoint !== 'string' ||
      typeof introspectionEndpoint !== 'string'
    ) {
      throw new Error(
        'OIDC discovery response missing required endpoints',
      );
    }

    return { tokenEndpoint, revocationEndpoint, introspectionEndpoint };
  }

  function getEndpoints(): Promise<OidcEndpoints> {
    if (endpointsPromise === null) {
      endpointsPromise = discover();
    }
    return endpointsPromise;
  }

  // ── Helpers ─────────────────────────────────────────────────────

  function generateTokenId(): string {
    if (
      typeof globalThis.crypto !== 'undefined' &&
      typeof globalThis.crypto.randomUUID === 'function'
    ) {
      return globalThis.crypto.randomUUID();
    }
    return `tok-${now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  // ── Interface implementation ────────────────────────────────────

  return {
    async issueToken(tokenOpts): Promise<IssuedToken> {
      const endpoints = await getEndpoints();

      const body = new URLSearchParams({
        grant_type: 'client_credentials',
        scope: tokenOpts.scopes.join(' '),
      });

      const res = await fetchFn(endpoints.tokenEndpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });

      if (!res.ok) {
        throw new Error(
          `Token issuance failed: ${res.status} ${res.statusText}`,
        );
      }

      const json = (await res.json()) as Record<string, unknown>;
      const accessToken = json['access_token'] as string;
      const expiresIn =
        typeof json['expires_in'] === 'number'
          ? json['expires_in']
          : tokenOpts.lifetimeSec;

      const tokenId = generateTokenId();
      const issuedAt = new Date(now()).toISOString();
      const expiresAt = new Date(now() + expiresIn * 1000).toISOString();

      // Persist metadata (no secret — that stays in-memory only).
      await metadataStore.save({
        tokenId,
        name: tokenOpts.name,
        scopes: [...tokenOpts.scopes],
        issuedAt,
        expiresAt,
        revoked: false,
        issuanceLogEntryHash: '',
      });

      // Keep the secret for same-session revocation.
      secrets.set(tokenId, accessToken);

      return {
        tokenId,
        clientId: tokenId,
        clientSecret: accessToken,
        expiresAt,
      };
    },

    async revokeToken(tokenId): Promise<void> {
      const endpoints = await getEndpoints();
      const meta = await metadataStore.get(tokenId);
      if (meta === null) {
        throw new Error(`Unknown token: ${tokenId}`);
      }

      const secret = secrets.get(tokenId);
      if (secret === undefined) {
        throw new Error(
          `Cannot revoke token ${tokenId}: secret not available (token was issued in a different session)`,
        );
      }

      const body = new URLSearchParams({
        token: secret,
        token_type_hint: 'access_token',
      });

      const res = await fetchFn(endpoints.revocationEndpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });

      if (!res.ok) {
        throw new Error(
          `Token revocation failed: ${res.status} ${res.statusText}`,
        );
      }

      await metadataStore.markRevoked(tokenId);
    },

    async listTokens(): Promise<readonly AgentTokenInfo[]> {
      const all = await metadataStore.listAll();
      return all.map(
        (m): AgentTokenInfo => ({
          tokenId: m.tokenId,
          name: m.name,
          scopes: m.scopes,
          issuedAt: m.issuedAt,
          expiresAt: m.expiresAt,
          revoked: m.revoked,
        }),
      );
    },

    async introspectToken(bearerToken): Promise<IntrospectionResult> {
      const endpoints = await getEndpoints();

      const body = new URLSearchParams({ token: bearerToken });

      const res = await fetchFn(endpoints.introspectionEndpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });

      if (!res.ok) {
        throw new Error(
          `Token introspection failed: ${res.status} ${res.statusText}`,
        );
      }

      const json = (await res.json()) as Record<string, unknown>;
      const active = json['active'] === true;

      if (!active) {
        return null;
      }

      const clientId = json['client_id'] as string;
      const scopeStr = (json['scope'] as string) ?? '';
      const scopes = scopeStr.split(' ').filter(Boolean);

      // Look up metadata to get the agent name.
      const meta = await metadataStore.get(clientId);
      const name = meta?.name ?? clientId;

      return {
        active: true,
        agentId: clientId,
        name,
        scopes,
      };
    },
  };
}
