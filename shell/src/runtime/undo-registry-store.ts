/**
 * Persistent encrypted backing store for the UndoRegistry (PR 20 of
 * the undo-registry plan).
 *
 * Mirrors action-log-store.ts: a sibling IDB database, AES-GCM-256
 * envelopes, wrap key from AuthStorage (D-050). Separated from the
 * action log because undo entries are advisory + consumable; they
 * don't share the chain integrity contract.
 *
 * Storage shape:
 *   - Database: `iarsma-undo` (separate from `iarsma-action-log`,
 *     `iarsma-auth`, `iarsma-cache` — each lifecycle gets its own
 *     drop point).
 *   - Object store: `entries`, keyed by `forEntrySeq` (number, the
 *     same numeric space as action-log seq).
 *   - Each row is a `CryptoEnvelope` of `UndoEntry` per D-050, under
 *     AAD `undo.entries.v1`.
 *
 * Failure mode: register/consume/cleanup errors propagate to the
 * caller (typically the loggingInvoker), which downgrades to a console
 * warning so the user-facing tool call still succeeds.
 */

import {
  CryptoEnvelopeError,
  decryptEnvelope,
  encryptEnvelope,
  type CryptoEnvelope,
} from './crypto-envelope.js';
import type { UndoEntry, UndoRegistry } from './undo-registry.js';
import type { AuthStorage } from './auth-storage.js';

const IDB_NAME = 'iarsma-undo';
const IDB_VERSION = 1;
const STORE_ENTRIES = 'entries';
const PURPOSE_ENTRIES = 'undo.entries.v1';

export type IndexedDbUndoRegistryOptions = {
  /** Source of the wrap key + kid. Production: AuthStorage. */
  readonly auth: AuthStorage;
  /** Override IDB factory for tests. */
  readonly idbFactory?: IDBFactory;
  /** For tests — overrides the wall clock. */
  readonly now?: () => number;
};

export function indexedDbUndoRegistry(
  opts: IndexedDbUndoRegistryOptions,
): UndoRegistry {
  const factory: IDBFactory | null =
    opts.idbFactory ??
    (typeof indexedDB !== 'undefined' ? indexedDB : null);
  if (factory === null) {
    throw new Error(
      'indexedDbUndoRegistry: no IDBFactory available; pass `idbFactory` ' +
        'or use inMemoryUndoRegistry() in environments without IndexedDB.',
    );
  }
  const idb: IDBFactory = factory;
  const now = opts.now ?? (() => Date.now());

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
        reject(req.error ?? new Error('iarsma-undo idb open failed'));
      req.onsuccess = () => resolve(req.result);
    });
    return dbPromise;
  }

  async function decryptRow(env: CryptoEnvelope): Promise<UndoEntry | null> {
    const wk = await opts.auth.getWrapKey();
    if (env.kid !== wk.kid) {
      // Wrap key changed under us. Treat as missing — the registry
      // is advisory; a dropped row just means "no undo for that
      // entry" rather than a hard error.
      return null;
    }
    try {
      return await decryptEnvelope<UndoEntry>({
        key: wk.key,
        purpose: PURPOSE_ENTRIES,
        envelope: env,
      });
    } catch (e) {
      if (e instanceof CryptoEnvelopeError) return null;
      throw e;
    }
  }

  async function writeEntry(entry: UndoEntry): Promise<void> {
    const wk = await opts.auth.getWrapKey();
    const env = await encryptEnvelope({
      key: wk.key,
      kid: wk.kid,
      purpose: PURPOSE_ENTRIES,
      value: entry,
    });
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_ENTRIES, 'readwrite');
      tx.objectStore(STORE_ENTRIES).put(env, entry.forEntrySeq);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('undo write failed'));
      tx.onabort = () => reject(tx.error ?? new Error('undo write aborted'));
    });
  }

  async function readEntry(seq: number): Promise<UndoEntry | null> {
    const db = await openDb();
    const env = await new Promise<CryptoEnvelope | null>((resolve, reject) => {
      const tx = db.transaction(STORE_ENTRIES, 'readonly');
      const req = tx.objectStore(STORE_ENTRIES).get(seq);
      req.onsuccess = () => resolve((req.result as CryptoEnvelope | undefined) ?? null);
      req.onerror = () => reject(req.error ?? new Error('undo read failed'));
    });
    if (env === null) return null;
    return decryptRow(env);
  }

  return {
    async register(input) {
      await writeEntry({ ...input, consumed: false });
    },

    async forEntry(seq) {
      return readEntry(seq);
    },

    async list(listOpts) {
      const db = await openDb();
      const rows = await new Promise<Array<{ key: number; env: CryptoEnvelope }>>(
        (resolve, reject) => {
          const tx = db.transaction(STORE_ENTRIES, 'readonly');
          const out: Array<{ key: number; env: CryptoEnvelope }> = [];
          const req = tx.objectStore(STORE_ENTRIES).openCursor();
          req.onsuccess = () => {
            const cursor = req.result;
            if (cursor === null) {
              resolve(out);
              return;
            }
            out.push({ key: Number(cursor.key), env: cursor.value as CryptoEnvelope });
            cursor.continue();
          };
          req.onerror = () => reject(req.error ?? new Error('undo list failed'));
        },
      );
      const entries: UndoEntry[] = [];
      for (const r of rows) {
        const decrypted = await decryptRow(r.env);
        if (decrypted !== null) entries.push(decrypted);
      }
      if (listOpts?.activeOnly !== true) return entries;
      const t = now();
      return entries.filter((e) => {
        if (e.consumed) return false;
        if (e.expiresAtMs !== undefined && e.expiresAtMs <= t) return false;
        return true;
      });
    },

    async consume(seq) {
      const existing = await readEntry(seq);
      if (existing === null) return;
      if (existing.consumed) return;
      await writeEntry({
        ...existing,
        consumed: true,
        consumedAtMs: now(),
      });
    },

    async cleanup() {
      const all = await this.list();
      const t = now();
      const db = await openDb();
      const toDelete: number[] = [];
      for (const e of all) {
        if (e.consumed) continue;
        if (e.expiresAtMs !== undefined && e.expiresAtMs <= t) {
          toDelete.push(e.forEntrySeq);
        }
      }
      if (toDelete.length === 0) return;
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_ENTRIES, 'readwrite');
        const os = tx.objectStore(STORE_ENTRIES);
        for (const k of toDelete) os.delete(k);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('undo cleanup failed'));
        tx.onabort = () => reject(tx.error ?? new Error('undo cleanup aborted'));
      });
    },
  };
}
