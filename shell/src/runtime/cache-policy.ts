/**
 * Per-tool cache policy (D-051).
 *
 * Maps capability tool names to the cache purpose under which their
 * results are stored. Tools NOT listed here pass through `cachedInvoker`
 * unchanged — that's the right default for writes (e.g., a future
 * `mail.send`) and any read whose freshness matters more than its
 * cache-hit performance.
 *
 * Adding a new cacheable read:
 *   1. Add the tool name + a `purpose` here.
 *   2. If the purpose is new (not already in `CACHE_PURPOSES`), add it
 *      to `cache-storage.ts` first AND bump the IDB version.
 */

import type { CachePurposeKey } from './cache-storage.js';

export const CACHEABLE_TOOLS: Readonly<Record<string, CachePurposeKey>> = {
  'mailbox.list': 'mailboxes',
  'thread.list': 'threads',
  'thread.get': 'threadBodies',
  // Identities change rarely (a user adds an alias maybe once a year)
  // and the compose modal opens many times per session. SWR keeps the
  // dropdown instant while a background fetch picks up server-side
  // changes within the same session.
  'identity.list': 'identities',
  // Search results cached SWR. Same encryption guarantees as the
  // rest; cleared on sign-out alongside the other cache stores.
  'thread.search': 'searchResults',
  // session.get is intentionally NOT cached — it's resolved once
  // per invoker instance via in-memory caching inside jmapInvoker
  // (see invoker.ts), and re-fetching on sign-in is correct.
};

export function purposeFor(toolName: string): CachePurposeKey | null {
  return CACHEABLE_TOOLS[toolName] ?? null;
}

/**
 * Which cache purposes a successful WRITE invalidates (D-051 follow-up,
 * v0.13.1). `cachedInvoker` calls this after a non-dry-run mutation and
 * clears each returned purpose so a later read — even for a mailbox the
 * user isn't currently viewing — sees fresh data instead of the
 * stale-while-revalidate cache.
 *
 * Why this is needed: the push-generation bump only forces a refetch on
 * hooks that are currently MOUNTED. A message moved into a folder the
 * user then navigates to was unmounted at move time, so its cached
 * `threads` list (without the moved message) is served on arrival. The
 * fix is to drop the affected stores on the write itself.
 *
 * Scoped deliberately:
 *   - Mailbox-membership changes (`mail.modify` with a `mailboxIds`
 *     patch, restore, `mail.delete`, `mail.purge`) shift which messages
 *     a per-mailbox `threads` list and `searchResults` return, and the
 *     unread/total counts in `mailboxes` — invalidate all three.
 *   - Keyword-membership changes (`label.apply`, `label.delete`) shift
 *     keyword-filtered `threads`/`searchResults` views but not mailbox
 *     counts — invalidate those two.
 *   - A keyword-only `mail.modify` (flag / mark-read) changes NO query
 *     membership; the mounted view already refreshes via the generation
 *     bump. Returning `[]` here preserves the cache on the very hot
 *     mark-read-on-open path (don't regress it).
 */
export function cacheInvalidationsFor(
  toolName: string,
  input: unknown,
): readonly CachePurposeKey[] {
  switch (toolName) {
    case 'mail.delete':
    case 'mail.purge':
      return ['threads', 'threadBodies', 'searchResults', 'mailboxes'];
    case 'mail.modify':
      return patchTouchesMailbox(input)
        ? ['threads', 'searchResults', 'mailboxes']
        : [];
    case 'label.apply':
    case 'label.delete':
      return ['threads', 'searchResults'];
    default:
      return [];
  }
}

/** True when a `mail.modify` patch changes mailbox membership (a move /
 *  restore), as opposed to a keyword-only patch (flag, seen). */
function patchTouchesMailbox(input: unknown): boolean {
  if (typeof input !== 'object' || input === null) return false;
  const patch = (input as { patch?: unknown }).patch;
  if (typeof patch !== 'object' || patch === null) return false;
  const mailboxIds = (patch as { mailboxIds?: unknown }).mailboxIds;
  return (
    typeof mailboxIds === 'object' &&
    mailboxIds !== null &&
    Object.keys(mailboxIds).length > 0
  );
}
