# Contributing to Iarsma

Thanks for being here. This is a small project with strong conventions; the conventions are what let it stay coherent under AI-assisted development. Read the docs below before opening a PR.

## Quickstart

```bash
git clone https://github.com/r3moteBee/iarsma.git
cd iarsma
just bootstrap     # checks node + pnpm + cargo, installs JS deps, builds Rust workspace
just wasm          # transpile WASM components
pnpm codegen       # generate React hooks + MCP tool registrations from contracts
pnpm -r test       # run the full test matrix (codegen + shell + mcp-server + token-exchange)
pnpm -r typecheck  # tsc across all five workspace packages
```

A successful `pnpm -r test` and `pnpm -r typecheck` is the local CI mirror; the cloud CI (`TypeScript`, `Rust`, `Shell bundle`) gates `main` via the `main protection` branch ruleset.

For Rust components: `cargo test -p <component>` runs each component's unit tests on the host target (per D-038, components are pure; tests don't need the WASM runtime).

## Where to read first

- **`docs/project-brief.md`** — the *what* and *why*. Architecture, audience, non-goals.
- **`docs/implementation-plan.md`** — the *how*, in order, with definitions of done.
- **`docs/decisions.md`** — the *because*. Every architectural choice has a numbered entry (D-001…). New decisions append; reversed decisions get an "Updated" line in place rather than removal.
- **`docs/versioning.md`** + **`docs/schema-migration.md`** — how the eight versioned boundaries (contracts, components, bundle, action-log entries, URN payload, config, MCP extensions, scope vocabulary) evolve.
- **`docs/discovery.md`** — how `urn:iarsma:agent-context` is published.
- **`docs/capability-scopes.md`** — the agent capability scope vocabulary.

## Conventions

### Branches and commits

- **Trunk-based.** Short-lived feature branches off `main`; squash-merge with `--delete-branch` (`gh pr merge --squash --delete-branch`).
- **One feature per PR.** Bundling is fine inside a single coherent change ("contract envelope: error + version + stability") but not across orthogonal concerns.
- **[Conventional Commits](https://www.conventionalcommits.org/)** for commit titles. Examples in the log: `feat(codegen): contract envelope`, `chore: just wasm transpiles all components`, `docs: pre-Phase-1 prep`.

### Decisions log discipline

If your PR makes an architectural choice (data shape, library, transport, security boundary, versioning rule), it gets a new D-NNN entry in `docs/decisions.md` with date / decision / why / how-to-apply. The PR description references the entry by ID. If you reverse an existing decision, edit its entry in-place and add an "Updated YYYY-MM-DD (see D-MMM)" line — never delete the original reasoning.

Most code-only PRs don't need a decision entry. When in doubt, ask in the PR.

### Capability contracts

Every MCP / React / library-API capability lives as a Zod-typed contract under `tools/codegen/contracts/`. Required fields per `CapabilityDef`: `name`, `version` (semver, validated), `scopes`, `description`, `input`, `output`, `examples`. Optional: `isDestructive`, `dryRun.preview` (required iff `isDestructive`), `errors`, `stability` (defaults to `'experimental'`).

Run `pnpm codegen` after editing a contract; the generators are deterministic and idempotent. Don't edit anything under `tools/codegen/dist/`, `shell/src/generated/`, or `mcp-server/src/generated/` by hand — they're gitignored regenerated outputs.

### Tests

- **Vitest** for TypeScript (shell, mcp-server, token-exchange, codegen).
- **`cargo test`** on the host target for Rust components.
- **Playwright** for E2E (`shell/e2e/`); not gated in CI yet.
- **axe-core in Vitest** for component-level a11y — see `shell/src/__tests__/a11y.test.tsx` for the pattern reference (D-013, CT-1).

New components add a unit test alongside the implementation. Destructive contracts add a snapshot test that exercises both `mode: 'preview'` and `mode: 'commit'` paths. New WIT-shape changes bump the entry's `schemaVersion` per `docs/versioning.md`.

## Pull requests

- **Title:** Conventional Commits format. Short.
- **Body:** what changed, why, what's out of scope, decision-log links if applicable, a test plan.
- **Test plan:** explicit checkboxes for typecheck / tests / hand-verification / CI. The repo has a PR template at `.github/PULL_REQUEST_TEMPLATE.md`.
- **CI:** TypeScript + Rust + Shell bundle must all pass before merge. Branch ruleset enforces this.

## Security

Found a vulnerability? See `SECURITY.md`. Use GitHub's [private security advisory](https://github.com/r3moteBee/iarsma/security/advisories/new) — not a public issue.

## Licensing

Iarsma is dual-licensed under MIT OR Apache-2.0 (D-010, the Rust ecosystem standard). Contributions are accepted under the same terms.

## Filing issues

Bugs, feature requests, and design discussions are all welcome as issues. For design discussions that might land as a decision, prefix the title with `design:` so it's easy to find later.
