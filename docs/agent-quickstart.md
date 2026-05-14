# Iarsma — Agent Quickstart

How an external MCP client connects to an Iarsma deployment, authenticates, and runs the read-mail flow end-to-end. **Last updated:** 2026-05-14.

This is the agent-side companion to `docs/architecture.md` (server side) and `docs/discovery.md` (endpoint advertisement). If you're building tooling on top of Iarsma — a CLI, a research assistant, a workflow integration — start here.

## What you can do today

Phase 2's MCP read surface exposes these capabilities:

| Tool | Purpose | Scope |
|------|---------|-------|
| `session.get` | Resolve the JMAP account and discover `urn:iarsma:agent-context`. | `session:read` |
| `mailbox.list` | Get the user's mailbox tree (Inbox, Sent, Drafts, custom folders). | `mail:read.metadata` |
| `thread.list` | Page through threads in a given mailbox, newest first. | `mail:read.metadata` |
| `thread.get` | Fetch a full thread: every message, body parts, attachment metadata. | `mail:read` |
| `thread.search` | Server-side full-text search across the account. | `mail:read` |
| `mail.draft` | Create a draft message. Supports `dryRun` for preview. | `mail:draft` |

Phase 3 adds the destructive write surface (`mail.send`, mailbox/keyword mutations) and per-agent scope enforcement. Phase 2 ships **stdio** + **Streamable HTTP** transports with a single shared-secret bearer; the same MCP client code works against both.

## Picking a transport

```
                  ┌──────────────────────────┐
                  │  External MCP client     │
                  │  (CLI, Claude Desktop,   │
                  │   custom script, etc.)   │
                  └──────────┬───────────────┘
                             │
              ┌──────────────┴─────────────────┐
              │                                │
              ▼                                ▼
     ┌────────────────┐              ┌─────────────────────┐
     │   stdio        │              │   Streamable HTTP   │
     │                │              │                     │
     │  Local process │              │  Network endpoint   │
     │  Best for dev  │              │  Best for remote    │
     │  No auth       │              │  Bearer-token auth  │
     └────────────────┘              └─────────────────────┘
```

- **stdio** for local development. The MCP client spawns `pnpm --filter @iarsma/mcp-server start` (or equivalent) and talks to it over the child process's `stdin`/`stdout`. No port, no auth — the OS is the trust boundary.
- **Streamable HTTP** for remote / hosted access. The server listens on a configured port; clients POST to `/mcp` with `Authorization: Bearer <shared-token>`. Use this when the client and server live on different machines.

Both transports expose the same handler set. Pick whichever fits your environment.

## Discovery: find the endpoint

The discovery URN `urn:iarsma:agent-context` carries the MCP endpoint URL. There are two ways to read it:

### Option A — well-known endpoint

```bash
curl -s https://sw-mail.example.net/.well-known/iarsma | jq
```

Response:

```json
{
  "version": 1,
  "webmailMcpUrl": "https://sw-mail.example.net/mcp",
  "actionLogUrl": "https://sw-mail.example.net/log",
  "memoryBackendUrl": "https://ob1.example.net/mcp"
}
```

`webmailMcpUrl` is the Streamable HTTP endpoint to target.

### Option B — MCP capabilities map

After connecting (via stdio or HTTP), the MCP server advertises the same URN inside its `capabilities` field at `initialize` time:

```json
{
  "capabilities": {
    "tools": {},
    "urn:iarsma:agent-context": {
      "version": 1,
      "webmailMcpUrl": "...",
      "actionLogUrl": "..."
    }
  }
}
```

Use Option A when you need to find the endpoint *before* connecting. Use Option B when you've already connected and want to discover sibling services (the action-log endpoint, an optional memory backend).

Full schema: `docs/discovery.md`.

## Authentication

### stdio (local dev)

No authentication. The MCP server spawns with `IARSMA_JMAP_BASE_URL` + `IARSMA_AGENT_TOKEN` in its environment; every connected client uses the same JMAP credentials. Production deployments don't use stdio.

### Streamable HTTP (remote)

**Phase 2**: single shared bearer secret. The operator sets `IARSMA_MCP_HTTP_TOKEN` on the server; every connected agent presents the same token. This is **not** suitable for production deployments with multiple agents — anyone who learns the token impersonates the whole account.

```http
POST /mcp HTTP/1.1
Host: sw-mail.example.net
Authorization: Bearer <IARSMA_MCP_HTTP_TOKEN>
Content-Type: application/json
Accept: application/json, text/event-stream
```

Missing or wrong token → `401 Unauthorized` with `WWW-Authenticate: Bearer realm="iarsma-mcp"`. The well-known endpoint and `/healthz` are unauthenticated.

**Phase 3**: per-agent identity issuance. The user creates a token for each agent through the Iarsma UI, with a scoped capability set (e.g., `mail:read` only). The MCP server introspects the token at connect time and restricts the tool list accordingly. The protocol shape stays the same — only the token issuance + introspection changes.

## Example: list and read a thread

End-to-end flow using Anthropic's MCP SDK (TypeScript). Substitute `@modelcontextprotocol/sdk` for your language's client.

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const transport = new StreamableHTTPClientTransport(
  new URL('https://sw-mail.example.net/mcp'),
  {
    requestInit: {
      headers: { authorization: 'Bearer your-shared-secret' },
    },
  },
);

const client = new Client(
  { name: 'iarsma-quickstart', version: '0.0.1' },
  { capabilities: {} },
);
await client.connect(transport);

