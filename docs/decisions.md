# Decisions Log

Architectural decisions made deliberately, with rationale, so future-you doesn't relitigate them. New decisions append to this list with a date, the call, and the reason. The brief is the *what and why*; the implementation plan is the *how*; this log is the *because*.

When an existing decision is reversed or refined, edit the entry and add an "Updated" line — never remove the original reasoning.

---

## D-001 — Dioxus → TypeScript + React + Tauri 2 shell
**Date:** 2026-04-26
**Decision:** Build the shell in TypeScript + React + Tauri 2, not Rust + Dioxus.
**Why:** JS is the native host for browser-side WASM Component Model (`jco` is JS-first by design); orders of magnitude more AI training data; mature mobile via Tauri 2; Squire integrates natively (no wasm-bindgen bridge); large React component ecosystem. The polyglot principle is "preserve flexibility, don't be a Rust zealot."
**Trade-off accepted:** No tight coupling with Stalwart Labs' first-party Dioxus webmail. Alignment moves from "shared rsx components" to "shared WASM components" — the integration boundary moves from the shell to the component.

## D-002 — JMAP-only, no IMAP fallback
**Date:** 2026-04-26
**Decision:** No IMAP polyfills. JMAP end to end.
**Why:** Force protocol benefits. Stalwart is JMAP-first. No legacy weight.

## D-003 — Squire (not TipTap) for the composer
**Date:** 2026-04-26
**Decision:** Squire (Fastmail, MIT, ~16.5 KB gzipped) is the rich-text editor.
**Why:** Purpose-built for the email use case TipTap is awkward at — round-tripping arbitrary forwarded HTML without normalizing it through a ProseMirror schema. Used in production by Fastmail, ProtonMail, Tutanota, StartMail, Zoho Mail, and Superhuman. Avoids TipTap's commercial AI-upgrade tier (which belongs behind MCP anyway).

## D-004 — Git/GitHub for files, pluggable backend
**Date:** 2026-04-26
**Decision:** File storage is a `FileBackend` trait. Default impl is the GitHub REST API; Tier-2 future is gitoxide-in-WASM. Other git hosts and S3-likes are also valid backends.
**Why:** Versioning + collab + portability + state-sharing with the tuatha agent harness for free. Tenant files don't live on the webmail server.

## D-005 — Stalwart for the mail server
**Date:** 2026-04-26
**Decision:** Use Stalwart Mail Server. Don't fork or rebuild.
**Why:** Excellent existing project, JMAP-native, MIT/AGPL dual-licensed. Position the webmail as adjacent, not competitive.

## D-006 — SendGrid for outbound (operator-specific)
**Date:** 2026-04-26
**Decision:** Outbound mail relays through SendGrid in the reference deployment.
**Why:** OCI free-tier blocks PTR record setup, so direct outbound from Stalwart isn't deliverable. SendGrid is pluggable — any SMTP relay works.

## D-007 — WASM Component Model where mature
**Date:** 2026-04-26
**Decision:** Prefer the WASM Component Model. Plain WASM modules acceptable as fallback if browser-side composition is rough.
**Why:** Polyglot future-proofing, capability confinement, independent versioning. Component Model is the right primitive even if tooling is occasionally rough.

## D-008 — Phased roadmap; daily-driver each phase
**Date:** 2026-04-26
**Decision:** No big-bang releases. Each phase ships a state we can use ourselves.
**Why:** Solo + AI-assisted development benefits from shippable mid-points. Reduces burnout risk; surfaces priorities for the next phase based on actual use.

## D-009 — One language per component, polyglot at the boundary
**Date:** 2026-04-26
**Decision:** A WASM Component is authored in one language. Polyglot is across components, not within.
**Why:** Mixing languages within a single component is the polyglot trap.

## D-010 — Dual MIT OR Apache-2.0 license
**Date:** 2026-04-26
**Decision:** Repository licensed under MIT OR Apache-2.0 (the Rust ecosystem standard).
**Why:** Apache provides patent grant relevant for protocol/MCP/agent integrations; MIT keeps adoption frictionless. Compatible with virtually everything we'd pull in.

## D-011 — Agent/human collaboration is foundational
**Date:** 2026-04-26
**Decision:** Symmetric capability surface (UI/MCP/library), propose-preview-approve-commit, tamper-evident audit, capability scoping, policy seam.
**Why:** This is what makes the project distinct. Agents as peers from day one, not a feature bolted on later.

## D-012 — Firecracker as deployment, not architecture
**Date:** 2026-04-26
**Decision:** WASM Component Model provides the capability confinement the architecture needs. Firecracker stays available as a deployment option for operators who need full kernel isolation; it is not an architectural pillar.
**Why:** Anthropic's own practice supports this (bubblewrap/gVisor for code execution; Firecracker only for ephemeral multi-tenant scenarios). Agents talk to the system through MCP, not through driving a GUI in a microVM.

## D-013 — WCAG 2.1 AA from Phase 1
**Date:** 2026-04-26
**Decision:** Accessibility is a Phase 1 design constraint, not Phase 7 polish.
**Why:** Cheaper to build keyboard model and semantic HTML in than to retrofit. AAA is explicitly not the target — diminishing returns and some criteria conflict with reasonable design choices.

## D-014 — MCP server as separate process, sibling to shell
**Date:** 2026-04-26
**Decision:** The MCP server is a separate Node + TypeScript process. Both shell and MCP server import the same WASM components.
**Why:** Symmetric capability surface — UI and agents consume the same components through a shared contract. The MCP shape is "separate process" by design.

## D-015 — Tamper-evident hash-chained action log
**Date:** 2026-04-26
**Decision:** The action log is immutable, hash-chained, and OpenInference-compatible. Append-only is not enough; integrity matters.
**Why:** Trust in the agent collaboration model depends on the audit being verifiable. Hash chains make tampering detectable without being expensive.

## D-016 — OAuth 2.1 + PKCE for both human and agent auth
**Date:** 2026-04-26
**Decision:** One auth model. No API keys. Ephemeral per-task tokens for agents.
**Why:** Eliminates a class of credential-sharing issues. Per-agent virtual credentials make the audit log meaningful.

## D-017 — Policy engine seam at dry-run boundary
**Date:** 2026-04-26
**Decision:** Every destructive tool's dry-run preview can be sent to a pluggable policy engine returning `allow | deny | require_approval`. v1 ships a no-op engine; the seam exists from Phase 0.
**Why:** Adding the seam later means refactoring every destructive tool. Cheap to build in; expensive to retrofit.

