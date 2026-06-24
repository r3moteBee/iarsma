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
 */

import { canonicalize } from './canonical.js';
import type { CacheStorage } from './cache-storage.js';
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
};

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
      const isCacheable = purpose !== null && options.dryRun !== true;

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
      const dedupKey = `${name}|${cacheKey}`;

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
            await opts.store.put<O>(purpose, cacheKey, result);
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
          const cached = await opts.store.get<O>(purpose, cacheKey);
          if (cached !== null) {
            // Stale-while-revalidate. Return cached; kick off (or join)
            // the background revalidation tracked in `inRevalidate`.
            void scheduleRevalidate<I, O>(name, input, cacheKey, purpose);
            return cached;
          }
          const result = (await opts.inner.invoke<I, O>(
            name,
            input,
            options,
          )) as O;
          await opts.store.put<O>(purpose, cacheKey, result);
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

  function scheduleRevalidate<I, O>(
    name: string,
    input: I,
    cacheKey: string,
    purpose: NonNullable<ReturnType<typeof purposeFor>>,
  ): Promise<void> {
    const dedupKey = `${name}|${cacheKey}`;
    const existing = inRevalidate.get(dedupKey);
    if (existing !== undefined) return existing;
    const promise = (async () => {
      try {
        const result = (await opts.inner.invoke<I, O>(name, input, {})) as O;
        await opts.store.put<O>(purpose, cacheKey, result);
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
