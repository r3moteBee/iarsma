/**
 * useRouter — bidirectional sync between the History API and the
 * atoms that drive the SignedInShell view (PR 46 / CoWork #2).
 *
 * Behaviour:
 *   - On mount, read window.location and seed the atoms.
 *   - On atom changes, push a new history entry whose URL matches
 *     the current (activeView, mailbox, thread, searchQuery) tuple.
 *     Search-query-only changes use replaceState to avoid one history
 *     entry per keystroke.
 *   - On popstate (browser back/forward), re-parse the URL and write
 *     the atoms.
 *
 * `withBase` keeps everything relative to the app's deploy path
 * (`/webmail/`). The browser shows e.g.
 * `/webmail/mail/Mb-inbox/T-001` instead of the OAuth callback URL.
 */

import { useAtom } from 'jotai';
import { useEffect, useRef } from 'react';
import { activeViewAtom } from '../nav-state.js';
import {
  searchQueryAtom,
  selectedMailboxIdAtom,
  selectedThreadIdAtom,
} from '../mail-state.js';
import {
  parseRoute,
  routeFor,
  serializeRoute,
  stripBase,
  viewAndSelectionFor,
  withBase,
} from '../runtime/router.js';

function appBasePath(): string {
  const env = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env;
  return env?.BASE_URL ?? '/';
}

/**
 * Apply a parsed route's view + selection to the relevant atoms.
 * Skips when activeView is null (callback / unknown).
 */
function applyRouteToAtoms(
  route: ReturnType<typeof parseRoute>,
  setters: {
    setActiveView: (v: Exclude<ReturnType<typeof viewAndSelectionFor>['activeView'], null>) => void;
    setMailboxId: (id: string | null) => void;
    setThreadId: (id: string | null) => void;
    setSearchQuery: (q: string) => void;
  },
): void {
  const { activeView, mailboxId, threadId, searchQuery } =
    viewAndSelectionFor(route);
  if (activeView === null) return;
  setters.setActiveView(activeView);
  if (mailboxId !== undefined) setters.setMailboxId(mailboxId);
  if (threadId !== undefined) setters.setThreadId(threadId);
  if (searchQuery !== undefined) setters.setSearchQuery(searchQuery);
}

export function useRouter(): void {
  const [activeView, setActiveView] = useAtom(activeViewAtom);
  const [mailboxId, setMailboxId] = useAtom(selectedMailboxIdAtom);
  const [threadId, setThreadId] = useAtom(selectedThreadIdAtom);
  const [searchQuery, setSearchQuery] = useAtom(searchQueryAtom);

  // Track the last URL we authored so the popstate listener can
  // skip when the change came from us, and so the push/replace
  // decision compares against the right baseline.
  const lastUrlRef = useRef<string | null>(null);
  // Track the last search query independently so we can pick
  // pushState vs. replaceState based on what actually changed.
  const lastQueryRef = useRef<string>('');

  // Initial hydration + popstate. Only re-runs when the basePath
  // changes (i.e. never, in production).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const base = appBasePath();
    const setters = { setActiveView, setMailboxId, setThreadId, setSearchQuery };

    const sync = () => {
      const rel = stripBase(window.location.pathname, base);
      const route = parseRoute(rel, window.location.search);
      applyRouteToAtoms(route, setters);
      lastUrlRef.current = window.location.pathname + window.location.search;
    };
    sync();
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, [setActiveView, setMailboxId, setThreadId, setSearchQuery]);

  // Atom → URL. Fires after every relevant atom change.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const base = appBasePath();
    const route = routeFor(activeView, {
      mailboxId,
      threadId,
      searchQuery,
    });
    const targetPath = withBase(serializeRoute(route), base);
    const current = window.location.pathname + window.location.search;
    if (targetPath === current) {
      lastQueryRef.current = searchQuery;
      return;
    }
    // Pick history mode. Search-query-only edits (typing in the
    // search box) replaceState so back-button doesn't traverse
    // every keystroke. Everything else pushState.
    const onlyQueryChanged = lastQueryRef.current !== searchQuery &&
      // Compare paths sans query — if only the ?q= part differs,
      // the path part is unchanged.
      stripPath(targetPath) === stripPath(current);
    if (onlyQueryChanged) {
      window.history.replaceState({}, '', targetPath);
    } else {
      window.history.pushState({}, '', targetPath);
    }
    lastUrlRef.current = targetPath;
    lastQueryRef.current = searchQuery;
  }, [activeView, mailboxId, threadId, searchQuery]);
}

/**
 * One-shot helper for the OAuth callback flow. Called by App.tsx
 * after `handleCallback` swaps the code for tokens. Replaces the
 * `/auth/callback?code=...` URL with the app's home route so
 * subsequent reloads land on something useful instead of bouncing
 * back to Stalwart with a now-spent code.
 */
export function replaceCallbackUrlWithHome(): void {
  if (typeof window === 'undefined') return;
  const base = appBasePath();
  const home = withBase(serializeRoute({ kind: 'mail' }), base);
  window.history.replaceState({}, '', home);
}

function stripPath(url: string): string {
  const i = url.indexOf('?');
  return i === -1 ? url : url.slice(0, i);
}
