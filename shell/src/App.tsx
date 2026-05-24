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
} from './auth-state.js';
import { composeStateAtom } from './compose-state.js';
import { loadConfig, type ShellConfig } from './config.js';
import { useSessionGet } from './generated/capabilities/session-get.js';
import { useBreakpoint } from './hooks/use-media-query.js';
import { keyboardHelpOpenAtom } from './keyboard-state.js';
import { searchQueryAtom } from './mail-state.js';
import { activeViewAtom } from './nav-state.js';
import type { ActiveView } from './nav-state.js';
import {
  IarsmaProvider,
  cachedInvoker,
  jmapInvoker,
  loggingInvoker,
  type Invoker,
} from './runtime/index.js';
import { inMemoryAgentMetadataStore, indexedDbAgentMetadataStore } from './runtime/agent-metadata-store.js';
import { localTokenIssuer } from './runtime/local-token-issuer.js';
import type { AgentTokenInfo } from './runtime/agent-token-issuer.js';
import { handleCallback, signOut } from './runtime/oauth.js';
import { themePreferenceAtom, resolveTheme } from './runtime/theme.js';
import { BottomNav } from './components/bottom-nav.js';
import { Sidebar } from './components/sidebar.js';
import { TopBar } from './components/top-bar.js';
import { ComposeView } from './views/compose-view.js';
import { ContactsView } from './views/contacts-view.js';
import { AgentSettingsView } from './views/agent-settings-view.js';
import { ActivityView } from './views/activity-view.js';
import { ApprovalsView } from './views/approvals-view.js';
import { CalendarView } from './views/calendar-view.js';
import { KeyboardHelpOverlay } from './views/keyboard-help-overlay.js';
import { MailboxList } from './views/mailbox-list.js';
import { SignedOutView } from './views/signed-out-view.js';
import { ThreadList } from './views/thread-list.js';
import { ThreadView } from './views/thread-view.js';
import layoutStyles from './styles/layout.module.css';

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
            getAuthToken: () => authStorage.loadTokens()?.accessToken ?? null,
          }),
          store: cacheStorage,
        }),
        log: actionLog,
        getIdentity: () => {
          const t = authStorage.loadTokens();
          if (t === null) return null;
          return { id: t.subject ?? t.email ?? 'unknown' };
        },
      }),
    [config],
  );
  // Populate the agent-context atom from config so capabilities and
  // agent-facing surfaces can read it without re-walking the config.
  useEffect(() => {
    setAgentContext(config.agentContext ?? null);
  }, [config, setAgentContext]);

  return (
    <IarsmaProvider value={invoker}>
      <Shell config={config} />
    </IarsmaProvider>
  );
}

