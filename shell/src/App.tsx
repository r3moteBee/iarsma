// Phase 0 work items 6 + 7 — OAuth 2.1 + PKCE flow + login UI.
// Phase 4 — responsive shell layout with sidebar, top bar, bottom nav.

import { Provider as JotaiProvider, useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  actionLog,
  agentContextAtom,
  authStorage,
  authVersionAtom,
  cacheStorage,
  isSignedInAtom,
  tokensAtom,
  undoRegistry,
} from './auth-state.js';
import { composeStateAtom } from './compose-state.js';
import { loadConfig, type ShellConfig } from './config.js';
import { useMailboxList } from './generated/capabilities/mailbox-list.js';
import { useSessionGet } from './generated/capabilities/session-get.js';
import { useBreakpoint } from './hooks/use-media-query.js';
import { keyboardHelpOpenAtom } from './keyboard-state.js';
import { mailLayoutAtom, pendingDeleteUndoAtom, searchQueryAtom, selectedMailboxIdAtom, type MailLayout as MailLayoutType } from './mail-state.js';
import { activeViewAtom } from './nav-state.js';
import type { ActiveView } from './nav-state.js';
import {
  IarsmaProvider,
  cachedInvoker,
  jmapInvoker,
  loggingInvoker,
  useInvoker,
  type Invoker,
} from './runtime/index.js';
import { inMemoryAgentMetadataStore, indexedDbAgentMetadataStore } from './runtime/agent-metadata-store.js';
import { announceUnreadDelta, updateTabTitle } from './runtime/new-mail-notify.js';
import { toCalendarViewEvent } from './runtime/calendar-transform.js';
import { localTokenIssuer } from './runtime/local-token-issuer.js';
import { stalwartApiKeyIssuer } from './runtime/stalwart-apikey-issuer.js';
import type { AgentTokenInfo } from './runtime/agent-token-issuer.js';
import { getAccessToken, handleCallback, signOut } from './runtime/oauth.js';
import { replaceCallbackUrlWithHome, useRouter } from './hooks/use-router.js';
import { themePreferenceAtom, resolveTheme } from './runtime/theme.js';
import { accentAtom, applyAppearance, densityAtom } from './runtime/appearance.js';
import { hiddenCalendarIdsAtom, toggleCalendarId } from './runtime/calendar-visibility.js';
import { createSendBuffer, type SendBuffer } from './runtime/send-buffer.js';
import { SendBufferProvider, useOutboxCount } from './runtime/send-buffer-context.js';
import type { MailSendInput, MailSendResult, Session } from './runtime/jmap-client.js';
import {
  pushGenerationAtom,
  usePushSubscription,
} from './runtime/push-subscription.js';
import { BottomNav } from './components/bottom-nav.js';
import { SegmentedControl, type SegmentedOption } from './components/segmented-control.js';
import { Sidebar } from './components/sidebar.js';
import { TopBar } from './components/top-bar.js';
import { ComposeView } from './views/compose-view.js';
import { ContactsView } from './views/contacts-view.js';
import { AgentDashboardView } from './views/agent-dashboard-view.js';
import { AgentSettingsView } from './views/agent-settings-view.js';
import { useAgentDashboard } from './runtime/use-agent-dashboard.js';
import { FilesView, type FileTreeNode, type FileContent as FilesViewContent, type CommitHistoryEntry } from './views/files-view.js';
import { githubClient, type GitHubConfig } from './runtime/github-client.js';
import { indexedDbGitHubConfigStore, inMemoryGitHubConfigStore, type GitHubStoredConfig } from './runtime/github-config-store.js';
import { ActivityView } from './views/activity-view.js';
import { OutboxView } from './views/outbox-view.js';
import { activityFiltersAtom, useActivityLog } from './runtime/use-activity-log.js';
import { ApprovalsView } from './views/approvals-view.js';
import {
  jmapApprovalStore,
  type ApprovalRequest,
  type ApprovalStore,
} from './runtime/approval-store.js';
import { CalendarView, buildEventParticipants } from './views/calendar-view.js';
import { CommandPalette, type CommandItem } from './components/command-palette.js';
import { SendToast } from './components/send-toast.js';
import { DeleteToast } from './components/delete-toast.js';
import { KeyboardHelpOverlay } from './views/keyboard-help-overlay.js';
import { SignedOutView } from './views/signed-out-view.js';
import { ThreadList } from './views/thread-list.js';
import { ThreadView } from './views/thread-view.js';
import layoutStyles from './styles/layout.module.css';
import mailLayoutStyles from './styles/mail-layout.module.css';

type Phase =
  | { kind: 'loading' }
  | { kind: 'config_error'; message: string }
  | { kind: 'callback'; url: URL }
  | { kind: 'ready' };

export function App() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [config, setConfig] = useState<ShellConfig | null>(null);

  const bumpAuth = useSetAtom(authVersionAtom);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Hydrate the auth-storage in-memory cache from the persistent
        // IndexedDB backing (D-050) before any code that calls
        // `authStorage.loadTokens()` runs. Bump the auth version so atoms
        // that read tokens recompute once the cache is populated.
        await authStorage.ready();
        if (cancelled) return;
        bumpAuth((v) => v + 1);

        const cfg = await loadConfig();
        if (cancelled) return;
        setConfig(cfg);

        const url = typeof window !== 'undefined' ? new URL(window.location.href) : null;
        if (url !== null && (url.searchParams.has('code') || url.searchParams.has('error'))) {
          setPhase({ kind: 'callback', url });
        } else {
          // PR 44 — proactive expiry-or-refresh gate. If tokens exist
          // and the access_token is past its TTL (or about to be),
          // `getAccessToken` either refreshes via refresh_token or
          // clears storage. Either way, the next render sees the
          // truth: a usable token, or no token (→ SignedOutView)
          // instead of a stale Bearer fired at JMAP that returns 401
          // and triggers the browser's native Basic-auth popup.
          const stored = authStorage.loadTokens();
          if (stored !== null) {
            const refreshed = await getAccessToken({ config: cfg, storage: authStorage });
            if (refreshed === null) {
              // refresh failed or no refresh token; getAccessToken
              // already called clearTokens(). Bump so atoms pick up
              // the now-null tokens.
              bumpAuth((v) => v + 1);
            }
          }
          if (cancelled) return;
          setPhase({ kind: 'ready' });
        }
      } catch (e) {
        if (cancelled) return;
        setPhase({
          kind: 'config_error',
          message: e instanceof Error ? e.message : String(e),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bumpAuth]);

  if (phase.kind === 'loading' || (config === null && phase.kind !== 'config_error')) {
    return (
      <main aria-busy="true">
        <p>Loading…</p>
      </main>
    );
  }

  if (phase.kind === 'config_error') {
    return (
      <main role="alert">
        <h1>Iarsma — configuration error</h1>
        <p>{phase.message}</p>
        <p>
          See <code>docs/stalwart-setup.md</code>.
        </p>
      </main>
    );
  }

  // After this point config is non-null.
  const cfg = config!;

  return (
    <JotaiProvider>
      {phase.kind === 'callback' ? (
        <CallbackView
          config={cfg}
          url={phase.url}
          onDone={() => setPhase({ kind: 'ready' })}
        />
      ) : (
        <ConnectedApp config={cfg} />
      )}
    </JotaiProvider>
  );
}

