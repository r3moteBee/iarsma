/**
 * Token + auth-state storage for the shell.
 *
 * Phase 0 backs storage with `sessionStorage` — tokens live for the
 * lifetime of the tab and are gone when the tab closes. The interface is
 * the IndexedDB-encrypted-blob shape the implementation plan calls for
 * (Phase 0 risk note: "encryption key needs an honest design"); the real
 * encrypted IndexedDB store lands in Phase 1+ behind this same interface.
 *
 * Two slots:
 *   - "tokens"  — the active OIDC token bundle (access / refresh / id /
 *                 expiry). Read on every `getAuthToken()` invocation.
 *   - "pkce"    — the in-flight PKCE state, keyed by the `state` value
 *                 we put in the auth URL. Cleared once the callback
 *                 either succeeds or is aborted.
 */

const TOKENS_KEY = 'iarsma.auth.tokens.v0';
const PKCE_KEY_PREFIX = 'iarsma.auth.pkce.v0:';

export type StoredTokens = {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly idToken?: string;
  /** Unix timestamp (ms) past which the access token is presumed expired. */
  readonly expiresAtMs: number;
  /** Stable subject claim from the id_token, if available. */
  readonly subject?: string;
  /** Email claim from the id_token / userinfo, if available. */
  readonly email?: string;
};

export type StoredPkce = {
  readonly state: string;
  readonly codeVerifier: string;
  readonly nonce: string;
  /** Where we sent the user — we re-pass this to the token endpoint. */
  readonly redirectUri: string;
  /** Wall-clock at start; used to expire stale PKCE entries. */
  readonly startedAtMs: number;
};

export interface AuthStorage {
  loadTokens(): StoredTokens | null;
  saveTokens(tokens: StoredTokens): void;
  clearTokens(): void;

  /** Stash the in-flight PKCE state under its `state` value. */
  savePkce(state: string, pkce: StoredPkce): void;
  /** Read + delete a PKCE entry by its `state` value. */
  takePkce(state: string): StoredPkce | null;
  /** Drop all PKCE entries (e.g., on sign-out). */
  clearAllPkce(): void;
}

/**
 * Default implementation backed by `window.sessionStorage`. Returns a
 * no-op storage when sessionStorage is unavailable (SSR / tests without
 * a window) — the caller should branch on `loadTokens() === null` for
 * its sign-out path anyway, so this fails safe.
 */
export function sessionAuthStorage(): AuthStorage {
  const ss = (() => {
    try {
      return typeof window !== 'undefined' && window.sessionStorage
        ? window.sessionStorage
        : null;
    } catch {
      return null;
    }
  })();

  return {
    loadTokens() {
      if (ss === null) return null;
      const raw = ss.getItem(TOKENS_KEY);
      if (raw === null) return null;
      try {
        return JSON.parse(raw) as StoredTokens;
      } catch {
        return null;
      }
    },
    saveTokens(tokens) {
      ss?.setItem(TOKENS_KEY, JSON.stringify(tokens));
    },
    clearTokens() {
      ss?.removeItem(TOKENS_KEY);
    },
    savePkce(state, pkce) {
      ss?.setItem(PKCE_KEY_PREFIX + state, JSON.stringify(pkce));
    },
    takePkce(state) {
      if (ss === null) return null;
      const key = PKCE_KEY_PREFIX + state;
      const raw = ss.getItem(key);
      if (raw === null) return null;
      ss.removeItem(key);
      try {
        return JSON.parse(raw) as StoredPkce;
      } catch {
        return null;
      }
    },
    clearAllPkce() {
      if (ss === null) return;
      const toDelete: string[] = [];
      for (let i = 0; i < ss.length; i++) {
        const key = ss.key(i);
        if (key !== null && key.startsWith(PKCE_KEY_PREFIX)) toDelete.push(key);
      }
      for (const k of toDelete) ss.removeItem(k);
    },
  };
}

/**
 * In-memory implementation for tests and SSR fallback. Identical contract,
 * no persistence.
 */
export function inMemoryAuthStorage(): AuthStorage {
  let tokens: StoredTokens | null = null;
  const pkce = new Map<string, StoredPkce>();
  return {
    loadTokens: () => tokens,
    saveTokens: (t) => {
      tokens = t;
    },
    clearTokens: () => {
      tokens = null;
    },
    savePkce: (state, p) => {
      pkce.set(state, p);
    },
    takePkce: (state) => {
      const v = pkce.get(state) ?? null;
      pkce.delete(state);
      return v;
    },
    clearAllPkce: () => pkce.clear(),
  };
}
