# Iarsma — Stalwart Setup Runbook

Operator-facing steps for preparing a Stalwart Mail Server to host Iarsma. This doc covers the *server-side* prep that has to happen before the shell can authenticate; deployment of the shell bundle itself is in `deployment.md`.

The runbook is organized by Phase prerequisite (`P-1.x`) so it tracks the implementation plan. Run the sections you haven't already done; they're idempotent.

> **Stalwart version assumed:** any release that ships an OIDC discovery document at `/.well-known/openid-configuration`. Verify yours before continuing (step P-1.2 below).

---

## P-1.1 — OAuth client registration

Iarsma signs users in with OAuth 2.1 + PKCE against Stalwart's built-in OIDC provider. Iarsma is registered as a **public client** (no `client_secret`). See `decisions.md` D-039 for why.

### Steps

1. Sign in to Stalwart's admin UI at `https://<your-mail-server>/admin/`.
2. Navigate to **Authentication → OAuth → OAuth Clients → Create Client**.
3. Fill in:
   - **Client ID:** `webmail` (or any stable identifier — match this in `config.json` / `VITE_OAUTH_CLIENT_ID`).
   - **Client Secret:** *leave blank.* Iarsma is a browser-based public client; no secret will ship with the bundle.
   - **Auth Method:** `none` / `PKCE only` / `Public client` — whichever wording your Stalwart UI uses for the no-secret posture.
   - **Grant Types:** `authorization_code` + `refresh_token`.
   - **PKCE Required:** **on** (S256). PKCE is the only thing protecting the auth-code exchange for a public client.
   - **Redirect URIs:** see *Redirect URIs* below.
   - **Description:** something humans will recognize (e.g. `Iarsma webmail`).
4. **Save**, then re-open the client. Confirm:
   - The `client_secret` field is **empty** (some browsers autofill `<input type="password">` from saved admin credentials — verify in an incognito window).
   - The redirect URIs match the list below.

### Redirect URIs

Register every origin that will host the shell. Phase 0 typically needs all three:

| Environment | URI | Purpose |
|---|---|---|
| Vite dev server | `http://localhost:5173/auth/callback` | `pnpm --filter @iarsma/shell dev` |
| Tauri 2 dev | `http://localhost:1420/auth/callback` | `cargo tauri dev` |
| Production (web bundle on Stalwart) | `https://<your-mail-server>/<prefix>/auth/callback` | `<prefix>` matches your Stalwart Web Application URL prefix (default `/iarsma` per `deployment.md`) |

Stalwart performs an exact-match check at the auth-request stage. A typo here surfaces as a redirect-uri-mismatch error from the auth server before the user ever sees a sign-in screen.

### Verification

```bash
# Discovery endpoint should reflect Stalwart's OIDC capabilities.
curl -s https://<your-mail-server>/.well-known/openid-configuration | jq '
  .issuer,
  .authorization_endpoint,
  .token_endpoint,
  .scopes_supported,
  .code_challenge_methods_supported
'
```