function ConnectedApp({ config }: { readonly config: ShellConfig }) {
  const setAgentContext = useSetAtom(agentContextAtom);
  const bumpAuth = useSetAtom(authVersionAtom);
  // U-4 — surface a "Moved to Trash · Undo" toast the moment a UI
  // delete commits and its inverse is registered. useSetAtom returns a
  // stable setter, so referencing it in the invoker memo below doesn't
  // rebuild the invoker.
  const setPendingDeleteUndo = useSetAtom(pendingDeleteUndoAtom);
  // PR 44 — token accessor with auto-refresh. Replaces the bare
  // `authStorage.loadTokens()?.accessToken ?? null` at every invoker /
  // push / approval-store wiring. `getAccessToken` checks expiresAtMs
  // (with 30s skew), refreshes via refresh_token when expired, and
  // clears storage on refresh failure so the next render lands on
  // SignedOutView instead of firing 401s with a stale Bearer.
  const getAuthTokenAsync = useCallback(
    async (): Promise<string | null> =>
      getAccessToken({ config, storage: authStorage }),
    [config],
  );
  const invoker = useMemo<Invoker>(
    () =>
      // Three-layer composition (outermost → innermost):
      //   loggingInvoker — appends an action-log entry on every
      //                    successful invocation (D-052).
      //   cachedInvoker  — stale-while-revalidate persistent cache
      //                    (D-051). Cache hits skip the network but
      //                    are still logged.
      //   jmapInvoker    — actual JMAP fetch via the WASM client.
      loggingInvoker({
        inner: cachedInvoker({
          inner: jmapInvoker({
            baseUrl: config.jmapBaseUrl ?? config.oidcIssuer,
            getAuthToken: getAuthTokenAsync,
          }),
          store: cacheStorage,
        }),
        log: actionLog,
        undoRegistry,
        getIdentity: () => {
          const t = authStorage.loadTokens();
          if (t === null) return null;
          return { id: t.subject ?? t.email ?? 'unknown' };
        },
        // PR 44 — flip to SignedOutView the moment a 401 surfaces.
        // getAccessToken() already clears storage on refresh failure,
        // so this catches the rarer case where a token is somehow
        // still believed-valid by the local clock but Stalwart has
        // rotated keys / revoked the session. Best-effort; storage
        // already might be empty.
        onUnauthorized: () => {
          void authStorage.clearTokens().then(() => bumpAuth((v) => v + 1));
        },
        // U-4 — only UI deletes get the act-then-undo toast; agent
        // deletes are surfaced in the Activity log instead.
        onUndoRegistered: (info) => {
          if (info.tool !== 'mail.delete' || info.callerClass !== 'ui') return;
          const emailIds =
            (info.params as { emailIds?: readonly string[] }).emailIds ?? [];
          setPendingDeleteUndo({
            seq: info.seq,
            count: emailIds.length,
            createdAtMs: Date.now(),
          });
        },
      }),
    [config, getAuthTokenAsync, bumpAuth, setPendingDeleteUndo],
  );
  // Populate the agent-context atom from config so capabilities and
  // agent-facing surfaces can read it without re-walking the config.
  useEffect(() => {
    setAgentContext(config.agentContext ?? null);
  }, [config, setAgentContext]);

  // PR 24 — SendBuffer holds outgoing mail.send for the configured
  // delay window. Constructed at the invoker scope so onFire goes
  // through the full logging+caching chain (one append per actual
  // send, not per buffer-enqueue).
  const sendBuffer = useMemo<SendBuffer>(
    () =>
      createSendBuffer({
        onFire: async (params) =>
          // Commit path (no dryRun option) → invoker returns the
          // natural MailSendResult, never a preview. The union
          // return signature of invoke is satisfied by the cast.
          (await invoker.invoke<MailSendInput, MailSendResult>(
            'mail.send',
            params,
          )) as MailSendResult,
        // PR 26 — purge the autosaved draft once the buffered send
        // commits. Buffer only calls this on a successful fire,
        // never on cancel, so Undo keeps the user's draft.
        onPurgeDraft: async (emailId) => {
          await invoker.invoke('mail.purge', { emailIds: [emailId] });
        },
      }),
    [invoker],
  );

  return (
    <IarsmaProvider value={invoker}>
      <SendBufferProvider value={sendBuffer}>
        <Shell config={config} />
      </SendBufferProvider>
    </IarsmaProvider>
  );
}

function Shell({ config }: { readonly config: ShellConfig }) {
  const isSignedIn = useAtomValue(isSignedInAtom);
  const themePreference = useAtomValue(themePreferenceAtom);
  const resolvedTheme = resolveTheme(themePreference);
  // Apply accent + density tokens to the document root so every
  // `var(--accent-h)` / `var(--density)` consumer downstream reflects
  // the user's choices. Effect dependency is the atom values, so
  // changing either picker re-runs the CSS-variable assignment.
  const accent = useAtomValue(accentAtom);
  const density = useAtomValue(densityAtom);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    applyAppearance(document.documentElement, accent, density);
  }, [accent, density]);
  useGlobalKeyboardShortcuts();

  if (!isSignedIn) {
    return (
      <main aria-label="Iarsma — sign in" data-theme={resolvedTheme}>
        <header>
          <h1>Iarsma</h1>
        </header>
        <SignedOutView config={config} />
        <KeyboardHelpOverlay />
      </main>
    );
  }

  return (
    <SignedInShell config={config} resolvedTheme={resolvedTheme} />
  );
}

/**
 * Map a JMAP `ApprovalRequest` to the `ApprovalCardData` the view expects.
 * The summary is a one-line human-readable description of what the agent
 * is asking for — derived from the tool name + params.
 */
function toApprovalCard(req: ApprovalRequest): {
  readonly id: string;
  readonly toolName: string;
  readonly agentName: string;
  readonly summary: string;
  readonly requestedAt: string;
  readonly status: 'pending' | 'approved' | 'denied';
  readonly preview: unknown;
  readonly params: unknown;
} {
  return {
    id: req.id,
    toolName: req.toolName,
    agentName: req.requestingAgentName || req.requestingAgentId,
    summary: summarizeApproval(req),
    requestedAt: req.requestedAt,
    status: req.status,
    preview: req.preview,
    params: req.params,
  };
}

function summarizeApproval(req: ApprovalRequest): string {
  switch (req.toolName) {
    case 'files.propose_write': {
      const p = req.params as { path?: unknown; message?: unknown };
      if (typeof p.path === 'string' && typeof p.message === 'string') {
        return `${p.path}: ${p.message}`;
      }
      return req.toolName;
    }
    default:
      return req.toolName;
  }
}

/**
 * Dispatch an approved action by tool name (Phase 5b, D-053).
 *
 * The MCP server appends pending approvals but never executes destructive
 * GitHub writes — the browser holds those credentials. When the human
 * approves, this function runs the underlying action using the user's
 * IDB-backed GitHub PAT, then the caller flips the approval keyword to
 * `$approval_approved` via the JMAP store.
 *
 * Per-tool dispatch is intentionally explicit (no registry of executors)
 * so the auth posture for each new approve-able tool is reviewed
 * individually before it lands.
 */
