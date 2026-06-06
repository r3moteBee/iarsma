/**
 * File-based agent token store for the MCP server.
 *
 * Reads a JSON file mapping bearer secrets to agent identities +
 * scopes. The webmail UI generates tokens and shows the user a
 * snippet to add to this file. The MCP server reads the file on
 * startup and reloads on SIGHUP.
 *
 * File format (`tokens.json`):
 * ```json
 * [
 *   {
 *     "secret": "a1b2c3...",
 *     "name": "my-agent",
 *     "scopes": ["mail:read", "mail:send"],
 *     "tokenId": "uuid"
 *   }
 * ]
 * ```
 *
 * The file path is configured via `IARSMA_TOKENS_FILE` env var.
 * When unset, the MCP server falls back to the legacy single-token
 * mode (`IARSMA_MCP_HTTP_TOKEN`).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { makeScopeSet, type ScopeSet } from './scope-filter.js';

export type TokenEntry = {
  readonly secret: string;
  readonly name: string;
  readonly scopes: readonly string[];
  readonly tokenId: string;
  /** Stalwart API key for this agent's JMAP calls. Scoped to match
   *  the agent's permissions via Stalwart's Replace mode. */
  readonly stalwartApiKey?: string;
  /** Stalwart key ID for cleanup on revocation. */
  readonly stalwartKeyId?: string;
};

export type ResolvedIdentity = {
  readonly id: string;
  readonly name: string;
  readonly scopes: ScopeSet;
  readonly stalwartApiKey?: string;
};

export interface TokenStore {
  /**
   * Validate a bearer token and surface the agent identity.
   *
   * Returns `null` when the token is unknown / inactive / revoked /
   * expired. Implementations may issue network calls (e.g. Stalwart
   * introspection), so this is async.
   */
  resolve(bearerToken: string): Promise<ResolvedIdentity | null>;
  reload(): void;
  register(entry: TokenEntry): void;
  remove(tokenId: string): TokenEntry | null;
  list(): readonly TokenEntry[];
}

export function fileTokenStore(filePath: string): TokenStore {
  let entries: readonly TokenEntry[] = [];

  function load(): void {
    try {
      const raw = readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        // eslint-disable-next-line no-console
        console.warn(`[iarsma-mcp] tokens file is not an array: ${filePath}`);
        entries = [];
        return;
      }
      entries = parsed.filter(
        (e): e is TokenEntry =>
          e !== null &&
          typeof e === 'object' &&
          typeof (e as Record<string, unknown>).secret === 'string' &&
          typeof (e as Record<string, unknown>).name === 'string' &&
          Array.isArray((e as Record<string, unknown>).scopes),
      );
      // eslint-disable-next-line no-console
      console.error(
        `[iarsma-mcp] loaded ${entries.length} agent token(s) from ${filePath}`,
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        // eslint-disable-next-line no-console
        console.error(
          `[iarsma-mcp] tokens file not found: ${filePath} — no agent tokens configured`,
        );
        entries = [];
      } else {
        throw e;
      }
    }
  }

  load();

  return {
    async resolve(bearerToken: string): Promise<ResolvedIdentity | null> {
      const match = entries.find((e) => constantTimeEqual(e.secret, bearerToken));
      if (match === undefined) return null;
      return {
        id: match.tokenId,
        name: match.name,
        ...(match.stalwartApiKey !== undefined ? { stalwartApiKey: match.stalwartApiKey } : {}),
        scopes: makeScopeSet(match.scopes),
      };
    },
    reload(): void {
      load();
    },
    register(entry: TokenEntry): void {
      entries = [...entries, entry];
      save();
    },
    remove(tokenId: string): TokenEntry | null {
      const idx = entries.findIndex((e) => e.tokenId === tokenId);
      if (idx === -1) return null;
      const removed = entries[idx]!;
      entries = [...entries.slice(0, idx), ...entries.slice(idx + 1)];
      save();
      return removed;
    },
    list(): readonly TokenEntry[] {
      return entries;
    },
  };

  function save(): void {
    writeFileSync(filePath, JSON.stringify(entries, null, 2));
  }
}

export function singleTokenStore(
  secret: string,
  identity?: { name?: string; scopes?: readonly string[] },
): TokenStore {
  const resolved: ResolvedIdentity = {
    id: 'static-token',
    name: identity?.name ?? 'default-agent',
    scopes: makeScopeSet(identity?.scopes ?? []),
  };
  return {
    async resolve(bearerToken: string): Promise<ResolvedIdentity | null> {
      return constantTimeEqual(bearerToken, secret) ? resolved : null;
    },
    register(): void {},
    remove(): null { return null; },
    list(): readonly TokenEntry[] { return []; },
    reload(): void {},
  };
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
