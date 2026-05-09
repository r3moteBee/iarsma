# Iarsma — Versioning Policy

The companion to `docs/schema-migration.md`. Migration is *how* boundaries evolve over time; this document is the *catalog* of which boundaries carry versions, what style each uses, and where the version field lives in the wire format. Decisions D-042 (migration policy), D-044 (workspace versioning policy), D-045 (stability annotation) all reference this catalog.

## Why this exists

Iarsma's symmetric capability surface (D-011) means one schema change can ripple to four consumer surfaces (React hooks, MCP tools, native-app SDKs per CT-7, the tuatha agent harness). Without a uniform version policy each boundary develops its own conventions and embedders can't predict breakage.

Every boundary in the table below declares its version *in the wire format itself*, not just in changelogs. That's the contract: a consumer reading the boundary's payload can determine its version without consulting an external manifest.

## The eight boundaries

| # | Boundary | Where it lives | Style | Field |
|---|----------|----------------|-------|-------|
| 1 | Capability contracts | `tools/codegen/contracts/*.ts` | Semver per contract | `version: string` (required, validated) |
| 2 | WIT components | `components/*/wit/*.wit` | Semver per component | Package decl, e.g. `iarsma:jmap-client@0.0.0` |
| 3 | Bundle (`iarsma.zip`) | Git tag + `version.json` in the bundle | Semver, matched to git tag (D-028) | Tag name + `version.json.bundleVersion` |
| 4 | Action-log entry schema | `components/action-log/wit/action_log.wit` records | Monotonic integer | `schemaVersion: int` on every entry (CT-6) |
| 5 | `urn:iarsma:agent-context` payload | Discovery URN value | Monotonic integer | `version: int` in the payload object |
| 6 | `config.json` | Bundle root | Monotonic integer | `schemaVersion: int` (CT-6) |
| 7 | Iarsma MCP protocol extensions | MCP tool registration extension fields | Monotonic integer | `version: int` in the extension envelope |
| 8 | Capability scope vocabulary | `docs/capability-scopes.md` | Doc-level version | `v0`, `v1`, … in heading |

## Per-boundary policy

### 1. Capability contracts (semver)

The central case. `CapabilityDef.version` is required; `tools/codegen/src/contract.ts:capability()` rejects non-semver strings at definition time. Pre-1.0 default is `0.0.x`; the v1.0 GA milestone collectively promotes the v1 contract set per D-045.

Bump rules — full mechanics in `docs/schema-migration.md`:

- **patch (`x.y.Z`)** — implementation only.
- **minor (`x.Y.0`)** — additive, backward-compatible.
- **major (`X.0.0`)** — breaking. Ships side-by-side with the previous major for at least one minor bundle release.

Stability annotation (D-045): `'experimental'` (default), `'stable'`, `'deprecated'`. Independent of the version number — a `1.2.3` contract may be `'experimental'` if explicitly authored that way, though the v1.0 GA promotion convention makes that uncommon.

### 2. WIT components (semver)

WIT package declarations carry a semver — e.g. `package iarsma:jmap-client@0.0.0;`. Already enforced by `cargo component`. Components evolve independently of capability contracts; the same component may serve multiple contracts at different versions.

### 3. Bundle (semver, git tag)

`iarsma.zip` is semver-tagged per D-028. The git tag (e.g. `v0.3.1`) is canonical; the `version.json` file inside the zip carries the same string for runtime introspection. Bundle major bumps generally coincide with at least one capability contract major bump.

### 4. Action-log entry schema (monotonic integer)

Every action-log entry carries a `schemaVersion: int` field. The current version is `1` once CT-6 wires it in (PR-4 lands this). Readers tolerant: entries with a higher `schemaVersion` than the reader knows are treated as opaque (verified via hash chain, not parsed). This protects mixed-version chains during deployment.

### 5. URN payload (monotonic integer)

`urn:iarsma:agent-context` payload carries a `version: int`. Schema lock and mutation policy land in the discovery-surface PR (PR-5 from the audit roadmap). Backward-incompatible changes bump the integer; forward-compatible additions don't.

### 6. `config.json` (monotonic integer)

The bundle's `config.json` carries `schemaVersion: int`. Forward-compatible additions don't bump; backward-incompatible changes do, and the shell's loader maintains a small migration ladder for old configs.

### 7. Iarsma MCP protocol extensions (monotonic integer)

MCP tool registrations carry Iarsma-specific extension fields (e.g. `requiredScopes`, `errorEnvelopeSchema`, `version`, `stability`). The set of extension fields itself is versioned via a single envelope `version: int` once the registration shape is locked. Today (Phase 0 → Phase 1) the extension set is small and stable enough that this envelope hasn't been added; the placeholder is reserved.

### 8. Capability scope vocabulary (doc-level)

`docs/capability-scopes.md` carries a single document-level version in its heading (currently `v0`). Append-only naming — scope names never change meaning once introduced. Adding a scope is a doc-level minor change. Deprecating one keeps the name reserved (existing tokens continue to work) and introduces the replacement alongside it. Removing a scope is a doc-level major bump (`v0 → v1`).

## Mechanics

- **Codegen enforcement.** `pnpm codegen` rejects any contract without a `version` matching the canonical semver pattern. Run via `just codegen` and `just check`.
- **Generator pass-through.** Every generator stamps the contract `version` and `stability` onto its output. The values are runtime-queryable: `useSessionGet_VERSION` is `'0.0.1'`; the MCP tool registration's `version` field is `'0.0.1'`; OpenAPI carries `x-iarsma-version: '0.0.1'`.
- **Bundle release notes.** Generated automatically from contract version diffs since the previous tag; major bumps surfaced prominently with their decision-log links (CT-6).
- **`config.json` migration ladder.** The shell's `config.ts` loads the file, checks `schemaVersion`, and applies the migration for older versions before handing off to the rest of the app.

## When in doubt

If a change might be breaking, treat it as breaking. Major bumps are cheap (one decision-log entry plus a side-by-side window); silent breakage of an embedded native app is expensive — every embedder is its own pinning policy and the project doesn't get to debug their builds.
