# OpenBrain Co-Deployment Recipe

A Docker Compose recipe for running [Open Brain (OB1)](https://github.com/NateBJones-Projects/OB1) alongside Iarsma as the Tier-2 memory backend. OB1 is an MCP-native vector memory server (PostgreSQL + pgvector); agents that discover it via Iarsma's `urn:iarsma:agent-context` capability URN connect to it **directly** for vector search and free-text memory. The webmail does **not** proxy memory queries — Iarsma's only role here is configuration + discovery.

Status: Phase 5c work item 10. See [`docs/decisions.md`](../../docs/decisions.md) D-031 for the architectural rationale and D-054 for the recipe's design choices.

## What this recipe contains

| File | What it is |
|---|---|
| `docker-compose.yml` | Three services: `db` (postgres + pgvector), `ollama` (local embeddings), `ob1` (OB1 MCP server built from a pinned upstream commit) |
| `init/01-schema.sql` | Schema bootstrap. Creates the `thoughts` table + `match_thoughts` function. Default is `vector(768)` to match the bundled Ollama embedder |
| `init/01-schema-1536.sql.example` | Alternative schema for OpenRouter/OpenAI 1536-dim embeddings |
| `.env.example` | Operator config — copy to `.env`, fill in the one required field (`MCP_ACCESS_KEY`) |

## Quickstart

```bash
cd deployment/openbrain
cp .env.example .env
# Generate an MCP access key:
echo "MCP_ACCESS_KEY=$(openssl rand -hex 32)" >> .env

docker compose up -d
# First run: ollama pulls nomic-embed-text (~270 MB). Watch with:
docker compose logs -f ollama-init

# Once `ob1` is up:
curl -sS http://localhost:8000/health
```

Defaults give you a zero-API-key embeddings stack. Chat features are off until you add a chat endpoint (see "Enable chat tools" below).

## Pointing Iarsma at OB1

On the Iarsma webmail host, set:

```bash
IARSMA_MEMORY_BACKEND_URL=http://<openbrain-host>:8000/mcp
```

on both the MCP server (`mcp-server/`) and token-exchange (`token-exchange/`) processes, then SIGHUP or restart. The next time an agent fetches the JMAP session or the `/.well-known/iarsma` discovery payload, the `memoryBackendUrl` field will be advertised; the agent connects to OB1 directly using its own `MCP_ACCESS_KEY`-bearer token.

The browser shell picks up the same URL via `config.json` (`agentContext.memoryBackendUrl`) — see `deployment/iarsma-web-app/config.json.example`.

## Common operator switches

### Upgrade OB1 (review the diff, then bump)

```bash
# Confirm what changed upstream
git diff $(grep ^OB1_REF .env | cut -d= -f2) main -- integrations/kubernetes-deployment

# Set the new SHA in .env, then rebuild:
docker compose build --no-cache ob1
docker compose up -d ob1
```

Setting `OB1_REF=main` in `.env` tracks upstream HEAD on every rebuild — faster updates, less reproducibility. The default-pinned SHA is the safer choice for production.

### Swap to OpenRouter embeddings (1536-dim)

OpenAI/OpenRouter's `text-embedding-3-small` returns 1536-dim vectors. The bundled Ollama model returns 768-dim. They are not interchangeable inside one database — moving between them requires a wipe **before** any thoughts land.

```bash
docker compose down -v             # destroys pgdata + ollama_models
cp init/01-schema-1536.sql.example init/01-schema.sql
# In .env:
#   EMBEDDING_API_BASE=https://openrouter.ai/api/v1
#   EMBEDDING_API_KEY=sk-or-...
#   EMBEDDING_MODEL=openai/text-embedding-3-small
# Optionally remove the `ollama` and `ollama-init` services from compose.
docker compose up -d
```

### Enable chat tools

OB1's chat-completion MCP tools error with a clear "not configured" message until you set chat credentials. To enable them, point at any OpenAI-compatible endpoint (OpenRouter, Anthropic via gateway, a local Ollama chat model, your own gateway):

```bash
# In .env:
CHAT_API_BASE=https://openrouter.ai/api/v1
CHAT_API_KEY=sk-or-...
CHAT_MODEL=openai/gpt-4o-mini
```

Then `docker compose up -d ob1` to restart the server with the new env.

### Add an Ollama chat model (local, no external API)

Local CPU chat is slow but possible. Add to `ollama-init`'s entrypoint:

```yaml
entrypoint:
  - sh
  - -c
  - 'ollama pull nomic-embed-text && ollama pull llama3.2:1b'
```

Then set in `.env`:

```bash
CHAT_API_BASE=http://ollama:11434/v1
CHAT_API_KEY=ollama
CHAT_MODEL=llama3.2:1b
```

Expect multi-second response times on CPU; budget RAM accordingly.

### Expose Postgres for inspection

Uncomment the `ports:` block under the `db:` service in `docker-compose.yml`. Re-up with `docker compose up -d db`. Connect with:

```bash
psql "postgresql://${POSTGRES_USER:-openbrain}@127.0.0.1:5432/${POSTGRES_DB:-openbrain}"
```

## Trust posture

- **Iarsma does not handle agent → OB1 traffic.** Agents authenticate to OB1 directly using `MCP_ACCESS_KEY` as a bearer token. Compromising the webmail does not grant memory access; compromising OB1 does not grant mail access.
- **Iarsma does not store OB1 credentials in the browser.** The discovery URN carries only the URL. Agents bring their own bearer.
- **Co-deployment is not co-trust.** Even when both services run on the same host, the privilege boundary is the same as if OB1 ran on a separate host — modulo whatever network ACLs you put in front of port 8000.

## Limitations

- **Embeddings are model-locked at init time.** Changing dimension requires a `docker compose down -v` (data loss). Pick the embedder before you ingest anything you care about.
- **No multi-tenant isolation.** Every agent with a valid `MCP_ACCESS_KEY` sees the same thought corpus. Per-principal isolation needs OB1 metadata-filter conventions, not yet wired here.
- **Health checks are coarse.** `ollama` is "healthy" once `nomic-embed-text` is listed locally; that doesn't guarantee the model is loaded or responsive. First-request latency can be tens of seconds on cold start.
