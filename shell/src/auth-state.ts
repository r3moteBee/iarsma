/**
 * Jotai atoms for the shell's auth state.
 *
 * Storage is the source of truth; these atoms mirror it so React components
 * re-render when the user signs in or out. Calls into `oauth.ts` mutate
 * storage and then call `refreshAuthAtom` to nudge the atom re-derivation.
 */

import { atom } from 'jotai';
import {
  inMemoryAuthStorage,
  sessionAuthStorage,
  type AuthStorage,
  type StoredTokens,
} from './runtime/auth-storage.js';

const isBrowser = typeof window !== 'undefined' && Boolean(window.sessionStorage);

/** The active storage instance. Browser → sessionStorage; server → in-memory. */
export const authStorage: AuthStorage = isBrowser
  ? sessionAuthStorage()
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
