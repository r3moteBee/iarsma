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

# Run the Tauri 2 native shell in dev mode. Spawns Vite on port 1420
# (per `tauri.conf.json`'s `beforeDevCommand`) and opens a native
# window pointed at it. Requires the Tauri 2 system deps —
# https://v2.tauri.app/start/prerequisites/ has the per-OS package
# list (Debian/Ubuntu: libwebkit2gtk-4.1-dev, libgtk-3-dev,
# libayatana-appindicator3-dev, librsvg2-dev, xdotool, patchelf).
tauri-dev:
    cd shell && pnpm exec tauri dev

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

# Build the Tauri 2 native bundle for the host platform. Produces
# `.AppImage` / `.deb` (Linux), `.dmg` (macOS), `.msi` (Windows). Code
# signing is configured per platform when those builds light up in
# Phase 6.
tauri-build:
    cd shell && pnpm exec tauri build

# Build all real WASM components and transpile to JS bindings via jco.
# cargo-component emits to target/wasm32-wasip1/ — the outer artifacts are
# Component Model components despite the wasip1 inner core modules (D-038).
# Add a new component by appending its name to COMPONENTS below; the rest
# follows the same recipe.
wasm:
    #!/usr/bin/env bash
    set -euo pipefail
    COMPONENTS=(jmap-client action-log)
    for c in "${COMPONENTS[@]}"; do
        cargo component build -p "$c" --release
        out="shell/src/wasm/$c"
        rm -rf "$out"
        mkdir -p "$out"
        wasm_underscored="${c//-/_}"
        jco transpile "target/wasm32-wasip1/release/${wasm_underscored}.wasm" \
            -o "$out" \
            --name "$wasm_underscored"
        echo "✓ $c transpiled to $out/"
    done

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
    just fmt-check

# Run all tests.
test:
    pnpm -r run test
    cargo test --workspace

# Format everything (skips cargo-component-generated bindings.rs files).
fmt:
    pnpm fmt
    just _rustfmt --edition 2021

# Format-check Rust code (mirrors CI). Skips bindings.rs because it's
# regenerated on every component build.
fmt-check:
    just _rustfmt --check --edition 2021

# Internal helper: run rustfmt over every source file we own.
_rustfmt *args:
    #!/usr/bin/env bash
    set -euo pipefail
    git ls-files -z '*.rs' | xargs -0 rustfmt {{args}}

# --- Codegen ------------------------------------------------------------

# Run the capability-contract codegen — walks contracts/, writes to dist/.
codegen:
    pnpm --filter '@iarsma/codegen' run codegen

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
