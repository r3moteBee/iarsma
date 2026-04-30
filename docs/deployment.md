# Iarsma — Deployment Guide

Operator-facing deployment instructions for Iarsma. The architectural rationale lives in `project-brief.md` (Deployment Models section); this document is the *how*, with concrete commands.

The webmail ships as a single versioned `iarsma.zip` (static site). The same artifact deploys identically to every supported host — the choice is operational, not architectural. Two simple rules keep the bundle portable across all of them:

1. **No hardcoded server URLs in the bundle.** The JMAP endpoint and OIDC issuer come from `config.json` (or build-time env), with same-origin defaults. No domain ever appears in the source.
2. **No reliance on host-injected runtimes.** The bundle treats its host as a dumb static file server.

---

## Producing `iarsma.zip`

Two paths — the GitHub Release path is canonical for production; the local path is a one-shot for ad-hoc / air-gapped installs.

### Tag-driven GitHub Release (canonical)
1. From `main`, push a semver tag: `git tag v0.1.0 && git push --tags`.
2. The `release` workflow (`.github/workflows/release.yml`) builds the bundle reproducibly: codegen → cargo-component → jco transpile → Vite build → zip with a versioned `iarsma/version.json` stamped inside.
3. The release publishes `iarsma-<version>.zip` and an `iarsma-<version>.zip.sha256` companion to the GitHub Releases page.
4. Operators consume the asset URL — the `latest` channel resolves to whatever tag was last pushed.

### Local one-shot
```bash
just package 0.1.0
# → iarsma-0.1.0.zip + a `iarsma.zip` symlink for unversioned consumers
```
Useful for testing a build before tagging, or for air-gapped operators who pull the tagged commit and build their own zip.

### Bundle layout
After unzip, the artifact extracts to a single top-level `iarsma/` directory:

```
iarsma/
├─ index.html
├─ version.json          # { "version": "...", "builtAt": "..." }
└─ assets/
   ├─ index-<hash>.js    # Vite bundle, gzip-friendly
   ├─ index-<hash>.css
   ├─ jmap_client.core-<hash>.wasm
   ├─ action_log.core-<hash>.wasm
   └─ ...
```

The deployer drops their `config.json` next to `index.html` (i.e. inside the `iarsma/` directory after extraction). Schema lives in `shell/src/config.ts`.

---

## Path A — Stalwart Web Application (recommended default)

Simplest path. Stalwart serves the bundle directly at a URL prefix on the same origin as JMAP, eliminating CORS and the need for a separate web server.

### Prerequisites
- A running Stalwart Mail Server with admin access.
- A published `iarsma.zip` accessible over HTTPS (a GitHub Release tag is the canonical source) or sitting on the Stalwart host's filesystem.
- An OAuth client registered for the webmail (see [`docs/stalwart-setup.md`](stalwart-setup.md) for the P-1.1 registration flow).

### Reference-deployment runbook (Phase 0 work item 13b)

This is the precise sequence that closes Phase 0's definition of done — "a user navigates to `https://<your-mail-server>/iarsma/`, clicks Sign in, completes OAuth, and sees their email displayed." Adapt the prefix to whatever you prefer; `iarsma` is the convention used throughout this guide.

#### Step 1 — Cut a release
On a clean main:
```bash
git tag v0.1.0    # or whatever semver applies
git push --tags
```
The `release` workflow (`.github/workflows/release.yml`) builds + publishes `iarsma-0.1.0.zip` and `iarsma-0.1.0.zip.sha256` to a new GitHub Release. Wait for the green check.

#### Step 2 — Register the production redirect URI on the OAuth client
In Stalwart admin → **Authentication → OAuth → OAuth Clients → webmail**, add `https://<your-mail-server>/iarsma/auth/callback` to the **Redirect URIs** list. Keep the existing dev URIs (`http://localhost:5173/auth/callback`, `http://localhost:1420/auth/callback`). Save.

