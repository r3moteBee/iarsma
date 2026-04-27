# Open Brain Co-Deployment Recipe

Optional: deploy [Open Brain (OB1)](https://github.com/NateBJones-Projects/OB1) alongside the webmail to act as the Tier-2 memory backend.

## Status

Recipe lands in **Phase 5 work item 10** — see [`docs/implementation-plan.md`](../../docs/implementation-plan.md). This README is a placeholder so the directory exists in the repo scaffold and future contributors know where the recipe will live.

## What this directory will contain

- `docker-compose.yml` — Postgres 16 + pgvector, OB1 MCP gateway, volume-mounted persistent storage.
- `.env.example` — connection settings (OIDC issuer, client id, postgres password) for honoring the same identities as the webmail.
- `README.md` (this file, expanded) — operator instructions.

## Why co-deployment, not integration

The webmail does NOT proxy memory queries through to OB1. OB1 runs as an independent service with its own MCP endpoint. The webmail's role is limited to:

1. Configuration (`config.json` carries `memoryBackend.url`).
2. Discovery (the `urn:iarsma:agent-context` capability URN advertises the OB1 MCP URL).
3. Trust delegation (the `MemoryBackend` trait wires structured-store reads/writes through to OB1; vector search and free-text thoughts go agent-direct).

See [`docs/decisions.md`](../../docs/decisions.md) D-031 for the full rationale.
