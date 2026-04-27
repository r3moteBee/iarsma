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

## D-033 — Stalwart Labs outreach deferred indefinitely
**Date:** 2026-04-26
**Decision:** No proactive outreach to Stalwart Labs. If the project matures into something they'd value, contact is a one-message later. No pre-existing relationship to leverage; they don't run a marketplace.
**Why:** Lower coupling to upstream cadence. The project's positioning as complementary (agent-native + WASM-component) holds whether or not Stalwart cares.

## D-034 — Project name: Iarsma
**Date:** 2026-04-26
**Decision:** The project is named **Iarsma** (Irish, "EER-sma" — *relic, artifact, durable remnant*). Domains owned: `iarsma.com` (primary user-facing) and `iarsma.io` (developer-facing). The `.ai` TLD was deliberately *not* purchased — Iarsma is communication infrastructure, not an AI product, and the `.ai` framing would mis-position it. Use `Iarsma` as the proper noun in prose and titles; `iarsma` as the lowercase identifier in package names, URNs (`urn:iarsma:agent-context`), and component namespaces (`iarsma:jmap-client@0.0.0`).
**Why:** Lugh was eliminated by a Microsoft AI-agent project conflict plus pronunciation gate. Tessera was eliminated by parallel conflicts with a Rust UI framework and a Python AI-agent context tool. Iarsma came up clean across every surface — `.com` at standard pricing (strongest no-squatter signal), `github.com/iarsma` available, npm + crates.io packages free, no software-search collisions. The metaphor — "the durable artifact that carries meaning across time" — describes what mail actually is, and the Irish root preserves ecosystem coherence with `tuatha` (the agent harness, also Irish mythology). Brent's framing — "durable message" is a sharper metaphor than security-token — guided the search.