#### Step 3 — Update the CORS allowed-origin
In Stalwart admin → **HTTP → General → Custom Response Headers** (the location where the existing dev origin lives), add `https://<your-mail-server>` to `Access-Control-Allow-Origin`. (For same-origin deploys, the browser doesn't actually require CORS — but JMAP-from-XHR still does, and the value persists across the dev / prod transitions.)

#### Step 4 — Create the Web Application entry
In Stalwart admin → **Network → Services → Web Applications → Create application**:

| Field | Value |
|---|---|
| **Resource URL** | `https://github.com/<your-org>/iarsma/releases/download/v0.1.0/iarsma-0.1.0.zip` (pin the tag; don't use `latest` for production) |
| **Enabled** | ON |
| **Description** | `Iarsma` |
| **URL Prefix** | `/iarsma` |
| **Update Frequency** | `30 d` for production, `1 d` for active dev |

Save. Stalwart fetches the zip and serves it at the chosen prefix.

#### Step 5 — Drop `config.json` next to the bundle
The bundle reads `/<prefix>/config.json` at startup. There is no default — Iarsma refuses to load without one. Use [`deployment/iarsma-web-app/config.json.example`](../deployment/iarsma-web-app/config.json.example) as a template:

```json
{
  "oidcIssuer": "https://<your-mail-server>",
  "clientId": "webmail",
  "redirectUri": "https://<your-mail-server>/iarsma/auth/callback",
  "agentContext": {
    "webmailMcpUrl": "https://<your-mail-server>/iarsma/mcp"
  }
}
```

How to actually deliver it depends on your Stalwart version's Web Apps fetcher: some versions fetch the zip and serve it as-is (you'd need to bake `config.json` into the zip before publishing); others let the operator drop additional files into a per-app overrides directory. Check the Stalwart admin UI — there's usually a "files" or "overrides" pane on the Web Application entry.

#### Step 6 — Smoke check
```bash
just verify-deployment https://<your-mail-server>/iarsma
```
That's [`./.github/scripts/verify-deployment.sh`](../.github/scripts/verify-deployment.sh) — confirms the bundle is reachable, `version.json` parses, `config.json` has the required fields, the OIDC discovery doc is reachable + sends CORS headers for the deploy origin, and the JMAP endpoint resolves.

#### Step 7 — Manual sign-in
Open `https://<your-mail-server>/iarsma/` in a browser, click **Sign in with Stalwart**, complete the OAuth round-trip, and confirm "Signed in as &lt;you@example.net&gt;" appears.

### Updating
Stalwart re-fetches the zip at the configured frequency. To pin a new release, edit the Web Application entry, change the Resource URL to the new tag's asset, and save — that triggers a refetch. Re-run `just verify-deployment` afterward to catch any version skew.

### Pros and trade-offs
- Single VM, same-origin, no CORS, no Caddy.
- Lifecycle is bound to whatever runs Stalwart. If Stalwart is down, the webmail is down too — but at the JMAP level it's already down anyway, so this isn't a real loss.

---

## Path B — Separate web server (Caddy / nginx)

For operators who want the webmail on a different host than Stalwart. Adds CORS configuration on Stalwart and explicit OAuth redirect URI registration.

### Prerequisites
- Two HTTPS-capable hosts: one running Stalwart, one running the static-file server.
- The webmail OAuth client registered with the production redirect URI for this origin.
- CORS configured on Stalwart to allow the webmail origin.

### Caddy example (`Caddyfile`)
```
webmail.example.com {
    root * /var/www/webmail
    file_server
    encode gzip zstd

    # SPA fallback: any unknown path serves index.html
    try_files {path} /index.html
}
```

### Configuration
- Place the unzipped contents of `iarsma.zip` in `/var/www/webmail/`.
- Edit `/var/www/webmail/config.json`:
  ```json
  {
    "jmapEndpoint": "https://mail.example.com/.well-known/jmap",
    "oidcIssuer": "https://mail.example.com/",
    "clientId": "webmail"
  }
  ```
- Reload Caddy.

### Stalwart-side CORS
Stalwart's HTTP listener needs to accept the webmail origin. Configure under Settings → Network → Services → HTTP → CORS (or equivalent in your Stalwart version).

### nginx note
If you're using nginx, the equivalent config is `try_files $uri /index.html;` inside a `location /` block. Same approach — SPA routing requires unknown paths to fall through to `index.html`.

---

## Path C — CDN / managed static hosting (Cloudflare Pages, Netlify, Vercel)

Same shape as Path B, but the static bundle lives on a managed edge platform.

### Steps
1. Create a project on the platform pointing at your fork's `gh-pages` (or equivalent) branch, or upload `iarsma.zip`'s contents directly.
2. Configure the platform's SPA-fallback rule (Cloudflare Pages: `_redirects` file with `/* /index.html 200`; Netlify: same; Vercel: `vercel.json` with a rewrite).
3. Edit `config.json` to point at your Stalwart's JMAP endpoint and OIDC issuer.
4. Configure CORS on Stalwart for the platform-assigned origin.
5. Register the platform-assigned origin's redirect URI on the OAuth client.

Useful for public reference deployments. Same caveats as Path B about CORS and OAuth.

---

## Path D — Tauri 2 desktop and mobile

The Tauri build wraps the same bundle in a native shell. No web server is required at all.

### Steps
1. Install Tauri 2 prerequisites for your target platform (see `https://v2.tauri.app/start/prerequisites/`).
2. From the repo root: `pnpm tauri build` for the host platform, or `pnpm tauri build --target <triple>` for cross-compilation.
3. The resulting `.dmg` (macOS), `.AppImage` / `.deb` (Linux), `.msi` (Windows), `.ipa` (iOS), or `.apk` (Android) ships the bundle inside the native app.
4. On first launch, the user (or an MDM profile) configures the JMAP endpoint URL.

### Code signing
- macOS: Apple Developer ID required for distribution outside the App Store.
- Windows: code signing certificate recommended to avoid SmartScreen warnings.
- Linux: optional but recommended; sign the AppImage with `gpg --detach-sign`.
- iOS: Apple Developer Program membership required.
- Android: keystore for Play Store distribution.

CI workflows in `.github/workflows/release.yml` handle signing for the platforms you've configured secrets for.

---

## Path E — Air-gapped

For operators with no public internet egress.

### Option E1 — Stalwart Web Application with `file://`
Stalwart's Web Application Resource URL accepts `file://` paths. Drop `iarsma.zip` on the Stalwart VM at, say, `/opt/webmail/iarsma.zip`, set Resource URL to `file:///opt/webmail/iarsma.zip`, and Stalwart serves it without ever hitting the internet.

### Option E2 — Caddy/nginx on the same network
Same as Path B but inside the air-gapped network. CORS still applies if Stalwart and the webmail are on different origins.

---

## OAuth Client Registration (required for all paths)

The webmail authenticates via OAuth 2.1 + PKCE against the OIDC provider on your JMAP server. Stalwart has a built-in OIDC provider; for other JMAP servers, follow their OAuth client registration process.

### Stalwart steps
1. Sign in to the admin at `https://<your-mail-server>/admin/`.
2. **Directory → OAuth Clients → Create OAuth client.**
3. Fill in:
   - **Client ID:** `webmail`
   - **Description:** `JMAP webmail — agent/human collaboration client`
   - **Contact Emails:** an admin email on the server
   - **Client Secret:** Stalwart auto-fills this regardless of input — the OAuth client is treated as a confidential client. Note the value (the eye icon reveals it); the webmail's token-exchange host (Tauri Rust glue for desktop/mobile, or a small co-deployed function for the web bundle) needs it. **Never embed it in the browser bundle.**
   - **Redirect URIs:** every origin the webmail might run from. Include all that apply:
     - `http://localhost:5173/auth/callback` (Vite dev)
     - `http://localhost:1420/auth/callback` (Tauri 2 dev)
     - `https://<your-mail-server>/webmail/auth/callback` (Stalwart Web Application)
     - `https://webmail.example.com/auth/callback` (separate web server)
     - `tauri://localhost/auth/callback` (Tauri 2 production builds; verify the actual scheme used by your build)
   - **Logo:** optional
   - **Expiration Date:** optional (leave empty for stable clients)
4. **Save.**

### What about the agent identities?
Per-agent OAuth clients are issued at runtime through the webmail's UI (Settings → Agents → Issue token), not pre-registered in Stalwart's admin. Each agent identity gets its own dynamically-created credential, scoped to the capabilities the user grants. See `project-brief.md` "Agent/Human Collaboration Model" for the full design.

---

## JMAP Capability Verification

After deployment, verify the JMAP server is advertising the capabilities the webmail expects:

```bash
curl -u 'user@example.com:<password>' \
     https://<your-mail-server>/.well-known/jmap | jq '.capabilities | keys'
```

Required URNs (will be present on any modern Stalwart):
- `urn:ietf:params:jmap:core`
- `urn:ietf:params:jmap:mail`
- `urn:ietf:params:jmap:submission`

Optional but unlocks features:
- `urn:ietf:params:jmap:calendars` (Phase 4)
- `urn:ietf:params:jmap:contacts` (Phase 4)
- `urn:ietf:params:jmap:files` (Phase 5+ if used)

The webmail will work with just the required URNs; missing optional URNs cause those features to render as disabled with a clear "not supported by your server" message rather than failing silently.

---

## SendGrid Outbound Relay (Stalwart configuration)

If your Stalwart instance can't establish a PTR record (common on cloud free tiers), configure SendGrid as the outbound relay.

1. **Settings → MTA → Outbound → Routes → Create route.**
2. Type: **Relay Host**.
3. ID: `SendGrid587`. Description: `SendGrid SMTP relay (port 587)`.
4. Configure host, port, and authentication per SendGrid's SMTP integration docs.
5. **Settings → MTA → Outbound → Strategy** — set the default outbound to use this route.

This is a Stalwart-side configuration, independent of the webmail. Once Stalwart accepts mail from the webmail's `EmailSubmission/set` calls, SendGrid handles the actual delivery.

---

## Optional: Open Brain Co-Deployment (Memory Backend Tier 2)

The webmail's memory layer is pluggable. By default, it ships with a Tier-1 structured-only store (annotations, user profile, opt-in behavior signals) that lives in the browser or Tauri filesystem with zero external dependencies. Operators who want richer agent context — vector search, free-text thoughts, cross-source memory — can opt into Tier 2 by running an [Open Brain](https://github.com/NateBJones-Projects/OB1) instance alongside the webmail.

### Architectural note

The webmail does NOT proxy memory queries through to Open Brain. Open Brain runs as an independent service with its own MCP endpoint. The webmail's role is limited to:

1. Configuration: `config.json` carries `memoryBackend.url` pointing at the OB1 endpoint.
2. Discovery: the webmail's JMAP session resource extends with the `urn:iarsma:agent-context` capability URN, advertising the OB1 MCP URL.
3. Trust delegation: the webmail's `MemoryBackend` trait wires structured-store reads/writes (annotations, profile) through to OB1 for users who want unified memory; vector search and free-text thoughts go agent-direct.

Agents discovering the URN connect to OB1's MCP independently. From the agent's perspective, mail context (webmail) and broader personal context (OB1) are two MCP endpoints under one auth identity — the agent composes them.

### Option E.1 — Co-deployed via Docker Compose (recommended for new operators)

The webmail repo ships a Docker Compose recipe at `deployment/openbrain/` that stands up:

- PostgreSQL 16 with pgvector extension
- Open Brain MCP gateway
- Volume-mounted persistent storage
- Environment config for connecting to your Stalwart's OIDC provider (so OB1 honors the same identities)

Steps:

```bash
cd deployment/openbrain/
cp .env.example .env
# edit .env: set OIDC_ISSUER, OIDC_CLIENT_ID, postgres password
docker compose up -d
```

Then in the webmail's `config.json`:
```json
{
  "memoryBackend": {
    "type": "openbrain",
    "url": "https://memory.r3motely.net/mcp"
  }
}
```

### Option E.2 — Pointing at an existing Open Brain instance

If you already run OB1 (e.g., for a separate agent harness or personal use):

1. Ensure your OB1 instance is reachable from the webmail's host and from agent platforms that will consume it.
2. Configure `memoryBackend.url` in the webmail's `config.json` to point at your existing OB1's MCP endpoint.
3. Verify the discovery URN is populated: `curl -u 'user@example.com:<password>' https://<your-mail-server>/.well-known/jmap | jq '.capabilities."urn:iarsma:agent-context"'`.

### Option E.3 — Other memory backends (Mem0, Letta, custom)

The `MemoryBackend` trait is provider-agnostic. Adapters for other systems live as small Rust→WASM components in `components/memory-backend/<provider>/`. Contributing a new adapter is a matter of implementing the WIT contract and adding a `type: "<provider>"` value in the config.

### Resource considerations

Postgres + pgvector is non-trivial on a free-tier VM. If you're running Stalwart on OCI free tier alongside the webmail and trying to host OB1 on the same VM, you may run out of memory under load. Options:

- Host OB1 on a separate small VM (cheapest cloud instance is usually fine for personal use).
- Use a managed Postgres+pgvector provider (Supabase has a free tier, Neon has a free tier).
- Stay on Tier 1 (structured-only) until you actually need vector search. The webmail works fully without OB1.

### License

Open Brain is FSL-1.1-MIT (Functional Source License → MIT after 2 years), compatible with this project's dual MIT/Apache licensing. We link to OB1 and ship a deployment recipe — we do not vendor or fork.

---

## Reference Deployment

The project author maintains a reference deployment using Path A (Stalwart Web Application) — its hostname is documented in `docs/project-brief.md` Phase -1 if you want to look. Treat it as documentation-by-example — the configuration matches what's documented above. Operators of their own Iarsma instance should substitute their own hostname throughout this guide.