async function executeApprovedAction(
  approval: ApprovalRequest,
  gh: ReturnType<typeof githubClient> | null,
): Promise<void> {
  switch (approval.toolName) {
    case 'files.propose_write': {
      if (gh === null) {
        throw new Error(
          'Cannot execute files.propose_write — GitHub is not connected in the browser. ' +
            'Connect under Settings → GitHub Files before approving.',
        );
      }
      const params = approval.params as {
        path?: unknown;
        content?: unknown;
        message?: unknown;
      };
      const preview = approval.preview as {
        diff?: { baseSha?: unknown; isCreate?: unknown };
      };
      if (
        typeof params.path !== 'string' ||
        typeof params.content !== 'string' ||
        typeof params.message !== 'string'
      ) {
        throw new Error('files.propose_write approval is missing path/content/message.');
      }
      const baseSha =
        typeof preview.diff?.baseSha === 'string' && preview.diff.baseSha.length > 0
          ? preview.diff.baseSha
          : undefined;
      await gh.write(
        params.path,
        params.content,
        params.message,
        ...(baseSha !== undefined ? [baseSha] : []),
      );
      return;
    }
    default:
      throw new Error(
        `Approval execution for tool '${approval.toolName}' is not wired in this browser build.`,
      );
  }
}

/** SegmentedControl options for the mail layout toggle. Icon glyphs
 *  match the §12 mockup: two vertical bars = side-by-side, two
 *  horizontal bars = stacked. */
const MAIL_LAYOUT_OPTIONS: ReadonlyArray<SegmentedOption<MailLayoutType>> = [
  {
    value: 'side',
    label: 'Side-by-side',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <rect x="0.5" y="0.5" width="6" height="13" rx="1" stroke="currentColor" />
        <rect x="7.5" y="0.5" width="6" height="13" rx="1" stroke="currentColor" />
      </svg>
    ),
  },
  {
    value: 'stacked',
    label: 'Stacked',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <rect x="0.5" y="0.5" width="13" height="6" rx="1" stroke="currentColor" />
        <rect x="0.5" y="7.5" width="13" height="6" rx="1" stroke="currentColor" />
      </svg>
    ),
  },
];

/**
 * The signed-in shell with responsive sidebar/top-bar/bottom-nav layout.
 * Separated from Shell so hooks that depend on signed-in state (session,
 * mailboxes) are only called when authenticated.
 */