// 1. List mailboxes — find the Inbox.
const mailboxesRes = await client.callTool({
  name: 'mailbox.list',
  arguments: {},
});
const mailboxes = (mailboxesRes.content[0] as { text: string }).text;
const inboxId = JSON.parse(mailboxes).find(
  (m: { role?: string }) => m.role === 'inbox',
)!.id;

// 2. List threads in the Inbox.
const threadsRes = await client.callTool({
  name: 'thread.list',
  arguments: { mailboxId: inboxId, limit: 10 },
});
const { threads } = JSON.parse(
  (threadsRes.content[0] as { text: string }).text,
);

// 3. Read the latest thread.
const threadGetRes = await client.callTool({
  name: 'thread.get',
  arguments: { threadId: threads[0].id },
});
const { emails } = JSON.parse(
  (threadGetRes.content[0] as { text: string }).text,
);
console.log(`Latest message subject: ${emails[emails.length - 1].subject}`);
```

### Example: search

```ts
const searchRes = await client.callTool({
  name: 'thread.search',
  arguments: { query: 'project plan', limit: 5 },
});
const { threads: hits } = JSON.parse(
  (searchRes.content[0] as { text: string }).text,
);
console.log(`Found ${hits.length} thread(s).`);
```

### Example: dry-run a draft

`mail.draft` is destructive, so the MCP envelope carries a `mode` field. **Always** dry-run first — agents should never commit a draft the user hasn't seen.

```ts
const previewRes = await client.callTool({
  name: 'mail.draft',
  arguments: {
    mode: 'preview',
    params: {
      mailboxId: '<drafts-mailbox-id>',
      from: { name: 'Brent', email: 'brent@r3motely.net' },
      to: [{ email: 'alice@example.net' }],
      subject: 'Test draft',
      bodyText: 'Hi Alice.',
    },
  },
});
// Inspect previewRes — render to the user, get approval, THEN commit.
const commitRes = await client.callTool({
  name: 'mail.draft',
  arguments: {
    mode: 'commit',
    params: { /* same payload */ },
  },
});
```

## Same flow with curl

For one-off scripting, you can hit the HTTP endpoint directly. The body is JSON-RPC 2.0 over MCP's call shape:

```bash
TOKEN="your-shared-secret"
MCP="https://sw-mail.example.net/mcp"

# 1. List mailboxes.
curl -s -X POST "$MCP" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": { "name": "mailbox.list", "arguments": {} }
  }'

# 2. List threads in mailbox "Mb01".
curl -s -X POST "$MCP" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "thread.list",
      "arguments": { "mailboxId": "Mb01", "limit": 10 }
    }
  }'
```

The `accept: application/json, text/event-stream` header tells the server you accept either a direct JSON response (simple call/response) or an SSE stream (progress + final result). For these read-only tools the server returns plain JSON; the SSE upgrade lands when long-running operations do (Phase 3 push subscriptions).

## Setting up the server (operator side)

```bash
# Required for any handler to work:
export IARSMA_JMAP_BASE_URL="https://sw-mail.example.net"
export IARSMA_AGENT_TOKEN="<bearer-token-for-the-JMAP-account>"

# Optional — advertise discovery URN values:
export IARSMA_WEBMAIL_MCP_URL="https://sw-mail.example.net/mcp"

# Enable HTTP transport (omit to run stdio-only):
export IARSMA_MCP_HTTP_PORT="8765"
export IARSMA_MCP_HTTP_TOKEN="$(openssl rand -hex 32)"  # share with agents
export IARSMA_MCP_HTTP_HOST="0.0.0.0"  # default; restrict to "127.0.0.1" for localhost-only

# Run:
pnpm --filter @iarsma/mcp-server start
```

The server prints which transports are active:

```
[iarsma-mcp] capabilities wired against https://sw-mail.example.net: session.get, mailbox.list, thread.list, thread.get, thread.search, mail.draft
[iarsma-mcp] connected via stdio. Awaiting requests...
[iarsma-mcp] Streamable HTTP transport listening on 0.0.0.0:8765. POST /mcp with Authorization: Bearer <token>.
```

## Troubleshooting

| Symptom | Likely cause |
|---------|--------------|
| `401 Unauthorized` | Missing or wrong `Authorization: Bearer <token>`. Check the env var on the server matches the header on the client. |
| `404 Not Found` on POST | Wrong path. The endpoint is `/mcp`, not `/`. |
| Tool returns `not_implemented` | `IARSMA_JMAP_BASE_URL` or `IARSMA_AGENT_TOKEN` not set on the server — the handlers couldn't bind. |
| `jmap_http_error` | The JMAP server (Stalwart) refused the request. Check the token has the right scopes against Stalwart. |
| `invalid_input` | The arguments don't match the contract's input schema. Re-check against `mcp-server/dist/tools/<tool>.json`. |

## What's next (Phase 3 preview)

- Per-agent token issuance + scope enforcement (the same MCP surface, but each agent sees only the tools it's permitted to call).
- The write surface (`mail.send`, `mailbox.move`, `keyword.set`) — every destructive call goes through a dry-run + policy-seam decision.
- Push subscriptions over the Streamable HTTP transport's SSE channel — agents get notified about new mail without polling.
- Action-log UI surface — every tool call appears in a tamper-evident chain visible to the user.

See `docs/implementation-plan.md` for the full Phase 3 work-item list.
