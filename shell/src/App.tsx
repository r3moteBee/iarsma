// Phase 0 work item 1 — minimal "Sign in" surface.
// Real OAuth flow lands in Phase 0 work item 6 + token-exchange sidecar (10a).

import { Provider as JotaiProvider } from 'jotai';

export function App() {
  return (
    <JotaiProvider>
      <main aria-label="Sign in">
        <header>
          <h1>Iarsma</h1>
        </header>
        <section aria-labelledby="signin-heading">
          <h2 id="signin-heading">Sign in</h2>
          <p>The OAuth 2.1 + PKCE flow lands in Phase 0 work item 6.</p>
          <button type="button" disabled>
            Sign in with Stalwart
          </button>
        </section>
      </main>
    </JotaiProvider>
  );
}
