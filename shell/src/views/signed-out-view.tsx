/**
 * Signed-out view — sign-in pitch + button.
 *
 * The first screen every visitor sees. PR 6.5 (§8.9): centered card
 * on a soft surface, Iarsma wordmark, one-line value prop, accent
 * primary CTA, error surfaced via the shared Notice banner.
 *
 * Lives in its own module so component-level a11y tests (D-013,
 * D-029) can render it without pulling in the full App tree (which
 * imports WASM bindings that don't load cleanly under jsdom without
 * a polyfill).
 */

import { useState } from 'react';
import { authStorage } from '../auth-state.js';
import { Button } from '../components/button.js';
import { Notice } from '../components/notice.js';
import type { ShellConfig } from '../config.js';
import { startSignIn } from '../runtime/oauth.js';
import styles from './signed-out-view.module.css';

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function SignedOutView({ config }: { readonly config: ShellConfig }) {
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSignIn = async () => {
    setError(null);
    setSigningIn(true);
    try {
      // Use the IDB-backed authStorage so PKCE persists where
      // `handleCallback` will look for it. Without this, the OAuth
      // default `sessionAuthStorage()` saves PKCE in sessionStorage but
      // `handleCallback` (passed `storage: authStorage` from App.tsx)
      // reads from IndexedDB — sign-in completes but the shell
      // perpetually renders the signed-out view.
      await startSignIn({ config, storage: authStorage });
      // startSignIn navigates away; if we reach this line, navigation failed.
    } catch (e) {
      setSigningIn(false);
      setError(describe(e));
    }
  };

  return (
    <main className={styles['page']}>
      <section aria-labelledby="signin-heading" className={styles['card']}>
        <div className={styles['wordmark']} aria-hidden="true">
          <span className={styles['wordmarkDot']} />
          Iarsma
        </div>
        <h1 id="signin-heading" style={visuallyHidden}>
          Sign in to Iarsma
        </h1>
        <p className={styles['valueProp']}>
          Self-hosted JMAP webmail with first-class agent collaboration.
        </p>
        <p className={styles['issuer']}>
          You'll be redirected to <code>{config.oidcIssuer}</code> to sign in. Iarsma never sees your password.
        </p>
        <div className={styles['actions']}>
          <Button
            variant="primary"
            size="lg"
            onClick={onSignIn}
            disabled={signingIn}
            {...(styles['cta'] !== undefined ? { className: styles['cta'] } : {})}
          >
            {signingIn ? 'Redirecting…' : 'Sign in with Stalwart'}
          </Button>
        </div>
        {error !== null ? (
          <div data-testid="signin-error">
            <Notice variant="error">Sign-in failed: {error}</Notice>
          </div>
        ) : null}
      </section>
    </main>
  );
}

const visuallyHidden = {
  position: 'absolute' as const,
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0,0,0,0)',
  whiteSpace: 'nowrap' as const,
  border: 0,
};
