# Iarsma MCP server — docker-compose recipe

Single-command deployment for the agent-facing MCP server alongside an existing Stalwart instance. The webmail (`iarsma-base-webmail.zip` served by Stalwart) handles user-facing token issuance + audit; this recipe brings up the always-on process that agents actually connect to.

## What you need before starting

- **An existing Stalwart instance** reachable over HTTPS (e.g. `https://sw-mail.example.test`). This recipe does NOT install or manage Stalwart.
- **Docker** and the **Docker Compose plugin** installed on the host you want to run the MCP server on (your pantheon server, a side container next to Stalwart, anywhere reachable by the agents you'll point at it).
- **An agent token issued from the Iarsma webmail UI** (Settings → Agent tokens → fill in the form, copy the secret it shows once).
- The repo checked out: `git clone https://github.com/r3moteBee/iarsma.git`

## Three-step quickstart

```bash
cd iarsma/deployment/mcp

# 1. Copy the env template and fill in your values.
cp .env.example .env
$EDITOR .env
#   IARSMA_JMAP_BASE_URL   → your Stalwart URL
#   IARSMA_AGENT_TOKEN     → the secret from the Iarsma UI
#   IARSMA_MCP_HTTP_TOKEN  → same secret for now

# 2. Build the image + start the server.
docker compose up -d

# 3. Watch the logs to confirm it's listening.
docker compose logs -f iarsma-mcp
# Expect: "Streamable HTTP transport listening on 0.0.0.0:8765"
```

That's it. Your agents now connect to `http://<this-host>:8765/mcp` with `Authorization: Bearer <IARSMA_MCP_HTTP_TOKEN>`.

## Verify it works

From the MCP host itself:

```bash
TOKEN="<the-same-secret>"
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
- **No persistent state.** The MCP server is stateless — every request is authenticated independently against `IARSMA_MCP_HTTP_TOKEN`. Issued tokens themselves live in your browser IDB on the webmail side.
- **No automatic token rotation.** When you revoke a token in the Iarsma UI, also pull it from `.env` and `docker compose up -d` to redeploy. Per-agent introspection (server-side token revocation) is a future PR.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `Streamable HTTP transport listening` doesn't appear in the logs | Missing `IARSMA_MCP_HTTP_PORT` or `IARSMA_MCP_HTTP_TOKEN`. The server falls back to stdio if HTTP env isn't configured. |
| Agents get `401 Unauthorized` | The `Authorization: Bearer <token>` header doesn't match `IARSMA_MCP_HTTP_TOKEN`. Check the env vs. what your agent's config carries. |
| Agents get `not_implemented` for tools | `IARSMA_JMAP_BASE_URL` or `IARSMA_AGENT_TOKEN` not set — the JMAP handler couldn't bind upstream. |
| Container exits immediately | `docker compose logs iarsma-mcp` — most likely a missing required env var, or `IARSMA_JMAP_BASE_URL` isn't reachable from inside the container. |
| Port `8765` already used | Override `IARSMA_MCP_HTTP_PORT` in `.env` (e.g., `9000`) and rerun `docker compose up -d`. |
