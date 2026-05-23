/**
 * Persistent capability-result cache (D-051).
 *
 * Caches `mailbox.list`, `thread.list`, and `thread.get` results so the
 * shell can render an instant view on subsequent loads without waiting
 * for a JMAP round-trip. The wrapped invoker (see `cached-invoker.ts`)
 * implements stale-while-revalidate semantics on top of this store.
 *
 * Storage:
 *   - Separate IndexedDB database `iarsma-cache` so clear-on-sign-out
 *     is a single drop rather than a per-store sweep.
 *   - One object store per cacheable capability — keyed by the
 *     canonicalized input string. Keeps queries simple ("get all
 *     thread bodies for cache eviction" stays a per-store cursor).
 *   - Each row stores a `CryptoEnvelope` per D-050. The wrap key comes
 *     from `AuthStorage.getWrapKey()` — same key as tokens, AAD-domain-
 *     separated so a corrupted thread can't decrypt as a mailbox row.
 *
 * Lifecycle:
 *   - `clearAll()` is called on sign-out alongside `clearTokens()`.
 *   - The store survives tab close. Cache from a previous sign-in
 *     survives only as long as the wrap key does — `indexedDbAuthStorage`
 *     persists the key, so cache survives reload; `inMemoryAuthStorage`
 *     and `sessionAuthStorage` regenerate per instance, so cache
 *     decryption fails-closed and the wrapper falls through to a
 *     network fetch (correct behavior).
 *
 * AAD-domain separation:
 *   - `cache.mailboxes.v1`, `cache.threads.v1`, `cache.thread-bodies.v1`.
 *   - Each is bound to a single object store. `CACHE_PURPOSES` is the
 *     authoritative map.
 */

import {
  CryptoEnvelopeError,
  decryptEnvelope,
  encryptEnvelope,
  type CryptoEnvelope,
} from './crypto-envelope.js';
import type { AuthStorage } from './auth-storage.js';

const IDB_NAME = 'iarsma-cache';
// IDB_VERSION 2 added `identities`; v3 adds `search-results`
// (Phase 2 item 9). `onupgradeneeded` iterates every entry in
// `CACHE_PURPOSES`, so the upgrade path is "create any stores not
// already present" — additive schema changes don't need
// version-specific migration code.
const IDB_VERSION = 3;

/**
 * Cache "purposes" — the object-store name on disk and the AAD bound
 * into the encrypted envelope. Adding a new cacheable capability:
 *   1. Add an entry here with a new `purpose` value.
 *   2. Register the tool name in `cache-policy.ts`.
 *   3. Bump IDB_VERSION + add the store in `onupgradeneeded`.
 */
export const CACHE_PURPOSES = {
  mailboxes: { store: 'mailboxes', purpose: 'cache.mailboxes.v1' },
  threads: { store: 'threads', purpose: 'cache.threads.v1' },
  threadBodies: {
    store: 'thread-bodies',
    purpose: 'cache.thread-bodies.v1',
  },
  identities: { store: 'identities', purpose: 'cache.identities.v1' },
  searchResults: {
    store: 'search-results',
    purpose: 'cache.search.v1',
  },
} as const;

export type CachePurposeKey = keyof typeof CACHE_PURPOSES;

export interface CacheStorage {
  /** One-time IDB open. Subsequent calls are no-ops. */
  ready(): Promise<void>;
  /**
   * Read a cached value. Returns `null` on miss, on decrypt-failure
   * (treated as a miss — caller fetches), or on absent IDB.
   */
  get<T>(purpose: CachePurposeKey, key: string): Promise<T | null>;
  /** Write-through. */
  put<T>(purpose: CachePurposeKey, key: string, value: T): Promise<void>;
  /** Drop a single entry (used on JMAP-side mutations). */
  delete(purpose: CachePurposeKey, key: string): Promise<void>;
  /** Drop every cache entry. Called on sign-out. */
  clearAll(): Promise<void>;
}

// ──────────────────────────────────────────────────────────────────────
// In-memory implementation (tests, SSR fallback, environments without IDB)
// ──────────────────────────────────────────────────────────────────────

export function inMemoryCacheStorage(): CacheStorage {
  const stores = new Map<CachePurposeKey, Map<string, unknown>>();
  function getStore(purpose: CachePurposeKey): Map<string, unknown> {
    let s = stores.get(purpose);
    if (s === undefined) {
      s = new Map();
      stores.set(purpose, s);
    }
    return s;
  }
  return {
    ready: async () => {},
    get: async <T>(purpose: CachePurposeKey, key: string) => {
      return (getStore(purpose).get(key) as T | undefined) ?? null;
    },
    put: async <T>(purpose: CachePurposeKey, key: string, value: T) => {
      getStore(purpose).set(key, value);
    },
    delete: async (purpose, key) => {
      getStore(purpose).delete(key);
    },
    clearAll: async () => {
      stores.clear();
    },
  };
}

