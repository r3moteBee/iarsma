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
import { useMailboxList } from './generated/capabilities/mailbox-list.js';
import { useSessionGet } from './generated/capabilities/session-get.js';
import { useBreakpoint } from './hooks/use-media-query.js';
import { keyboardHelpOpenAtom } from './keyboard-state.js';
import { mailLayoutAtom, searchQueryAtom, selectedMailboxIdAtom, type MailLayout as MailLayoutType } from './mail-state.js';
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
import { FilesView, type FileTreeNode, type FileContent as FilesViewContent, type CommitHistoryEntry } from './views/files-view.js';
import { githubClient, type GitHubConfig } from './runtime/github-client.js';
import { indexedDbGitHubConfigStore, inMemoryGitHubConfigStore, type GitHubStoredConfig } from './runtime/github-config-store.js';
import { ActivityView } from './views/activity-view.js';
import { ApprovalsView } from './views/approvals-view.js';
import { CalendarView } from './views/calendar-view.js';
import { KeyboardHelpOverlay } from './views/keyboard-help-overlay.js';
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
  const invoker = useInvoker();
  const [crudRefresh, setCrudRefresh] = useState(0);
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
        const events = await invoker.invoke<unknown, { events: ReadonlyArray<{
          id: string;
          title: string;
          start: string;
          duration?: string;
        }> }>('event.list', {
          after: monthStart.toISOString(),
          before: monthEnd.toISOString(),
        });
        if (!cancelled) {
          const e = events as { events: ReadonlyArray<{ id: string; title: string; start: string; duration?: string }> };
          setCalendarEvents(e.events ?? []);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[iarsma] calendar fetch failed:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [activeView, calendarDate, invoker, crudRefresh]);

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

  // Load saved GitHub config on mount
  useEffect(() => {
    let cancelled = false;
    githubConfigStore.load().then((cfg) => {
      if (!cancelled && cfg !== null) setGithubConfig(cfg);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [githubConfigStore]);

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
    gh.list('').then((entries) => {
      if (!cancelled) setFilesTree(entries);
    }).catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error('[iarsma] files list failed:', err);
    }).finally(() => {
      if (!cancelled) setFilesLoadingTree(false);
    });
    return () => { cancelled = true; };
  }, [activeView, gh]);

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
    files: 'Files',
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
            <div className={layoutStyles.layoutToggle} role="group" aria-label="Mail layout">
              <button
                type="button"
                className={`${layoutStyles.layoutToggleBtn}${mailLayout === 'side' ? ` ${layoutStyles.layoutToggleBtnActive}` : ''}`}
                onClick={() => handleLayoutChange('side')}
                aria-pressed={mailLayout === 'side'}
                aria-label="Side-by-side layout"
                title="Side-by-side"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <rect x="0.5" y="0.5" width="6" height="13" rx="1" stroke="currentColor" />
                  <rect x="7.5" y="0.5" width="6" height="13" rx="1" stroke="currentColor" />
                </svg>
              </button>
              <button
                type="button"
                className={`${layoutStyles.layoutToggleBtn}${mailLayout === 'stacked' ? ` ${layoutStyles.layoutToggleBtnActive}` : ''}`}
                onClick={() => handleLayoutChange('stacked')}
                aria-pressed={mailLayout === 'stacked'}
                aria-label="Stacked layout"
                title="Stacked"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <rect x="0.5" y="0.5" width="13" height="6" rx="1" stroke="currentColor" />
                  <rect x="0.5" y="7.5" width="13" height="6" rx="1" stroke="currentColor" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {activeView === 'mail' ? (
          <MailLayout isLoading={session.isLoading} error={session.error} layout={mailLayout} />
        ) : activeView === 'calendar' ? (
          <CalendarView
            events={calendarEvents}
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
              await invoker.invoke('event.create', {
                calendarId: defaultCalendar.id,
                title: data.title,
                start: startIso,
                duration: data.duration,
                ...(data.description !== undefined ? { description: data.description } : {}),
                ...(data.location !== undefined ? { location: data.location } : {}),
              });
              setCrudRefresh((n) => n + 1);
            }}
            onUpdateEvent={async (id, data) => {
              const startIso = `${data.date}T${data.startTime}:00`;
              await invoker.invoke('event.update', {
                eventId: id,
                title: data.title,
                start: startIso,
                duration: data.duration,
                ...(data.description !== undefined ? { description: data.description } : {}),
                ...(data.location !== undefined ? { location: data.location } : {}),
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
        ) : activeView === 'files' ? (
          <FilesView
            config={githubConfig !== null ? { owner: githubConfig.owner, repo: githubConfig.repo, branch: githubConfig.branch } : null}
            tree={filesTree}
            selectedPath={filesSelectedPath}
            selectedContent={filesSelectedContent}
            history={filesHistory}
            isLoadingTree={filesLoadingTree}
            isLoadingContent={filesLoadingContent}
            onSelectPath={handleFilesSelectPath}
            onExpandDir={handleFilesExpandDir}
            onSave={handleFilesSave}
            onDisconnect={handleFilesDisconnect}
          />
        ) : activeView === 'settings' ? (
          <AgentSettingsView
            tokens={agentTokens}
            onIssue={handleIssue}
            onRevoke={handleRevoke}
            isLoading={agentTokensLoading}
            files={{
              currentConfig: githubConfig !== null ? { owner: githubConfig.owner, repo: githubConfig.repo, branch: githubConfig.branch } : null,
              onConnect: handleFilesConnect,
              onDisconnect: handleFilesDisconnect,
            }}
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
  const gridClass =
    layout === 'stacked'
      ? `${layoutStyles.mailGrid} ${layoutStyles.mailGridStacked}`
      : `${layoutStyles.mailGrid} ${layoutStyles.mailGridSide}`;

  return (
    <div className={gridClass}>
      <section
        aria-label="Selected mailbox"
        className={layout === 'stacked' ? layoutStyles.mailThreadColStacked : undefined}
      >
        {isLoading ? <p>Loading session...</p> : null}
        {error !== undefined ? (
          <p role="alert">Session error: {error.message}</p>
        ) : null}
        <ThreadList />
      </section>
      <section
        aria-label="Selected thread"
        className={layout === 'stacked' ? layoutStyles.mailViewColStacked : undefined}
      >
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
