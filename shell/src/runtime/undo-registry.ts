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
 * call. Returns null when the tool isn't reversible or when the
 * required hints (e.g. mail.delete's pre-move memberships) are
 * missing from the result.
 *
 * Used by loggingInvoker (PR 21+) post-commit: register the result
 * under the just-appended action-log entry's seq.
 */
export function buildInverse(
  tool: string,
  params: unknown,
  result?: unknown,
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
  if (tool === 'mail.delete') {
    // PR 22 — soft-delete inverse. mail.delete's commit return must
    // carry `previousMailboxesByEmail` (the pre-move memberships
    // the invoker captured). Without it we can't build a meaningful
    // inverse, so we skip — better than registering a wrong one.
    const p = params as { emailIds: readonly string[] };
    const r = result as
      | { previousMailboxesByEmail?: Readonly<Record<string, readonly string[]>> }
      | undefined;
    const meta = r?.previousMailboxesByEmail;
    if (meta === undefined) return null;

    // Restore the union of previousMailboxes (= true), remove Trash
    // and anything not in the union (= false, picked up from the
    // current patch shape via the invoker's _trashId hint or
    // inferred at undo time). For v1 we take the simple route: the
    // inverse patch sets every mentioned previous mailbox to true.
    // The Activity Undo's call into mail.modify will result in a
    // round-trip through the same JMAP update path.
    const mailboxIds: Record<string, boolean> = {};
    for (const ids of Object.values(meta)) {
      for (const id of ids) mailboxIds[id] = true;
    }
    // Heuristic: any mailbox we don't know about goes off. The
    // mail.delete invoker can hint at the Trash id by including it
    // as a `previousMailboxesByEmail` value (it doesn't, since
    // Trash isn't a previous mailbox), so the Undo-time UX is "the
    // user lands the email back in its original mailboxes, and
    // the Trash membership is removed by the subsequent
    // mail.modify". For that to work the undo's mail.modify must
    // remove Trash explicitly — which it can't know without a
    // hint. We supply it via a result-side `trashMailboxId` field;
    // when absent, we skip the off-set and rely on the user to
    // manually empty the Trash row that lingers.
    const trashHint = (r as { trashMailboxId?: string } | undefined)?.trashMailboxId;
    if (trashHint !== undefined) mailboxIds[trashHint] = false;
    return {
      inverseAction: 'mail.modify',
      inverseParams: { emailIds: p.emailIds, patch: { mailboxIds } },
    };
  }
  return null;
}

function flipBooleans(m: Readonly<Record<string, boolean>>): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(m)) out[k] = !v;
  return out;
}
