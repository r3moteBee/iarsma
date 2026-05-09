/**
 * Token + auth-state storage for the shell.
 *
 * Three implementations behind one interface:
 *
 *   - `inMemoryAuthStorage()`     — tests, SSR fallback. No persistence.
 *   - `sessionAuthStorage()`      — backed by `sessionStorage`. Per-tab,
 *                                   plaintext. Useful for kiosk / shared-
 *                                   computer deployments where token
 *                                   persistence across tab close is
 *                                   *not* wanted.
 *   - `indexedDbAuthStorage()`    — backed by IndexedDB + AES-GCM-256
 *                                   wrapping (D-050). Origin-bound non-
 *                                   extractable wrapping key. Tokens
 *                                   survive tab close; the wrapping key
 *                                   never leaves the secure context.
 *                                   Production default in App.tsx.
 *
 * The interface mixes async writes with synchronous `loadTokens()` reads:
 * read-on-the-hot-path (every JMAP call computes a token from the atom)
 * stays cheap by going through an in-memory cache. Callers `await
 * storage.ready()` once at app startup to hydrate the cache; subsequent
 * reads are sync.
 */

import {
  CryptoEnvelopeError,
  CRYPTO_ENVELOPE_VERSION,
  decryptEnvelope,
  encryptEnvelope,
  generateKid,
  generateWrapKey,
  type CryptoEnvelope,
} from './crypto-envelope.js';

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
  /**
   * One-time hydration of any sync-read cache from the persistent backing.
   * Callers `await ready()` at startup before relying on `loadTokens()`.
   * Implementations that have nothing to hydrate resolve immediately.
   */
  ready(): Promise<void>;

  /**
   * Synchronous read of the cached active tokens. Returns `null` when
   * signed out. Reflects whatever was last loaded by `ready()` or written
   * by `saveTokens()`.
   */
  loadTokens(): StoredTokens | null;

  saveTokens(tokens: StoredTokens): Promise<void>;
  clearTokens(): Promise<void>;

  /** Stash the in-flight PKCE state under its `state` value. */
  savePkce(state: string, pkce: StoredPkce): Promise<void>;
  /** Read + delete a PKCE entry by its `state` value. */
  takePkce(state: string): Promise<StoredPkce | null>;
  /** Drop all PKCE entries (e.g., on sign-out). */
  clearAllPkce(): Promise<void>;
}

// ──────────────────────────────────────────────────────────────────────────
// In-memory implementation (tests, SSR fallback).
// ──────────────────────────────────────────────────────────────────────────

export function inMemoryAuthStorage(): AuthStorage {
  let tokens: StoredTokens | null = null;
  const pkce = new Map<string, StoredPkce>();
  return {
    ready: async () => {},
    loadTokens: () => tokens,
    saveTokens: async (t) => {
      tokens = t;
    },
    clearTokens: async () => {
      tokens = null;
    },
    savePkce: async (state, p) => {
      pkce.set(state, p);
    },
    takePkce: async (state) => {
      const v = pkce.get(state) ?? null;
      pkce.delete(state);
      return v;
    },
    clearAllPkce: async () => pkce.clear(),
  };
}

// ──────────────────────────────────────────────────────────────────────────
// sessionStorage implementation (per-tab, plaintext).
// ──────────────────────────────────────────────────────────────────────────

