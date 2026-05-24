/**
 * Host wrapper around the `iarsma:action-log` WASM component.
 *
 * Per D-038 the component is pure: it canonicalizes entries and verifies
 * link integrity. SHA-384 (D-027) is computed here via Web Crypto, and
 * persistence goes through an IndexedDB-shaped store interface (in-memory
 * default; the real IndexedDB-backed implementation lands when the login
 * flow — Phase 0 work item 7 — actually exercises this surface).
 */

import { chain as actionLogChain } from '@iarsma/wasm-bindings/action-log';

/** Origin of the call (D-047). UI = human web/native session; MCP = an
 *  agent connecting via the MCP server; LIBRARY = a native-app or other
 *  embedder using the Library API path. */
export type CallerClass = 'ui' | 'mcp' | 'agent' | 'library';

/** Mode of a call against a destructive capability (D-046). Absent on
 *  non-destructive reads. */
export type CallMode = 'preview' | 'commit';

/** Commit-only metadata: which artifacts were created/modified plus the
 *  hash linking back to the dry-run preview that was approved (D-047). */
export type Provenance = {
  /** JSON-serialized list of affected artifacts. Each entry shape:
   *  `{ kind: 'mail' | 'event' | 'contact' | 'file' | ...,
   *     id: string, op: 'create' | 'modify' | 'delete' }`. */
  readonly affectedJson: string;
  /** Hex SHA-384 of the preview output that was approved before this
   *  commit. Empty string if the commit was not preceded by a dry-run. */
  readonly previewHashHex: string;
};

/** Field-aligned with the WIT `entry-data` record, but with `bigint`s
 *  unwrapped to numbers — millisecond timestamps fit comfortably. */
export type EntryInput = {
  /** Schema version of this entry (D-047). Currently `1`. */
  readonly schemaVersion: number;
  readonly timestampMs: number;
  readonly callerClass: CallerClass;
  readonly identity: string;
  readonly action: string;
  /** Mode of the call. Set on destructive tools (D-046); omit on reads. */
  readonly mode?: CallMode;
  /** Pre-serialized JSON. The component folds the literal string into
   *  the canonical bytes; what's inside is the host's responsibility. */
  readonly paramsJson: string;
  /** Commit-only metadata. Set iff `mode === 'commit'` AND artifacts
   *  were created / modified / deleted. */
  readonly provenance?: Provenance;
  /** Token ID of the agent that made this call. Set when
   *  `callerClass === 'agent'` to link the entry to the specific
   *  token in `iarsma-agents`. */
  readonly agentTokenId?: string;
};

/** Current entry-data schema version. Bumped per `docs/versioning.md`
 *  boundary 4 when the entry shape changes incompatibly. */
export const ENTRY_SCHEMA_VERSION = 1;

/** A finalized chain entry as it sits in storage. */
export type StoredEntry = {
  readonly seq: number;
  readonly data: EntryInput;
  /** Empty string for the genesis entry. */
  readonly prevHashHex: string;
  readonly hashHex: string;
};

/** Why a chain check (link or hash recomputation) failed. */
export type ChainVerificationError = {
  readonly seq: number;
  readonly message: string;
};

/**
 * Storage seam — the action log's tier-1 backing store. The real impl
 * targets IndexedDB (web) and the Tauri filesystem (native). The
 * in-memory variant here is for tests and for development before Item 7
 * lights up the login event.
 */
export interface ActionLogStore {
  /** Number of stored entries. */
  count(): Promise<number>;
  /** The most recent entry, or `null` if the chain is empty. */
  last(): Promise<StoredEntry | null>;
  /** All entries, in seq order. Phase 0 keeps the whole chain in
   *  memory; Phase 1 introduces pagination + verified-prefix caching. */
  all(): Promise<readonly StoredEntry[]>;
  /** Append a finalized entry. Implementations must reject if the
   *  entry's seq is not exactly `count()`. */
  append(entry: StoredEntry): Promise<void>;
}

/** In-memory implementation of `ActionLogStore`. */
export function inMemoryActionLogStore(): ActionLogStore {
  const entries: StoredEntry[] = [];
  return {
    async count() {
      return entries.length;
    },
    async last() {
      return entries.length === 0 ? null : entries[entries.length - 1]!;
    },
    async all() {
      return entries.slice();
    },
    async append(entry) {
      if (entry.seq !== entries.length) {
        throw new Error(
          `inMemoryActionLogStore: expected seq ${entries.length}, got ${entry.seq}`,
        );
      }
      entries.push(entry);
    },
  };
}

/** Hash function abstraction so tests can pin the hash without a Web
 *  Crypto polyfill. Production callers pass `webCryptoSha384`. */
export type Sha384 = (bytes: Uint8Array) => Promise<string>;

/** Web Crypto / Node Web Crypto SHA-384, hex-encoded. */
export async function webCryptoSha384(bytes: Uint8Array): Promise<string> {
  // Copy into a fresh ArrayBuffer-backed view; lib.dom's BufferSource
  // type rejects the unioned ArrayBufferLike that Uint8Array now carries
  // (it could in principle wrap a SharedArrayBuffer).
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  const digest = await crypto.subtle.digest('SHA-384', copy);
  return bytesToHex(new Uint8Array(digest));
}

/** Identity bound to one or more entries; written into each `EntryInput`. */
export type Identity = { readonly id: string };

