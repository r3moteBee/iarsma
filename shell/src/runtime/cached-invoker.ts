/**
 * cachedInvoker — wraps another `Invoker` with a stale-while-revalidate
 * cache (D-051).
 *
 * Behavior:
 *   - For tool names listed in `cache-policy.ts` (and non-dry-run calls):
 *     - Cache hit  → resolve immediately with the cached value, AND
 *                    fire the underlying `inner.invoke(...)` in the
 *                    background, write-through on success.
 *     - Cache miss → fetch via the inner invoker, write-through on
 *                    success, return the fetched result.
 *   - For non-cacheable tools or dry-run invocations: pass straight
 *     through. Dry-run skips the cache because the response shape is
 *     `DryRunPreview<O>`, not `O`, and we never want to serve a
 *     preview as a real result.
 *
 * The wrapper is deliberately UI-agnostic — it doesn't know about
 * atoms or hooks. The atom/hook layer above (`useReadHook`) already
 * triggers a re-render when the cache hit returns; the background
 * revalidation triggers a second re-render when fresh data lands.
 *
 * Concurrency:
 *   - Identical in-flight fetches (same tool + same canonical input)
 *     are deduplicated. Two components mounting at the same moment
 *     hit the same Promise; only one round-trip happens.
 *
 * Errors:
 *   - Inner-fetch errors during background revalidation are silently
 *     dropped (the cached value is still served). This avoids surfacing
 *     transient revalidation failures as user-visible errors. A future
 *     `onRevalidationError` callback can opt back into surfacing them.
 *   - Inner-fetch errors during a cache miss propagate normally.
 *
 * Account isolation (`getOwner`):
 *   - Cache keys are the canonical input only, and `mailbox.list {}` is the
 *     same key for every account. With `getOwner` set, each row is stored
 *     as `{ owner, value }` and served only to the same owner (the signed-in
 *     subject); rows from another account, or written before scoping
 *     existed, are a miss. A null owner (signed out / no stable identity)
 *     bypasses the cache entirely. This holds even when a sign-out path
 *     failed to `clearAll()` before the next user signed in.
 */

import { canonicalize } from './canonical.js';
import type { CachePurposeKey, CacheStorage } from './cache-storage.js';
import { cacheInvalidationsFor, purposeFor } from './cache-policy.js';
import type { InvocationOptions, Invoker } from './invoker.js';
import type { DryRunPreview } from './types.js';

export type CachedInvokerOptions = {
  readonly inner: Invoker;
  readonly store: CacheStorage;
  /**
   * Called when a background revalidation fails. Defaults to a no-op
   * (silent). Tests use this to assert revalidation dispatched at all.
   */
  readonly onRevalidationError?: (toolName: string, error: unknown) => void;
  /**
   * Identity the cached rows belong to (see "Account isolation" above).
   * Omitted → rows are unscoped (single-account tests).
   */
  readonly getOwner?: () => string | null;
};

/** On-disk row shape when `getOwner` is set. */
type OwnedRow<O> = { readonly owner: string; readonly value: O };

/** Sentinel: caching is disabled for this call (no owner). */
const NO_OWNER = Symbol('no-owner');

