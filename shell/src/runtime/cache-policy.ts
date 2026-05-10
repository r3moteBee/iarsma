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
  // session.get is intentionally NOT cached — it's resolved once
  // per invoker instance via in-memory caching inside jmapInvoker
  // (see invoker.ts), and re-fetching on sign-in is correct.
};

export function purposeFor(toolName: string): CachePurposeKey | null {
  return CACHEABLE_TOOLS[toolName] ?? null;
}
