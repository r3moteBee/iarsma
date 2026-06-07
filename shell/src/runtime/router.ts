/**
 * URL router (PR 46 / CoWork #2).
 *
 * Iarsma was a single-URL SPA: the address bar stayed at
 * `/webmail/auth/callback?...` regardless of which view the user
 * was on. Browser back/forward and refresh lost all state; you
 * couldn't bookmark or share a deep link.
 *
 * This module is the pure-functions half — parse a URL into a
 * `Route` and serialize a `Route` back into a path. The hook half
 * (`hooks/use-router.ts`) wires `Route` <-> atoms and the History
 * API.
 *
 * The deliberate choice: no react-router. The route surface is
 * small (10 views), and react-router would add ~12kB gzip + a
 * Provider component + a styling debate about which API version to
 * target. A flat discriminated union + two pure functions covers
 * the same need in ~150 lines.
 */

import type { ActiveView } from '../nav-state.js';

export type MailRouteParts = {
  readonly mailboxId?: string;
  readonly threadId?: string;
  readonly query?: string;
};

export type Route =
  | ({ readonly kind: 'mail' } & MailRouteParts)
  | { readonly kind: 'outbox' }
  | { readonly kind: 'calendar' }
  | { readonly kind: 'contacts' }
  | { readonly kind: 'files' }
  | { readonly kind: 'approvals' }
  | { readonly kind: 'activity' }
  | { readonly kind: 'agents' }
  | { readonly kind: 'settings' }
  | { readonly kind: 'callback'; readonly raw: string }
  | { readonly kind: 'unknown'; readonly raw: string };

/** Map every `ActiveView` to its kind for one-step nav transitions. */
const VIEW_TO_KIND: Record<Exclude<ActiveView, 'mail'>, Route['kind']> = {
  outbox: 'outbox',
  calendar: 'calendar',
  contacts: 'contacts',
  files: 'files',
  approvals: 'approvals',
  activity: 'activity',
  agents: 'agents',
  settings: 'settings',
};

/**
 * Strip the app's base path (e.g. `/webmail/`) from a full URL pathname,
 * normalizing so the route parser sees a clean app-relative path.
 *
 * Input examples (base = `/webmail/`):
 *   `/webmail`                → ``
 *   `/webmail/`               → ``
 *   `/webmail/mail/inbox`     → `mail/inbox`
 *   `/webmail/auth/callback`  → `auth/callback`
 *
 * Anything outside the base is treated as ``.
 */
export function stripBase(pathname: string, basePath: string): string {
  const trimmedBase = basePath.replace(/\/+$/, '');
  if (trimmedBase === '' || trimmedBase === '/') {
    return pathname.replace(/^\/+/, '');
  }
  if (pathname === trimmedBase) return '';
  if (pathname.startsWith(`${trimmedBase}/`)) {
    return pathname.slice(trimmedBase.length + 1);
  }
  // URL is outside the app's base — treat as root for safety.
  return '';
}

/** Re-attach the app base to a relative route path. */
export function withBase(relative: string, basePath: string): string {
  const base = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
  if (relative === '') return `${base}/`;
  return `${base}/${relative.replace(/^\/+/, '')}`;
}

/**
 * Parse an app-relative pathname + search-string into a Route.
 *
 * `pathRelative` MUST already have the app base stripped (use
 * `stripBase` first). `search` is the URL's query string
 * (with or without leading `?`).
 */
export function parseRoute(pathRelative: string, search: string): Route {
  const segments = pathRelative.split('/').filter((s) => s.length > 0);
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);

  if (segments.length === 0) {
    return { kind: 'mail' };
  }

  // OAuth callback. Stalwart returns to `/auth/callback?code=...`.
  if (segments[0] === 'auth' && segments[1] === 'callback') {
    return { kind: 'callback', raw: pathRelative };
  }

  const first = segments[0]!;
  switch (first) {
    case 'mail': {
      const out: { kind: 'mail' } & MailRouteParts = { kind: 'mail' };
      if (segments[1] !== undefined) {
        (out as Record<string, string>).mailboxId = decodeURIComponent(segments[1]);
      }
      if (segments[2] !== undefined) {
        (out as Record<string, string>).threadId = decodeURIComponent(segments[2]);
      }
      const q = params.get('q');
      if (q !== null && q.length > 0) {
        (out as Record<string, string>).query = q;
      }
      return out;
    }
    case 'outbox':
    case 'calendar':
    case 'contacts':
    case 'files':
    case 'approvals':
    case 'activity':
    case 'agents':
    case 'settings':
      return { kind: first };
    default:
      return { kind: 'unknown', raw: pathRelative };
  }
}

/**
 * Serialize a Route into an app-relative path + query string
 * (no leading slash, no base). Caller prepends the base via
 * `withBase` before pushing to history.
 */
export function serializeRoute(route: Route): string {
  switch (route.kind) {
    case 'mail': {
      const segs: string[] = ['mail'];
      if (route.mailboxId !== undefined) {
        segs.push(encodeURIComponent(route.mailboxId));
        if (route.threadId !== undefined) {
          segs.push(encodeURIComponent(route.threadId));
        }
      }
      const search = route.query !== undefined && route.query.length > 0
        ? `?q=${encodeURIComponent(route.query)}`
        : '';
      return segs.join('/') + search;
    }
    case 'callback':
      return route.raw;
    case 'unknown':
      return route.raw;
    default:
      return route.kind;
  }
}

/**
 * Map an `ActiveView` + the per-view selection atoms to a Route.
 * Used by the sync hook to derive a canonical URL whenever the
 * relevant atoms change.
 */
export function routeFor(
  activeView: ActiveView,
  selection: {
    readonly mailboxId: string | null;
    readonly threadId: string | null;
    readonly searchQuery: string;
  },
): Route {
  if (activeView === 'mail') {
    const out: { kind: 'mail' } & MailRouteParts = { kind: 'mail' };
    if (selection.mailboxId !== null) {
      (out as Record<string, string>).mailboxId = selection.mailboxId;
      if (selection.threadId !== null) {
        (out as Record<string, string>).threadId = selection.threadId;
      }
    }
    if (selection.searchQuery.length > 0) {
      (out as Record<string, string>).query = selection.searchQuery;
    }
    return out;
  }
  const kind = VIEW_TO_KIND[activeView];
  return { kind } as Route;
}

/**
 * Reverse of routeFor — extract `ActiveView` + selection patches
 * to apply to the corresponding atoms.
 */
export function viewAndSelectionFor(route: Route): {
  readonly activeView: ActiveView | null;
  readonly mailboxId: string | null | undefined;
  readonly threadId: string | null | undefined;
  readonly searchQuery: string | undefined;
} {
  switch (route.kind) {
    case 'mail':
      return {
        activeView: 'mail',
        mailboxId: route.mailboxId ?? null,
        threadId: route.threadId ?? null,
        searchQuery: route.query ?? '',
      };
    case 'outbox':
    case 'calendar':
    case 'contacts':
    case 'files':
    case 'approvals':
    case 'activity':
    case 'agents':
    case 'settings':
      return {
        activeView: route.kind,
        mailboxId: undefined,
        threadId: undefined,
        searchQuery: undefined,
      };
    case 'callback':
    case 'unknown':
      return {
        activeView: null,
        mailboxId: undefined,
        threadId: undefined,
        searchQuery: undefined,
      };
  }
}
