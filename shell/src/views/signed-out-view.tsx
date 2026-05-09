/**
 * Signed-out view — sign-in pitch + button.
 *
 * Lives in its own module so component-level a11y tests (D-013, D-029)
 * can render it without pulling in the full App tree (which imports the
 * WASM-binding modules that don't load cleanly under vitest's jsdom
 * environment without a WASM polyfill).
 */

import { useState } from 'react';
import type { ShellConfig } from '../config.js';
import { startSignIn } from '../runtime/oauth.js';

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
      await startSignIn({ config });
      // startSignIn navigates away; if we reach this line, navigation failed.
    } catch (e) {
      setSigningIn(false);
      setError(describe(e));
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
