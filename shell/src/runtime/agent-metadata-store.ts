/**
 * AgentMetadataStore — local metadata about issued agent tokens.
 *
 * Tracks which tokens have been issued, their scopes, expiry, and
 * revocation status. This is the client-side bookkeeping layer —
 * separate from the server-side token lifecycle managed by the
 * AgentTokenIssuer.
 *
 * Two implementations:
 *   - `inMemoryAgentMetadataStore()` — Map-backed, for tests.
 *   - `indexedDbAgentMetadataStore()` — IndexedDB-backed, for
 *     production browsers. Follows the same `onblocked` /
 *     `onversionchange` / degraded-fallback pattern as
 *     `cache-storage.ts` (lesson from v0.4.0 blocked-upgrade bug).
 *
 * Storage:
 *   - Database: `iarsma-agents`
 *   - Object store: `tokens`, keyed by `tokenId`.
 */

// ── Types ───────────────────────────────────────────────────────────

export type AgentMetadata = {
  readonly tokenId: string;
  readonly name: string;
  readonly scopes: readonly string[];
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly revoked: boolean;
  readonly issuanceLogEntryHash: string;
};

// ── Interface ───────────────────────────────────────────────────────

export interface AgentMetadataStore {
  /** Persist a metadata record (insert or overwrite). */
  save(record: AgentMetadata): Promise<void>;
  /** Retrieve a record by tokenId, or null if absent. */
  get(tokenId: string): Promise<AgentMetadata | null>;
  /** Return every stored record. */
  listAll(): Promise<readonly AgentMetadata[]>;
  /** Mark an existing record as revoked. No-op if tokenId is unknown. */
  markRevoked(tokenId: string): Promise<void>;
}

// ──────────────────────────────────────────────────────────────────────
// In-memory implementation (tests, SSR fallback, environments without IDB)
// ──────────────────────────────────────────────────────────────────────

export function inMemoryAgentMetadataStore(): AgentMetadataStore {
  const records = new Map<string, AgentMetadata>();

  return {
    save: async (record) => {
      records.set(record.tokenId, record);
    },

    get: async (tokenId) => {
      return records.get(tokenId) ?? null;
    },

    listAll: async () => {
      return [...records.values()];
    },

    markRevoked: async (tokenId) => {
      const existing = records.get(tokenId);
      if (existing === undefined) return;
      records.set(tokenId, { ...existing, revoked: true });
    },
  };
}

// ──────────────────────────────────────────────────────────────────────
// IndexedDB implementation (production path).
// ──────────────────────────────────────────────────────────────────────

const IDB_NAME = 'iarsma-agents';
const IDB_VERSION = 1;
const STORE_TOKENS = 'tokens';

export type IndexedDbAgentMetadataStoreOptions = {
  /** Override IDB factory for tests. */
  readonly idbFactory?: IDBFactory;
};

class IdbBlockedError extends Error {
  constructor() {
    super('iarsma-agents IDB upgrade blocked by another connection');
    this.name = 'IdbBlockedError';
  }
}

export function indexedDbAgentMetadataStore(
  opts?: IndexedDbAgentMetadataStoreOptions,
): AgentMetadataStore {
  const factory: IDBFactory | null =
    opts?.idbFactory ??
    (typeof indexedDB !== 'undefined' ? indexedDB : null);
  if (factory === null) {
    return inMemoryAgentMetadataStore();
  }
  const idb: IDBFactory = factory;

  let dbPromise: Promise<IDBDatabase> | null = null;
  let degraded = false;

  // In-memory fallback used when IDB is blocked. Lazily created so the
  // happy path (IDB available) allocates no extra Map.
  let fallback: AgentMetadataStore | null = null;
  function getFallback(): AgentMetadataStore {
    if (fallback === null) fallback = inMemoryAgentMetadataStore();
    return fallback;
  }

  function openDb(): Promise<IDBDatabase> {
    if (dbPromise !== null) return dbPromise;
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = idb.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_TOKENS)) {
          db.createObjectStore(STORE_TOKENS);
        }
      };
      req.onerror = () =>
        reject(req.error ?? new Error('iarsma-agents idb open failed'));
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
          '[iarsma] agents IDB upgrade blocked — another tab may hold an older connection. Falling back to in-memory store.',
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
  ): Promise<AgentMetadata | null> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_TOKENS, 'readonly');
      const req = tx.objectStore(STORE_TOKENS).get(key);
      req.onsuccess = () =>
        resolve((req.result as AgentMetadata | undefined) ?? null);
      req.onerror = () =>
        reject(req.error ?? new Error(`agents get ${key} failed`));
    });
  }

  function idbPut(
    db: IDBDatabase,
    key: string,
    value: AgentMetadata,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_TOKENS, 'readwrite');
      tx.objectStore(STORE_TOKENS).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(tx.error ?? new Error(`agents put ${key} failed`));
      tx.onabort = () =>
        reject(tx.error ?? new Error(`agents put ${key} aborted`));
    });
  }

  function idbGetAll(db: IDBDatabase): Promise<AgentMetadata[]> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_TOKENS, 'readonly');
      const req = tx.objectStore(STORE_TOKENS).getAll();
      req.onsuccess = () => resolve(req.result as AgentMetadata[]);
      req.onerror = () =>
        reject(req.error ?? new Error('agents getAll failed'));
    });
  }

  // ── Public interface ────────────────────────────────────────────

  return {
    save: async (record) => {
      const db = await tryOpenDb();
      if (db === null) return getFallback().save(record);
      await idbPut(db, record.tokenId, record);
    },

    get: async (tokenId) => {
      const db = await tryOpenDb();
      if (db === null) return getFallback().get(tokenId);
      return idbGet(db, tokenId);
    },

    listAll: async () => {
      const db = await tryOpenDb();
      if (db === null) return getFallback().listAll();
      return idbGetAll(db);
    },

    markRevoked: async (tokenId) => {
      const db = await tryOpenDb();
      if (db === null) return getFallback().markRevoked(tokenId);
      const existing = await idbGet(db, tokenId);
      if (existing === null) return;
      await idbPut(db, tokenId, { ...existing, revoked: true });
    },
  };
}
