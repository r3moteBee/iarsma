/**
 * UndoRegistry — maps action-log seq → inverse-action descriptor.
 *
 * See docs/superpowers/specs/2026-06-04-undo-registry-design.md §2.
 *
 * Storage seam: in-memory here (production + tests + SSR), IDB-backed
 * variant in undo-registry-store.ts. The in-memory impl is the
 * zero-dependency default and what the test suite drives directly.
 */

export type UndoEntry = {
  /** Seq of the action-log entry this undoes. Same numeric space as
   *  StoredEntry.seq in action-log.ts. */
  readonly forEntrySeq: number;
  /** Tool name to invoke for the inverse. */
  readonly inverseAction: string;
  /** Params for the inverse invocation. Opaque to the registry. */
  readonly inverseParams: unknown;
  /** Wall-clock ms at which this entry can no longer be acted on.
   *  Undefined = no expiry (the common mail.modify case). */
  readonly expiresAtMs?: number;
  /** True once the user has invoked the inverse. Consumed entries
   *  stay in storage (historical record) but aren't surfaced as
   *  active. */
  readonly consumed: boolean;
  /** Wall-clock ms when `consumed` flipped true. */
  readonly consumedAtMs?: number;
};

export type UndoRegisterInput = Omit<UndoEntry, 'consumed' | 'consumedAtMs'>;

export interface UndoRegistry {
  /** Register a new inverse for a freshly-committed action-log entry.
   *  Idempotent: registering the same forEntrySeq twice replaces. */
  register(entry: UndoRegisterInput): Promise<void>;
  /** Look up the undo entry for a specific seq. */
  forEntry(seq: number): Promise<UndoEntry | null>;
  /** List undo entries. With `activeOnly: true`, excludes consumed
   *  and expired (relative to the registry's `now`). */
  list(opts?: { readonly activeOnly?: boolean }): Promise<readonly UndoEntry[]>;
  /** Mark an entry consumed. No-op when the seq isn't registered.
   *  Idempotent on already-consumed entries. */
  consume(seq: number): Promise<void>;
  /** Best-effort GC: drop expired-and-unconsumed entries. Consumed
   *  entries are kept (they're the historical record of what the user
   *  undid). */
  cleanup(): Promise<void>;
}

export type InMemoryUndoRegistryOptions = {
  /** For tests — overrides the wall clock. */
  readonly now?: () => number;
};

export function inMemoryUndoRegistry(
  opts: InMemoryUndoRegistryOptions = {},
): UndoRegistry {
  const now = opts.now ?? (() => Date.now());
  const entries = new Map<number, UndoEntry>();

  return {
    async register(input) {
      entries.set(input.forEntrySeq, { ...input, consumed: false });
    },
    async forEntry(seq) {
      return entries.get(seq) ?? null;
    },
    async list(listOpts) {
      const t = now();
      const out: UndoEntry[] = [];
      for (const e of entries.values()) {
        if (listOpts?.activeOnly === true) {
          if (e.consumed) continue;
          if (e.expiresAtMs !== undefined && e.expiresAtMs <= t) continue;
        }
        out.push(e);
      }
      return out;
    },
    async consume(seq) {
      const e = entries.get(seq);
      if (e === undefined) return;
      entries.set(seq, { ...e, consumed: true, consumedAtMs: now() });
    },
    async cleanup() {
      const t = now();
      for (const [seq, e] of entries) {
        if (e.consumed) continue;
        if (e.expiresAtMs !== undefined && e.expiresAtMs <= t) entries.delete(seq);
      }
    },
  };
}

// ───────────────────────────────────────────────────────────────────────
// Inverse-action builder
// ───────────────────────────────────────────────────────────────────────

/**
 * Compute the inverse-action descriptor for a known reversible tool
 * call. Returns null when the tool isn't reversible (or isn't
 * reversible by params alone — e.g. mail.delete in PR 22 will need the
 * action-log entry's provenance to recover pre-delete memberships).
 *
 * Used by loggingInvoker (PR 21+) post-commit: register the result
 * under the just-appended action-log entry's seq.
 */
export function buildInverse(
  tool: string,
  params: unknown,
): { readonly inverseAction: string; readonly inverseParams: unknown } | null {
  if (tool === 'mail.modify') {
    const p = params as {
      emailIds: readonly string[];
      patch: {
        mailboxIds?: Readonly<Record<string, boolean>>;
        keywords?: Readonly<Record<string, boolean>>;
      };
    };
    const inversePatch: {
      mailboxIds?: Record<string, boolean>;
      keywords?: Record<string, boolean>;
    } = {};
    if (p.patch.mailboxIds !== undefined) {
      inversePatch.mailboxIds = flipBooleans(p.patch.mailboxIds);
    }
    if (p.patch.keywords !== undefined) {
      inversePatch.keywords = flipBooleans(p.patch.keywords);
    }
    return {
      inverseAction: 'mail.modify',
      inverseParams: { emailIds: p.emailIds, patch: inversePatch },
    };
  }
  return null;
}

function flipBooleans(m: Readonly<Record<string, boolean>>): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(m)) out[k] = !v;
  return out;
}
