// Token-exchange sidecar entrypoint.
//
// Phase 0 work item 10a fills this in:
//   - Single route: POST /auth/token { code, code_verifier, redirect_uri }
//   - Reads OIDC config + client_secret from env (NEVER committed)
//   - Calls Stalwart's token endpoint with client_id + client_secret + auth code + PKCE verifier
//   - Returns { access_token, refresh_token, id_token, expires_in } to the shell
//
// Why this exists: Stalwart treats OAuth clients as confidential (D-019).
// The browser bundle cannot safely hold the client_secret. This sidecar holds it.

console.log('token-exchange scaffold — implementation lands in Phase 0 work item 10a');