/**
 * Backed by `window.sessionStorage`. Tokens live for the lifetime of the
 * tab and clear when the tab closes. Plaintext at rest — sessionStorage
 * is already isolated by tab + origin; an attacker with sessionStorage
 * access has session-level compromise of the running tab. No additional
 * encryption value here.
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

  let tokenCache: StoredTokens | null = null;

  return {
    ready: async () => {
      if (ss === null) {
        tokenCache = null;
        return;
      }
      const raw = ss.getItem(TOKENS_KEY);
      tokenCache = raw === null ? null : safeJsonParse<StoredTokens>(raw);
    },
    loadTokens: () => tokenCache,
    saveTokens: async (tokens) => {
      tokenCache = tokens;
      ss?.setItem(TOKENS_KEY, JSON.stringify(tokens));
    },
    clearTokens: async () => {
      tokenCache = null;
      ss?.removeItem(TOKENS_KEY);
    },
    savePkce: async (state, pkce) => {
      ss?.setItem(PKCE_KEY_PREFIX + state, JSON.stringify(pkce));
    },
    takePkce: async (state) => {
      if (ss === null) return null;
      const key = PKCE_KEY_PREFIX + state;
      const raw = ss.getItem(key);
      if (raw === null) return null;
      ss.removeItem(key);
      return safeJsonParse<StoredPkce>(raw);
    },
    clearAllPkce: async () => {
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

// ──────────────────────────────────────────────────────────────────────────
// IndexedDB + AES-GCM implementation (D-050).
// ──────────────────────────────────────────────────────────────────────────

const IDB_NAME = 'iarsma-auth';
const IDB_VERSION = 1;
const STORE_KEYS = 'wrap-keys';
const STORE_TOKENS = 'tokens';
const STORE_PKCE = 'pkce';
const KEY_RECORD_ID = 'current';
const TOKENS_RECORD_ID = 'current';
const PURPOSE_TOKENS = 'tokens.v1';
const PURPOSE_PKCE = 'pkce.v1';

/** Stored alongside the CryptoKey so we can decode existing envelopes. */
type StoredWrapKey = {
  readonly kid: string;
  readonly key: CryptoKey;
  /** Currently always 1 — bumped on incompatible CryptoKey-shape changes. */
  readonly recordVersion: 1;
};

export type IndexedDbAuthStorageOptions = {
  /** Override IDB factory for tests (e.g. fake-indexeddb). */
  readonly idbFactory?: IDBFactory;
};

/**
 * Encrypted persistent auth storage. The active wrapping key is created
 * on first use, persisted to IndexedDB as a non-extractable CryptoKey
 * (origin-bound, structured-clone-safe), and never re-exported.
 *
 * Token / PKCE values are stored as `CryptoEnvelope` records (v1 today,
 * D-050) keyed by their slot in the same DB. Domain-separated AAD
 * prevents accidental cross-purpose decryption.
 */
