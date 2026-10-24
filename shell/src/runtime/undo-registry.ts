/**
 * UndoRegistry — maps action-log seq → inverse-action descriptor.
 *
 * See docs/superpowers/specs/2026-06-04-undo-registry-design.md §2.
 *
 * Storage seam: in-memory here (production + tests + SSR), IDB-backed
 * variant in undo-registry-store.ts. The in-memory impl is the
 * zero-dependency default and what the test suite drives directly.
 */

import type { MailboxPatchGroup } from './jmap-client.js';

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
  const previous = previousMailboxesOf(result);
  if (tool === 'mail.modify') {
    const p = params as {
      emailIds: readonly string[];
      patch: {
        mailboxIds?: Readonly<Record<string, boolean>>;
        keywords?: Readonly<Record<string, boolean | null>>;
      };
    };
    // Bulk keyword patches (flag/read over 2+ emails) have no exact
    // inverse: the selection's prior states can be mixed, and a
    // uniform flip would overwrite them. Register no undo rather
    // than a corrupting one.
    if (p.patch.keywords !== undefined && p.emailIds.length > 1) {
      return null;
    }
    const keywords =
      p.patch.keywords !== undefined ? flipKeywords(p.patch.keywords) : undefined;
    const mailboxPatch = p.patch.mailboxIds;
    if (mailboxPatch === undefined || Object.keys(mailboxPatch).length === 0) {
      return keywords === undefined
        ? null
        : {
            inverseAction: 'mail.modify',
            inverseParams: { emailIds: p.emailIds, patch: { keywords } },
          };
    }
    if (previous === undefined) {
      // No captured memberships (degraded read, or an inner invoker
      // that doesn't enrich its result). A single email's flip is the
      // best available guess; a bulk flip is not — emails in a
      // selection need not share a source mailbox (a thread spans
      // Inbox + Sent), so the flip would file each one into every
      // source. No undo beats a corrupting one.
      if (p.emailIds.length > 1) return null;
      return {
        inverseAction: 'mail.modify',
        inverseParams: {
          emailIds: p.emailIds,
          patch: {
            mailboxIds: flipBooleans(mailboxPatch),
            ...(keywords !== undefined ? { keywords } : {}),
          },
        },
      };
    }
    return mailboxInverse(
      [{ emailIds: p.emailIds, mailboxIds: mailboxPatch }],
      previous,
      keywords,
    );
  }
  if (tool === 'mail.delete') {
    // PR 22 — soft-delete inverse. mail.delete's commit return must
    // carry `previousMailboxesByEmail` (the pre-move memberships the
    // invoker captured). Without it we can't build a meaningful
    // inverse, so we skip — better than registering a wrong one.
    if (previous === undefined) return null;
    const p = params as { emailIds: readonly string[] };
    // Reconstruct the forward soft-delete patch (invoker.ts
    // buildSoftDeletePatch): Trash on, every source mailbox off. The
    // per-email inverse then restores exactly what each email lost
    // and takes Trash off only where it was added. Without the
    // `trashMailboxId` hint the Trash membership is left in place
    // (degraded — the user empties that row by hand).
    const trashId = (result as { trashMailboxId?: unknown }).trashMailboxId;
    const forward: Record<string, boolean> = {};
    for (const ids of Object.values(previous)) {
      for (const id of ids) forward[id] = false;
    }
    if (typeof trashId === 'string') forward[trashId] = true;
    return mailboxInverse([{ emailIds: p.emailIds, mailboxIds: forward }], previous);
  }
  if (tool === MAIL_RESTORE_MAILBOXES) {
    // The heterogeneous undo itself — reversible the same way, so a
    // redo from the Activity log keeps per-email memberships intact.
    if (previous === undefined) return null;
    const p = params as MailRestoreMailboxesInput;
    return mailboxInverse(p.groups, previous);
  }
  return null;
}

/**
 * UI-only tool the per-email undo of a mixed-membership action
 * dispatches to (invoker.ts): one JMAP Email/set carrying a distinct
 * mailboxIds patch per group of emails. Not a tool contract — agents
 * and the MCP server never see it.
 */
export const MAIL_RESTORE_MAILBOXES = 'mail.restore-mailboxes';

