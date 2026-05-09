#!/usr/bin/env bash
#
# Build every Rust WASM-component crate in `components/*` and, for the
# subset that hosts import, transpile the WASM artifact into JS bindings
# under `wasm-bindings/<comp>/` (the workspace-wide `@iarsma/wasm-bindings`
# package). Idempotent — safe to re-run.
#
# Invoked from the CI workflow's TS and shell-build jobs. Mirrors the
# `just wasm` recipe so a fresh checkout reproducibly arrives at the
# same on-disk state without needing `just` installed.
#
# Adding a new real component is automatic — appearing in `components/*`
# is enough; if the shell imports its bindings, the transpile happens.

set -euo pipefail

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$repo_root"

# 1. Build every component crate.
for cargo_toml in components/*/Cargo.toml; do
    comp_name="$(basename "$(dirname "$cargo_toml")")"
    echo "→ cargo component build -p $comp_name"
    cargo component build -p "$comp_name" --release
done

# 2. Transpile each into wasm-bindings/<name>/.
#    cargo-component emits to target/wasm32-wasip1/release/<name>.wasm
#    despite the wasip2 inner target — the outer artifact is a Component.
for comp_dir in components/*/; do
    comp_name="$(basename "$comp_dir")"
    underscored="${comp_name//-/_}"
    wasm_artifact="target/wasm32-wasip1/release/${underscored}.wasm"

    if [[ ! -f "$wasm_artifact" ]]; then
        echo "  (skip transpile for $comp_name — no artifact at $wasm_artifact)"
        continue
    fi

    out="shell/src/wasm/$comp_name"
    rm -rf "$out"
    mkdir -p "$out"

    echo "→ jco transpile $comp_name"
    pnpm dlx @bytecodealliance/jco transpile \
        "$wasm_artifact" \
        -o "$out" \
        --name "$underscored"
done

echo "✓ WASM component build + transpile complete."
