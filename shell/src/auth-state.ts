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
} from './runtime/action-log.js';
import {
  indexedDbAuthStorage,
  inMemoryAuthStorage,
  type AuthStorage,
  type StoredTokens,
} from './runtime/auth-storage.js';

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
 * Singleton action log for the shell. Phase 0 backs it with the in-memory
 * store; Phase 1 swaps the store for the encrypted IndexedDB-backed
 * implementation behind the same `ActionLogStore` interface (D-027 / D-038).
 *
 * The shell appends to this log on every capability invocation and
 * security-relevant event (sign-in / sign-out, token refresh, etc.). Phase 0
 * lights up only the sign-in event — the broader instrumentation lands as
 * the corresponding capabilities do.
 */
export const actionLog: ActionLog = createActionLog({
  store: inMemoryActionLogStore(),
});

/**
 * Mirror of the `urn:iarsma:agent-context` URN value (D-032). Set by
 * `<App>` after `loadConfig()` resolves, then read by capabilities and
 * agent-facing surfaces that need to advertise / hand the URN value
 * downstream. Null when the operator hasn't configured it (dev default).
 */
export const agentContextAtom = atom<AgentContext | null>(null);
