/**
 * Jotai atoms for the shell's auth state.
 *
 * Storage is the source of truth; these atoms mirror it so React components
 * re-render when the user signs in or out. Calls into `oauth.ts` mutate
 * storage and then call `refreshAuthAtom` to nudge the atom re-derivation.
 */

import { atom } from 'jotai';
import type { AgentContext } from './config.js';
import {
  createActionLog,
  inMemoryActionLogStore,
  type ActionLog,
  type ActionLogStore,
} from './runtime/action-log.js';
import { indexedDbActionLogStore } from './runtime/action-log-store.js';
import { inMemoryUndoRegistry, type UndoRegistry } from './runtime/undo-registry.js';
import { indexedDbUndoRegistry } from './runtime/undo-registry-store.js';
import {
  indexedDbAuthStorage,
  inMemoryAuthStorage,
  type AuthStorage,
  type StoredTokens,
} from './runtime/auth-storage.js';
import {
  inMemoryCacheStorage,
  indexedDbCacheStorage,
  type CacheStorage,
} from './runtime/cache-storage.js';

const isBrowser = typeof window !== 'undefined' && typeof indexedDB !== 'undefined';

/**
 * The active storage instance.
 *
 * Browser → IndexedDB-backed AES-GCM-256 wrapped storage (D-050). Tokens
 * survive tab close; the wrapping key is origin-bound, non-extractable,
 * and never leaves the secure context.
 *
 * Server / SSR → in-memory (no persistence; the rendered HTML doesn't need
 * tokens, and the in-memory impl satisfies the same contract).
 *
 * App.tsx calls `await authStorage.ready()` once at startup to hydrate the
 * sync `loadTokens()` cache from IndexedDB before the first capability
 * call goes through.
 */
export const authStorage: AuthStorage = isBrowser
  ? indexedDbAuthStorage()
  : inMemoryAuthStorage();

/**
 * Persistent capability-result cache (D-051). Backed by IndexedDB in
 * the browser, in-memory elsewhere. Encrypts each row with the same
 * wrap key as `authStorage`, AAD-domain-separated per cache purpose.
 *
 * Wired into the production invoker via `cachedInvoker(jmapInvoker, ...)`
 * in App.tsx.
 *
 * On sign-out, App.tsx calls `cacheStorage.clearAll()` alongside
 * `authStorage.clearTokens()` to drop all cached email data.
 */
export const cacheStorage: CacheStorage = isBrowser
  ? indexedDbCacheStorage({ auth: authStorage })
  : inMemoryCacheStorage();

/** Increment to force `tokensAtom` to re-read storage. */
export const authVersionAtom = atom(0);

/** Current tokens, or null when signed out. */
export const tokensAtom = atom<StoredTokens | null>((get) => {
  // Read `authVersionAtom` to make this atom recompute on bump.
  void get(authVersionAtom);
  return authStorage.loadTokens();
});

/** Convenience: are we signed in right now? */
export const isSignedInAtom = atom((get) => get(tokensAtom) !== null);

/**
 * Singleton action log for the shell.
 *
 * In the browser the chain persists to IndexedDB encrypted under the
 * same wrap key as auth tokens, AAD-domain-separated by purpose
 * `action-log.entries.v1` (D-052, third consumer of D-050's wrap key).
 * Server / SSR / test environments fall back to the in-memory store.
 *
 * The shell appends here on:
 *   - sign-in (`auth.signin` event in App.tsx callback handler)
 *   - every successful capability invocation, via the `loggingInvoker`
 *     wrapper around the production invoker (D-052).
 *
 * The log is *not* cleared on sign-out — it is per-installation, not
 * per-session, and the `identity` field on each entry distinguishes
 * mixed sign-ins on a shared browser.
 */
const actionLogStore: ActionLogStore = isBrowser
  ? indexedDbActionLogStore({ auth: authStorage })
  : inMemoryActionLogStore();

export const actionLog: ActionLog = createActionLog({
  store: actionLogStore,
});

/**
 * Singleton UndoRegistry (PR 20 of the undo-registry plan).
 *
 * In the browser, undo entries persist to IndexedDB encrypted under
 * the same wrap key as auth tokens, AAD-domain-separated by purpose
 * `undo.entries.v1`. Test / SSR environments fall back to the
 * in-memory store.
 *
 * Failure to register an undo is best-effort: the user-facing tool
 * call still succeeds, the user just doesn't see an Undo button for
 * that entry. Failure modes log to console; see
 * docs/superpowers/specs/2026-06-04-undo-registry-design.md §2.3.
 */
export const undoRegistry: UndoRegistry = isBrowser
  ? indexedDbUndoRegistry({ auth: authStorage })
  : inMemoryUndoRegistry();

/**
 * Mirror of the `urn:iarsma:agent-context` URN value (D-032). Set by
 * `<App>` after `loadConfig()` resolves, then read by capabilities and
 * agent-facing surfaces that need to advertise / hand the URN value
 * downstream. Null when the operator hasn't configured it (dev default).
 */
export const agentContextAtom = atom<AgentContext | null>(null);
