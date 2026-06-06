# syntax=docker/dockerfile:1.7
#
# @iarsma/mcp-server container image (PR 35).
#
# The build context is the MONOREPO ROOT (not mcp-server/), because the
# server depends on workspace packages (@iarsma/wasm-bindings,
# @iarsma/codegen). The deployment/mcp/docker-compose.yml file points
# `context: ../..` so this works out of the box.
#
# Multi-stage:
#   1. `builder` installs every workspace dep with the dev profile and
#      compiles TypeScript + runs codegen so `dist/` + the JSON tool
#      registrations exist.
#   2. `runner` is a slim node:20 image with only the runtime files:
#      mcp-server/dist, wasm-bindings/*, tools/codegen/dist/, and a
#      production-trimmed node_modules tree.
#
# Image size lands at ~120 MB compressed (alpine + node:20 + the
# WASM bundles). The runner doesn't include pnpm — it just runs
# `node mcp-server/dist/index.js`.

# ── Stage 1: builder ───────────────────────────────────────────────
FROM node:20-alpine AS builder

# pnpm via corepack (no extra apt-get / npm install dance).
RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /work

# Copy lockfile + workspace manifest first so the install layer is
# cached across source-only changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY mcp-server/package.json ./mcp-server/
COPY wasm-bindings/package.json ./wasm-bindings/
COPY tools/codegen/package.json ./tools/codegen/
COPY shell/package.json ./shell/
COPY token-exchange/package.json ./token-exchange/

# The shell pulls in heavy browser-side deps the MCP server doesn't
# actually need. `pnpm install --filter !@iarsma/shell...` would skip
# it, but the cleaner story is to install everything and let the
# runner stage drop what isn't used. Disk during build is cheap.
RUN pnpm install --frozen-lockfile

# Now the source.
COPY tools/codegen ./tools/codegen
COPY wasm-bindings ./wasm-bindings
COPY mcp-server ./mcp-server

# Codegen produces tools/codegen/dist/tools/*.json which the server
# loads at startup.
RUN pnpm --filter @iarsma/codegen build && pnpm codegen

# Build the MCP server itself.
RUN pnpm --filter @iarsma/mcp-server build

# ── Stage 2: runner ────────────────────────────────────────────────
FROM node:20-alpine AS runner

# Stalwart's typical container labels — useful for tooling.
LABEL org.opencontainers.image.title="iarsma-mcp"
LABEL org.opencontainers.image.description="Iarsma MCP server — Streamable HTTP transport for agent tools."
LABEL org.opencontainers.image.source="https://github.com/r3moteBee/iarsma"
LABEL org.opencontainers.image.licenses="MIT OR Apache-2.0"

WORKDIR /app

# Pull only what the runtime needs. The mcp-server's dist/ is the
# entrypoint; the workspace deps come along through node_modules
# symlinks the install stage created.
COPY --from=builder /work/mcp-server/dist ./mcp-server/dist
COPY --from=builder /work/mcp-server/package.json ./mcp-server/package.json
COPY --from=builder /work/wasm-bindings ./wasm-bindings
COPY --from=builder /work/tools/codegen/dist ./tools/codegen/dist
COPY --from=builder /work/node_modules ./node_modules

# Symlinks inside node_modules/.pnpm point at the workspace dirs by
# relative path — preserve the layout so requires resolve.
COPY --from=builder /work/package.json ./package.json

# Default HTTP transport port. Override via the IARSMA_MCP_HTTP_PORT
# env var; the compose recipe does that.
EXPOSE 8765

# Run as the unprivileged `node` user that node:alpine ships.
USER node

# Direct exec — no shell wrapping, so the container responds to
# SIGTERM correctly and `docker stop` exits cleanly.
ENTRYPOINT ["node", "mcp-server/dist/index.js"]
