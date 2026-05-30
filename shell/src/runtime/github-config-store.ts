/**
 * GitHubConfigStore — local persistence of the user's GitHub repo
 * connection (token + owner + repo + branch).
 *
 * A single configuration is kept under the fixed key `'default'`; the
 * webmail surfaces one connected repo at a time for the Phase 5a files
 * feature.
 *
 * Two implementations:
 *   - `inMemoryGitHubConfigStore()` — Map-backed, for tests.
 *   - `indexedDbGitHubConfigStore()` — IndexedDB-backed, for production
 *     browsers. Uses the same `onblocked` / `onversionchange` /
 *     degraded-fallback pattern as `agent-metadata-store.ts`.
 *
 * Storage:
 *   - Database: `iarsma-github`
 *   - Object store: `config`, keyed by string. Only `'default'` is used
 *     today, but the schema leaves room for additional named profiles.
 *
 * Security note: the access token is stored in IndexedDB in clear. The
 * threat model treats local browser storage as trusted (the user owns
 * the device). If the token is a fine-grained PAT scoped to a single
 * repo, the blast radius matches the user's intent.
 */

// ── Types ───────────────────────────────────────────────────────────

export type GitHubStoredConfig = {
  readonly token: string;
  readonly owner: string;
  readonly repo: string;
  readonly branch: string;
  readonly connectedAt: string;
};

export interface GitHubConfigStore {
  /** Persist the single configuration (insert or overwrite). */
  save(config: GitHubStoredConfig): Promise<void>;
  /** Load the stored configuration, or null if none is set. */
  load(): Promise<GitHubStoredConfig | null>;
  /** Remove any stored configuration. No-op if nothing is saved. */
  clear(): Promise<void>;
}

const CONFIG_KEY = 'default';

// ──────────────────────────────────────────────────────────────────────
// In-memory implementation (tests, SSR fallback, environments without IDB)
// ──────────────────────────────────────────────────────────────────────

export function inMemoryGitHubConfigStore(): GitHubConfigStore {
  const records = new Map<string, GitHubStoredConfig>();

  return {
    save: async (config) => {
      records.set(CONFIG_KEY, config);
    },

    load: async () => {
      return records.get(CONFIG_KEY) ?? null;
    },

    clear: async () => {
      records.delete(CONFIG_KEY);
    },
  };
}

// ──────────────────────────────────────────────────────────────────────
// IndexedDB implementation (production path).
// ──────────────────────────────────────────────────────────────────────

const IDB_NAME = 'iarsma-github';
const IDB_VERSION = 1;
const STORE_CONFIG = 'config';

export type IndexedDbGitHubConfigStoreOptions = {
  /** Override IDB factory for tests. */
  readonly idbFactory?: IDBFactory;
};

class IdbBlockedError extends Error {
  constructor() {
    super('iarsma-github IDB upgrade blocked by another connection');
    this.name = 'IdbBlockedError';
  }
}

export function indexedDbGitHubConfigStore(
  opts?: IndexedDbGitHubConfigStoreOptions,
): GitHubConfigStore {
  const factory: IDBFactory | null =
    opts?.idbFactory ??
    (typeof indexedDB !== 'undefined' ? indexedDB : null);
  if (factory === null) {
    return inMemoryGitHubConfigStore();
  }
  const idb: IDBFactory = factory;

  let dbPromise: Promise<IDBDatabase> | null = null;
  let degraded = false;

  // In-memory fallback used when IDB is blocked. Lazily created so the
  // happy path (IDB available) allocates no extra Map.
  let fallback: GitHubConfigStore | null = null;
  function getFallback(): GitHubConfigStore {
    if (fallback === null) fallback = inMemoryGitHubConfigStore();
    return fallback;
  }

  function openDb(): Promise<IDBDatabase> {
    if (dbPromise !== null) return dbPromise;
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = idb.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_CONFIG)) {
          db.createObjectStore(STORE_CONFIG);
        }
      };
      req.onerror = () =>
        reject(req.error ?? new Error('iarsma-github idb open failed'));
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
          '[iarsma] github IDB upgrade blocked — another tab may hold an older connection. Falling back to in-memory store.',
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

  // ── IDB helpers (private to this module) ────────────────────────

  function idbGet(
    db: IDBDatabase,
    key: string,
  ): Promise<GitHubStoredConfig | null> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CONFIG, 'readonly');
      const req = tx.objectStore(STORE_CONFIG).get(key);
      req.onsuccess = () =>
        resolve((req.result as GitHubStoredConfig | undefined) ?? null);
      req.onerror = () =>
        reject(req.error ?? new Error(`github config get ${key} failed`));
    });
  }

  function idbPut(
    db: IDBDatabase,
    key: string,
    value: GitHubStoredConfig,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CONFIG, 'readwrite');
      tx.objectStore(STORE_CONFIG).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(tx.error ?? new Error(`github config put ${key} failed`));
      tx.onabort = () =>
        reject(tx.error ?? new Error(`github config put ${key} aborted`));
    });
  }

  function idbDelete(db: IDBDatabase, key: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CONFIG, 'readwrite');
      tx.objectStore(STORE_CONFIG).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(tx.error ?? new Error(`github config delete ${key} failed`));
      tx.onabort = () =>
        reject(tx.error ?? new Error(`github config delete ${key} aborted`));
    });
  }

  // ── Public interface ────────────────────────────────────────────

  return {
    save: async (config) => {
      const db = await tryOpenDb();
      if (db === null) return getFallback().save(config);
      await idbPut(db, CONFIG_KEY, config);
    },

    load: async () => {
      const db = await tryOpenDb();
      if (db === null) return getFallback().load();
      return idbGet(db, CONFIG_KEY);
    },

    clear: async () => {
      const db = await tryOpenDb();
      if (db === null) return getFallback().clear();
      await idbDelete(db, CONFIG_KEY);
    },
  };
}
