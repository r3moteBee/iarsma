/**
 * Persistent encrypted backing store for the action log (D-052).
 *
 * Lives next to `action-log.ts` rather than inside it so the in-memory
 * store remains the canonical zero-dependency option for tests and
 * environments without IndexedDB. Production browsers use the IDB-backed
 * variant here.
 *
 * Storage shape:
 *   - Database: `iarsma-action-log` (separate from `iarsma-auth` and
 *     `iarsma-cache` — three lifecycles, three drops on operator
 *     intervention. The action log is *not* cleared on sign-out.)
 *   - Object store: `entries`, keyed by `seq` (number).
 *   - Each row: a `CryptoEnvelope` of the `StoredEntry` per D-050,
 *     under AAD `action-log.entries.v1`. Wrap key comes from
 *     `AuthStorage.getWrapKey()` (D-052: third consumer of the wrap
 *     key, AAD-domain-separated).
 *
 * The hash chain itself (`prevHashHex` linking each entry to the
 * previous) is defended by the action-log component's `verifyLinks` +
 * the host's SHA-384 recomputation. Encryption here is privacy-of-
 * audit-payload, not integrity — that's what the chain provides.
 */

import {
  CryptoEnvelopeError,
  decryptEnvelope,
  encryptEnvelope,
  type CryptoEnvelope,
} from './crypto-envelope.js';
import type { ActionLogStore, StoredEntry } from './action-log.js';
import type { AuthStorage } from './auth-storage.js';

const IDB_NAME = 'iarsma-action-log';
const IDB_VERSION = 1;
const STORE_ENTRIES = 'entries';
const PURPOSE_ENTRIES = 'action-log.entries.v1';

export type IndexedDbActionLogStoreOptions = {
  /** Source of the wrap key + kid (D-050). Production: AuthStorage. */
  readonly auth: AuthStorage;
  /** Override IDB factory for tests. */
  readonly idbFactory?: IDBFactory;
};

export function indexedDbActionLogStore(
  opts: IndexedDbActionLogStoreOptions,
): ActionLogStore {
  const factory: IDBFactory | null =
    opts.idbFactory ??
    (typeof indexedDB !== 'undefined' ? indexedDB : null);
  if (factory === null) {
    // Caller's job to fall back; we don't auto-degrade here because
    // silently switching to in-memory means a "successful append" that
    // never persists, and the chain claim ("tamper-evident audit
    // trail") would silently weaken. Throw at construction so the
    // shell's bootstrap chooses an explicit fallback.
    throw new Error(
      'indexedDbActionLogStore: no IDBFactory available; pass `idbFactory` ' +
        'or use inMemoryActionLogStore() in environments without IndexedDB.',
    );
  }
  const idb: IDBFactory = factory;

  let dbPromise: Promise<IDBDatabase> | null = null;
  function openDb(): Promise<IDBDatabase> {
    if (dbPromise !== null) return dbPromise;
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = idb.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_ENTRIES)) {
          db.createObjectStore(STORE_ENTRIES);
        }
      };
      req.onerror = () =>
        reject(req.error ?? new Error('iarsma-action-log idb open failed'));
      req.onsuccess = () => resolve(req.result);
    });
    return dbPromise;
  }

  async function decryptRow(env: CryptoEnvelope): Promise<StoredEntry | null> {
    const wk = await opts.auth.getWrapKey();
    if (env.kid !== wk.kid) {
      // Wrap key changed under us. Treat as missing rather than crash —
      // the chain can't be extended past this point but reads return
      // empty rather than tripping a hash mismatch later.
      return null;
    }
    try {
      return await decryptEnvelope<StoredEntry>({
        key: wk.key,
        purpose: PURPOSE_ENTRIES,
        envelope: env,
      });
    } catch (e) {
      if (e instanceof CryptoEnvelopeError) return null;
      throw e;
    }
  }

  return {
    async count() {
      const db = await openDb();
      return new Promise<number>((resolve, reject) => {
        const tx = db.transaction(STORE_ENTRIES, 'readonly');
        const req = tx.objectStore(STORE_ENTRIES).count();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () =>
          reject(req.error ?? new Error('action-log count failed'));
      });
    },

    async last() {
      const db = await openDb();
      const env = await new Promise<CryptoEnvelope | null>((resolve, reject) => {
        const tx = db.transaction(STORE_ENTRIES, 'readonly');
        const req = tx
          .objectStore(STORE_ENTRIES)
          .openCursor(null, 'prev');
        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor === null) {
            resolve(null);
            return;
          }
          resolve(cursor.value as CryptoEnvelope);
        };
        req.onerror = () =>
          reject(req.error ?? new Error('action-log last failed'));
      });
      if (env === null) return null;
      return decryptRow(env);
    },

    async all() {
      const db = await openDb();
      const envs = await new Promise<CryptoEnvelope[]>((resolve, reject) => {
        const tx = db.transaction(STORE_ENTRIES, 'readonly');
        const out: CryptoEnvelope[] = [];
        const req = tx.objectStore(STORE_ENTRIES).openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor === null) {
            resolve(out);
            return;
          }
          out.push(cursor.value as CryptoEnvelope);
          cursor.continue();
        };
        req.onerror = () =>
          reject(req.error ?? new Error('action-log all failed'));
      });
      const rows: StoredEntry[] = [];
      for (const env of envs) {
        const decrypted = await decryptRow(env);
        if (decrypted !== null) rows.push(decrypted);
      }
      return rows;
    },

    async append(entry) {
      // Verify the seq matches the existing count — same invariant the
      // in-memory store enforces. This is the thin client-side check;
      // the real integrity guarantee is the hash chain.
      const db = await openDb();
      const existing = await new Promise<number>((resolve, reject) => {
        const tx = db.transaction(STORE_ENTRIES, 'readonly');
        const req = tx.objectStore(STORE_ENTRIES).count();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () =>
          reject(req.error ?? new Error('action-log count for append failed'));
      });
      if (entry.seq !== existing) {
        throw new Error(
          `indexedDbActionLogStore: expected seq ${existing}, got ${entry.seq}`,
        );
      }
      const wk = await opts.auth.getWrapKey();
      const env = await encryptEnvelope({
        key: wk.key,
        kid: wk.kid,
        purpose: PURPOSE_ENTRIES,
        value: entry,
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_ENTRIES, 'readwrite');
        tx.objectStore(STORE_ENTRIES).put(env, entry.seq);
        tx.oncomplete = () => resolve();
        tx.onerror = () =>
          reject(tx.error ?? new Error('action-log append failed'));
        tx.onabort = () =>
          reject(tx.error ?? new Error('action-log append aborted'));
      });
    },
  };
}