function Shell({ config }: { readonly config: ShellConfig }) {
  const isSignedIn = useAtomValue(isSignedInAtom);
  const themePreference = useAtomValue(themePreferenceAtom);
  const resolvedTheme = resolveTheme(themePreference);
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

  const [activeView, setActiveView] = useAtom(activeViewAtom);
  const [themePreference, setThemePreference] = useAtom(themePreferenceAtom);
  const setCompose = useSetAtom(composeStateAtom);
  const openCompose = useCallback(() => setCompose({ kind: 'open', prefill: {} }), [setCompose]);
  const session = useSessionGet({});
  const tokens = useAtomValue(tokensAtom);
  const bumpAuth = useSetAtom(authVersionAtom);
  const [searchQuery, setSearchQuery] = useAtom(searchQueryAtom);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Sidebar drawer state (tablet only)
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const toggleSidebar = useCallback(() => setSidebarOpen((o) => !o), []);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  // Calendar view state
  const [calendarView, setCalendarView] = useState<'month' | 'week' | 'day'>('month');
  const [calendarDate, setCalendarDate] = useState(() => new Date());

  // Expose search input ref globally for `/` keybinding.
  useEffect(() => {
    searchInputRefHandle.current = searchInputRef.current;
    return () => {
      searchInputRefHandle.current = null;
    };
  }, []);

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

  // Agent token management (settings view)
  const metadataStore = useMemo(
    () =>
      typeof indexedDB !== 'undefined'
        ? indexedDbAgentMetadataStore()
        : inMemoryAgentMetadataStore(),
    [],
  );
  const issuer = useMemo(
    () => localTokenIssuer({ metadataStore }),
    [metadataStore],
  );

  const [agentTokens, setAgentTokens] = useState<readonly AgentTokenInfo[]>([]);
  const [agentTokensLoading, setAgentTokensLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setAgentTokensLoading(true);
    issuer.listTokens().then(
      (list) => { if (!cancelled) { setAgentTokens(list); setAgentTokensLoading(false); } },
      () => { if (!cancelled) setAgentTokensLoading(false); },
    );
    return () => { cancelled = true; };
  }, [issuer]);

  const handleIssue = async (name: string, scopes: string[], lifetimeSec: number) => {
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

  // View title for mobile top bar
  const VIEW_TITLES: Record<ActiveView, string> = {
    mail: 'Mail',
    calendar: 'Calendar',
    contacts: 'Contacts',
    approvals: 'Approvals',
    activity: 'Activity',
    settings: 'Settings',
  };

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
          theme={themePreference}
          onThemeChange={setThemePreference}
          isOpen={sidebarOpen}
          onClose={closeSidebar}
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
          </div>
        )}

        {activeView === 'mail' ? (
          <MailLayout isLoading={session.isLoading} error={session.error} />
        ) : activeView === 'calendar' ? (
          <CalendarView
            events={[]}
            view={calendarView}
            onViewChange={setCalendarView}
            currentDate={calendarDate}
            onDateChange={setCalendarDate}
          />
        ) : activeView === 'contacts' ? (
          <ContactsView
            contacts={[]}
            selectedContact={null}
            onSelect={() => {}}
            onSearch={() => {}}
            searchQuery=""
          />
        ) : activeView === 'approvals' ? (
          <ApprovalsView
            approvals={[]}
            onApprove={async () => {}}
            onDeny={async () => {}}
          />
        ) : activeView === 'activity' ? (
          <ActivityView
            entries={[]}
            integrityStatus="unchecked"
            filters={{ actor: 'all', action: 'all', mode: 'all', timeRange: 'all' }}
            onFilterChange={() => {}}
            page={1}
            pageSize={25}
            totalEntries={0}
            onPageChange={() => {}}
          />
        ) : activeView === 'settings' ? (
          <AgentSettingsView
            tokens={agentTokens}
            onIssue={handleIssue}
            onRevoke={handleRevoke}
            isLoading={agentTokensLoading}
          />
        ) : (
          <PlaceholderView name="Unknown" />
        )}
      </div>

      {/* Mobile: Bottom nav */}
      {isMobile && (
        <BottomNav
          activeView={activeView}
          onNavigate={setActiveView}
          onSignOut={onSignOut}
        />
      )}

      <KeyboardHelpOverlay />
      <ComposeView />
    </main>
  );
}

/**
 * Mail layout — 3-column reading pane (desktop), or stacked on smaller
 * screens. Extracted so SignedInShell stays manageable.
 */
function MailLayout({
  isLoading,
  error,
}: {
  readonly isLoading: boolean;
  readonly error?: { message: string } | undefined;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '16em 22em minmax(0, 1fr)',
        gap: '1em',
        alignItems: 'start',
        flex: 1,
      }}
    >
      <aside aria-label="Mailbox sidebar">
        <MailboxList />
      </aside>
      <section aria-label="Selected mailbox">
        {isLoading ? <p>Loading session...</p> : null}
        {error !== undefined ? (
          <p role="alert">Session error: {error.message}</p>
        ) : null}
        <ThreadList />
      </section>
      <section aria-label="Selected thread">
        <ThreadView />
      </section>
    </div>
  );
}

/** Placeholder view for Calendar and Contacts (Phase 4 stubs). */
function PlaceholderView({ name }: { readonly name: string }) {
  return (
    <div style={{ padding: '2em', color: 'var(--text-3)' }}>
      {name} — coming soon
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
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
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
  }, [setOpen, setComposeState]);
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
        // Strip the callback params from the URL so a refresh doesn't
        // replay the (now-spent) authorization code.
        if (typeof window !== 'undefined') {
          const clean = new URL(window.location.href);
          clean.search = '';
          window.history.replaceState({}, '', clean.toString());
        }
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
