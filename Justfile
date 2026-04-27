# JMAP Webmail — Justfile orchestrator
# Canonical command surface. pnpm scripts mirror the most common recipes.

set shell := ["bash", "-cu"]
set dotenv-load := true

# Show available recipes.
default:
    @just --list --unsorted

# --- Setup --------------------------------------------------------------

# Install all dependencies and verify the toolchain.
bootstrap:
    @echo "→ checking node"
    @node --version
    @echo "→ checking pnpm"
    @pnpm --version
    @echo "→ checking rust"
    @cargo --version
    @echo "→ installing JS dependencies"
    pnpm install
    @echo "→ building Rust workspace"
    cargo build --workspace --quiet
    @echo "✓ bootstrap complete"

# Add the wasm32-wasip2 target needed for WASM Components.
wasm-target:
    rustup target add wasm32-wasip2

# --- Development --------------------------------------------------------

# Run the shell in dev mode.
dev:
    pnpm --filter '@iarsma/shell' dev

# Run the MCP server in dev mode.
dev-mcp:
    pnpm --filter '@iarsma/mcp-server' dev

# Run the token-exchange sidecar in dev mode.
dev-token:
    pnpm --filter '@iarsma/token-exchange' dev

# Run shell + MCP + token-exchange together (tmux/parallel).
dev-all:
    @echo "Run 'just dev', 'just dev-mcp', and 'just dev-token' in separate terminals."
    @echo "Combined dev orchestration lands in F-2 (CI/CD baseline)."

# --- Build / artifacts --------------------------------------------------

# Build the production webmail bundle (iarsma.zip target lives here).
build:
    pnpm --filter '@iarsma/shell' build

# Build all WASM components for the wasm32-wasip2 target.
wasm:
    cargo build --workspace --target wasm32-wasip2 --release
    @echo "✓ WASM components built. jco transpilation lands in F-3."

# Produce iarsma.zip from the shell's dist/.
package:
    @echo "Packaging iarsma.zip — wired up in F-2 / Phase 0 work item 12."

# --- Quality checks -----------------------------------------------------

# Run all checks (typecheck, lint, format-check).
check:
    pnpm typecheck
    pnpm lint
    pnpm fmt:check
    cargo check --workspace
    cargo fmt --all -- --check

# Run all tests.
test:
    pnpm -r run test
    cargo test --workspace

# Format everything.
fmt:
    pnpm fmt
    cargo fmt --all

# --- Codegen ------------------------------------------------------------

# Run the capability-contract codegen.
codegen:
    pnpm --filter '@iarsma/codegen' run build
    @echo "Codegen pipeline implementation lands in F-3."

# --- Cleanup ------------------------------------------------------------

# Remove all build artifacts and node_modules.
clean:
    pnpm clean

# --- Stalwart / dev fixtures (Phase -1, P-1.4) --------------------------

# Verify the configured Stalwart's JMAP capabilities (uses .env).
verify-jmap:
    @if [ -z "${JMAP_HOST:-}" ] || [ -z "${JMAP_USER:-}" ]; then \
        echo "Set JMAP_HOST and JMAP_USER in .env (and JMAP_PASSWORD)."; exit 1; \
    fi
    curl -fsSL -u "${JMAP_USER}:${JMAP_PASSWORD}" \
        "https://${JMAP_HOST}/.well-known/jmap" | jq '.capabilities | keys'

# Seed the dev mailbox with the test corpus (Phase -1.4 — script lands later).
seed-mailbox:
    @echo "Mailbox seeding lands in P-1.4 / Phase 0 boundary."
