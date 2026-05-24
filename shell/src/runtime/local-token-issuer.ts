/**
 * LocalTokenIssuer — Iarsma-managed agent tokens.
 *
 * Generates opaque bearer tokens locally (crypto.randomUUID-based)
 * and stores them alongside metadata in the AgentMetadataStore (IDB).
 * No dependency on the mail server's OAuth2 features — works with any
 * JMAP server.
 *
 * Agents present these tokens to the MCP server. The MCP server
 * validates them against this store and uses the user's real OAuth
 * token to make JMAP calls on the agent's behalf.
 */

import type { AgentMetadataStore } from './agent-metadata-store.js';
import type {
  AgentTokenIssuer,
  AgentTokenInfo,
  IntrospectionResult,
  IssuedToken,
} from './agent-token-issuer.js';

export type LocalTokenIssuerOptions = {
  readonly metadataStore: AgentMetadataStore;
  readonly now?: () => number;
};

function generateSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function generateTokenId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `tok-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function localTokenIssuer(
  opts: LocalTokenIssuerOptions,
): AgentTokenIssuer {
  const { metadataStore, now = Date.now } = opts;

  return {
    async issueToken(tokenOpts): Promise<IssuedToken> {
      const tokenId = generateTokenId();
      const secret = generateSecret();
      const issuedAt = new Date(now()).toISOString();
      const expiresAt = new Date(
        now() + tokenOpts.lifetimeSec * 1000,
      ).toISOString();

      await metadataStore.save({
        tokenId,
        name: tokenOpts.name,
        scopes: [...tokenOpts.scopes],
        issuedAt,
        expiresAt,
        revoked: false,
        issuanceLogEntryHash: '',
        secret,
      });

      return {
        tokenId,
        clientId: tokenId,
        clientSecret: secret,
        expiresAt,
      };
    },

    async revokeToken(tokenId): Promise<void> {
      const meta = await metadataStore.get(tokenId);
      if (meta === null) {
        throw new Error(`Unknown token: ${tokenId}`);
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
      const all = await metadataStore.listAll();
      const match = all.find(
        (m) => m.secret === bearerToken && !m.revoked,
      );
      if (match === undefined) return null;
      const expired = new Date(match.expiresAt).getTime() < now();
      if (expired) return null;
      return {
        active: true,
        agentId: match.tokenId,
        name: match.name,
        scopes: match.scopes,
      };
    },
  };
}
