# Iarsma MCP server — docker-compose recipe

Single-command deployment for the agent-facing MCP server alongside an existing Stalwart instance. Multi-tenant: one server handles agents for every mailbox on the Stalwart host. The webmail (`iarsma-base-webmail.zip` served by Stalwart) handles user-facing token issuance + audit; this recipe brings up the always-on process that agents actually connect to.

## How it works (D-058)

Each user issues their own **Stalwart API key** from the Iarsma webmail's "Agent tokens" panel; the key is created server-side via JMAP `x:ApiKey/set` with Replace-mode permissions matching the agent's iarsma scopes. Agents present the API key secret as a Bearer token to the MCP server, which validates each one at request time by making a JMAP session call — Stalwart returns 401 if the key is revoked or unknown, 200 otherwise. The same bearer is then forwarded verbatim to JMAP for the agent's tool calls.

This means:

- **No operator credential.** The MCP server has no shared secret of its own. Every agent's own bearer is what authorizes both the validation step and the downstream JMAP calls.
- **List + revoke from any device.** Stalwart owns the canonical key list. Log in on a different machine, you see the same agents; revoke from a fresh browser, it sticks within seconds (cache TTL).
- **One MCP server serves all users.** Run it once per Stalwart host. Agents on Alice's mailbox and Bob's mailbox both connect to the same URL; the session response tells the server which mailbox each request belongs to.
- **Revocations propagate within seconds.** Validation results are cached for 30s; once a key is revoked in the UI, the next cache miss returns 401 and the agent is locked out.

## What you need before starting

- **An existing Stalwart instance** reachable over HTTPS (e.g. `https://sw-mail.example.test`). This recipe does NOT install or manage Stalwart.
- **Docker** and the **Docker Compose plugin** installed on the host you want to run the MCP server on (your pantheon server, a side container next to Stalwart, anywhere reachable by the agents you'll point at it).
- The repo checked out: `git clone https://github.com/r3moteBee/iarsma.git`

## Two-step quickstart

```bash
cd iarsma/deployment/mcp

# 1. Copy the env template and set IARSMA_JMAP_BASE_URL to your
#    Stalwart URL. No operator credential needed — every agent
#    bearer is validated by Stalwart on each call.
cp .env.example .env
$EDITOR .env
#   IARSMA_JMAP_BASE_URL → your Stalwart URL

# 2. Build the image + start the server.
docker compose up -d

# 3. Watch the logs to confirm it's listening.
docker compose logs -f iarsma-mcp
# Expect:
#   "Streamable HTTP transport listening on 0.0.0.0:8765 ..."
#   "Token store: stalwart-session @ https://sw-mail.example.test"
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
| Logs show `Token store: <none — legacy IARSMA_MCP_HTTP_TOKEN only>` | `IARSMA_JMAP_BASE_URL` is unset. Set it and restart. |
| Every agent gets `401 Unauthorized` | The bearer the agent presents doesn't authenticate against Stalwart. Check the key is unrevoked under the webmail's Agent tokens panel (it'll be there since Stalwart owns the list now). |
| First agent call hangs, then 401 | The MCP server can't reach Stalwart's `/.well-known/jmap`. Verify `IARSMA_JMAP_BASE_URL` is reachable from inside the container. |
| `session-validate non-OK 5xx` in logs | Stalwart returned an unexpected error to the validation call. Investigate Stalwart-side; the MCP server fails closed and rejects the request. |
| Agents get `not_implemented` for tools | `IARSMA_JMAP_BASE_URL` not set — the JMAP handler couldn't bind upstream. |
| Container exits immediately | `docker compose logs iarsma-mcp` — most likely a missing required env var, or `IARSMA_JMAP_BASE_URL` isn't reachable from inside the container. |
| Port `8765` already used | Override `IARSMA_MCP_HTTP_PORT` in `.env` (e.g., `9000`) and rerun `docker compose up -d`. |
