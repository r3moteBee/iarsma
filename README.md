# Iarsma

**A JMAP-native webmail built for agent/human collaboration.**

> *iarsma* (Irish, /ˈiərˠsˠmə/, "EER-sma") — *relic, artifact, durable remnant*. The thing that endures.

A self-hosted JMAP-native communications client where humans and agents work as peers — not where agents are bolted onto a legacy mail UI. Mail, calendar, contacts, and lightweight files are the surface area; the design work is the collaboration model layered through every capability.

The client targets a [Stalwart Mail Server](https://stalw.art/) backend (or any JMAP-compliant server), uses Git as the file-storage substrate, and wraps [Squire](https://github.com/fastmail/Squire) for rich text. The shell is TypeScript + React + Tauri 2; security-critical and reusable logic lives in WebAssembly components.

> **Status:** pre-alpha. Repository scaffold and decision log are in place; Phase 0 vertical slice is the next milestone. See [`docs/implementation-plan.md`](docs/implementation-plan.md) for what's next.

## Documentation

Read these in order:

1. **[Project Brief](docs/project-brief.md)** — vision, architecture, components, agent collaboration model. The *what and why*.
2. **[Implementation Plan](docs/implementation-plan.md)** — phased work items, definitions of done, risks. The *how and when*.
3. **[Decisions Log](docs/decisions.md)** — architectural decisions with rationale. The *because*.
4. **[Deployment Guide](docs/deployment.md)** — operator-facing instructions for the supported deployment paths.
5. **[Capability Scopes](docs/capability-scopes.md)** — the agent capability vocabulary.

## Quick start (developers)

Prerequisites:
- Node 20+ and [pnpm](https://pnpm.io/) 9+
- Rust 1.78+ with `wasm32-wasip2` target (`rustup target add wasm32-wasip2`)
- [`just`](https://github.com/casey/just) (`brew install just` or `cargo install just`)
- A reachable Stalwart Mail Server (see `docs/deployment.md`)

```bash
git clone <repo-url> iarsma
cd iarsma
just bootstrap   # installs deps, builds the workspace
just dev         # runs the shell in dev mode
```

## Architecture at a glance

```
TypeScript + React + Tauri 2 shell
    │
    ├─ WASM Components (Rust): jmap-client, html-sanitizer, markdown,
    │                          action-log, memory-backend, git-backend
    │
    ├─ MCP server (Node, separate process) — capability-scoped tools for agents
    │
    ├─ Token-exchange sidecar (Node) — confidential OAuth client_secret
    │
    └─ Optional co-deployed Open Brain — Tier-2 memory backend
```

See [`docs/project-brief.md`](docs/project-brief.md) for the full architecture.

## License

Dual-licensed under either of:

- Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE) or <http://www.apache.org/licenses/LICENSE-2.0>)
- MIT license ([LICENSE-MIT](LICENSE-MIT) or <http://opensource.org/licenses/MIT>)

at your option.

### Contribution

Unless you explicitly state otherwise, any contribution intentionally submitted for inclusion in the work by you, as defined in the Apache-2.0 license, shall be dual licensed as above, without any additional terms or conditions.
