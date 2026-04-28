# @iarsma/token-exchange

OAuth 2.1 token-exchange sidecar. Holds the `client_secret` server-side and performs the auth-code-plus-PKCE-verifier exchange against Stalwart's OIDC token endpoint.

See [`docs/decisions.md`](../docs/decisions.md) D-019, D-022 for why this exists, and the project brief's Auth/Session component section for where it fits.

## Why this service exists

Stalwart treats OAuth clients as confidential — `client_secret` is always set even on a "public" registration. A browser bundle cannot safely hold a secret. So the auth flow splits:

1. **Browser:** runs the OAuth 2.1 + PKCE dance (code challenge, redirect, callback, code).
2. **This sidecar:** receives the auth code + code verifier, holds the `client_secret`, exchanges them at the token endpoint, returns the access/refresh/id tokens to the browser.

The `client_secret` never leaves the process. The sidecar is the *only* component that knows it.

## Single route

`POST /auth/token`

Request body (JSON):
```json
{
  "code": "<auth-code-from-callback>",
  "code_verifier": "<the-pkce-verifier-the-shell-stored>",
  "redirect_uri": "<must-be-in-the-allowed-list>"
}
```

Response (JSON, on success):
```json
{
  "access_token": "...",
  "token_type": "Bearer",
  "refresh_token": "...",
  "id_token": "...",
  "expires_in": 3600
}
```

Response (on error):
```json
{ "error": "invalid_grant", "error_description": "..." }
```

Error codes: `invalid_request` (400), `invalid_redirect_uri` (400), `oidc_error` (502), `internal_error` (500).

A health probe is also exposed at `GET /healthz` for orchestrators.

## Running

Required environment variables (see the repo-root `.env.example`):

| Var | Required | Purpose |
|---|---|---|
| `OIDC_ISSUER` | yes | Base URL of the OIDC provider, e.g. `https://sw-mail.r3motely.net` |
| `OIDC_CLIENT_ID` | yes | Registered client id (e.g. `webmail`) |
| `OIDC_CLIENT_SECRET` | yes | Registered client secret. **Never** ship to browser |
| `TOKEN_EXCHANGE_ALLOWED_REDIRECT_URIS` | yes | CSV of redirect URIs the sidecar accepts |
| `TOKEN_EXCHANGE_PORT` | no (4000) | HTTP port to listen on |
| `TOKEN_EXCHANGE_CORS_ORIGINS` | no | CSV of browser origins; empty = CORS off |
| `TOKEN_EXCHANGE_TOKEN_ENDPOINT` | no | Skip OIDC discovery; use this URL directly |

```bash
# Dev (with .env loaded by the shell or a runner like dotenv-cli)
pnpm --filter '@iarsma/token-exchange' run dev

# Run tests
pnpm --filter '@iarsma/token-exchange' run test
```

## Architecture

Three layers, each independently testable:

- **`config.ts`** — env parsing via Zod, with actionable error messages on missing/invalid vars.
- **`exchange.ts`** — pure OAuth 2.1 token-endpoint POST. Network calls go through an injectable `fetch` so tests can stub them. No Fastify dependency; this layer is reusable elsewhere if needed.
- **`server.ts`** — Fastify glue. Validates the request body, dispatches to the exchanger, translates `ExchangeError` codes to HTTP status codes. Tests use Fastify's `inject()` so no listener is needed.

CORS is opt-in (`TOKEN_EXCHANGE_CORS_ORIGINS`). For same-origin deployments (where the shell is served by Stalwart at a path on the same host as the sidecar's reverse proxy), CORS can stay off. For cross-origin dev (Vite at `localhost:5173` hitting this sidecar at `localhost:4000`), set `TOKEN_EXCHANGE_CORS_ORIGINS=http://localhost:5173`.

## Status

Phase 0 scaffold landed. Ready to wire into the shell's OAuth flow as part of Phase 0 work item 6. The shell's MCP invoker (in `shell/src/runtime/invoker.ts`) reads the auth token from somewhere; once Phase 0 item 6 lands, it'll read it from `localStorage`/IndexedDB after this sidecar provides it.
