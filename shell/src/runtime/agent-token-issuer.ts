/**
 * AgentTokenIssuer — pluggable contract for agent token lifecycle.
 *
 * Implementations manage issuing, revoking, listing, and introspecting
 * short-lived credentials that agents use to authenticate against the
 * mail server. The shell ships no implementation in this file — this is
 * pure types. The production implementation (StalwartTokenIssuer) lives
 * in a separate module (Task 9).
 */

// ── Result types ────────────────────────────────────────────────────

/** Returned to the caller immediately after token issuance. */
export type IssuedToken = {
  readonly tokenId: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly expiresAt: string;
};

/** Summary info about a previously issued token (no secret). */
export type AgentTokenInfo = {
  readonly tokenId: string;
  readonly name: string;
  readonly scopes: readonly string[];
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly revoked: boolean;
};

/**
 * Result of introspecting a bearer token. `null` means "token not
 * recognised at all"; `{ active: false, ... }` means "recognised but
 * expired or revoked".
 */
export type IntrospectionResult = {
  readonly active: boolean;
  readonly agentId: string;
  readonly name: string;
  readonly scopes: readonly string[];
} | null;

// ── Interface ───────────────────────────────────────────────────────

export interface AgentTokenIssuer {
  /** Issue a new short-lived agent token. */
  issueToken(opts: {
    readonly name: string;
    readonly scopes: readonly string[];
    readonly lifetimeSec: number;
  }): Promise<IssuedToken>;

  /** Revoke a previously issued token by ID. */
  revokeToken(tokenId: string): Promise<void>;

  /** List all tokens issued by the current user. */
  listTokens(): Promise<readonly AgentTokenInfo[]>;

  /** Introspect a bearer token (RFC 7662-style). */
  introspectToken(bearerToken: string): Promise<IntrospectionResult>;
}
