// Phase 0 work items 6 + 7 — OAuth 2.1 + PKCE flow + login UI.

import { Provider as JotaiProvider, useAtomValue, useSetAtom } from 'jotai';
import { useEffect, useMemo, useState } from 'react';
import { authStorage, authVersionAtom, tokensAtom, isSignedInAtom } from './auth-state.js';
import { loadConfig, type ShellConfig } from './config.js';
import { useSessionGet } from './generated/capabilities/session-get.js';
import { IarsmaProvider, jmapInvoker, type Invoker } from './runtime/index.js';
import { handleCallback, signOut, startSignIn } from './runtime/oauth.js';

type Phase =
  | { kind: 'loading' }
  | { kind: 'config_error'; message: string }
  | { kind: 'callback'; url: URL }
  | { kind: 'ready' };

export function App() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [config, setConfig] = useState<ShellConfig | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
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
  }, []);

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
  const invoker = useMemo<Invoker>(
    () =>
      jmapInvoker({
        baseUrl: config.jmapBaseUrl ?? config.oidcIssuer,
        getAuthToken: () => authStorage.loadTokens()?.accessToken ?? null,
      }),
    [config],
  );

  return (
    <IarsmaProvider value={invoker}>
      <Shell config={config} />
    </IarsmaProvider>
  );
}

function Shell({ config }: { readonly config: ShellConfig }) {
  const isSignedIn = useAtomValue(isSignedInAtom);
  return (
    <main aria-label={isSignedIn ? 'Iarsma — signed in' : 'Iarsma — sign in'}>
      <header>
        <h1>Iarsma</h1>
      </header>
      {isSignedIn ? <SignedInView config={config} /> : <SignedOutView config={config} />}
    </main>
  );
}

function SignedOutView({ config }: { readonly config: ShellConfig }) {
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSignIn = async () => {
    setError(null);
    setSigningIn(true);
    try {
      await startSignIn({ config });
      // startSignIn navigates away; if we reach this line, navigation failed.
    } catch (e) {
      setSigningIn(false);
      setError(e instanceof Error ? e.message : describe(e));
    }
  };

  return (
    <section aria-labelledby="signin-heading">
      <h2 id="signin-heading">Sign in</h2>
      <p>
        You will be redirected to <code>{config.oidcIssuer}</code> to sign in. Iarsma never
        sees your password.
      </p>
      <button type="button" onClick={onSignIn} disabled={signingIn}>
        {signingIn ? 'Redirecting…' : 'Sign in with Stalwart'}
      </button>
      {error !== null ? (
        <p role="alert" data-testid="signin-error">
          Sign-in failed: {error}
        </p>
      ) : null}
    </section>
  );
}

function SignedInView({ config }: { readonly config: ShellConfig }) {
  const session = useSessionGet({});
  const bumpAuth = useSetAtom(authVersionAtom);
  const tokens = useAtomValue(tokensAtom);

  const onSignOut = () => {
    signOut({ config });
    // tokensAtom is read-derived (storage-backed); the version bump
    // triggers re-derivation so it picks up the cleared tokens.
    bumpAuth((v) => v + 1);
  };

  return (
    <section aria-labelledby="signedin-heading">
      <h2 id="signedin-heading">Signed in</h2>
      {session.isLoading ? <p>Loading session…</p> : null}
      {session.error !== undefined ? (
        <p role="alert">Session error: {session.error.message}</p>
      ) : null}
      {session.data !== undefined ? (
        <p>
          Signed in as <strong>{session.data.username}</strong>.
        </p>
      ) : tokens?.email !== undefined ? (
        <p>
          Signed in as <strong>{tokens.email}</strong>.
        </p>
      ) : null}
      <button type="button" onClick={onSignOut}>
        Sign out
      </button>
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await handleCallback({ config }, url);
        if (cancelled) return;
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
        if (cancelled) return;
        setError(e instanceof Error ? e.message : describe(e));
      }
    })();
    return () => {
      cancelled = true;
    };
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