Expect `code_challenge_methods_supported` to include `S256` and `scopes_supported` to include `openid` (Iarsma additionally requests `offline_access` for the refresh token; if your Stalwart doesn't list it, refresh stops working but sign-in still succeeds).

A rough end-to-end smoke that exercises just the authorization endpoint (without completing the flow):

```bash
# Replace REDIRECT, CHALLENGE, STATE with sane stand-in values to confirm
# the URL is accepted (the response is a redirect to a login form):
curl -sIL "https://<your-mail-server>/login?\
client_id=webmail&\
redirect_uri=$(printf '%s' 'http://localhost:5173/auth/callback' | jq -sRr @uri)&\
response_type=code&\
scope=$(printf '%s' 'openid offline_access' | jq -sRr @uri)&\
state=test&\
nonce=test&\
code_challenge=foo&\
code_challenge_method=S256" | head -20
```

A successful response is HTTP 200 (login form) or 3xx (redirect to login). HTTP 4xx with a `error=invalid_client` or `redirect_uri_mismatch` query parameter means the client config doesn't match what you set above.

---

## P-1.2 — Verify JMAP capabilities

Iarsma is JMAP-only (D-002). Confirm the server advertises the URNs the implementation plan depends on.

```bash
# Authenticated discovery — Stalwart returns a richer capabilities map
# than the unauthenticated `/.well-known/jmap` endpoint.
curl -fsSL -u '<your-email>:<password>' \
  "https://<your-mail-server>/.well-known/jmap" | jq '.capabilities | keys'
```

**Required for Phase 0–2:**
- `urn:ietf:params:jmap:core`
- `urn:ietf:params:jmap:mail`
- `urn:ietf:params:jmap:submission`

**Optional (later phases):**
- `urn:ietf:params:jmap:calendar` (Phase 4)
- `urn:ietf:params:jmap:contacts` (Phase 4)

Record which optional URNs your deployment exposes and at what draft level — those determine which Iarsma capabilities are available against this server.

---

## P-1.3 — Define iarsma as a Stalwart Web Application

Covered in `deployment.md` (Path A). Key points to keep aligned with this runbook:

- The chosen URL prefix (`/iarsma`, `/webmail`, etc.) must appear in the *production* redirect URI registered in P-1.1.
- The bundle reads `<prefix>/config.json` at startup; the operator drops the JSON next to the bundle. Schema in `shell/src/config.ts` (Zod-validated).

Example `config.json` for production:

```json
{
  "oidcIssuer": "https://<your-mail-server>",
  "clientId": "webmail",
  "redirectUri": "https://<your-mail-server>/<prefix>/auth/callback"
}
```

For local dev, set the same values via Vite env vars in `shell/.env.local`:

```env
VITE_OIDC_ISSUER=https://<your-mail-server>
VITE_OAUTH_CLIENT_ID=webmail
VITE_OAUTH_REDIRECT_URI=http://localhost:5173/auth/callback
```

`shell/src/config.ts` checks `/config.json` first and falls back to the env vars, so the same code works in either deployment posture.

---

## Manual sign-in smoke

After P-1.1 and the dev env vars are in place:

```bash
just dev   # boots Vite at http://localhost:5173
```

Open the URL, click **Sign in with Stalwart**. You should be redirected to `<your-mail-server>/login`, complete the password prompt (and any second factor), and return to `http://localhost:5173/auth/callback?code=...&state=...`. The shell exchanges the code, stores tokens in `sessionStorage` (`iarsma.auth.tokens.v0`), and renders **Signed in as &lt;you@example.net&gt;** sourced from `useSessionGet`.

If the flow stalls, the most common causes are:

| Symptom | Cause | Fix |
|---|---|---|
| `redirect_uri_mismatch` from Stalwart | Dev URI not registered on the OAuth client | Add `http://localhost:5173/auth/callback` per P-1.1 |
| `pkce_mismatch` from the shell | sessionStorage wiped between redirects (private window quirks, tab change) | Re-trigger the flow in a single tab |
| `session error: 401` after sign-in | Token wasn't accepted by JMAP | Verify in DevTools → Application → Session Storage that `iarsma.auth.tokens.v0` exists; if not, sign-in failed silently — check the browser console |
| `discovery_failed` | TLS / certificate problem on `<your-mail-server>` | `curl -v https://<your-mail-server>/.well-known/openid-configuration` to inspect |

---

## Cleanup notes

- Redirect URIs are exact-match. Removing a URI from the OAuth client config invalidates any in-flight auth flows that targeted it.
- Rotating the public client's `client_id` invalidates every existing session — refresh tokens issued under the old id won't be honored.
- If you ever set a `client_secret` (mistake or intentional flip to confidential), Iarsma will fail token exchange against the bare `/auth/token` endpoint. Either clear the secret again or change Iarsma's posture (would land as a Phase 1+ config flag routing through `token-exchange/`).