function SignedInShell({
  config,
  resolvedTheme,
}: {
  readonly config: ShellConfig;
  readonly resolvedTheme: 'light' | 'dark';
}) {
  const breakpoint = useBreakpoint();
  const isMobile = breakpoint === 'mobile';
  const isTablet = breakpoint === 'tablet';
  const isDesktop = breakpoint === 'desktop';
  // P1.3 — let the sidebar Help button open the shortcuts overlay.
  const setKeyboardHelpOpen = useSetAtom(keyboardHelpOpenAtom);

  // PR 46 — bidirectional sync between window.location and the
  // view / mailbox / thread / search atoms. The hook reads the URL
  // on mount, listens for popstate, and pushes new history entries
  // on atom changes. Deep links + back/forward + tab title now all
  // reflect the actual view rather than /auth/callback?...
  useRouter();

  const [activeView, setActiveView] = useAtom(activeViewAtom);
  const [themePreference, setThemePreference] = useAtom(themePreferenceAtom);
  const setCompose = useSetAtom(composeStateAtom);
  const openCompose = useCallback(() => setCompose({ kind: 'open', prefill: {} }), [setCompose]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const session = useSessionGet({});
  const tokens = useAtomValue(tokensAtom);
  const bumpAuth = useSetAtom(authVersionAtom);
  const invoker = useInvoker();
  // PR 44 — shared expiry-aware token accessor for the push hook and
  // the approval store. Mirrors the one in ConnectedApp; both call
  // getAccessToken() so a stale access_token gets refreshed via the
  // refresh_token before the first 401 lands.
  const getAuthTokenAsync = useCallback(
    async (): Promise<string | null> =>
      getAccessToken({ config, storage: authStorage }),
    [config],
  );
  const [crudRefresh, setCrudRefresh] = useState(0);

  // PR 54 — organizer identity for new/edited calendar events.
  // Derived from the auth-cached email; the calendar view passes this
  // through `buildEventParticipants` when the user has attendees on
  // the event so Stalwart's scheduling stack knows who's sending the
  // iTIP REQUEST. When tokens.email isn't set yet (first paint), we
  // skip the organizer entry — the user has to wait for auth before
  // they can invite anyone.
  const organizerIdentity = useMemo(
    () => {
      const email = tokens?.email;
      if (email === undefined) return undefined;
      const name = session.data?.username;
      return name !== undefined
        ? { email, name }
        : { email };
    },
    [tokens?.email, session.data?.username],
  );

  // PR 29 — JMAP push (RFC 8620 §7) replaces the manual-refresh model.
  // Opens an EventSource to the server's eventSourceUrl; on any
  // StateChange, bumps pushGenerationAtom which useReadHook folds into
  // its refetch key. The shell-side cachedInvoker handles the actual
  // dedup + stale-while-revalidate.
  //
  // Connection only opens once session.data resolves (so the
  // eventSourceUrl is known) and tears down on sign-out (session.data
  // returns undefined when tokens clear).
  const bumpPushGeneration = useSetAtom(pushGenerationAtom);
  // PR 57 — track session identity for the push subscription off the
  // load-bearing fields ONLY (URL + account + token capability set).
  // A naive `[session.data]` dep made every read-hook refetch (which
  // produces a new Session object even when contents are identical)
  // tear down + reopen the SSE; the reopen drained pending state
  // events which bumped `pushGenerationAtom`, which refetched
  // `useSessionGet`, which restarted the cycle — the v0.10.20
  // post-click flicker loop. Keying off the URL + accountId makes
  // pushSession identity-stable across content-equal refetches and
  // breaks the loop.
  const pushSessionRaw = session.data as Session | undefined;
  const pushSessionKey =
    pushSessionRaw !== undefined
      ? `${pushSessionRaw.eventSourceUrl}|${pushSessionRaw.primaryAccountIdMail}`
      : '';
  const pushSession: Session | null = useMemo(() => {
    if (pushSessionRaw === undefined) return null;
    return pushSessionRaw;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pushSessionKey]);
  usePushSubscription({
    session: pushSession,
    getAuthToken: getAuthTokenAsync,
    onStateChange: () => bumpPushGeneration((n) => n + 1),
  });
  const [searchQuery, setSearchQuery] = useAtom(searchQueryAtom);
  const [mailLayout, setMailLayout] = useAtom(mailLayoutAtom);
  const [selectedMailboxId, setSelectedMailboxId] = useAtom(selectedMailboxIdAtom);
  const mailboxListResult = useMailboxList({});
  const sidebarMailboxes = useMemo(() => {
    if (mailboxListResult.data === undefined) return undefined;
    return (mailboxListResult.data as ReadonlyArray<{
      id: string;
      name: string;
      role?: string;
      unreadEmails: number;
      parentId?: string;
    }>).map((m) => {
      const entry: { id: string; name: string; role?: string; unreadCount: number; parentId?: string | null } = {
        id: m.id,
        name: m.name,
        unreadCount: m.unreadEmails,
      };
      if (m.role !== undefined) entry.role = m.role;
      if (m.parentId !== undefined) entry.parentId = m.parentId;
      return entry;
    });
  }, [mailboxListResult.data]);

  // Auto-select the Inbox the first time mailboxes load (§6.4 "no dead clicks").
  // Without this, clicking Mail in the nav leaves both panes blank because
  // `selectedMailboxIdAtom` defaults to null. Prefer `role: 'inbox'`; fall back
  // to the first mailbox in display order. Only fires when nothing is selected
  // yet — a deliberate later switch to a different mailbox is never overridden.
  useEffect(() => {
    if (selectedMailboxId !== null) return;
    if (sidebarMailboxes === undefined || sidebarMailboxes.length === 0) return;
    const inbox = sidebarMailboxes.find((m) => m.role === 'inbox');
    const first = sidebarMailboxes[0];
    const pick = inbox ?? first;
    if (pick !== undefined) {
      setSelectedMailboxId(pick.id);
    }
  }, [selectedMailboxId, setSelectedMailboxId, sidebarMailboxes]);

  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const handleLayoutChange = useCallback(
    (layout: MailLayoutType) => {
      setMailLayout(layout);
      localStorage.setItem('iarsma-mail-layout', layout);
    },
    [setMailLayout],
  );

  // Sidebar drawer state (tablet only)
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const toggleSidebar = useCallback(() => setSidebarOpen((o) => !o), []);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  // Calendar view state
  const [calendarView, setCalendarView] = useState<'month' | 'week' | 'day'>('month');
  const [calendarDate, setCalendarDate] = useState(() => new Date());

  // Calendar data fetching
  const [calendars, setCalendars] = useState<ReadonlyArray<{ id: string; name: string; color?: string }>>([]);
  const [calendarEvents, setCalendarEvents] = useState<ReadonlyArray<{
    id: string;
    title: string;
    start: string;
    duration?: string;
    calendarColor?: string;
    calendarId?: string;
  }>>([]);

  useEffect(() => {
    if (activeView !== 'calendar') return;
    let cancelled = false;
    (async () => {
      try {
        const list = await invoker.invoke<unknown, ReadonlyArray<{ id: string; name: string; color?: string }>>('calendar.list', {});
        if (!cancelled) setCalendars(list as ReadonlyArray<{ id: string; name: string; color?: string }>);

        const monthStart = new Date(calendarDate.getFullYear(), calendarDate.getMonth(), 1);
        const monthEnd = new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 2, 1);
        type EventListItem = {
          id: string;
          title: string;
          start: string;
          duration?: string;
          description?: string;
          locations?: Readonly<Record<string, { name?: string }>>;
          calendarIds?: Readonly<Record<string, boolean>>;
          participants?: Readonly<Record<string, {
            email: string;
            name?: string;
            roles?: Readonly<Record<string, boolean>>;
            participationStatus?: string;
            expectReply?: boolean;
          }>>;
        };
        const events = await invoker.invoke<unknown, { events: ReadonlyArray<EventListItem> }>('event.list', {
          after: monthStart.toISOString(),
          before: monthEnd.toISOString(),
        });
        if (!cancelled) {
          const e = events as { events: ReadonlyArray<EventListItem> };
          // Map JMAP's calendarIds:{cal-1:true} → flat calendarId for the
          // view. Pick the first true entry; multi-calendar membership is
          // a rare case we can revisit when it matters.
          const calList = list as ReadonlyArray<{ id: string; name: string; color?: string }>;
          const colorByCalId = new Map<string, string | undefined>(
            calList.map((c) => [c.id, c.color]),
          );
          const mapped = (e.events ?? []).map((evt) =>
            toCalendarViewEvent(evt, colorByCalId),
          );
          setCalendarEvents(mapped);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[iarsma] calendar fetch failed:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [activeView, calendarDate, invoker, crudRefresh]);

  // Calendar visibility — hidden-set atom is persisted; events whose
  // calendarId is in the set are filtered out before reaching the view.
  const [hiddenCalendarIds, setHiddenCalendarIds] = useAtom(hiddenCalendarIdsAtom);
  const visibleCalendarEvents = useMemo(() => {
    if (hiddenCalendarIds.length === 0) return calendarEvents;
    const hidden = new Set(hiddenCalendarIds);
    return calendarEvents.filter(
      (e) => e.calendarId === undefined || !hidden.has(e.calendarId),
    );
  }, [calendarEvents, hiddenCalendarIds]);

  // Contacts data fetching
  const [contacts, setContacts] = useState<ReadonlyArray<{
    id: string;
    name?: { full?: string; given?: string; surname?: string };
    emails?: ReadonlyArray<{ address: string; label?: string }>;
    phones?: ReadonlyArray<{ number: string; label?: string }>;
    organizations?: ReadonlyArray<{ name?: string; title?: string }>;
  }>>([]);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [contactSearch, setContactSearch] = useState('');
  const [addressBookId, setAddressBookId] = useState<string | null>(null);

  useEffect(() => {
    if (activeView !== 'contacts') return;
    let cancelled = false;
    (async () => {
      try {
        // Fetch address book ID directly (we don't have a capability for it).
        const sessionResult = await invoker.invoke<unknown, { apiUrl: string; primaryAccountIdMail: string }>('session.get', {});
        const sess = sessionResult as { apiUrl: string; primaryAccountIdMail: string };
        const tok = tokens?.accessToken;
        if (tok !== undefined && tok !== null) {
          const resp = await fetch(sess.apiUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${tok}`,
            },
            body: JSON.stringify({
              using: ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:contacts'],
              methodCalls: [['AddressBook/get', { accountId: sess.primaryAccountIdMail }, '0']],
            }),
          });
          if (resp.ok) {
            const data = await resp.json() as { methodResponses: Array<[string, { list: Array<{ id: string; isDefault?: boolean }> }, string]> };
            const books = data.methodResponses[0]?.[1]?.list ?? [];
            const defaultBook = books.find((b) => b.isDefault) ?? books[0];
            if (!cancelled && defaultBook !== undefined) {
              setAddressBookId(defaultBook.id);
            }
          }
        }

        const result = await invoker.invoke<unknown, { contacts: ReadonlyArray<typeof contacts[number]> }>(
          'contact.list',
          { query: contactSearch },
        );
        if (!cancelled) {
          const r = result as { contacts: ReadonlyArray<typeof contacts[number]> };
          setContacts(r.contacts ?? []);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[iarsma] contacts fetch failed:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [activeView, contactSearch, invoker, crudRefresh, tokens]);

  // Expose search input ref globally for `/` keybinding.
  useEffect(() => {
    searchInputRefHandle.current = searchInputRef.current;
    return () => {
      searchInputRefHandle.current = null;
    };
  }, []);

  // ─── Approval queue state ───────────────────────────────────────
  // The store reads from a dedicated "Approvals" JMAP mailbox the MCP
  // server appends to via `files.propose_write` (Phase 5b, D-053).
  const approvalStore = useMemo<ApprovalStore>(
    () =>
      jmapApprovalStore({
        baseUrl: config.jmapBaseUrl ?? config.oidcIssuer,
        getAuthToken: getAuthTokenAsync,
      }),
    [config, getAuthTokenAsync],
  );
  const [approvals, setApprovals] = useState<readonly ApprovalRequest[]>([]);

  // ─── GitHub Files state ─────────────────────────────────────────
  const githubConfigStore = useMemo(
    () =>
      typeof indexedDB !== 'undefined'
        ? indexedDbGitHubConfigStore()
        : inMemoryGitHubConfigStore(),
    [],
  );
  const [githubConfig, setGithubConfig] = useState<GitHubStoredConfig | null>(null);
  const [filesTree, setFilesTree] = useState<readonly FileTreeNode[]>([]);
  const [filesSelectedPath, setFilesSelectedPath] = useState<string | null>(null);
  const [filesSelectedContent, setFilesSelectedContent] = useState<FilesViewContent | null>(null);
  const [filesHistory, setFilesHistory] = useState<readonly CommitHistoryEntry[]>([]);
  const [filesLoadingTree, setFilesLoadingTree] = useState(false);
  const [filesLoadingContent, setFilesLoadingContent] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);

  // Load saved GitHub config on mount
  useEffect(() => {
    let cancelled = false;
    githubConfigStore.load().then((cfg) => {
      if (!cancelled && cfg !== null) setGithubConfig(cfg);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [githubConfigStore]);

  // Refresh the approval list every time the user opens the Approvals view.
  // Polling is intentionally manual — push subscriptions land in a later
  // phase. For Phase 5b the user navigates to the view to see new approvals.
  useEffect(() => {
    if (activeView !== 'approvals') return;
    let cancelled = false;
    approvalStore.list({ status: 'pending' })
      .then((list) => {
        if (!cancelled) setApprovals(list);
      })
      .catch(() => {
        if (!cancelled) setApprovals([]);
      });
    return () => { cancelled = true; };
  }, [activeView, approvalStore, crudRefresh]);

  const gh = useMemo(() => {
    if (githubConfig === null) return null;
    return githubClient({
      token: githubConfig.token,
      owner: githubConfig.owner,
      repo: githubConfig.repo,
      branch: githubConfig.branch,
    });
  }, [githubConfig]);

  // Load top-level tree when entering files view with valid config
  useEffect(() => {
    if (activeView !== 'files' || gh === null) return;
    let cancelled = false;
    setFilesLoadingTree(true);
    setFilesError(null);
    gh.list('').then((entries) => {
      if (!cancelled) {
        setFilesTree(entries);
        if (entries.length === 0) {
          setFilesError(`No files found at the root of ${githubConfig?.owner}/${githubConfig?.repo} on branch '${githubConfig?.branch}'. Verify the branch name (default branches are often 'main' or 'master') and that your token has access.`);
        }
      }
    }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error('[iarsma] files list failed:', err);
      if (!cancelled) {
        setFilesTree([]);
        setFilesError(`Failed to load repo contents: ${msg}`);
      }
    }).finally(() => {
      if (!cancelled) setFilesLoadingTree(false);
    });
    return () => { cancelled = true; };
  }, [activeView, gh, githubConfig]);

  const handleFilesConnect = useCallback(async (cfg: GitHubConfig) => {
    const stored: GitHubStoredConfig = {
      token: cfg.token,
      owner: cfg.owner,
      repo: cfg.repo,
      branch: cfg.branch ?? 'main',
      connectedAt: new Date().toISOString(),
    };
    await githubConfigStore.save(stored);
    setGithubConfig(stored);
  }, [githubConfigStore]);

  const handleFilesDisconnect = useCallback(async () => {
    await githubConfigStore.clear();
    setGithubConfig(null);
    setFilesTree([]);
    setFilesSelectedPath(null);
    setFilesSelectedContent(null);
    setFilesHistory([]);
  }, [githubConfigStore]);

  const handleFilesExpandDir = useCallback(async (path: string): Promise<readonly FileTreeNode[]> => {
    if (gh === null) return [];
    return gh.list(path);
  }, [gh]);

  const handleFilesSelectPath = useCallback((path: string) => {
    if (gh === null) return;
    setFilesSelectedPath(path);
    setFilesLoadingContent(true);
    (async () => {
      try {
        const content = await gh.read(path);
        setFilesSelectedContent(content);
        const history = await gh.history(path, 20);
        setFilesHistory(history);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[iarsma] files read failed:', err);
      } finally {
        setFilesLoadingContent(false);
      }
    })();
  }, [gh]);

  const handleFilesSave = useCallback(async (path: string, newContent: string, sha: string, message: string) => {
    if (gh === null) throw new Error('Not connected to GitHub');
    await gh.write(path, newContent, message, sha);
    // Refetch content + history
    const fresh = await gh.read(path);
    setFilesSelectedContent(fresh);
    const history = await gh.history(path, 20);
    setFilesHistory(history);
  }, [gh]);

  const userName = session.data?.username ?? tokens?.email;

  const onSignOut = useCallback(() => {
    void (async () => {
      await signOut({ config, storage: authStorage });
      try {
        await cacheStorage.clearAll();
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[iarsma] failed to clear capability cache on sign-out:', e);
      }
      bumpAuth((v) => v + 1);
    })();
  }, [config, bumpAuth]);

  // Command palette (⌘K / Ctrl-K). Items navigate the shell + cover the
  // commands the user most often reaches via clicks. The palette closes
  // itself before invoking each item's action, so navigation is single-tick.
  const paletteItems = useMemo<readonly CommandItem[]>(() => [
    { id: 'go-mail', label: 'Go to Mail', hint: 'Inbox', action: () => setActiveView('mail') },
    { id: 'go-calendar', label: 'Go to Calendar', action: () => setActiveView('calendar') },
    { id: 'go-contacts', label: 'Go to Contacts', action: () => setActiveView('contacts') },
    { id: 'go-files', label: 'Go to Files', action: () => setActiveView('files') },
    { id: 'go-approvals', label: 'Go to Approvals', action: () => setActiveView('approvals') },
    { id: 'go-activity', label: 'Go to Activity', action: () => setActiveView('activity') },
    { id: 'go-settings', label: 'Go to Settings', action: () => setActiveView('settings') },
    { id: 'compose', label: 'Compose new message', hint: 'c', action: openCompose },
    { id: 'sign-out', label: 'Sign out', action: onSignOut },
  ], [setActiveView, openCompose, onSignOut]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // ⌘K on Mac, Ctrl-K everywhere else. Toggling (vs. open-only) lets
      // the same shortcut close the palette without reaching for Escape.
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Agent token management (settings view).
  //
  // PR 39 / D-058: switched from `localTokenIssuer` (which generated
  // throw-away local UUIDs that never reached Stalwart) to
  // `stalwartApiKeyIssuer` which creates real Stalwart API keys via
  // `x:ApiKey/set`. The Stalwart server is the source of truth: list
  // and revoke work from any device. Local IDB metadata is no longer
  // load-bearing; the `metadataStore` stays only as a fallback for
  // testing environments without a Stalwart session.
  const metadataStore = useMemo(
    () =>
      typeof indexedDB !== 'undefined'
        ? indexedDbAgentMetadataStore()
        : inMemoryAgentMetadataStore(),
    [],
  );
  const sessionData = session.data as
    | { apiUrl: string; primaryAccountIdMail: string }
    | undefined;
  const userToken = tokens?.accessToken ?? null;
  const issuer = useMemo(() => {
    if (sessionData === undefined || userToken === null) {
      // Pre-session: fall back to the in-memory local issuer so the
      // Settings view can still render (no rows to list). Once the
      // session resolves the real issuer replaces this and the
      // listTokens effect re-runs.
      return localTokenIssuer({ metadataStore });
    }
    return stalwartApiKeyIssuer({
      jmapUrl: sessionData.apiUrl,
      userToken,
      accountId: sessionData.primaryAccountIdMail,
    });
  }, [sessionData, userToken, metadataStore]);

  const [agentTokens, setAgentTokens] = useState<readonly AgentTokenInfo[]>([]);

  useEffect(() => {
    let cancelled = false;
    issuer.listTokens().then(
      (list) => { if (!cancelled) setAgentTokens(list); },
      () => { /* swallow — UI shows the empty state when nothing loads */ },
    );
    return () => { cancelled = true; };
  }, [issuer]);

  const handleIssue = async (name: string, scopes: readonly string[], lifetimeSec: number) => {
    const result = await issuer.issueToken({ name, scopes, lifetimeSec });
    const refreshed = await issuer.listTokens();
    setAgentTokens(refreshed);
    return result;
  };
  const handleRevoke = async (tokenId: string) => {
    await issuer.revokeToken(tokenId);
    const refreshed = await issuer.listTokens();
    setAgentTokens(refreshed);
  };

  // Activity view — wires the action log to a paginated, filterable
  // table. Phase 0 reads the whole chain into memory and slices in JS;
  // Phase 1's verified-prefix caching will move pagination server-side.
  const activity = useActivityLog({
    actorTokenName: useCallback(
      (tokenId: string) =>
        agentTokens.find((t) => t.tokenId === tokenId)?.name ?? tokenId,
      [agentTokens],
    ),
  });
  const setActivityFilters = useSetAtom(activityFiltersAtom);

  // Agent dashboard (PR 38). Derives aggregate + per-agent metrics
  // from the same raw chain useActivityLog already polls — no
  // duplicate fetch loop.
  const agentDashboard = useAgentDashboard({
    tokens: agentTokens,
    entries: activity.allEntries,
  });

  // PR 21 — Activity row's Undo button. Looks up the inverse, runs
  // it through the same invoker (so it's logged + cached + visible
  // in the chain as a normal action), then marks the original undo
  // entry consumed.
  const handleUndo = useCallback(
    (seq: number) => {
      void (async () => {
        const u = await undoRegistry.forEntry(seq);
        if (u === null || u.consumed) return;
        try {
          await invoker.invoke(u.inverseAction, u.inverseParams);
          await undoRegistry.consume(seq);
          setCrudRefresh((n) => n + 1);
          // Restored mail must reappear in the thread list / unread
          // badge — bump push-generation so the read hooks refetch.
          bumpPushGeneration((n) => n + 1);
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error('[iarsma] undo failed:', e);
        }
      })();
    },
    [invoker, bumpPushGeneration],
  );

  // View title for mobile top bar
  const VIEW_TITLES: Record<ActiveView, string> = {
    mail: 'Mail',
    outbox: 'Outbox',
    calendar: 'Calendar',
    contacts: 'Contacts',
    files: 'Files',
    approvals: 'Approvals',
    agents: 'Agents',
    activity: 'Activity',
    settings: 'Settings',
  };

  const outboxCount = useOutboxCount();

  // Phase 3 #9 — surface unread Inbox count as a sidebar badge,
  // document.title prefix, and a polite live-region announce when
  // the count goes up (only "up" — reading a message shouldn't
  // re-announce). Push (PR 29) invalidates the mailbox.list cache
  // on every Email/Mailbox state change, so this reacts in real
  // time without an explicit subscription here.
  const inboxUnreadCount = useMemo(() => {
    if (sidebarMailboxes === undefined) return 0;
    const inbox = sidebarMailboxes.find((m) => m.role === 'inbox');
    return inbox?.unreadCount ?? 0;
  }, [sidebarMailboxes]);
  const prevInboxUnreadRef = useRef<number | null>(null);
  useEffect(() => {
    updateTabTitle(inboxUnreadCount);
    const prev = prevInboxUnreadRef.current;
    if (prev !== null && inboxUnreadCount > prev) {
      announceUnreadDelta(inboxUnreadCount - prev);
    }
    prevInboxUnreadRef.current = inboxUnreadCount;
  }, [inboxUnreadCount]);

  return (
    <main
      className={layoutStyles.app}
      aria-label="Iarsma — signed in"
      data-theme={resolvedTheme}
    >
      {/* Desktop/Tablet: Sidebar */}
      {!isMobile && (
        <Sidebar
          activeView={activeView}
          onNavigate={setActiveView}
          onCompose={openCompose}
          userName={userName}
          onSignOut={onSignOut}
          onOpenHelp={() => setKeyboardHelpOpen(true)}
          theme={themePreference}
          onThemeChange={setThemePreference}
          isOpen={sidebarOpen}
          onClose={closeSidebar}
          outboxCount={outboxCount}
          inboxUnreadCount={inboxUnreadCount}
          {...(sidebarMailboxes !== undefined ? { mailboxes: sidebarMailboxes } : {})}
          onMailboxSelect={setSelectedMailboxId}
          {...(selectedMailboxId !== null ? { selectedMailboxId } : {})}
        />
      )}


      {/* Tablet: Top bar with hamburger */}
      {isTablet && (
        <TopBar
          title={VIEW_TITLES[activeView]}
          onMenuToggle={toggleSidebar}
        />
      )}

      {/* Mobile: Top bar with title */}
      {isMobile && (
        <TopBar title={VIEW_TITLES[activeView]} />
      )}

      {/* Main content area */}
      <div className={layoutStyles.content}>
        {/* Search bar (visible on all breakpoints when in mail view) */}
        {activeView === 'mail' && (
          <div style={{ display: 'flex', gap: '0.5em', alignItems: 'center', padding: isDesktop ? 'var(--space-md)' : 'var(--space-sm)' }}>
            <label htmlFor="thread-search-input" style={{ flex: '0 0 auto' }}>
              Search:
            </label>
            <input
              id="thread-search-input"
              ref={searchInputRef}
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setSearchQuery('');
                  e.currentTarget.blur();
                }
              }}
              placeholder="Search every mailbox..."
              aria-label="Search threads"
              style={{
                flex: '1 1 auto',
                maxWidth: '30em',
                padding: '0.3em 0.5em',
                font: 'inherit',
                border: '1px solid var(--surface-3)',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--surface-1)',
                color: 'var(--text-1)',
              }}
            />
            {searchQuery !== '' ? (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
              >
                Clear
              </button>
            ) : null}
            <SegmentedControl
              label="Mail layout"
              size="sm"
              options={MAIL_LAYOUT_OPTIONS}
              value={mailLayout}
              onChange={handleLayoutChange}
              {...(layoutStyles.mailLayoutToggle !== undefined
                ? { className: layoutStyles.mailLayoutToggle }
                : {})}
            />
          </div>
        )}

        {activeView === 'mail' ? (
          <MailLayout isLoading={session.isLoading} error={session.error} layout={mailLayout} />
        ) : activeView === 'calendar' ? (
          <CalendarView
            events={visibleCalendarEvents}
            calendars={calendars}
            hiddenCalendarIds={hiddenCalendarIds}
            onToggleCalendar={(id) =>
              setHiddenCalendarIds(toggleCalendarId(hiddenCalendarIds, id))
            }
            view={calendarView}
            onViewChange={setCalendarView}
            currentDate={calendarDate}
            onDateChange={setCalendarDate}
            onSaveEvent={async (data) => {
              const defaultCalendar = calendars[0];
              if (defaultCalendar === undefined) {
                throw new Error('No calendar available to create event in.');
              }
              const startIso = `${data.date}T${data.startTime}:00`;
              const participants = buildEventParticipants(
                data.attendees,
                organizerIdentity,
              );
              await invoker.invoke('event.create', {
                calendarId: defaultCalendar.id,
                title: data.title,
                start: startIso,
                duration: data.duration,
                ...(data.description !== undefined ? { description: data.description } : {}),
                ...(data.location !== undefined ? { location: data.location } : {}),
                ...(participants !== undefined ? { participants } : {}),
              });
              setCrudRefresh((n) => n + 1);
            }}
            onUpdateEvent={async (id, data) => {
              const startIso = `${data.date}T${data.startTime}:00`;
              const participants = buildEventParticipants(
                data.attendees,
                organizerIdentity,
              );
              await invoker.invoke('event.update', {
                eventId: id,
                title: data.title,
                start: startIso,
                duration: data.duration,
                ...(data.description !== undefined ? { description: data.description } : {}),
                ...(data.location !== undefined ? { location: data.location } : {}),
                // Always send participants on update (even empty array)
                // so the user removing the last attendee actually
                // clears the field server-side.
                ...(participants !== undefined ? { participants } : {}),
              });
              setCrudRefresh((n) => n + 1);
            }}
            onDeleteEvent={async (id) => {
              await invoker.invoke('event.delete', { eventId: id });
              setCrudRefresh((n) => n + 1);
            }}
          />
        ) : activeView === 'contacts' ? (
          <ContactsView
            contacts={contacts}
            selectedContact={
              contacts.find((c) => c.id === selectedContactId) ?? null
            }
            onSelect={setSelectedContactId}
            onSearch={setContactSearch}
            searchQuery={contactSearch}
            onCreateContact={async (data) => {
              if (addressBookId === null) {
                throw new Error('No address book available. Reload and try again.');
              }
              const nameObj: { full?: string; given?: string; surname?: string } = {};
              if (data.givenName !== undefined) nameObj.given = data.givenName;
              if (data.surname !== undefined) nameObj.surname = data.surname;
              const emails = data.email !== undefined ? [{ address: data.email }] : undefined;
              const phones = data.phone !== undefined ? [{ number: data.phone }] : undefined;
              const orgs = (data.organization !== undefined || data.title !== undefined)
                ? [{ ...(data.organization !== undefined ? { name: data.organization } : {}), ...(data.title !== undefined ? { title: data.title } : {}) }]
                : undefined;
              try {
                await invoker.invoke('contact.create', {
                  addressBookId,
                  name: nameObj,
                  ...(emails !== undefined ? { emails } : {}),
                  ...(phones !== undefined ? { phones } : {}),
                  ...(orgs !== undefined ? { organizations: orgs } : {}),
                });
                setCrudRefresh((n) => n + 1);
              } catch (err) {
                // eslint-disable-next-line no-console
                console.error('[iarsma] contact create failed:', err);
                throw err;
              }
            }}
            onUpdateContact={async (id, data) => {
              const nameObj: { full?: string; given?: string; surname?: string } = {};
              if (data.givenName !== undefined) nameObj.given = data.givenName;
              if (data.surname !== undefined) nameObj.surname = data.surname;
              const emails = data.email !== undefined ? [{ address: data.email }] : undefined;
              const phones = data.phone !== undefined ? [{ number: data.phone }] : undefined;
              await invoker.invoke('contact.update', {
                contactId: id,
                name: nameObj,
                ...(emails !== undefined ? { emails } : {}),
                ...(phones !== undefined ? { phones } : {}),
              });
              setCrudRefresh((n) => n + 1);
            }}
            onDeleteContact={async (id) => {
              await invoker.invoke('contact.delete', { contactId: id });
              setSelectedContactId(null);
              setCrudRefresh((n) => n + 1);
            }}
          />
        ) : activeView === 'approvals' ? (
          <ApprovalsView
            approvals={approvals.map(toApprovalCard)}
            onApprove={async (id) => {
              const approval = approvals.find((a) => a.id === id);
              if (approval === undefined) return;
              await executeApprovedAction(approval, gh);
              await approvalStore.approve(id);
              setCrudRefresh((n) => n + 1);
            }}
            onDeny={async (id) => {
              await approvalStore.deny(id);
              setCrudRefresh((n) => n + 1);
            }}
          />
        ) : activeView === 'outbox' ? (
          <OutboxView />
        ) : activeView === 'agents' ? (
          <AgentDashboardView
            aggregate={agentDashboard.aggregate}
            agents={agentDashboard.agents}
            onIssue={handleIssue}
            onRevoke={handleRevoke}
            onViewActivity={(agentName) => {
              setActivityFilters((prev) => ({ ...prev, actor: agentName }));
              setActiveView('activity');
            }}
          />
        ) : activeView === 'activity' ? (
          <ActivityView
            entries={activity.entries}
            isLoading={activity.isLoading}
            integrityStatus={activity.integrityStatus}
            {...(activity.integrityError !== undefined
              ? { integrityError: activity.integrityError }
              : {})}
            onVerify={activity.onVerify}
            filters={activity.filters}
            onFilterChange={activity.onFilterChange}
            page={activity.page}
            pageSize={activity.pageSize}
            totalEntries={activity.totalEntries}
            onPageChange={activity.onPageChange}
            undoableSeqs={new Set(activity.undoBySeq.keys())}
            onUndo={handleUndo}
          />
        ) : activeView === 'files' ? (
          <FilesView
            config={githubConfig !== null ? { owner: githubConfig.owner, repo: githubConfig.repo, branch: githubConfig.branch } : null}
            tree={filesTree}
            selectedPath={filesSelectedPath}
            selectedContent={filesSelectedContent}
            history={filesHistory}
            isLoadingTree={filesLoadingTree}
            isLoadingContent={filesLoadingContent}
            error={filesError}
            onSelectPath={handleFilesSelectPath}
            onExpandDir={handleFilesExpandDir}
            onSave={handleFilesSave}
            onDisconnect={handleFilesDisconnect}
            onOpenSettings={() => setActiveView('settings')}
          />
        ) : activeView === 'settings' ? (
          <AgentSettingsView
            files={{
              currentConfig: githubConfig !== null ? { owner: githubConfig.owner, repo: githubConfig.repo, branch: githubConfig.branch } : null,
              onConnect: handleFilesConnect,
              onDisconnect: handleFilesDisconnect,
            }}
            {...(userName !== undefined ? { userName } : {})}
            onSignOut={onSignOut}
          />
        ) : null /* activeView is a closed union — every case is handled above */}
      </div>

      {/* Mobile: Bottom nav */}
      {isMobile && (
        <BottomNav
          activeView={activeView}
          onNavigate={setActiveView}
          outboxCount={outboxCount}
          inboxUnreadCount={inboxUnreadCount}
          onSignOut={onSignOut}
        />
      )}

      <KeyboardHelpOverlay />
      <ComposeView />
      <SendToast />
      <DeleteToast onUndo={handleUndo} />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        items={paletteItems}
      />
    </main>
  );
}

/**
 * Mail layout — 3-column reading pane (side) or 2-column with stacked
 * thread list + view. Extracted so SignedInShell stays manageable.
 */
function MailLayout({
  isLoading,
  error,
  layout,
}: {
  readonly isLoading: boolean;
  readonly error?: { message: string } | undefined;
  readonly layout: MailLayoutType;
}) {
  // PR 3: pane structure mirrors contacts-view.module.css. Each pane
  // owns its own scroll region; no 70vh magic, no page-level scrolling
  // for thread content. See styles/mail-layout.module.css.
  const containerClass =
    layout === 'stacked'
      ? `${mailLayoutStyles['container']} ${mailLayoutStyles['containerStacked']}`
      : mailLayoutStyles['container'];

  return (
    <div className={containerClass}>
      <section
        aria-label="Selected mailbox"
        className={`${mailLayoutStyles['pane']} ${mailLayoutStyles['listPane']}`}
      >
        {isLoading ? <p>Loading session...</p> : null}
        {error !== undefined ? (
          <p role="alert">Session error: {error.message}</p>
        ) : null}
        <ThreadList />
      </section>
      <section
        aria-label="Selected thread"
        className={`${mailLayoutStyles['pane']} ${mailLayoutStyles['readPane']}`}
      >
        <ThreadView />
      </section>
    </div>
  );
}

/**
 * Window-level keyboard shortcuts:
 *   - `?` opens the keyboard help overlay (suppressed while focus is
 *     inside a text input or contenteditable surface so it doesn't
 *     hijack the question-mark literal).
 *   - `Escape` closes the overlay.
 *
 * Bound to `window` rather than a React subtree because the overlay is
 * triggered from anywhere — including states with no rendered children
 * (e.g. the loading splash).
 */
/**
 * Cross-component handle to the search input. `SignedInView` mounts
 * it and the `/` global keybinding focuses it. The shell is a single-
 * surface app (no nested searches), so a module-level ref is fine —
 * no risk of two SignedInView instances mounting concurrently.
 */
const searchInputRefHandle: { current: HTMLInputElement | null } = {
  current: null,
};

function useGlobalKeyboardShortcuts(): void {
  const setOpen = useSetAtom(keyboardHelpOpenAtom);
  const setComposeState = useSetAtom(composeStateAtom);
  const invoker = useInvoker();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // PR 25 — Cmd-Z / Ctrl-Z = undo the most recent reversible
      // action (the highest-seq active UndoEntry). Suppressed inside
      // editable elements so the browser's native text-undo still
      // works while composing. Shift-modified is Redo by convention
      // and isn't wired yet — let it pass through.
      if ((event.metaKey || event.ctrlKey) && event.key === 'z' && !event.shiftKey) {
        if (isEditableElement(event.target)) return;
        event.preventDefault();
        void (async () => {
          const active = await undoRegistry.list({ activeOnly: true });
          if (active.length === 0) return;
          // Newest first — the user's intuition is "undo the thing
          // I just did".
          const latest = [...active].sort(
            (a, b) => b.forEntrySeq - a.forEntrySeq,
          )[0]!;
          try {
            await invoker.invoke(latest.inverseAction, latest.inverseParams);
            await undoRegistry.consume(latest.forEntrySeq);
          } catch (e) {
            // eslint-disable-next-line no-console
            console.error('[iarsma] cmd-z undo failed:', e);
          }
        })();
        return;
      }
      if (event.key === '?') {
        if (isEditableElement(event.target)) return;
        event.preventDefault();
        setOpen(true);
        return;
      }
      if (event.key === 'c') {
        // `c` opens a new empty composer. Suppressed when focus is in
        // a text input / contenteditable so it doesn't hijack typing.
        if (isEditableElement(event.target)) return;
        event.preventDefault();
        setComposeState({ kind: 'open', prefill: {} });
        return;
      }
      if (event.key === '/') {
        // `/` focuses the search input. Suppressed when focus is in
        // an editable surface (so typing "/" in the composer stays
        // a literal slash).
        if (isEditableElement(event.target)) return;
        const el = searchInputRefHandle.current;
        if (el === null) return;
        event.preventDefault();
        el.focus();
        el.select();
        return;
      }
      if (event.key === 'Escape') {
        // Close even from inside the dialog — the dialog itself doesn't
        // need a separate listener.
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen, setComposeState, invoker]);
}

function isEditableElement(target: EventTarget | null): boolean {
  if (target === null || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}


function CallbackView({
  config,
  url,
  onDone,
}: {
  readonly config: ShellConfig;
  readonly url: URL;
  readonly onDone: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const bumpAuth = useSetAtom(authVersionAtom);
  // The OAuth callback handler MUST run exactly once per mount: it
  // consumes the one-shot PKCE entry from storage and exchanges the
  // single-use authorization code. React StrictMode invokes effects
  // twice in dev to surface side-effect bugs — without this gate the
  // first invocation succeeds and clears storage, the second invocation
  // sees no PKCE entry and reports `pkce_mismatch`, overwriting the
  // success. The ref persists across the StrictMode rerun so only the
  // first execution touches storage / network. (Production runs the
  // effect once, so the gate is a no-op there.)
  //
  // Deliberately no `cancelled` flag: StrictMode's simulated cleanup
  // would flip it true on the first run's behalf and abort the success
  // path even though the call did succeed. The handler is one-shot and
  // mutates global storage atoms, so completing it after a simulated
  // unmount is the correct behavior.
  const hasHandledRef = useRef(false);

  useEffect(() => {
    if (hasHandledRef.current) return;
    hasHandledRef.current = true;
    (async () => {
      try {
        // Pass `storage: authStorage` so the callback reads PKCE +
        // writes tokens into the IDB-backed store (D-050). Default is
        // `sessionAuthStorage()`, which would split the auth state
        // across two backings and leave the shell perpetually signed
        // out after a successful sign-in.
        const tokens = await handleCallback({ config, storage: authStorage }, url);
        // Record the sign-in to the tamper-evident action log (item 8).
        // Identity is the verified id_token subject when available, then
        // email, then a "unknown" sentinel — we never want this append to
        // fail loud and break the otherwise-successful sign-in.
        if (tokens !== null) {
          const id = tokens.subject ?? tokens.email ?? 'unknown';
          try {
            await actionLog.append({
              identity: { id },
              // Sign-in is always initiated by a human in the browser
              // (callerClass is required by the action-log envelope per
              // D-047). MCP/library callers reach the system through
              // already-authenticated paths; auth.signin is UI-only.
              callerClass: 'ui',
              action: 'auth.signin',
              params: {
                ...(tokens.email !== undefined ? { email: tokens.email } : {}),
                ...(tokens.subject !== undefined ? { sub: tokens.subject } : {}),
              },
            });
          } catch (e) {
            // Best-effort — log to console, don't block sign-in. Real
            // failure handling lands when the action-log gains an
            // alerting/escalation surface (Phase 1+).
            // eslint-disable-next-line no-console
            console.warn('[iarsma] failed to append sign-in event to action log:', e);
          }
        }
        // PR 46 — replace the spent callback URL with the app's home
        // route. Previously this only cleared the query string, so
        // the URL stayed at /webmail/auth/callback through the
        // session. Now it lands on /webmail/mail (or wherever the
        // initial route would resolve), and the router hook takes
        // over for subsequent navigation.
        replaceCallbackUrlWithHome();
        bumpAuth((v) => v + 1);
        onDone();
      } catch (e) {
        setError(e instanceof Error ? e.message : describe(e));
      }
    })();
  }, [config, url, onDone, bumpAuth]);

  return (
    <main aria-busy={error === null}>
      <h1>Iarsma — completing sign-in…</h1>
      {error !== null ? (
        <>
          <p role="alert">Sign-in failed: {error}</p>
          <button type="button" onClick={onDone}>
            Back to sign-in
          </button>
        </>
      ) : (
        <p>Exchanging authorization code…</p>
      )}
    </main>
  );
}

function describe(e: unknown): string {
  if (e !== null && typeof e === 'object' && 'message' in e) {
    return String((e as { message: unknown }).message);
  }
  return String(e);
}
