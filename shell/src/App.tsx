// Phase 0 work items 6 + 7 — OAuth 2.1 + PKCE flow + login UI.

import { Provider as JotaiProvider, useAtomValue, useSetAtom } from 'jotai';
import { useEffect, useMemo, useRef, useState } from 'react';
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
import { keyboardHelpOpenAtom } from './keyboard-state.js';
import {
  IarsmaProvider,
  cachedInvoker,
  jmapInvoker,
  loggingInvoker,
  type Invoker,
} from './runtime/index.js';
import { handleCallback, signOut } from './runtime/oauth.js';
import { ComposeView } from './views/compose-view.js';
import { KeyboardHelpOverlay } from './views/keyboard-help-overlay.js';
import { MailboxList } from './views/mailbox-list.js';
import { SignedOutView } from './views/signed-out-view.js';
import { ThreadList } from './views/thread-list.js';
import { ThreadView } from './views/thread-view.js';

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
  useGlobalKeyboardShortcuts();
  return (
    <main aria-label={isSignedIn ? 'Iarsma — signed in' : 'Iarsma — sign in'}>
      <header>
        <h1>Iarsma</h1>
      </header>
      {isSignedIn ? <SignedInView config={config} /> : <SignedOutView config={config} />}
      <KeyboardHelpOverlay />
      {isSignedIn ? <ComposeView /> : null}
    </main>
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
function useGlobalKeyboardShortcuts(): void {
  const setOpen = useSetAtom(keyboardHelpOpenAtom);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === '?') {
        if (isEditableElement(event.target)) return;
        event.preventDefault();
        setOpen(true);
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
  }, [setOpen]);
}

function isEditableElement(target: EventTarget | null): boolean {
  if (target === null || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}


function SignedInView({ config }: { readonly config: ShellConfig }) {
  const session = useSessionGet({});
  const bumpAuth = useSetAtom(authVersionAtom);
  const tokens = useAtomValue(tokensAtom);
  const setCompose = useSetAtom(composeStateAtom);
  const openCompose = () => setCompose({ kind: 'open', prefill: {} });

  const onSignOut = () => {
    void (async () => {
      // Thread the IDB-backed authStorage through explicitly.
      // signOut's default `storage: sessionAuthStorage()` would clear
      // the wrong backing — leaving tokens still in IndexedDB and the
      // user appearing signed-in on the next reload.
      await signOut({ config, storage: authStorage });
      // Drop every cached email row so the next sign-in (possibly a
      // different user) doesn't read another user's mail. Failure is
      // non-fatal — the auth tokens are already gone, so the next
      // capability call will fail closed before serving stale cache.
      try {
        await cacheStorage.clearAll();
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[iarsma] failed to clear capability cache on sign-out:', e);
      }
      // tokensAtom is read-derived (storage-backed); the version bump
      // triggers re-derivation so it picks up the cleared tokens.
      bumpAuth((v) => v + 1);
    })();
  };

  return (
    <section
      aria-labelledby="signedin-heading"
      style={{
        display: 'grid',
        // 3-column reading layout: mailboxes | threads | thread body.
        // The thread column is wider than the thread-list because long
        // sender names + subjects are common; min-width:0 on the thread
        // body column lets the inner content scroll without forcing
        // grid overflow.
        gridTemplateColumns: '16em 22em minmax(0, 1fr)',
        gap: '1em',
        alignItems: 'start',
      }}
    >
      <header style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 id="signedin-heading">Signed in</h2>
        <span style={{ display: 'flex', gap: '0.75em', alignItems: 'baseline' }}>
          <button type="button" onClick={openCompose} aria-label="Compose new message">
            Compose
          </button>
          {session.data !== undefined ? (
            <span>
              {session.data.username} (
              <button type="button" onClick={onSignOut}>
                Sign out
              </button>
              )
            </span>
          ) : tokens?.email !== undefined ? (
            <span>
              {tokens.email} (
              <button type="button" onClick={onSignOut}>
                Sign out
              </button>
              )
            </span>
          ) : (
            <button type="button" onClick={onSignOut}>
              Sign out
            </button>
          )}
        </span>
      </header>
      <aside aria-label="Mailbox sidebar">
        <MailboxList />
      </aside>
      <section aria-label="Selected mailbox">
        {session.isLoading ? <p>Loading session…</p> : null}
        {session.error !== undefined ? (
          <p role="alert">Session error: {session.error.message}</p>
        ) : null}
        <ThreadList />
      </section>
      <section aria-label="Selected thread">
        <ThreadView />
      </section>
    </section>
  );
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