## D-018 — Stalwart deployment via Web Applications path
**Date:** 2026-04-26
**Decision:** The reference deployment uses Stalwart's Web Applications feature to serve the bundle at `/webmail`. Not separate VM, not Caddy proxy.
**Why:** Same-origin automatically (no CORS, no proxy). Single VM. Confirmed during admin walkthrough that Web Applications is pure static-bundle hosting (no runtime injection, no coupling).

## D-019 — Stalwart treats OAuth clients as confidential
**Date:** 2026-04-26
**Decision:** Stalwart auto-fills `client_secret` regardless of input. The webmail flow uses confidential-client + PKCE, not public-client + PKCE. Token-exchange happens server-side (sidecar binary or Tauri Rust glue) — never in the browser bundle.
**Why:** Empirically observed: clearing the Client Secret field and saving brings the secret back on reload. Stalwart treats OAuth clients as principals that always have secrets. The browser bundle cannot safely hold a secret; the architecture must accommodate.
**Updated 2026-04-29:** Reversed by D-039. The "secret comes back on reload" behavior was the operator's browser autofilling the saved admin-account password into the `<input type="password">` field — verified by re-checking the OAuth client config in an incognito window where the field is empty server-side. Stalwart's `client_secret` is genuinely optional; the `webmail` client is a public client (PKCE-only). The original "confidential client" framing in this entry is left intact as the historical reasoning that drove `token-exchange/` to be scaffolded in Phase 0; the sidecar remains scaffolded for the first *actual* confidential client (Phase 5 GitHub).

## D-020 — F-3: TypeScript IDL + Zod for shell capabilities, WIT for components
**Date:** 2026-04-26
**Decision:** Shell-level capability contracts in TypeScript + Zod. WIT only at the WASM-component boundary. Two formats, each canonical for its domain.
**Why:** Codegen consumes Zod via introspection (`schema._def`) into an intermediate AST; React/MCP/JSON-Schema generators consume the AST. Migration to WIT-everywhere later remains feasible (~2 weeks) if the WIT-clean discipline is maintained.

## D-021 — WIT-clean discipline enforced by linter (warnings only)
**Date:** 2026-04-26
**Decision:** The codegen lint emits *warnings* (never failures) when capability schemas use `z.refine`, `z.transform`, `z.intersection`, or branded types. These features are migration-cost when going to WIT. Authors can override with a comment; the lint never blocks the build.
**Why:** Default to staying WIT-clean. Hard ban would be too restrictive; no signal at all would let the codebase drift into a corner that's expensive to migrate from.

## D-022 — Co-deployed Node token-exchange sidecar
**Date:** 2026-04-26
**Decision:** A Node + TypeScript binary at `token-exchange/` exposes `POST /auth/token`. It holds the OAuth `client_secret` and performs the auth-code-plus-PKCE-verifier exchange against Stalwart's OIDC endpoint. Co-deployed alongside the webmail (same OCI VM), with the option of running it as a serverless function.
**Why:** Confidential-client requirement (D-019) means the secret cannot live in the browser bundle. Tauri builds use Rust glue for the same purpose; the web bundle uses the sidecar.

## D-023 — Jotai for state management
**Date:** 2026-04-26
**Decision:** Jotai (atom-style derived state), not Zustand or Redux.
**Why:** Atom model maps cleanly to the data shape — server-cached JMAP entities as atoms, derived counts (unread, pending approvals, active agents) as `atom(get => ...)`, UI state as smaller atoms. Same author family as Zustand (Pmndrs); good AI corpus.

## D-024 — React Router v6+ for routing
**Date:** 2026-04-26
**Decision:** React Router v6+. Boring-correct.
**Why:** Largest AI training corpus among React routers; Vite alignment with sibling project (tuatha) is automatic since Vite is the bundler, not the router.

## D-025 — Wrap `stalwartlabs/jmap-client` for the JMAP client component
**Date:** 2026-04-26
**Decision:** Use Stalwart's `jmap-client` Rust crate as the basis for our JMAP client component, compiled to WASM. Verify WASM-Component compatibility before depending; thin hand-roll fallback if needed.
**Why:** Same author as the server; used in Stalwart's own tools; real-world tested. Bulwark uses a JS JMAP client (different stack), so we mine it for usage patterns not code (AGPL prevents borrowing anyway).

## D-026 — Justfile orchestrator, pnpm scripts mirror common recipes
**Date:** 2026-04-26
**Decision:** `Justfile` is the canonical command surface. `package.json` scripts mirror the most-used recipes for muscle-memory continuity with sibling projects.
**Why:** Justfile is simpler than Make and more discoverable than scattered npm scripts. Mirroring keeps tuatha-style npm muscle memory functional.

## D-027 — SHA-384 for action log hash chain
**Date:** 2026-04-26
**Decision:** Action log uses SHA-384 via Web Crypto API / Node Web Crypto.
**Why:** PQC-conservative — ~128-bit second-preimage resistance under Grover, vs ~85 bits for SHA-256. Zero-dependency, native everywhere, drop-in upgrade path to SHA-512/SHAKE-256 if ever needed. BLAKE3 was rejected as it requires a third-party WASM library (fragile-dependency concern).

## D-028 — Semver matched to Git tag
**Date:** 2026-04-26
**Decision:** Bundle versioning is semver. Each release tag produces a `iarsma.zip` artifact.
**Why:** Standard, supported by tooling, expected by operators.

## D-029 — Boring testing stack
**Date:** 2026-04-26
**Decision:** Vitest + React Testing Library + axe-core (shell), `cargo test` (Rust components), Playwright (E2E web), MCP-client harness (E2E agent flows).
**Why:** None of these lock in bad architecture. All have substantial AI training data. axe-core in unit tests catches a11y regressions per-component (D-013).

## D-030 — Three-layer memory substrate
**Date:** 2026-04-26
**Decision:** The agent perception surface is three layers: (1) action log [mandatory, immutable]; (2) memory backend [mandatory contract, pluggable impl]; (3) behavior signals [opt-in, sensitive].
**Why:** The action surface (what agents can do) was already designed; the perception surface (what agents can understand) needs equal weight for genuine agent-as-peer collaboration. Inference belongs at the agent platform; the substrate stays structured and capability-scoped.

## D-031 — Open Brain as optional co-deployed Tier-2 memory backend
**Date:** 2026-04-26
**Decision:** Open Brain (OB1) is the canonical Tier-2 memory backend. Ships as an *optional co-deployed service* via Docker Compose recipe at `deployment/openbrain/`. The webmail does NOT proxy memory queries through to OB1 — agents connect to OB1 directly via the discovery URN. Other backends (Mem0, Letta, custom) follow the same pattern.
**Why:** Brent's framing — "tuatha is project-focused, OB1 is person-focused, email is person-focused, so OB1+email belong together; tuatha+OB1 connect by configuration." Co-deployment preserves architectural separation; the webmail and OB1 are independent services that share the user identity. Vector search lives at the agent (tuatha has its own vectorization) or in OB1 directly; the webmail's MCP exposes structured queries only.