export type MailRestoreMailboxesInput = {
  readonly groups: readonly MailboxPatchGroup[];
};

function previousMailboxesOf(
  result: unknown,
): Readonly<Record<string, readonly string[]>> | undefined {
  if (typeof result !== 'object' || result === null) return undefined;
  const meta = (result as { previousMailboxesByEmail?: unknown }).previousMailboxesByEmail;
  if (typeof meta !== 'object' || meta === null) return undefined;
  return meta as Readonly<Record<string, readonly string[]>>;
}

/**
 * Per-email inverse of mailbox patches, given each email's memberships
 * from BEFORE the forward action. For each mailbox the forward patch
 * touched, an email gets back exactly what it had: re-added where the
 * patch removed a membership it held, removed where the patch added one
 * it lacked; mailboxes whose membership didn't change are left out, so
 * the inverse never files an email somewhere it never was (an Inbox→
 * Archive move of a whole thread must not drop its Sent replies into
 * Inbox on undo).
 *
 * Emails with identical inverse patches are grouped. One group becomes
 * a plain `mail.modify` (the common single-mailbox case); several
 * become one `mail.restore-mailboxes`. Emails with no captured
 * memberships (absent from the server's Email/get) are skipped — the
 * forward update could not have touched them. Returns null when no
 * email needs restoring.
 */
function mailboxInverse(
  forward: readonly MailboxPatchGroup[],
  previous: Readonly<Record<string, readonly string[]>>,
  keywords?: Readonly<Record<string, boolean | null>>,
): { readonly inverseAction: string; readonly inverseParams: unknown } | null {
  const groups = new Map<string, { emailIds: string[]; mailboxIds: Record<string, boolean> }>();
  const seen = new Set<string>();
  for (const group of forward) {
    for (const emailId of group.emailIds) {
      // A repeated id would land in one group twice (or two groups),
      // which mail.restore-mailboxes rejects — the first patch wins.
      if (seen.has(emailId)) continue;
      seen.add(emailId);
      const before = Object.prototype.hasOwnProperty.call(previous, emailId)
        ? previous[emailId]
        : undefined;
      if (!Array.isArray(before)) continue;
      const had = new Set(before);
      const inverse: Record<string, boolean> = {};
      for (const [mailboxId, added] of Object.entries(group.mailboxIds)) {
        if (added && !had.has(mailboxId)) inverse[mailboxId] = false;
        if (!added && had.has(mailboxId)) inverse[mailboxId] = true;
      }
      if (Object.keys(inverse).length === 0) continue;
      const key = JSON.stringify(Object.entries(inverse).sort(([a], [b]) => (a < b ? -1 : 1)));
      const existing = groups.get(key);
      if (existing !== undefined) existing.emailIds.push(emailId);
      else groups.set(key, { emailIds: [emailId], mailboxIds: inverse });
    }
  }
  const list = [...groups.values()];
  if (list.length === 0) {
    return keywords === undefined
      ? null
      : {
          inverseAction: 'mail.modify',
          inverseParams: { emailIds: forward.flatMap((g) => g.emailIds), patch: { keywords } },
        };
  }
  if (list.length === 1) {
    const only = list[0]!;
    return {
      inverseAction: 'mail.modify',
      inverseParams: {
        emailIds: only.emailIds,
        patch: { mailboxIds: only.mailboxIds, ...(keywords !== undefined ? { keywords } : {}) },
      },
    };
  }
  // Keywords only ever ride along on single-email patches (bulk
  // keyword patches register no inverse), and one email is one group.
  const inverseParams: MailRestoreMailboxesInput = { groups: list };
  return { inverseAction: MAIL_RESTORE_MAILBOXES, inverseParams };
}

function flipBooleans(m: Readonly<Record<string, boolean>>): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(m)) out[k] = !v;
  return out;
}

function flipKeywords(
  m: Readonly<Record<string, boolean | null>>,
): Record<string, boolean | null> {
  // Keyword patch dialect (RFC 8621): true adds, null removes; false
  // is not a valid patch value. Inverse of add is remove and vice versa.
  const out: Record<string, boolean | null> = {};
  for (const [k, v] of Object.entries(m)) out[k] = v === true ? null : true;
  return out;
}
