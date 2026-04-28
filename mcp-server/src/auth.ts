/**
 * Bearer-token + scope extraction for MCP requests.
 *
 * Phase 0: a deliberately simple implementation. The token is treated as
 * an opaque identifier and the agent's scope set is read from a signed
 * claims source (or, in dev/test, from an `X-Iarsma-Scopes` header).
 *
 * Phase 1+: real OIDC introspection against Stalwart's OAuth provider,
 * with token caching and revocation checks.
 *
 * The auth layer never decides whether an action is *allowed* — it only
 * surfaces the agent's identity + scopes. The dispatch layer does the
 * scope check via `hasAllScopes` from `scope-filter.ts`.
 */

import { makeScopeSet, type ScopeSet } from './scope-filter.js';

export type AgentIdentity = {
  /** Stable identifier for the agent. Used in audit log entries. */
  readonly id: string;
  /** Human-readable name for the agent. May not be stable. */
  readonly name?: string;
  /** Scope set granted to this agent. */
  readonly scopes: ScopeSet;
};

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * Extract an agent identity from request-like headers.
 *
 * Headers expected:
 *   - `authorization: Bearer <token>`  (required)
 *   - `x-iarsma-scopes: a,b,c`         (Phase 0 dev/test only — Phase 1+ will
 *                                        introspect the bearer token instead)
 *   - `x-iarsma-agent-id: <id>`        (optional; Phase 0 dev/test only)
 *
 * The header type is `Headers`-like (any object with case-insensitive `get`).
 */
export function extractIdentity(headers: HeadersLike): AgentIdentity {
  const authHeader = headerOf(headers, 'authorization');
  if (authHeader === undefined) {
    throw new AuthError('Missing Authorization header.');
  }
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    throw new AuthError('Authorization header must use Bearer scheme.');
  }
  const token = authHeader.slice('bearer '.length).trim();
  if (token.length === 0) {
    throw new AuthError('Empty bearer token.');
  }

  const scopesHeader = headerOf(headers, 'x-iarsma-scopes');
  const scopes = scopesHeader === undefined
    ? makeScopeSet([])
    : makeScopeSet(scopesHeader.split(','));

  const agentIdHeader = headerOf(headers, 'x-iarsma-agent-id');
  // The bearer token is the canonical id when no explicit agent id is provided.
  const id = agentIdHeader ?? token;

  return { id, scopes };
}

// ──────────────────────────────────────────────────────────────────────────
// Header helpers
// ──────────────────────────────────────────────────────────────────────────

export interface HeadersLike {
  get(key: string): string | null;
}

/** Read a header in a case-insensitive way. Accepts both `Headers` and plain records. */
function headerOf(headers: HeadersLike, key: string): string | undefined {
  const value = headers.get(key);
  return value === null ? undefined : value;
}

/**
 * Wrap a plain object into a HeadersLike. Useful in tests and when integrating
 * with frameworks that don't ship a `Headers` instance.
 */
export function headersFromObject(obj: Record<string, string | undefined>): HeadersLike {
  const lower = new Map<string, string>();
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) lower.set(k.toLowerCase(), v);
  }
  return {
    get(key: string): string | null {
      return lower.get(key.toLowerCase()) ?? null;
    },
  };
}