## D-032 — Discovery URN: `urn:iarsma:agent-context`
**Date:** 2026-04-26
**Decision:** The webmail extends the JMAP session resource with a custom capability URN whose value carries `{webmailMcpUrl, actionLogUrl, memoryBackendUrl?}`. Agents understanding the URN pick up all relevant endpoints in one discovery call.
**Why:** One auth envelope, one discovery call, multiple MCP endpoints. URN extension is a JMAP convention; agents that don't understand the URN ignore it gracefully.
**Updated 2026-05-09 (see D-048):** The "JMAP session-resource extension" framing is retired. Iarsma can't append URNs to Stalwart's session response (the session is Stalwart's, not Iarsma's). The URN identifier itself is preserved (`urn:iarsma:agent-context`); delivery is now (a) the parallel discovery endpoint at `/.well-known/iarsma` and (b) the MCP capabilities map at initialize time. Both surfaces emit the same JSON payload, schema-locked in D-049 and documented in `docs/discovery.md`.

## D-033 — Stalwart Labs outreach deferred indefinitely
**Date:** 2026-04-26
**Decision:** No proactive outreach to Stalwart Labs. If the project matures into something they'd value, contact is a one-message later. No pre-existing relationship to leverage; they don't run a marketplace.
**Why:** Lower coupling to upstream cadence. The project's positioning as complementary (agent-native + WASM-component) holds whether or not Stalwart cares.

## D-035 — F-3 codegen intermediate AST is a custom typed AST
**Date:** 2026-04-26
**Decision:** The codegen pipeline reads Zod schemas, walks them through introspection (`schema._def`) into a custom typed AST that mirrors the WIT type system (`record`, `option`, `list`, `variant`, `enum`, etc.), and feeds that AST into multiple generators. JSON Schema is one of the generator *outputs* (consumed by MCP tool registrations and OpenAPI), not the AST itself.
**Why:** The custom AST gives precise control over how each output is generated (no JSON Schema ambiguity to disambiguate), and the WIT-shaped node kinds make a future migration to WIT-everywhere a serializer addition rather than a redesign. JSON Schema as an output is still standard-compliant for external consumers.
**How to apply:** Generators pattern-match on the AST's `kind` discriminator. Adding a new generator is an O(N-kinds) operation, never an O(generators) refactor.

## D-036 — WIT-clean discipline as local lint rules
**Date:** 2026-04-26
**Decision:** The four WIT-clean checks (`z.refine`, `z.transform`, `z.intersection`, branded types in capability schemas) live as a custom local rule set in `tools/codegen/eslint-rules/wit-clean/`. Loaded from the project's `eslintrc`. Warnings only, never failures (per D-021). Not published to npm.
**Why:** No existing community plugin covers exactly these four anti-patterns — they encode an architectural decision specific to this project, not a general "Zod best practices" idea. Belt-and-suspenders: the AST walker also throws `UnhandledZodKind` on these, so even if the lint rule is bypassed the codegen itself fails loud.
**How to apply:** Authors override per-occurrence with an `// @migration-cost: <reason>` comment. The lint rule respects the override; the codegen walker does not (the walker always fails loud — overrides require writing the implementation in a different shape).

## D-037 — Documentation is a first-class generator output
**Date:** 2026-04-26
**Decision:** The `iarsma.io` docs site is generated from the same capability contracts that produce React hooks, MCP tools, and JSON Schema. Capability contracts gain a required `examples` field (each example: `{title, input, output}`). The site exposes `/llms.txt` for AI-readable indexing, downloadable `openapi.json` and per-tool `*.schema.json` for machine consumption, and renders without JavaScript so curl/wget/agents work natively.
**Why:** Iarsma's audience explicitly includes agents reading documentation to learn how to interact with the system. Auto-generating docs from contracts eliminates code-doc drift; making the site machine-readable from day one means agents are first-class consumers, matching the project's collaboration thesis. The `examples` field doubles as test data — example round-trip tests catch doc-rot on the same axis as code-rot.
**How to apply:** Add `examples` to every contract (Phase 0). Build the docs generator as a separate pipeline output starting in Phase 1 (when there are real capabilities to document). The site stack (Astro / Docusaurus / mkdocs) is a Phase 1 decision.

## D-038 — `jmap-client` component is parse-only; HTTP transport lives in the host
**Date:** 2026-04-29
**Decision:** The `iarsma:jmap-client` WASM component does **not** import `wasi:http`. Its WIT exports are pure functions that operate on already-fetched bytes (`parse-session(json: string) -> result<session, parse-error>` for the first cut). The HTTP fetch — including auth header, redirect handling, and TLS — is performed by the host runtime: `fetch` in the shell (browser/Tauri) and `undici`/native `fetch` in the MCP server.
**Why:** Phase 0's stated risk #1 (`jco` toolchain rough edges) explicitly calls out `wasi:http` browser support as one of the most fragile surfaces in the 2026 component-model toolchain. Pulling HTTP into the component would have made every JMAP capability dependent on jco resolving its `wasi:http` polyfill, on Tauri's wasi-http story, and on the cargo-component → wasi-http import chain. By keeping the component pure, both transpilation paths (`jco transpile` for the browser, raw component for Node hosts) reduce to the boring case: arrays of bytes in, structured records out. The component still earns its keep — JMAP session response → typed `Session` is real protocol code that's reused identically by shell and MCP server, satisfies D-025's "thin hand-roll" allowance, and is trivially testable from `cargo test` with a recorded fixture. If `wasi:http` matures or a later capability genuinely needs streaming/multipart (e.g. `Email/import`, blob upload), we revisit per-component, not as a workspace-wide flip.
**How to apply:** New JMAP capabilities follow the same shape: component exports `parse-X` / `serialize-X` / pure-validation; the host wraps them with `fetch`. The thin "JMAP request envelope" code (`POST {apiUrl}` with the `using` array + `methodCalls` array) lives in the host too — host code is small, well-typed, and not portability-sensitive. Action-log writes happen at the host invocation layer, where the caller identity is already known.

