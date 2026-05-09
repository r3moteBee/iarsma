# Iarsma — Discovery

How agents, native-app embedders, and tuatha find Iarsma's endpoints.

## Two surfaces, one payload

Iarsma advertises its endpoint set through two equivalent surfaces:

1. **Parallel discovery endpoint** — `GET /.well-known/iarsma` returns the JSON payload below. Single round-trip; no MCP/JMAP handshake required. Native-app embedders and ad-hoc tools fetch this first. Served by the `token-exchange` sidecar (D-048).
2. **MCP capabilities map** — when an agent connects to Iarsma's MCP server, the `urn:iarsma:agent-context` URN appears under capabilities at the initialize response. Same JSON payload as the well-known endpoint.

Both surfaces emit the same payload. Operators can disable the well-known route in dev (set no `IARSMA_WEBMAIL_MCP_URL`); MCP advertisement is unaffected.

## Schema

```json
{
  "version": 1,
  "webmailMcpUrl": "https://sw-mail.example.net/mcp",
  "actionLogUrl": "https://sw-mail.example.net/log",
  "memoryBackendUrl": "https://ob1.example.net/mcp"
}
```

| Field              | Type   | Required | Description |
|--------------------|--------|----------|-------------|
| `version`          | int    | ✓        | Monotonic integer schema version (boundary 5 of `docs/versioning.md`). Currently `1`. |
| `webmailMcpUrl`    | string | ✓        | The webmail's MCP endpoint. Agents connect here for tool discovery and invocation. |
| `actionLogUrl`     | string |          | The action-log read endpoint. Set when the action log is exposed for external query (Phase 3+). |
| `memoryBackendUrl` | string |          | A configured memory backend (e.g. an OB1 instance). Agents connect here directly for free-text / vector queries (D-031). |

The Zod source-of-truth schema lives in `token-exchange/src/discovery.ts` and is replicated identically in `mcp-server/src/agent-context.ts` (the two locations are kept in lockstep — see schema sync invariant comments in both files).

## Mutation policy (D-049)

Per `docs/versioning.md` boundary 5 — monotonic integer.

- **Adding a new optional field** → no version bump. Consumers that don't recognize the field ignore it gracefully.
- **Adding a new required field** → bump `version` (existing consumers don't know to read it).
- **Renaming, removing, or changing the semantic of an existing field** → bump `version`. The previous version's interpretation stays in the codebase for at least two bundle minor releases per migration policy (D-042).
- **Changing the schema URL or content type** → does not happen; the well-known endpoint is the contract.

Consumers tolerant: a future-version payload (e.g. `version: 2`) is read by a `version: 1` consumer for the fields it knows; new fields are ignored. Lower-version payloads are read with the older fields' interpretation.

## Wire delivery

### `GET /.well-known/iarsma`

Served by the `token-exchange` sidecar at the root path. Returns `200` with the JSON payload, `content-type: application/json`, `cache-control: public, max-age=300`. Returns `404` when the sidecar's discovery payload is unconfigured (the operator chose not to publish it from this surface).

The 5-minute cache hint is a balance: short enough that operators don't have to bust caches when adding endpoints (e.g., lighting up `memoryBackendUrl`), long enough that a busy agent fleet doesn't refetch on every invocation.

### MCP capabilities map

The MCP server emits the URN at initialize time when its environment includes `IARSMA_WEBMAIL_MCP_URL`. Agents handling MCP's capability negotiation pick up the URN as a value under `capabilities[urn:iarsma:agent-context]`. The MCP SDK passes arbitrary extension fields through, so this is a free piggyback.

## Deployment routing

Iarsma's reference deployment serves both the bundle (Stalwart Web Applications, D-018) and the token-exchange sidecar on the same VM. To make `/.well-known/iarsma` reachable at the root domain, operators have three working patterns:

1. **Stalwart's reverse proxy.** Configure Stalwart's HTTP front to proxy `/.well-known/iarsma` to the sidecar's port (`http://127.0.0.1:4000/.well-known/iarsma` by default). Cleanest when Stalwart fronts everything; no extra processes.
2. **External reverse proxy (Caddy / Nginx).** A `proxy_pass` (or Caddy `reverse_proxy`) directive routes `/.well-known/iarsma` to the sidecar. Useful when an existing reverse-proxy already terminates TLS for the domain.
3. **Same-port sidecar.** Run the sidecar on `:443` (or the public port) directly. Trades simplicity at the routing layer for the sidecar handling TLS itself; not the recommended default.

Whichever pattern is chosen, the test that the operator's deployment is correct is:

```bash
curl -sf "https://<your-mail-server>/.well-known/iarsma" | jq .
```

Should return the JSON payload. `just verify-deployment` (Phase 0 work item 13) includes this check from the deployment hardening lane onwards.

## Configuration

The sidecar reads three optional env vars to populate the payload:

| Variable                      | Description |
|-------------------------------|-------------|
| `IARSMA_WEBMAIL_MCP_URL`      | The MCP endpoint URL (required to enable the route). |
| `IARSMA_ACTION_LOG_URL`       | Optional action-log read endpoint. |
| `IARSMA_MEMORY_BACKEND_URL`   | Optional memory backend (e.g. OB1) endpoint. |

If `IARSMA_WEBMAIL_MCP_URL` is unset, `GET /.well-known/iarsma` returns 404 — the sidecar still functions for `POST /auth/token` and `GET /healthz`. Production deployments set all three when they're available.

The MCP server reads the same three variables. Operators set them once in the shared environment; both processes pick them up.

## What lives where

- **Schema (Zod)** — `token-exchange/src/discovery.ts` (canonical) and `mcp-server/src/agent-context.ts` (mirror, sync'd via doc invariant).
- **Loader** — `loadDiscoveryPayload(env)` in token-exchange; `loadAgentContext(env)` in mcp-server. Same env vars, same payload.
- **Server route** — `buildServer({..., discovery})` in token-exchange wires the GET handler.
- **MCP advertisement** — `agentContextCapability(ctx)` in mcp-server returns the `{[URN]: payload}` shape for spreading into MCP capabilities.
- **Deployment routing** — operator's responsibility; verified by `just verify-deployment`.

## Future fields

Anticipated additions (not committed; will not bump `version` when added):

- `openapiUrl` — pointer to the bundled OpenAPI doc, for native-app embedders generating SDKs.
- `agentQuickstartUrl` — link to the agent-onboarding documentation page.
- `policyHints` — coarse machine-readable flags (e.g. `destructiveDryRunRequired: true`) so agents can pre-decide approach before calling.
- `mcpTransports` — list of MCP transports the server supports (`["stdio", "streamable-http"]`) once Streamable HTTP lands (Phase 2 item 10a).

These are not implemented today; the schema is intentionally minimal pre-Phase-1.
