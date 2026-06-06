# Iarsma MCP server — docker-compose recipe

Single-command deployment for the agent-facing MCP server alongside an existing Stalwart instance. Multi-tenant: one server handles agents for every mailbox on the Stalwart host. The webmail (`iarsma-base-webmail.zip` served by Stalwart) handles user-facing token issuance + audit; this recipe brings up the always-on process that agents actually connect to.

## How it works (D-057)

Each user issues their own OAuth tokens from the Iarsma webmail's "Agent tokens" panel; tokens come straight from Stalwart's OIDC `client_credentials` endpoint. Agents present those tokens directly to the MCP server, which validates each one at request time by POSTing to Stalwart's introspection endpoint (RFC 7662). The agent's own bearer is then forwarded verbatim to JMAP — calls run with the user's permissions, never an operator credential.

This means:

- **You never paste agent tokens into the server's `.env`.** Operators only configure one credential — the introspection admin token — and that's it. Adding/revoking agents happens entirely in the webmail UI.
- **One MCP server serves all users.** Run it once per Stalwart host. Agents on Alice's mailbox and Bob's mailbox both connect to the same URL; the introspection result tells the server which mailbox each request belongs to.
- **Revocations propagate within seconds.** Introspection results are cached for 30s; once a token is revoked in the UI, the next cache miss returns "inactive" and the agent is locked out.

## What you need before starting

- **An existing Stalwart instance** reachable over HTTPS (e.g. `https://sw-mail.example.test`). This recipe does NOT install or manage Stalwart.
- **A Stalwart admin Bearer token** for the introspection credential — the same kind of token you use to manage the server via JMAP `x:Action`. Create one under your admin account before starting.
- **Docker** and the **Docker Compose plugin** installed on the host you want to run the MCP server on (your pantheon server, a side container next to Stalwart, anywhere reachable by the agents you'll point at it).
- The repo checked out: `git clone https://github.com/r3moteBee/iarsma.git`

## Three-step quickstart

```bash
cd iarsma/deployment/mcp

# 1. Copy the env template and fill in your values.
cp .env.example .env
$EDITOR .env
#   IARSMA_JMAP_BASE_URL              → your Stalwart URL
#   IARSMA_INTROSPECTION_ADMIN_TOKEN  → your Stalwart admin Bearer

# 2. Build the image + start the server.
docker compose up -d

# 3. Watch the logs to confirm it's listening.
docker compose logs -f iarsma-mcp
# Expect:
#   "Streamable HTTP transport listening on 0.0.0.0:8765 ..."
#   "Token store: stalwart-introspection @ https://sw-mail.example.test"
```

That's it. **Any user** with a token issued from their Iarsma webmail can now connect their agent to `http://<this-host>:8765/mcp` with `Authorization: Bearer <their-issued-token>`.

## How a user wires an agent

1. Open the Iarsma webmail, go to **Settings → Agent tokens**.
2. Issue a token — pick scopes carefully.
3. Copy the secret (shown once).
4. In the agent harness (pantheon, Claude Desktop, custom script), set the MCP URL to `http://<mcp-host>:8765/mcp` and the bearer to the secret.

No server-side changes are needed when adding or removing users or agents.

## Verify it works

From the MCP host itself, using a token you issued from the webmail:

```bash
TOKEN="<the-secret-from-the-webmail-UI>"
curl -s -X POST http://localhost:8765/mcp \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

You should see a JSON-RPC response listing the tools your token's scopes permit.

## Updating

```bash
cd iarsma
git pull
cd deployment/mcp
docker compose up -d --build
```

The `--build` rebuilds the image from the local checkout so the running container picks up new code. The container restarts automatically; pending agent connections drop and reconnect within seconds.

## Behind a reverse proxy

If you front the container with nginx / Caddy / Traefik to give it a real hostname + TLS:

```nginx
location /mcp {
    proxy_pass http://localhost:8765/mcp;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    # SSE support — agents need streamable HTTP, not buffered.
    proxy_buffering off;
    proxy_request_buffering off;
    proxy_read_timeout 1h;
}
```

Then set `IARSMA_WEBMAIL_MCP_URL=https://mcp.example.test/mcp` in `.env` so the discovery URN advertised to MCP clients points at the public-facing URL.

## What's NOT included

- **No Stalwart bring-up.** This recipe assumes Stalwart is already running and reachable. See `deployment/openbrain/README.md` for a co-deploy pattern if you need a full stack on a fresh host.
- **No persistent state.** The MCP server is stateless — every request is authenticated independently against Stalwart's introspection endpoint. The user's tokens themselves live in Stalwart's OAuth store, managed entirely through the webmail UI.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `Streamable HTTP transport listening` doesn't appear | Missing `IARSMA_MCP_HTTP_PORT`. The server falls back to stdio if HTTP env isn't configured. |
| Logs show `Token store: <none — legacy IARSMA_MCP_HTTP_TOKEN only>` | `IARSMA_INTROSPECTION_ADMIN_TOKEN` is unset. Set it and restart. |
| Every agent gets `401 Unauthorized` | The bearer the agent presents doesn't introspect to `active=true`. Check the token is unrevoked in the webmail UI and not expired. |
| First agent call hangs, then 401 | The MCP server can't reach Stalwart's `/.well-known/openid-configuration`. Verify `IARSMA_JMAP_BASE_URL` is reachable from inside the container. |
| `introspection error: 401 Unauthorized` in logs | `IARSMA_INTROSPECTION_ADMIN_TOKEN` is wrong, expired, or doesn't have admin scope on Stalwart. |
| Agents get `not_implemented` for tools | `IARSMA_JMAP_BASE_URL` not set — the JMAP handler couldn't bind upstream. |
| Container exits immediately | `docker compose logs iarsma-mcp` — most likely a missing required env var, or `IARSMA_JMAP_BASE_URL` isn't reachable from inside the container. |
| Port `8765` already used | Override `IARSMA_MCP_HTTP_PORT` in `.env` (e.g., `9000`) and rerun `docker compose up -d`. |