## D-039 — Webmail OAuth client is a public client (PKCE only)
**Date:** 2026-04-29
**Decision:** The `webmail` OAuth client registered with the reference Stalwart deployment has no `client_secret` (Stalwart's "optional" auth method). The shell performs the full OAuth 2.1 + PKCE authorization-code flow directly against Stalwart's `/auth/token` endpoint — no token-exchange sidecar in the critical path. The sidecar at `token-exchange/` remains scaffolded but is unused by Phase 0 itself; it lights up when Iarsma needs to talk to a *confidential* OAuth client, with GitHub OAuth in Phase 5 as the first plausible consumer.
**Why:** **Reverses D-019.** That entry's empirical observation — "clearing the Client Secret field and saving brings the secret back on reload" — turned out to be the operator's browser autofilling the admin-account password into the field, not Stalwart persisting the value. Verified 2026-04-29 by re-checking in an incognito window: the field is genuinely empty server-side. The 2026-04-29 OIDC discovery doc plus the empty-field confirmation make the public-client posture safe (and PKCE-only is the OAuth 2.1 BCP for SPAs anyway). Staying public removes a process from `just dev-all`, removes the secret-handling surface from the Phase 0 threat model, and keeps the codepath the same on web and Tauri.
**How to apply:** `oauth4webapi` is configured with `client_id: "webmail"` and `token_endpoint_auth_method: "none"`. New capabilities that need a confidential OAuth integration (e.g., GitHub) go through `token-exchange/`; iarsma's own auth does not. If Stalwart deployments elsewhere choose to issue a `client_secret`, that's a Phase 1+ posture flag in `config.json` that flips the runtime to route through the sidecar.

## D-040 — `oauth4webapi` for the OIDC client
**Date:** 2026-04-29
**Decision:** Use `panva/oauth4webapi` for the shell's OIDC implementation — discovery, PKCE generation, authorization-code-grant exchange, ID-token validation against JWKS, refresh-token grant. Pinned at v3 (Web Crypto, no Node-specific dependencies, runs unmodified in browser + Tauri + Node tests).
**Why:** Authored and maintained by Filip Skokan (the lead behind `node-oidc-provider` and `jose`); audited; certified-conformance for OIDC; minimal surface; no transitive dependencies. The brief (item 6) explicitly forbids hand-rolling PKCE crypto, so picking the boring, reviewed library is the prescription. `openid-client` (the Skokan-authored cousin) was not chosen because it targets Node only — the shell needs to run in the browser.
**How to apply:** All OIDC operations route through `shell/src/runtime/oauth.ts`, which re-exports a narrow surface (`startSignIn`, `handleCallback`, `refreshTokens`, `signOut`). Other modules never import `oauth4webapi` directly — keeping the integration boundary contained means a future migration to a different lib (or hand-rolling a niche flow) is one file.

## D-041 — JMAP-mirrored pagination convention (`position` + `limit`)
**Date:** 2026-05-09
**Decision:** Capability contracts whose output is a list and whose data source supports pagination declare `position: number` (zero-indexed offset into the result set) and `limit: number` (positive integer, per-tool cap) on input. Outputs echo back `position` and include `total: number` when cheap to compute. No cursor scheme; no opaque continuation tokens.
**Why:** JMAP is the substrate for the bulk of paginated data Iarsma surfaces (`Email/query`, `Mailbox/get`, `Thread/get`, `EmailSubmission/query`, calendar `Event/query`, contact `AddressBook/query`). RFC 8620 §5.5 defines `position` + `limit` as the wire shape; wrapping JMAP's pagination in our own cursor scheme would force translation at every capability boundary — a "cursor" that's just `{position, limit}` underneath. Native-app embedders (per the brief's Library API path) and tuatha consume the same shape they'd see in any JMAP client, with no extra translation. JMAP's `state` token already covers concurrent-modification detection through a separate channel; cursors solve a problem we don't have.
**How to apply:** Default `limit` is 50 unless the contract overrides; per-tool maximum is documented in the contract's `description` and enforced server-side. Contracts wrapping non-JMAP sources (Phase 5 GitHub file listings, Phase 4 OB1 memory queries) follow the same shape — translate to whatever the underlying API uses at the host boundary, never in the contract. Inputs without explicit `position`/`limit` are read-everything (where the data shape allows it) or fail with a documented error.

## D-042 — Schema migration policy
**Date:** 2026-05-09
**Decision:** Iarsma's eight versioned boundaries (capability contracts, WIT components, bundle, action-log entry schema, `urn:iarsma:agent-context` payload, `config.json`, Iarsma's MCP protocol extensions, capability scope vocabulary) follow a uniform migration policy documented in `docs/schema-migration.md`. Capability contracts use semver per-contract; wire-format schemas (action-log entry, URN payload, config.json, MCP extensions) use monotonic integers; the scope vocabulary is doc-level versioned with append-only naming. Major-bumped contracts ship side-by-side with the previous major for at least one minor bundle release.
**Why:** D-011's symmetric capability surface (UI, MCP, Library API) means any contract change ripples to React hooks, MCP tool registrations, native-app SDKs (per the brief's Library API path), and the tuatha agent harness. Without a uniform policy, each boundary develops its own conventions and embedders can't predict breakage. Embedded native applications living against an old contract version need a clear signal — a version field on the wire, plus side-by-side ship of the previous major — rather than a silent generator regeneration. The policy formalizes the existing CT-6 promise.
**How to apply:** Every capability contract carries a semver `version` field (default `0.0.0` until v1.0 — the contract envelope landing in PR-2 wires this in). Every wire-format schema carries `schemaVersion` (action-log, config) or `version` (URN payload). Codegen rejects contracts without a version. Release notes auto-summarize major bumps. Full mechanics — including what counts as patch / minor / major for each boundary type, how side-by-side shipping works, and how the scope vocabulary evolves — live in `docs/schema-migration.md`.

