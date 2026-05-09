# Iarsma — Schema Migration Policy

How versioned schemas evolve in Iarsma without breaking existing consumers.

This document is the authoritative companion to D-042. The implementation plan's CT-6 ("Schema versioning") points here for mechanics; decisions.md carries the high-level rationale.

## Why this matters

Iarsma's symmetric capability surface (D-011) means a single contract change ripples to React hooks (the shell), MCP tool registrations (agents), native-app SDKs (per the brief's Library API path), and the tuatha agent harness. An embedded SwiftUI mail client running against `mail.send@1.2.0` needs a clear signal when `mail.send@2.0.0` lands — not a silent generator regeneration that breaks compile or, worse, runtime.

The policy below applies uniformly to every wire-format and contract boundary in the project. Embedders can predict breakage because the wire format itself declares its version.

## Scope — the eight versioned boundaries

| # | Boundary | Versioning style | Field name |
|---|----------|------------------|------------|
| 1 | Capability contracts (`tools/codegen/contracts/*.ts`) | Semver per contract | `version` |
| 2 | WIT components (`components/*/wit/*.wit`) | Semver per component | package decl, e.g. `iarsma:jmap-client@0.0.0` |
| 3 | Bundle (`iarsma.zip`) | Semver, matched to git tag (D-028) | tag + `version.json` |
| 4 | Action-log entry schema | Monotonic integer | `schemaVersion` |
| 5 | `urn:iarsma:agent-context` payload | Monotonic integer | `version` |
| 6 | `config.json` | Monotonic integer | `schemaVersion` |
| 7 | Iarsma MCP protocol extensions (annotations beyond MCP spec) | Monotonic integer | `version` (in extension envelope) |
| 8 | Capability scope vocabulary (`docs/capability-scopes.md`) | Doc-level version | `v0`, `v1`, … in heading |

**Shared rule:** any boundary readable by an external consumer (UI, MCP agent, native-app embedder, tuatha) declares its version *in the wire format itself*, not just in changelogs.

## Capability contracts — the central case

Every capability contract carries a semver `version` field, defaulting to `0.0.0` pre-1.0 until the v1.0 GA release. The contract envelope landing in PR-2 wires this in.

### Patch bump (`x.y.Z`)
Implementation changes only; no schema diff. Examples: bug fix in JMAP request envelope, wording adjustment in an error message, performance tuning. Generated outputs (TS types, MCP tool registration, OpenAPI fragment, future SDKs) byte-identical except where comments referenced the version.

### Minor bump (`x.Y.0`) — additive, backward-compatible
Allowed:
- New optional fields in input or output records.
- New optional fields in nested records.
- New error variants. Consumers must pattern-match exhaustively at the type level, but the runtime policy is "unrecognized error code → fall through to generic handler" — see the workspace error envelope (D-043, landing in PR-2).
- New examples in the `examples` field.
- Tightened or expanded `description` text (no schema effect).
- New optional `dryRun.preview` fields (post-PR-3 once the dry-run shape lands).

A consumer pinned at `mail.send@1.2.0` continues to work against `mail.send@1.5.0` without code change. Generators may emit deprecation comments for fields scheduled for removal in the next major.

### Major bump (`X.0.0`) — breaking
Required when:
- Removing a field, even if optional.
- Renaming a field.
- Changing a field's type (including narrowing — `string` → `enum<'foo','bar'>` is breaking).
- Changing a required field to optional or vice versa (breaking in both directions: existing producers may stop sending; existing consumers may stop tolerating).
- Changing the `mode: 'preview' | 'commit'` discriminated-union shape or its preview/result payload schema.
- Changing required scopes — adding a scope is breaking for tokens that don't have it; removing one isn't, but consumers may have hardcoded the old set.
- Changing `isDestructive` from `false` to `true` (or vice versa) — affects whether the policy seam fires.

### Side-by-side rule
Major-bumped contracts ship alongside the previous major for **at least one minor release of the bundle**. Both contracts appear in:
- The OpenAPI doc (as separate operation IDs, e.g. `mail.send.v1` and `mail.send.v2`).
- The docs site, with the older flagged as `deprecated` and a migration note linking to the new major.
- The MCP tool list (both tools registered; the deprecated one carries the deprecation in its description).
- Generator output in the same workspace tree.

Contract authors mark the old major as `stability: 'deprecated'` (annotation landing in PR-2) in any minor bump after the new major lands. The deprecated contract is removed only after the next bundle major (i.e., bundle `1.x → 2.x` is when bundled deprecated contracts can be dropped).

### Workspace versioning constraint
The bundle's release notes auto-list contracts that have changed major version since the last release. Contracts with major changes must each have a decision-log entry referencing the migration rationale and the side-by-side window.

## Wire-format schemas — monotonic integer

The action-log entry, URN payload, `config.json`, and MCP protocol extensions use a monotonic integer because they're internal-format wire shapes, not public APIs. Semver overhead isn't worth it — readers either understand the version or they don't.

**Reading rule:** code accepts any version it knows. Versions higher than the reader knows are treated as opaque (verified via hash chain for action-log entries, ignored fields for the others) — the reader doesn't fail on unknown future fields. Versions lower than the reader knows are read with the older fields' interpretation.

**Writing rule:** code writes the highest version it knows. Mixed-version chains during deployment (writers ahead of readers) are handled by reader tolerance, not by writer downgrading.

**Backward-incompatible change** — bumps the integer (e.g., changing the meaning of an existing field, dropping a previously-required field). The reader code-paths for each version stay in the codebase for at least two bundle minor releases.

**Forward-compatible addition** — does not bump. New optional fields are added; readers that don't know about them ignore them.

## Capability scope vocabulary

The vocabulary is versioned at the document level (currently `v0` per the heading in `docs/capability-scopes.md`). Append-only naming: scope names never change meaning once introduced.

- **Adding a scope** — minor doc-level change. Existing tokens unaffected; new tokens may opt in.
- **Deprecating a scope** — name remains reserved, existing tokens continue to work, replacement is introduced alongside it. Document marks the deprecated scope and links the replacement.
- **Removing a scope** — only at a doc-level major bump (`v0 → v1`). Tokens minted against the old vocabulary need re-issuance; the bundle release notes call this out explicitly.

The scope vocabulary will likely stay at `v0` through v1.0 GA. The first re-version is most likely when memory backend semantics evolve in Phase 5+ (per D-031).

## Mechanics

- **Codegen enforcement.** `tools/codegen` rejects any contract without a `version` field and any wire-format schema definition without a version. `just codegen` and `just check` run this validation.
- **Bundle release notes.** Generated automatically from contract version diffs since the previous tag; major bumps surfaced prominently with their decision-log links.
- **Generator pass-through.** Every generator (React hook, MCP tool, OpenAPI, JSON Schema, future SDKs per CT-7) stamps the contract `version` onto its output. The version is queryable at runtime — `useMailSend.version` is `'1.2.0'`.
- **Action-log writers** stamp `schemaVersion` on every entry as part of canonicalization. Readers that recompute hashes also use the entry's declared version to interpret the canonical bytes.

## When in doubt

If a change might be breaking, treat it as breaking. Major bumps are cheap to issue: a side-by-side window plus a decision-log entry. Embedded native apps living with surprise breakage are expensive — every embedder is its own pinning policy, and the project doesn't get to debug their builds.