export function cachedInvoker(opts: CachedInvokerOptions): Invoker {
  // Two dedup maps with different responsibilities:
  //
  //   - `inFlight`     — caller-facing: synchronizes concurrent
  //                      `invoke()` calls for the same (tool, input)
  //                      onto a single Promise so they all see the
  //                      same cache lookup + (maybe) fetch.
  //   - `inRevalidate` — background: tracks fire-and-forget
  //                      revalidations spawned from cache hits, so a
  //                      flurry of cache hits doesn't spawn parallel
  //                      revalidation fetches.
  //
  // Lifetime matches the invoker instance (one IarsmaProvider, one
  // sign-in session). On sign-out a fresh invoker is constructed.
  const inFlight = new Map<string, Promise<unknown>>();
  const inRevalidate = new Map<string, Promise<void>>();

  return {
    async invoke<I, O>(
      name: string,
      input: I,
      options: InvocationOptions = {},
    ): Promise<O | DryRunPreview<O>> {
      const purpose = purposeFor(name);
      const owner = currentOwner();
      const isCacheable =
        purpose !== null && options.dryRun !== true && owner !== NO_OWNER;

      if (!isCacheable) {
        const result = await opts.inner.invoke<I, O>(name, input, options);
        // v0.13.1 — a successful write may invalidate cached reads for
        // mailboxes/keyword-views the user isn't currently viewing (a
        // move into an unmounted folder, a delete, a label apply). The
        // push-generation bump only refreshes MOUNTED hooks, so without
        // this the destination serves a stale `threads` list on first
        // navigation. Drop the affected stores so the next read is a
        // clean miss. Dry-run never mutates → never invalidates.
        if (options.dryRun !== true) {
          for (const purpose of cacheInvalidationsFor(name, input)) {
            try {
              await opts.store.invalidate(purpose);
            } catch {
              // Best-effort — a cache-clear failure must not fail the
              // user's write. The stale entry self-heals on the next
              // push tick / manual refresh.
            }
          }
        }
        return result;
      }

      const cacheKey = canonicalize(input);
      const dedupKey = dedupKeyFor(name, cacheKey, owner);

      // PR 58 — bypassCache is a "give me fresh data" signal from
      // useReadHook on push-generation refetches. We still write
      // through to the cache so the next call benefits, but we don't
      // serve the stale value here. Without this, a JMAP state change
      // arrives → bumpPushGen → refetch → cachedInvoker returns the
      // pre-change value while a background revalidate silently
      // updates the cache, and the UI never re-renders to show the
      // fresh state.
      if (options.bypassCache === true) {
        const existing = inFlight.get(dedupKey);
        if (existing !== undefined) return existing as Promise<O>;
        const promise = (async () => {
          try {
            const result = (await opts.inner.invoke<I, O>(name, input, options)) as O;
            await putRow(purpose, cacheKey, owner, result);
            return result;
          } finally {
            inFlight.delete(dedupKey);
          }
        })();
        inFlight.set(dedupKey, promise);
        return promise;
      }

      // Sync dedup gate. The cache lookup happens INSIDE the IIFE —
      // moving it out would create a race where two concurrent calls
      // both await `store.get()` before either sets `inFlight`.
      const existing = inFlight.get(dedupKey);
      if (existing !== undefined) {
        return existing as Promise<O>;
      }

      const promise = (async () => {
        try {
          const cached = await getRow<O>(purpose, cacheKey, owner);
          if (cached !== MISS) {
            // Stale-while-revalidate. Return cached; kick off (or join)
            // the background revalidation tracked in `inRevalidate`.
            void scheduleRevalidate<I, O>(name, input, cacheKey, purpose, owner);
            return cached;
          }
          const result = (await opts.inner.invoke<I, O>(
            name,
            input,
            options,
          )) as O;
          await putRow(purpose, cacheKey, owner, result);
          return result;
        } finally {
          inFlight.delete(dedupKey);
        }
      })();
      inFlight.set(dedupKey, promise);
      return promise;
    },
    // Attachment uploads bypass the cache (binary side-channel, no
    // canonicalizable input, no value in caching). Pass-through.
    ...(opts.inner.uploadAttachment !== undefined
      ? {
          uploadAttachment: (blob, uploadOpts) =>
            opts.inner.uploadAttachment!(blob, uploadOpts),
        }
      : {}),
    // Thread-email-id resolution is a cheap read with no cacheable value —
    // it's always issued fresh via the inner invoker. Pass-through.
    ...(opts.inner.resolveThreadEmailIds !== undefined
      ? {
          resolveThreadEmailIds: (threadIds: readonly string[]) =>
            opts.inner.resolveThreadEmailIds!(threadIds),
        }
      : {}),
  };

  /** `undefined` = unscoped, `NO_OWNER` = don't cache, string = scoped. */
  function currentOwner(): string | undefined | typeof NO_OWNER {
    if (opts.getOwner === undefined) return undefined;
    return opts.getOwner() ?? NO_OWNER;
  }

  function dedupKeyFor(name: string, cacheKey: string, owner: string | undefined): string {
    // JSON-encode the owner so no subject string can collide with
    // another (owner, input) pair.
    return owner === undefined
      ? `${name}|${cacheKey}`
      : `${name}|${JSON.stringify(owner)}|${cacheKey}`;
  }

  async function getRow<O>(
    purpose: CachePurposeKey,
    cacheKey: string,
    owner: string | undefined,
  ): Promise<O | typeof MISS> {
    if (owner === undefined) {
      const raw = await opts.store.get<O>(purpose, cacheKey);
      return raw === null ? MISS : raw;
    }
    const row = await opts.store.get<unknown>(purpose, cacheKey);
    if (!isOwnedRow(row) || row.owner !== owner) return MISS;
    return row.value as O;
  }

  async function putRow<O>(
    purpose: CachePurposeKey,
    cacheKey: string,
    owner: string | undefined,
    value: O,
  ): Promise<void> {
    if (owner === undefined) {
      await opts.store.put<O>(purpose, cacheKey, value);
      return;
    }
    // The account changed while the fetch was in flight (sign-out, or
    // another tab signed in someone else and the token layer picked their
    // tokens up): we can't tell whose token fetched `value`, so don't
    // file it under either account.
    if (currentOwner() !== owner) return;
    await opts.store.put<OwnedRow<O>>(purpose, cacheKey, { owner, value });
  }

  function scheduleRevalidate<I, O>(
    name: string,
    input: I,
    cacheKey: string,
    purpose: CachePurposeKey,
    owner: string | undefined,
  ): Promise<void> {
    const dedupKey = dedupKeyFor(name, cacheKey, owner);
    const existing = inRevalidate.get(dedupKey);
    if (existing !== undefined) return existing;
    const promise = (async () => {
      try {
        const result = (await opts.inner.invoke<I, O>(name, input, {})) as O;
        await putRow(purpose, cacheKey, owner, result);
      } catch (e) {
        opts.onRevalidationError?.(name, e);
      } finally {
        inRevalidate.delete(dedupKey);
      }
    })();
    inRevalidate.set(dedupKey, promise);
    return promise;
  }
}

/** Sentinel for a cache miss (a cached value may itself be `null`). */
const MISS = Symbol('miss');

function isOwnedRow(row: unknown): row is OwnedRow<unknown> {
  return (
    row !== null &&
    typeof row === 'object' &&
    typeof (row as { owner?: unknown }).owner === 'string' &&
    'value' in row
  );
}