## D-043 — Workspace-wide `IarsmaError` envelope
**Date:** 2026-05-09
**Decision:** Every consumer of Iarsma's symmetric capability surface (D-011) sees application-level errors in a single envelope shape: `{ code: string, message: string, details?: unknown }`. The shape is locked in `tools/codegen/src/types.ts` (exported as the `ErrorEnvelope` TypeScript type and the `errorEnvelopeJsonSchema()` helper). Each generator stamps it identically: MCP tool registrations carry it as `errorEnvelopeSchema` plus per-tool `errorCodes`; OpenAPI publishes it as `components.schemas.IarsmaError` and references it from every non-2xx response; markdown docs render it; React-hook generated outputs treat the `error` field as this shape. Per-tool error codes are declared on the capability contract's `errors` array; the envelope is the transport.
**Why:** Components had drifting error shapes (`chain-error` on action-log, `parse-error` on jmap-client) and generator outputs each described errors differently. With native-app embedding now an explicit consumer (per the brief's Library API path), three surfaces (React, MCP, library) consuming three different error shapes meant every embedder rebuilt error handling from scratch. One envelope, locked at the codegen layer, propagates uniformly.
**How to apply:** New capability contracts continue to declare typed `errors` (per-tool codes); the envelope wraps them automatically. Consumers reading MCP responses unwrap JSON-RPC's `error.data` to find the envelope; HTTP/OpenAPI consumers find the envelope as the response body for non-2xx; React/library consumers see it on the `error` field of the hook return. WIT-component-level error shapes (`chain-error`, `parse-error`) are not touched in this PR — those are a separate refactor; they convert to envelope shape at the host invocation boundary where the action-log already brokers.

## D-044 — Workspace-wide versioning policy
**Date:** 2026-05-09
**Decision:** Every wire-format and contract boundary in Iarsma carries an explicit version field. The eight boundaries and their styles are catalogued in `docs/versioning.md`; this entry locks the *workspace policy* that the doc enforces. Capability contracts gain a required semver `version` field, validated at definition time in `tools/codegen/src/contract.ts:capability()`. WIT components use semver in package declarations (already done). Wire-format schemas (action-log entry, URN payload, `config.json`, MCP protocol extensions) use a monotonic integer `schemaVersion` or `version`. The capability scope vocabulary is doc-level versioned with append-only naming.
**Why:** D-011's symmetric capability surface means a single contract change ripples to React hooks, MCP tool registrations, native-app SDKs (per CT-7), and tuatha. Without an enforced version field on every contract, embedders can't pin and major bumps slip through silently. Codegen rejects contracts without a valid semver version — caught at PR time, not at consumer-broken-build time. The migration *mechanics* (side-by-side major shipping, deprecation) live in the migration doc (D-042) and reference this entry for the policy itself.
**How to apply:** `tools/codegen/src/contract.ts:isValidSemver()` is the canonical validator; same regex used for tooling that emits version diffs in release notes. Generators stamp `version` on every output (MCP tool registration top-level, OpenAPI operation `x-iarsma-version`, markdown docs front matter, React hook `<NAME>_VERSION` constant). Consumers querying a tool by name can check `version` to decide whether they understand its current shape. New `docs/versioning.md` enumerates the eight boundaries.

## D-045 — Stability annotation on capability contracts
**Date:** 2026-05-09
**Decision:** Capability contracts carry a `stability: 'experimental' | 'stable' | 'deprecated'` annotation, defaulting to `'experimental'`. Generators stamp the annotation on every output. The v1.0 GA milestone is the single moment where the v1 contract set is collectively promoted to `'stable'`; new post-v1 contracts default back to `'experimental'` for one minor bundle release before being promoted. `'deprecated'` marks a contract whose successor major has shipped and is kept registered for the side-by-side window per `docs/schema-migration.md`.
**Why:** Without a stability signal, embedders can't tell which contracts they should depend on long-term. Defaulting to `'experimental'` pre-v1.0 protects against premature dependence — the project has not yet earned the right to call anything stable. The single-milestone promotion model means "stable" reflects an intentional commitment rather than drift. Foundational contracts like mail-baseline could plausibly default to `'stable'` at definition time, but that overweights individual confidence over the milestone discipline that protects embedders system-wide.
**How to apply:** Contract authors omit `stability` (default applies). Annotation appears in MCP tool registration, OpenAPI `x-iarsma-stability`, markdown docs front matter (with a one-line explanation per stability level), and React hook output as `<NAME>_STABILITY`. The v1.0 GA bundle release flips every v1-set contract to `'stable'` in one PR.

## D-046 — Dry-run protocol shape: uniform `mode` envelope
**Date:** 2026-05-09
**Decision:** Every destructive capability uses a single tool with a uniform wire envelope:

- **Input:** `{ mode: 'preview' | 'commit', params: <ContractInput> }`
- **Output for preview:** `{ mode: 'preview', preview: <ContractPreview> }`
- **Output for commit:** `{ mode: 'commit', result: <ContractOutput>, logEntryRef: string }`

Authors define the natural input, output, and **preview** shape on `CapabilityDef`. Codegen rejects destructive contracts without a `dryRun.preview` schema, and rejects non-destructive contracts that declare one. The envelope is the codegen's job; the contract author writes only the artifact-specific shapes.

Default `mode` per consumer: MCP-server-side default is `'preview'` for agent calls (forces explicit commit); React-hook callers go through `useWriteHook.preview()` and `useWriteHook.commit()` which set the mode for them; library API callers must pass mode explicitly.

**Why:** The audit's recommendation, accepted in conversation. The dry-run / propose-preview-approve-commit pattern is foundational (brief, "Agent/Human Collaboration Model"). A uniform envelope is artifact-agnostic — the same shape carries `mail.send`, `calendar.event.create`, `contacts.contact.update`, and Phase 5's `files.file.write`. Discriminated outputs let consumers narrow on `mode` and access the matching payload without conditional shape inspection. One MCP tool per verb (not two — `mail.send` and `mail.send.preview`) keeps the tool surface small and discoverable. The `params` indirection on input is what makes adding workspace-level metadata later (e.g. `correlationId`, `policyHints`) cheap — a forward-compatible minor bump per D-042.

**How to apply:** Contract authors declare `dryRun: { preview: <ZodSchema> }` alongside `isDestructive: true`. Generators handle the rest:
- mcp-tool: `inputSchema` is the wrapped envelope; `outputSchema` is the discriminated `oneOf`. `paramsSchema` and `previewSchema` carry the natural shapes for direct introspection.
- openapi: same wrapped shapes on requestBody / 200 response, plus `x-iarsma-params-schema` and `x-iarsma-preview-schema` extensions.
- markdown: separate `## Calling convention`, `## Params`, `## Preview output`, `## Commit output` sections — natural shapes per section, the envelope explained in prose.
- react-hook: emits `<Name>Preview` type alias alongside `<Name>Input` and `<Name>Output`.

**Out of scope (follow-ups):**
- The shell runtime's `DryRunPreview<O>` placeholder (`{ output, effects, policy }`) and the MCP server's `_iarsmaDryRun` arg path are not yet aligned with the new wire shape. No destructive contract has been authored, so nothing exercises the divergence today; runtime/server alignment lands when Phase 2 ships the first destructive contract (`mail.send`). The contract surface is locked here so embedders can plan against the stable shape.
- Policy seam metadata on the preview output (workspace-level `effects`, `policy`, `estimatedCost`) is deliberately not part of the v0 envelope. A minor bump adds them as optional fields when the policy seam lands real implementations (Phase 3).

## D-047 — Action-log entry shape: caller-class, mode, provenance, schema version
**Date:** 2026-05-09
**Decision:** The `iarsma:action-log` `entry-data` record gains four fields and bumps to `schema-version: 1` (boundary 4 of `docs/versioning.md`):

- **`schema-version: u32`** — monotonic integer per `docs/versioning.md`; readers tolerate higher versions as opaque (verified via hash chain, not parsed).
- **`caller-class: enum {ui, mcp, library}`** — origin of the call. Distinguishes a human web/native session from an agent-via-MCP from a native-app or other Library API embedder. Required on every entry.
- **`mode: option<call-mode>`** — `'preview' | 'commit'` for destructive tools (D-046); absent on non-destructive reads.
- **`provenance: option<provenance-data>`** — set iff `mode == commit` AND artifacts were created/modified/deleted. Carries `affected-json` (a JSON list of `{kind, id, op}` artifacts) and `preview-hash-hex` (hex SHA-384 of the preview output that was approved before this commit, empty if not preview-approved).

Canonical form folds the new fields in alphabetical key order with `null` for absent options. WIT package version bumps `iarsma:action-log@0.0.0` → `@0.1.0` (breaking shape change, semver-pre-1.0 minor).

**Why:** A1 from the audit: with humans and agents touching the same mailbox, the audit chain has to prove origination and provenance for created/modified artifacts. Identity alone isn't enough — a single user-id can drive both a UI session and an MCP-flowing agent call, and reviewers need to disambiguate. The brief's "tamper-evident action log as inbox-adjacent surface" (project-brief.md, "Core Identity") demands provenance binding for any commit that produced a new message, event, contact, or file.

The `mode` field unifies destructive-call recording with the dry-run protocol shape (D-046) — every preview AND every commit appears in the chain, so reviewers can match `provenance.preview-hash-hex` against an earlier `mode=preview` entry's recomputed canonical hash and prove that what was committed is what was approved. This closes the trust gap that "the agent did X" / "but here's what the user actually saw at preview time" otherwise leaves open.

The `caller-class` field gives the policy seam (D-017) a fourth dimension to evaluate beyond identity, scope, and tool: a `mail.send` from a `library`-class caller can be policy-treated differently from an `mcp` agent, even if both bind to the same agent identity. Native-app embedders (per the brief's Library API path and CT-7) get a clean way to be "us" without being indistinguishable from agents.

**How to apply:** Hosts pass `callerClass`, `mode` (when destructive), and `provenance` (when committing real artifacts) to the action-log host wrapper. The shell's existing login event records `callerClass: 'ui'`. Phase 2's first destructive contract (`mail.send`) wires `mode: 'commit'` + `provenance` on commit; previews record `mode: 'preview'` with no provenance. The MCP server records `callerClass: 'mcp'` on every invocation it brokers. Native-app embedders record `callerClass: 'library'`.

**Out of scope (follow-ups):**
- Action-log UI surface ("Activity" page) for inspecting provenance + matching previews to commits — Phase 3 work item 11.
- Cross-entry provenance verification (recomputing the preview-hash from a referenced earlier entry to confirm match) — Phase 3 hardening; the field is recorded now so the verification can land later without a schema bump.
- Affected-json kind vocabulary lock — kept open-ended on purpose; new artifact types (mail/event/contact/file/...) extend it without bumping `schema-version`.

## D-048 — Parallel discovery endpoint at `/.well-known/iarsma`
**Date:** 2026-05-09
**Decision:** Iarsma publishes its endpoint set through two equivalent surfaces:

1. `GET /.well-known/iarsma` — single round-trip JSON, served by the `token-exchange` sidecar. Used by native-app embedders, ad-hoc tools, and any consumer that wants discovery without an MCP/JMAP handshake first.
2. The MCP capabilities map at initialize time (`urn:iarsma:agent-context`) — same payload, free piggyback on the connection an agent is already opening.

Both surfaces emit the same JSON, schema-locked in D-049. Operators route `<host>/.well-known/iarsma` to the sidecar (Stalwart reverse-proxy, external Caddy, or sidecar-on-public-port — see `docs/discovery.md`).

**Why:** **Reverses the "JMAP session-resource extension" framing of D-032.** Iarsma can't append URNs to Stalwart's session response — the session belongs to Stalwart, not Iarsma. Two clean alternatives surfaced in audit item A3: (a) parallel discovery endpoint, (b) MCP-init-only emission. Native-app embedding (per the brief's Library API path and CT-7) makes (a) more attractive — a SwiftUI iOS client should reach `https://mail.example.net/.well-known/iarsma` and find everything in one fetch, with no MCP client library yet loaded.

The two-surface design is not redundant: each serves a different bootstrap. Native-app embedders and ad-hoc curl-driven discovery start with the well-known endpoint; agents already mid-MCP-handshake get it free in capabilities. Both surfaces draw from the same env-var-shaped configuration.

**How to apply:** `token-exchange/src/discovery.ts` is the sidecar-side implementation; `mcp-server/src/agent-context.ts` is the MCP-side mirror. Both consume `IARSMA_WEBMAIL_MCP_URL` (required), `IARSMA_ACTION_LOG_URL` (optional), `IARSMA_MEMORY_BACKEND_URL` (optional). Operators set the vars once in the shared environment. New env vars for new fields land in lockstep across both files; the schema-sync invariant is enforced via comments in each file referencing `docs/discovery.md`.

## D-049 — URN payload schema lock + mutation policy
**Date:** 2026-05-09
**Decision:** The `urn:iarsma:agent-context` payload schema is locked at:

```json
{ "version": 1, "webmailMcpUrl": string, "actionLogUrl"?: string, "memoryBackendUrl"?: string }
```

`version` is a monotonic integer per `docs/versioning.md` boundary 5. Mutation policy:

- **Adding a new optional field** → no version bump; consumers ignore unknowns.
- **Adding a new required field** → bump `version` (existing consumers don't know to read it).
- **Renaming, removing, or changing the semantic of an existing field** → bump `version`. Prior version's reader stays in code for at least two bundle minor releases per D-042.
- **Changing the schema URL or content type** → does not happen; the well-known endpoint is the contract.

**Why:** Lock-in protects native-app embedders. A SwiftUI client pinned at `version: 1` continues to work against `version: 1` payloads even after the operator deploys new fields; lower-version payloads work because the schema is append-only between major-version steps. The mutation policy mirrors the existing action-log entry policy (D-047) and the workspace versioning policy (D-044) — one rule, applied consistently across all monotonic-integer wire formats.

**How to apply:** The Zod source-of-truth schema is `DiscoveryPayloadSchema` in `token-exchange/src/discovery.ts`; `AgentContextUrnSchema` in `mcp-server/src/agent-context.ts` mirrors it. `loadDiscoveryPayload(env)` and `loadAgentContext(env)` validate env-var-resolved payloads at startup; published payloads always conform. Tests in both packages assert the schema match. Doc lives at `docs/discovery.md`.

**Out of scope:** A `discovery.json` static file in the bundle (operators who don't want to run the sidecar). Anticipated as a future option; the schema is locked here so the static-file path can come online later without redesign.

## D-050 — Token storage: AES-GCM-256 in IndexedDB with versioned envelope
**Date:** 2026-05-09
**Decision:** The shell's auth storage moves from plaintext sessionStorage to encrypted IndexedDB:

- **Wrap algorithm:** AES-GCM-256 via Web Crypto. AES-256 has ~128-bit post-quantum security under Grover (matches D-027's SHA-384 reasoning — symmetric AEAD doesn't need PQ replacement; asymmetric does, and we don't do app-level asymmetric here).
- **Wrapping key:** generated via `crypto.subtle.generateKey({name:'AES-GCM', length:256}, false, ...)`. Non-extractable, origin-bound, persisted to IndexedDB via Web Crypto's structured-clone support. The key never leaves the secure context.
- **Per-encryption:** random 96-bit IV, AAD = `${kid}|${purpose}` for domain separation across slots (`tokens.v1`, `pkce.v1`).
- **Versioned envelope:** `{ v: 1, alg: 'A256GCM', kid: <id>, iv: <b64u>, ct: <b64u> }`. Self-describing on the wire.
- **Crypto-agility:** the envelope's `v` is a monotonic integer per `docs/versioning.md`; future algorithms (e.g., a PQ AEAD candidate) bump `v` and add a new code path while old envelopes still decrypt as long as the previous reader stays in code. `kid` enables key rotation with old keys retained during a grace period.
- **Backing store interface:** `AuthStorage` becomes async (writes return Promises; sync reads go through an in-memory cache hydrated by `ready()`). Three implementations: `inMemoryAuthStorage` (tests / SSR), `sessionAuthStorage` (per-tab plaintext, kiosk-friendly), `indexedDbAuthStorage` (production default).

**Why:** Audit item C1. Pre-Phase-1 was acknowledged-risky in the implementation plan ("encryption key needs an honest design"). Phase 1 lengthens the attack window by adding `mailbox.list` and a longer-lived session; the right moment to lock storage is now. The user's preference for crypto-agility + PQ-readiness drives the versioned envelope and the choice of AES-GCM-256 (PQ-conservative under Grover's algorithm).

For *transit* security, Iarsma rides on the platform's TLS — TLS 1.3 with X25519+ML-KEM-768 hybrid key exchange is rolling out in browsers and Node through 2025-2026, so app-level asymmetric crypto is unnecessary today. The token-exchange sidecar, when it eventually handles confidential clients (Phase 5+ GitHub OAuth), is the only place app-level asymmetric might enter — that's a then-decision.

**How to apply:** New code reads `authStorage.loadTokens()` synchronously (cache-backed). Code that mutates tokens or PKCE state awaits the async `saveTokens` / `savePkce` / `takePkce` / `clearTokens`. App.tsx awaits `authStorage.ready()` once on mount before bumping `authVersionAtom`. The `kid` is generated at first run and persisted alongside the wrapping key; rotation lands as a separate concern when there's a use case (e.g., post-incident or scheduled).

**Out of scope (follow-ups):**
- IndexedDB integration tests (require fake-indexeddb or a jsdom environment; unit logic is covered by crypto-envelope tests against Node's built-in Web Crypto). Lands with Phase 1's broader testing infrastructure work.
- Per-purpose key derivation via HKDF-SHA-384 from a master CryptoKey. The current design uses a single AES-GCM-256 key with AAD-based domain separation — simpler and sufficient. HKDF lands when a second consumer of the wrapping key emerges (e.g., wrapping a separate database of cached email metadata).
- Tauri secure-storage upgrade (Phase 6+). The Web Crypto path inside the Tauri WebView works today; OS keychain integration is a hardening pass for native distributions.

## D-051 — Capability-result cache: encrypted IndexedDB, AAD-domain-separated, stale-while-revalidate
**Date:** 2026-05-10
**Decision:** Phase 1 work item 8 lands a persistent cache for capability invocations (mailbox tree, thread lists, opened thread bodies) backed by IndexedDB.

- **Plug point:** a `cachedInvoker(inner, store)` wrapper around the production `jmapInvoker`. Tests still construct `mockInvoker(...)` raw — the cache is opt-in at the runtime boundary, not baked into `useReadHook` so individual capabilities can declare themselves uncacheable later (e.g., `mail.send` has no cacheable read).
- **Cache key:** `(toolName, canonicalize(input))`. Reuses the same input-canonicalization function the read-hook already uses for atom-family keys, so cache and atom invalidation align.
- **Invalidation:** stale-while-revalidate. A cache hit resolves the call immediately; the wrapper fires the underlying fetch in the background and writes the result through. A cache miss does the round-trip fetch + write-through. Future delta-sync via JMAP `state` tokens (Phase 2 push subscriptions) will flip this to "always serve cache, only revalidate when state changes."
- **Storage:** new IndexedDB database `iarsma-cache` (separate lifecycle from `iarsma-auth` — clear-on-sign-out is one-store).
- **Encryption:** triggers the D-050 "second consumer" branch but takes the *AAD-domain-separated* path rather than HKDF. The same AES-GCM-256 wrap key persisted in `iarsma-auth/wrap-keys` decrypts the cache, with AAD purposes `cache.mailboxes.v1`, `cache.threads.v1`, `cache.thread-bodies.v1`. Each store-class has its own AAD so a cross-purpose decrypt fails closed (e.g., a corrupted thread row can't accidentally decrypt as a mailbox row). HKDF lands when there's a second *origin* — multi-account, e.g. — or a credential-isolation requirement.
- **AuthStorage coupling:** the cache module imports the wrap-key accessor from `auth-storage.ts` rather than re-implementing key management. AuthStorage exposes a new `withWrapKey(<callback>)` accessor used by both auth and cache encrypt/decrypt paths.

**Why:** The implementation plan named "second consumer of the wrapping key" as the trigger for the HKDF follow-up to D-050. We're at that trigger today but the marginal security gain over AAD-domain-separation is small — AAD already provides cryptographic domain separation, and HKDF would only protect against *full key compromise*, which AES-GCM already considers catastrophic. The complexity-vs-benefit tradeoff favors AAD now; HKDF stays a future-work item with a clearer driver (multi-account, third-party-shared keys).

Stale-while-revalidate matches the project ethos better than TTL: this is offline-capable agent collaboration territory; users should see their mailbox even with no network. A TTL would force unnecessary spinners on the common path. The downside (a 1-2-frame staleness window) is acceptable because the revalidation is non-blocking and the UI re-renders on success.

**How to apply:**
- Production reads of `mailbox.list`, `thread.list`, `thread.get` now serve from cache on subsequent loads.
- New cacheable capabilities add themselves to a `CACHEABLE_TOOLS` set in `cache-policy.ts` with their AAD purpose; non-cacheable capabilities pass through unchanged.
- Writes (`mail.send`, future `mail.draft.create`) bypass cache. They will (in Phase 2) emit cache-invalidation events that drop affected entries.
- On sign-out, the cache DB is cleared alongside the token store.
- Tests around cached invocations should construct a `mockInvoker` and a `cachedInvoker(mock, fakeStore)` to exercise the wrapper without IDB.

**Out of scope (follow-ups):**
- HKDF-derived per-purpose keys. Re-evaluate when multi-account lands or a third party (e.g., extension) needs scoped access to a subset of the cache.
- JMAP `state`-token-based delta sync — currently we revalidate the full result on every cache hit. State-token-aware delta sync is the Phase 2 push-subscription work item.
- LRU eviction — current schema has no size cap. Becomes important once mailbox bodies dominate the cache; at that point we'll add `lastAccessedAt` indexing and a budget.

## D-052 — Action-log writes on every invocation: outer-wrap, log-after-success, opt-out list
**Date:** 2026-05-10
**Decision:** Phase 1 work item 9 lights up real action-log writes for capability invocations. The mechanism is a `loggingInvoker(inner, log, ...)` wrapper that:

- **Plugs in outermost** — `loggingInvoker(cachedInvoker(jmapInvoker(...)))`. Cache hits and network round-trips alike produce log entries, because the audit chain is about *what was requested*, not *how it was served*. The user-or-agent-initiated read is the auditable event regardless of cache state.
- **Logs after success** — the inner `invoke()` runs first; the log append happens only if it returned. Failures aren't recorded today (a future "negative-acks" follow-up may add them, but Phase 1's goal is "the action log shows the read trail" per the implementation plan, not "the action log is a crash log").
- **Best-effort append** — log-append errors are caught and warned to console; they never propagate to the caller. The chain is integrity-checked separately via `actionLog.verify()`. A broken append doesn't break the user's UI.
- **Opt-out list, not opt-in** — every cacheable read tool logs by default. `EXCLUDED_FROM_LOG` carves out tools whose calls are uninteresting for audit (today: only `session.get`, which fires once per invoker construction and never again). New tools auto-log unless explicitly excluded — bias toward over-logging is correct for an audit chain.
- **Persistent store** — the singleton `actionLog` swaps `inMemoryActionLogStore()` for `indexedDbActionLogStore({auth})` in browser. Each row is a `CryptoEnvelope` under AAD purpose `action-log.entries.v1`, reusing the same wrap key as auth and cache (third consumer, same AAD-domain-separation rationale as D-051).
- **Identity comes from the active token** — `subject` (id_token sub) preferred, then `email`, then `'unknown'`. Same fallback chain as the existing `auth.signin` event in App.tsx; logged calls carry the same identity tag the JMAP fetch already trusts.
- **Caller-class is `'ui'`** — the shell is a human-driven UI session. The MCP server records `'mcp'` on its own log when those handlers wire up (Phase 2). Library-API-class loggers ship later.

**Why:** The brief commits to "tamper-evident action log as inbox-adjacent surface" — and Phase 1's definition of done explicitly calls out "the action log shows the read trail." Without per-invocation writes, the chain is empty and the brief's commitment is aspirational. Outer-wrap keeps the chain's semantic ("what did the user ask to see") clean; logging cache hits would be confusing audit data ("user looked at inbox 7 times in 30s" when they actually scrolled back-and-forth between windows).

Logging after success rather than before-and-after avoids the "what does a half-logged failure mean" problem without losing detection power: a tamper attempt has to forge BOTH a successful response AND a chain link, and the chain link's prev-hash check still holds. A future negative-ack mode is straightforward to add (`status: 'success' | 'error'` field, schema version bump).

The persistent store is encrypted because the params often carry mailbox + thread IDs and timestamps — useful audit trail for the user, but not something other origins / extensions on the device should be able to enumerate. Same threat model as auth tokens (D-050) and the cache (D-051); same key, different AAD.

**How to apply:**
- New cacheable read capabilities auto-log on every invocation. Add to `EXCLUDED_FROM_LOG` only when the call is too noisy to be useful (e.g., a future `notification.heartbeat` ping).
- Destructive capabilities (`mail.send`, etc., Phase 2) record `mode: 'commit'` + `provenance` per D-047 — they go through `useWriteHook` which constructs the input with the destructive-call envelope. The logging-invoker passes the existing `mode` field through unchanged.
- The action log persists across sign-outs. It is *not* cleared with `cacheStorage.clearAll()` — the audit trail is per-installation, not per-session, and the `identity` field on each entry distinguishes mixed sign-ins on a shared browser.

**Out of scope (follow-ups):**
- Activity / log-viewer UI surface — Phase 3 work item 11.
- Negative-ack logging (failure events) — schema-version bump when there's a clear use case (today's "invocation failed" already surfaces via tool errors in the UI; the audit value is marginal until policy-seam denials need recording).
- Cross-entry provenance verification (recomputing preview-hash from a referenced earlier entry) — Phase 3 hardening, per D-047's existing follow-up.
- Server-side action-log integration: the MCP server keeps its own chain on the server filesystem; reconciling client + server chains under one identity is a Phase 2+ design problem.

## D-034 — Project name: Iarsma
**Date:** 2026-04-26
**Decision:** The project is named **Iarsma** (Irish, "EER-sma" — *relic, artifact, durable remnant*). Domains owned: `iarsma.com` (primary user-facing) and `iarsma.io` (developer-facing). The `.ai` TLD was deliberately *not* purchased — Iarsma is communication infrastructure, not an AI product, and the `.ai` framing would mis-position it. Use `Iarsma` as the proper noun in prose and titles; `iarsma` as the lowercase identifier in package names, URNs (`urn:iarsma:agent-context`), and component namespaces (`iarsma:jmap-client@0.0.0`).
**Why:** Lugh was eliminated by a Microsoft AI-agent project conflict plus pronunciation gate. Tessera was eliminated by parallel conflicts with a Rust UI framework and a Python AI-agent context tool. Iarsma came up clean across every surface — `.com` at standard pricing (strongest no-squatter signal), `github.com/iarsma` available, npm + crates.io packages free, no software-search collisions. The metaphor — "the durable artifact that carries meaning across time" — describes what mail actually is, and the Irish root preserves ecosystem coherence with `tuatha` (the agent harness, also Irish mythology). Brent's framing — "durable message" is a sharper metaphor than security-token — guided the search.
