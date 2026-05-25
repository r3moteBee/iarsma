# Iarsma — Notes for Claude Code sessions

Read first: docs/project-brief.md, docs/implementation-plan.md, docs/decisions.md.

Current phase: Phase 0 (~half done). See implementation-plan.md for status.

Workflow:
- Branch ruleset on main blocks direct pushes. All changes go via PR.
- Required CI checks: ts, rust, shell-build.
- Use `gh pr create` to open PRs.
- Conventional Commits for messages.
- One feature per PR, linked to a decision-log entry where applicable.

Toolchain expected:
- Node 20+ via pnpm, Rust stable + wasm32-wasip2 target, cargo-component, jco.
- pnpm workspace + Cargo workspace, Justfile orchestrator.

Author: Brent (single solo developer). Self-hosted target: Stalwart on OCI free tier.

Release build:
- `cd shell && IARSMA_VERSION=X.Y.Z VITE_BASE_PATH=/webmail/ pnpm build`
- Package: `cd dist && echo '{"version":"X.Y.Z"}' > version.json && zip -r iarsma-base-webmail.zip .`
- Upload: `gh release upload vX.Y.Z iarsma-base-webmail.zip --clobber`
- Stalwart fetches `iarsma-base-webmail.zip` from `/releases/latest/download/`.