export type ActionLogOptions = {
  readonly store: ActionLogStore;
  readonly sha384?: Sha384;
  /** For tests — overrides `Date.now()` on append. */
  readonly now?: () => number;
};

export interface ActionLog {
  /**
   * Canonicalize, hash, and persist a new entry. Returns the stored
   * entry — including its computed `hashHex` — so the caller can pass
   * it into downstream pipelines (UI, MCP responses) without re-reading
   * from the store.
   */
  append(input: AppendInput): Promise<StoredEntry>;
  /**
   * Verify the full chain in storage: link integrity (delegated to the
   * component) plus hash recomputation against the canonical bytes
   * (this side, since SHA-384 lives in the host). Returns null on
   * success; the offending entry's seq + message otherwise.
   */
  verify(): Promise<ChainVerificationError | null>;
}

export type AppendInput = {
  readonly identity: Identity;
  readonly callerClass: CallerClass;
  readonly action: string;
  /** Pre-serialized JSON, or a value to JSON-stringify here. */
  readonly params: string | unknown;
  /** Mode of the call (D-046). Set on destructive tools; omit for reads. */
  readonly mode?: CallMode;
  /** Commit-only metadata (D-047). Required on commit if artifacts were
   *  created / modified / deleted. */
  readonly provenance?: Provenance;
};

export function createActionLog(opts: ActionLogOptions): ActionLog {
  const sha384 = opts.sha384 ?? webCryptoSha384;
  const now = opts.now ?? (() => Date.now());

  return {
    async append(input) {
      const seq = await opts.store.count();
      const last = await opts.store.last();
      const prevHashHex = last === null ? '' : last.hashHex;
      const data: EntryInput = {
        schemaVersion: ENTRY_SCHEMA_VERSION,
        timestampMs: now(),
        callerClass: input.callerClass,
        identity: input.identity.id,
        action: input.action,
        ...(input.mode !== undefined ? { mode: input.mode } : {}),
        paramsJson:
          typeof input.params === 'string' ? input.params : JSON.stringify(input.params),
        ...(input.provenance !== undefined ? { provenance: input.provenance } : {}),
      };
      const canonical = actionLogChain.canonicalize(BigInt(seq), toWit(data), prevHashHex);
      const hashHex = await sha384(canonical);
      const entry: StoredEntry = { seq, data, prevHashHex, hashHex };
      await opts.store.append(entry);
      return entry;
    },

    async verify() {
      const entries = await opts.store.all();
      try {
        actionLogChain.verifyLinks(entries.map((e) => toWitEntry(e)));
      } catch (e) {
        return toChainError(e);
      }
      // Recompute every hash; covers payload tamper that link-only
      // verification can't catch.
      for (const entry of entries) {
        const canonical = actionLogChain.canonicalize(
          BigInt(entry.seq),
          toWit(entry.data),
          entry.prevHashHex,
        );
        const recomputed = await sha384(canonical);
        if (recomputed !== entry.hashHex) {
          return {
            seq: entry.seq,
            message: `hash mismatch: stored ${entry.hashHex} != recomputed ${recomputed}`,
          };
        }
      }
      return null;
    },
  };
}

// ───────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────

type WitCallerClass = 'ui' | 'mcp' | 'library';

type WitEntryData = {
  schemaVersion: number;
  timestampMs: bigint;
  callerClass: WitCallerClass;
  identity: string;
  action: string;
  mode?: CallMode;
  paramsJson: string;
  provenance?: Provenance;
};

function toWitCallerClass(c: CallerClass): WitCallerClass {
  return c === 'agent' ? 'mcp' : c;
}

function toWit(data: EntryInput): WitEntryData {
  return {
    schemaVersion: data.schemaVersion,
    timestampMs: BigInt(data.timestampMs),
    callerClass: toWitCallerClass(data.callerClass),
    identity: data.identity,
    action: data.action,
    ...(data.mode !== undefined ? { mode: data.mode } : {}),
    paramsJson: data.paramsJson,
    ...(data.provenance !== undefined ? { provenance: data.provenance } : {}),
  };
}

function toWitEntry(entry: StoredEntry): {
  seq: bigint;
  data: WitEntryData;
  prevHashHex: string;
  hashHex: string;
} {
  return {
    seq: BigInt(entry.seq),
    data: toWit(entry.data),
    prevHashHex: entry.prevHashHex,
    hashHex: entry.hashHex,
  };
}

function toChainError(e: unknown): ChainVerificationError {
  // jco transpiles `result<_, E>` to a throw of a wrapper whose
  // `.payload` carries the E value (here, the WIT `chain-error` record).
  // Unwrap that first; fall back to direct shape for tests that throw
  // plain objects.
  const candidate =
    e !== null && typeof e === 'object' && 'payload' in e
      ? (e as { payload: unknown }).payload
      : e;
  if (
    candidate !== null &&
    typeof candidate === 'object' &&
    'seq' in candidate &&
    'message' in candidate
  ) {
    const o = candidate as { seq: unknown; message: unknown };
    const seq = typeof o.seq === 'bigint' ? Number(o.seq) : Number(o.seq ?? 0);
    return { seq, message: String(o.message ?? 'unknown chain error') };
  }
  return { seq: -1, message: e instanceof Error ? e.message : String(e) };
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += (bytes[i]! >>> 4).toString(16);
    out += (bytes[i]! & 0xf).toString(16);
  }
  return out;
}