export function indexedDbAuthStorage(
  opts: IndexedDbAuthStorageOptions = {},
): AuthStorage {
  const factory: IDBFactory | null =
    opts.idbFactory ?? (typeof indexedDB !== 'undefined' ? indexedDB : null);
  if (factory === null) {
    // Fall back to in-memory in environments without IndexedDB (SSR,
    // certain test runners). Caller can swap in a real impl explicitly.
    return inMemoryAuthStorage();
  }
  // After the null-check, alias so closures don't re-narrow on each call.
  const idb: IDBFactory = factory;

  let tokenCache: StoredTokens | null = null;
  let wrapKey: StoredWrapKey | null = null;
  let dbPromise: Promise<IDBDatabase> | null = null;

  function openDb(): Promise<IDBDatabase> {
    if (dbPromise !== null) return dbPromise;
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = idb.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_KEYS)) db.createObjectStore(STORE_KEYS);
        if (!db.objectStoreNames.contains(STORE_TOKENS)) db.createObjectStore(STORE_TOKENS);
        if (!db.objectStoreNames.contains(STORE_PKCE)) db.createObjectStore(STORE_PKCE);
      };
      req.onerror = () => reject(req.error ?? new Error('idb open failed'));
      req.onsuccess = () => resolve(req.result);
    });
    return dbPromise;
  }

  async function loadOrCreateWrapKey(): Promise<StoredWrapKey> {
    if (wrapKey !== null) return wrapKey;
    const db = await openDb();
    const existing = await idbGet<StoredWrapKey>(db, STORE_KEYS, KEY_RECORD_ID);
    if (existing !== null) {
      wrapKey = existing;
      return existing;
    }
    const key = await generateWrapKey();
    const fresh: StoredWrapKey = { kid: generateKid(), key, recordVersion: 1 };
    await idbPut(db, STORE_KEYS, KEY_RECORD_ID, fresh);
    wrapKey = fresh;
    return fresh;
  }

  async function loadTokensFromDisk(): Promise<StoredTokens | null> {
    const db = await openDb();
    const env = await idbGet<CryptoEnvelope>(db, STORE_TOKENS, TOKENS_RECORD_ID);
    if (env === null) return null;
    const wk = await loadOrCreateWrapKey();
    if (env.kid !== wk.kid) {
      // The wrapping key we have can't decrypt this envelope. Treat as
      // "signed out" rather than throwing — the caller's sign-in path
      // will overwrite the record cleanly.
      return null;
    }
    try {
      return await decryptEnvelope<StoredTokens>({
        key: wk.key,
        purpose: PURPOSE_TOKENS,
        envelope: env,
      });
    } catch (e) {
      if (e instanceof CryptoEnvelopeError) {
        // Corrupt or tampered — drop the record and force re-auth.
        await idbDelete(db, STORE_TOKENS, TOKENS_RECORD_ID);
        return null;
      }
      throw e;
    }
  }

  return {
    ready: async () => {
      tokenCache = await loadTokensFromDisk();
    },
    loadTokens: () => tokenCache,
    saveTokens: async (tokens) => {
      const wk = await loadOrCreateWrapKey();
      const env = await encryptEnvelope({
        key: wk.key,
        kid: wk.kid,
        purpose: PURPOSE_TOKENS,
        value: tokens,
      });
      const db = await openDb();
      await idbPut(db, STORE_TOKENS, TOKENS_RECORD_ID, env);
      tokenCache = tokens;
    },
    clearTokens: async () => {
      const db = await openDb();
      await idbDelete(db, STORE_TOKENS, TOKENS_RECORD_ID);
      tokenCache = null;
    },
    savePkce: async (state, pkce) => {
      const wk = await loadOrCreateWrapKey();
      const env = await encryptEnvelope({
        key: wk.key,
        kid: wk.kid,
        purpose: PURPOSE_PKCE,
        value: pkce,
      });
      const db = await openDb();
      await idbPut(db, STORE_PKCE, state, env);
    },
    takePkce: async (state) => {
      const db = await openDb();
      const env = await idbGet<CryptoEnvelope>(db, STORE_PKCE, state);
      if (env === null) return null;
      await idbDelete(db, STORE_PKCE, state);
      const wk = await loadOrCreateWrapKey();
      if (env.kid !== wk.kid) return null;
      try {
        return await decryptEnvelope<StoredPkce>({
          key: wk.key,
          purpose: PURPOSE_PKCE,
          envelope: env,
        });
      } catch (e) {
        if (e instanceof CryptoEnvelopeError) return null;
        throw e;
      }
    },
    clearAllPkce: async () => {
      const db = await openDb();
      await idbClear(db, STORE_PKCE);
    },
  };
}

/** Exposed for tests: the current crypto-envelope version used at-rest. */
export const STORAGE_ENVELOPE_VERSION = CRYPTO_ENVELOPE_VERSION;

// ──────────────────────────────────────────────────────────────────────────
// IndexedDB helpers
// ──────────────────────────────────────────────────────────────────────────

function idbGet<T>(db: IDBDatabase, store: string, key: IDBValidKey): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
    req.onerror = () =>
      reject(req.error ?? new Error(`idb get ${store}/${String(key)} failed`));
  });
}

function idbPut(
  db: IDBDatabase,
  store: string,
  key: IDBValidKey,
  value: unknown,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(tx.error ?? new Error(`idb put ${store}/${String(key)} failed`));
    tx.onabort = () =>
      reject(tx.error ?? new Error(`idb put ${store}/${String(key)} aborted`));
  });
}

function idbDelete(db: IDBDatabase, store: string, key: IDBValidKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(tx.error ?? new Error(`idb delete ${store}/${String(key)} failed`));
  });
}

function idbClear(db: IDBDatabase, store: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error(`idb clear ${store} failed`));
  });
}

function safeJsonParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