// ──────────────────────────────────────────────────────────────────────
// IndexedDB + AES-GCM-256 implementation (production path).
// ──────────────────────────────────────────────────────────────────────

export type IndexedDbCacheStorageOptions = {
  /** Source of the wrap key + kid (D-050). Production: AuthStorage. */
  readonly auth: AuthStorage;
  /** Override IDB factory for tests. */
  readonly idbFactory?: IDBFactory;
};

class IdbBlockedError extends Error {
  constructor() {
    super('iarsma-cache IDB upgrade blocked by another connection');
    this.name = 'IdbBlockedError';
  }
}

export function indexedDbCacheStorage(
  opts: IndexedDbCacheStorageOptions,
): CacheStorage {
  const factory: IDBFactory | null =
    opts.idbFactory ??
    (typeof indexedDB !== 'undefined' ? indexedDB : null);
  if (factory === null) {
    return inMemoryCacheStorage();
  }
  const idb: IDBFactory = factory;

  let dbPromise: Promise<IDBDatabase> | null = null;
  let degraded = false;

  function openDb(): Promise<IDBDatabase> {
    if (dbPromise !== null) return dbPromise;
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = idb.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const { store } of Object.values(CACHE_PURPOSES)) {
          if (!db.objectStoreNames.contains(store)) {
            db.createObjectStore(store);
          }
        }
      };
      req.onerror = () =>
        reject(req.error ?? new Error('iarsma-cache idb open failed'));
      req.onsuccess = () => {
        const db = req.result;
        // When a future schema upgrade opens at a higher version,
        // close this connection so the upgrade isn't blocked.
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      req.onblocked = () => {
        // eslint-disable-next-line no-console
        console.warn(
          '[iarsma] cache IDB upgrade blocked — another tab may hold an older connection. Falling back to in-memory cache.',
        );
        reject(new IdbBlockedError());
      };
    });
    return dbPromise;
  }

  async function tryOpenDb(): Promise<IDBDatabase | null> {
    if (degraded) return null;
    try {
      return await openDb();
    } catch (e) {
      if (e instanceof IdbBlockedError) {
        degraded = true;
        return null;
      }
      throw e;
    }
  }

  return {
    ready: async () => {
      await tryOpenDb();
    },
    get: async <T>(purposeKey: CachePurposeKey, key: string) => {
      const db = await tryOpenDb();
      if (db === null) return null;
      const cfg = CACHE_PURPOSES[purposeKey];
      const env = await idbGet<CryptoEnvelope>(db, cfg.store, key);
      if (env === null) return null;
      const wk = await opts.auth.getWrapKey();
      if (env.kid !== wk.kid) return null;
      try {
        return await decryptEnvelope<T>({
          key: wk.key,
          purpose: cfg.purpose,
          envelope: env,
        });
      } catch (e) {
        if (e instanceof CryptoEnvelopeError) {
          await idbDelete(db, cfg.store, key);
          return null;
        }
        throw e;
      }
    },
    put: async <T>(purposeKey: CachePurposeKey, key: string, value: T) => {
      const db = await tryOpenDb();
      if (db === null) return;
      const cfg = CACHE_PURPOSES[purposeKey];
      const wk = await opts.auth.getWrapKey();
      const env = await encryptEnvelope({
        key: wk.key,
        kid: wk.kid,
        purpose: cfg.purpose,
        value,
      });
      await idbPut(db, cfg.store, key, env);
    },
    delete: async (purposeKey, key) => {
      const db = await tryOpenDb();
      if (db === null) return;
      const cfg = CACHE_PURPOSES[purposeKey];
      await idbDelete(db, cfg.store, key);
    },
    clearAll: async () => {
      const db = await tryOpenDb();
      if (db === null) return;
      for (const { store } of Object.values(CACHE_PURPOSES)) {
        await idbClear(db, store);
      }
    },
  };
}

// ──────────────────────────────────────────────────────────────────────
// Internal IDB helpers (mirror auth-storage.ts; kept private here so
// changing the cache shape doesn't ripple into auth).
// ──────────────────────────────────────────────────────────────────────

function idbGet<T>(
  db: IDBDatabase,
  store: string,
  key: IDBValidKey,
): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
    req.onerror = () =>
      reject(req.error ?? new Error(`cache get ${store}/${String(key)} failed`));
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
      reject(tx.error ?? new Error(`cache put ${store}/${String(key)} failed`));
    tx.onabort = () =>
      reject(tx.error ?? new Error(`cache put ${store}/${String(key)} aborted`));
  });
}

function idbDelete(
  db: IDBDatabase,
  store: string,
  key: IDBValidKey,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(tx.error ?? new Error(`cache delete ${store}/${String(key)} failed`));
  });
}

function idbClear(db: IDBDatabase, store: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(tx.error ?? new Error(`cache clear ${store} failed`));
  });
}
