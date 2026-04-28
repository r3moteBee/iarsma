# @iarsma/mcp-server

MCP (Model Context Protocol) server exposing Iarsma capabilities as agent-callable tools. Sibling to the shell — both consume the same WASM components and the same capability contracts.

See [docs/decisions.md](../docs/decisions.md) D-014 for why this lives in its own process, and [docs/agent-collaboration.md](../docs/agent-collaboration.md) for the agent-facing protocol.

## Layout

```
mcp-server/
├── src/
│   ├── index.ts            # Entrypoint — loads tools, starts the stdio transport
│   ├── server.ts           # MCP SDK glue: ListTools + CallTool handlers
│   ├── tool-loader.ts      # Reads tools/codegen/dist/tools/*.json registrations
│   ├── auth.ts             # Bearer-token + scope extraction (Phase 0 stub)
│   ├── scope-filter.ts     # hasAllScopes + visibleTools per docs/capability-scopes.md
│   ├── invocation.ts       # Dispatcher: scope check + handler dispatch + dry-run
│   └── __tests__/          # vitest tests
└── package.json
```

## Status

**Phase 0 scaffold landed.** The server loads tool registrations from disk, exposes them via the MCP SDK over stdio, enforces scope checks, and dispatches to handlers. **No tools have real implementations yet** — every call returns `not_implemented` until the underlying components (JMAP client, sanitizer, etc.) come online.

The dispatcher accepts a handler map at construction; once the JMAP client component lands (Phase 0 work item 5), `session.get` and friends get real handlers and `not_implemented` flips to live data.

## Running

```bash
# Generate tool registrations from contracts (run once, or whenever contracts change)
pnpm codegen

# Start the MCP server (stdio transport)
pnpm --filter '@iarsma/mcp-server' run dev

# In a separate terminal: connect with any MCP-aware agent (Claude Desktop, etc.)
# pointing at this stdio process. The tool list will be advertised; call attempts
# will return `not_implemented` until handlers are wired.
```

## Testing

```bash
pnpm --filter '@iarsma/mcp-server' run test
```

Tests cover:
- Tool registration JSON parsing (valid, malformed, missing, duplicate)
- Scope-set semantics (additive, no implication, `admin:*` wildcard, refinements independent)
- Bearer-token + scope-header extraction
- Dispatcher: not_found, forbidden, not_implemented, ok, preview, handler-thrown errors
- Integration: loads the real `tools/codegen/dist/tools/` if present

## Architecture

The MCP server is *thin*. Domain logic (loading, auth, scopes, dispatch) lives in standalone modules with no MCP SDK coupling so the modules are testable in isolation. `server.ts` is the only file that imports the SDK; everything else stays portable.

This shape leaves room for:

- **HTTP/SSE transport** (Phase 1+) — for remote agents. The same dispatcher, different transport. Auth headers get pulled in real this time.
- **Real OIDC introspection** — replaces the Phase 0 `extractIdentity` stub. The interface stays the same: in → `AgentIdentity`, out.
- **Tool handler registry** — wired separately as each underlying component lands. Today, `createIarsmaMcpServer({ tools })` produces a server where every tool returns `not_implemented`. Tomorrow, `createIarsmaMcpServer({ tools, handlers })` plugs in real implementations.

## Why JSON over compile-time imports

The MCP server reads `tools/codegen/dist/tools/*.json` at startup rather than importing from `@iarsma/codegen`. Trade-offs:

- ✅ Loose coupling: codegen and MCP server can be released independently.
- ✅ Restart picks up new tools without recompilation.
- ✅ Easier to test — drop a JSON file in a tmpdir, point the loader at it.
- ⚠️ No compile-time type sharing between codegen output and server consumption; the loader's Zod schema is the runtime contract instead.
