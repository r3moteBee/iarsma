# Iarsma — Implementation Plan

Companion document to `project-brief.md`. The brief is the *what* and *why*; this plan is the *how, in order, with definitions of done*. Each phase breaks down into work items sized so an AI-assisted session can pick one up, complete it, and hand back a reviewable diff. Items within a phase are numbered to suggest sequencing; explicit dependencies are called out where they exist.

Timeboxes from the brief (e.g., "Phase 0 — weeks 1–2") are kept as rough markers but the primary axis is *deliverables*, not weeks. AI-assisted development surfaces unknown unknowns; expect to refine this plan after each phase ships.

---

## Pre-Phase: Foundations

These are cross-cutting prerequisites. None are user-visible; all of them shape every phase that follows. Skipping them is the most common way solo projects accumulate compounding cleanup debt.

### F-1. Repository scaffold and conventions
- Initialize the monorepo with the structure defined in the brief (pnpm workspace + Cargo workspace, `Justfile` orchestrator).
- **`Justfile` is the canonical command surface; pnpm `package.json` scripts mirror the most common recipes for muscle-memory continuity with sibling projects (e.g., tuatha).**
- Add `LICENSE-MIT`, `LICENSE-APACHE`, root `README.md`, `.gitignore`, `.editorconfig`.
- Establish branch conventions (trunk-based, short-lived feature branches), commit message format (Conventional Commits), and a PR template emphasizing one feature per PR with linked decision-log entry.
- **Definition of done:** `git clone && just bootstrap` succeeds on a fresh machine and produces a runnable (but empty) shell.

### F-2. CI/CD baseline
- GitHub Actions: lint (TypeScript + Rust + Markdown), unit tests, WASM component build, bundle build, on every PR.
- Release workflow: tag-driven, produces a versioned `iarsma.zip` published to GitHub Releases.
- Branch protection: required checks before merge.
- **Definition of done:** opening a PR runs the full check matrix in under five minutes; tagging `v0.0.1` produces a downloadable zip artifact.

### F-3. Capability contract format and codegen pipeline
**Decided:** **TypeScript IDL + Zod for shell-level capabilities, WIT only at the WASM-component boundary.** Two formats, each canonical for its domain. The architectural linchpin — the same contract defines a React hook, an MCP tool, and a library API.

**WIT-clean discipline (enforced by linter, warnings only — never failures):**
- **Avoid** `z.refine`, `z.transform`, `z.intersection`, and branded types in capability schemas. Each has a clean WIT-clean alternative: validation in implementation code, built-in coercions like `z.coerce.date()`, `.merge()` for object combination, branded types as TS-only consumption-site wrappers.
- The lint emits a *strongly-worded warning* with a hint pointing at the alternative or `@migration-cost` annotation suggestion. Authors can override per-case with a comment; the lint never fails the build.

**Codegen architecture:**
- `tools/codegen/` reads Zod schemas via introspection (`schema._def`) and emits an intermediate AST.
- React hook generator, MCP tool registration generator, JSON Schema generator, OpenAPI doc generator all consume the intermediate AST — never Zod directly.
- This decouples codegen from Zod internals; if we ever migrate to WIT-everywhere later, only the input parser changes.
- One sample capability (`session.get`) defined and codegen'd end-to-end before Phase 0 closes.

**Definition of done:** adding a new capability is a matter of writing one Zod schema file and running `just codegen`. Both the React side and the MCP server side appear automatically. The lint catches non-WIT-clean usage.

**AST shape (D-035):** custom typed AST internally; JSON Schema as one of the generator outputs (not the AST).
**Lint shape (D-036):** four custom local rules in `tools/codegen/eslint-rules/wit-clean/`, warnings only.
**Docs as a generator output (D-037):** capability contracts include an `examples` field; docs site is a Phase 1 deliverable consuming the same AST.

### F-3 test coverage (Phase 0 work item 4a)
The codegen pipeline gets six categories of preliminary tests, all passing before F-3 closes:

1. **Generator snapshot tests** — each generator (React hook, MCP tool, JSON Schema, OpenAPI) produces a deterministic string for a given AST. Snapshot committed; regression caught at the diff.
2. **AST walker exhaustiveness** — encountering a Zod feature the walker doesn't handle throws `UnhandledZodKind`, never silently produces wrong output. Tested per anti-pattern (refine/transform/intersection/branded types) and per genuinely-unhandled kind (e.g., `z.bigint`, `z.date`).
3. **Idempotency** — running codegen twice produces byte-identical output.
4. **Schema parity** — JSON Schema and the Zod runtime validator agree on accept/reject for the same inputs (property-tested with random samples).
5. **Lint rule positive/negative** — `RuleTester` pattern. Each anti-pattern fires; clean code does not.
6. **End-to-end round-trip for `session.get`** — React hook (`useSessionGet`) and MCP tool (`session.get`) both return the same Session object when the agent identity has the right scope. Action log records both with distinct identities.

These tests are the *F-3 definition-of-done check*. They also stay relevant per-contract through Phase 0+: each new capability adds a snapshot fixture and an example round-trip.

### F-4. Config and bundle conventions
- Define `config.json` schema: `{ jmapEndpoint, oidcIssuer, clientId, ... }` with same-origin defaults.
- Bundle structure documented: what's in `iarsma.zip`, where `config.json` lives, how the shell loads it at startup.
- Bundle versioning: `iarsma.zip` is semver-tagged and matches a Git tag.
- **Definition of done:** the shell reads its config from `/config.json` (or relative path) and falls back to same-origin defaults if absent. The same bundle works pointed at any compliant JMAP server.

### F-5. Testing conventions
- React: Vitest + React Testing Library + axe-core for a11y assertions in component tests.
- Rust: standard `#[cfg(test)]`, plus a JS-host integration suite that loads each component via `jco` and exercises the WIT surface.
- MCP server: contract tests against the codegen output; every tool gets a dry-run + commit path test minimum.
- E2E: Playwright for human-driven flows, plus an MCP client harness for agent-driven flows. Both run against a Stalwart in Docker.
- **Definition of done:** `just test` runs the full matrix locally; failures are clear and actionable.

### F-6. Observability scaffold
- Structured logging shape defined for shell, MCP server, and components.
- `__DEV__` instrumentation visible in browser devtools without leaking production noise.
- Action log component scaffold (concrete impl comes in Phase 1) writes to console in dev.
- **Definition of done:** every tool invocation, JMAP call, and policy decision can be inspected without adding ad-hoc `console.log` statements.

---

## Phase -1: Stalwart Prep

Operational, mostly already verified during the 2026-04-26 admin walkthrough. The remaining work items here are infrastructure that has to exist before Phase 0 can run.

### P-1.1. Pre-register the webmail OAuth client
- Find the Stalwart-canonical path for client registration (admin UI, CLI, or config file). Not visible in the admin we walked through; likely a CLI command or `*.toml` entry.
- Register a stable `client_id` with: `token_endpoint_auth_method = "none"`, `grant_types = ["authorization_code", "refresh_token"]`, `response_types = ["code"]`, `pkce_required = true`, redirect URIs covering the dev origin (Vite at `localhost:5173`) and the production origin (TBD per deployment model).
- Document the `client_id` and the registration command in `docs/stalwart-setup.md` so any operator can reproduce.
- **Definition of done:** the webmail's OAuth dance against this `client_id` returns a valid access token in a manual `curl` or browser test.

### P-1.2. Verify JMAP capabilities
- `curl -u '<your-email>:<password>' https://<your-mail-server>/.well-known/jmap | jq '.capabilities'`.
- Record the returned URN list in `docs/stalwart-setup.md`. Required: `urn:ietf:params:jmap:core`, `urn:ietf:params:jmap:mail`, `urn:ietf:params:jmap:submission`.
- Note which optional URNs (calendar, contacts, files) are present and at what draft level. This determines what's available to Phase 4 / Phase 5.
- **Definition of done:** the capability list is in version control; phases that depend on specific URNs reference this file.

### P-1.3. Pick the deployment model and document it
- Decision: Stalwart Web Application (recommended default) for the reference deployment. Document in `docs/deployment.md`.
- Cover the two portability rules from the brief.
- **Definition of done:** an operator new to the project can stand up a working webmail by following `docs/deployment.md`.

### P-1.4. Seed the dev mailbox
- Create a deterministic test corpus in `tests/fixtures/mailbox/`: 5 plain-text messages, 3 HTML messages with quoted replies, 2 forwarded threads with inline images, 1 calendar invite (`text/calendar`), 1 message with attachments, 1 spam-suspect, 1 with non-ASCII characters.
- Script (`tests/fixtures/seed.ts` or shell script) that uses JMAP `Email/import` to load the corpus into a target account.
- Run against the author's dev account for personal verification; against a Docker Stalwart for CI.
- **Definition of done:** `just seed-mailbox` populates a fresh account with the corpus in under 30 seconds.

### P-1.5. Clean up the duplicate SendGrid route
- Cosmetic: remove the unnamed second `SendGrid` route in MTA → Outbound → Routes (the one without a description).
- **Definition of done:** Routes table shows `SendGrid587` and `local` only.

---

## Phase 0: Skeleton

**Goal:** prove the toolchain end-to-end with a vertical slice — repo to login to displayed account email — so adding the second capability is mechanical.

**Prereqs:** F-1, F-2, F-3, F-4, F-5, P-1.1, P-1.2, P-1.3.

### Work items

1. **shell/ minimal React app via Vite.** Single page, "Sign in" button, no routing yet. **State management: Jotai.** Tailwind + shadcn/ui installed. Tauri scaffold present but not yet driving the build. *AI session: setup.*
2. **components/jmap-client/ scaffold.** Cargo crate compiling to a WASM Component via `cargo component build`. WIT interface declares `session.get(endpoint, token) -> Session`. Empty implementation that returns a placeholder. *AI session: jmap-client setup.*
3. **`jco` transpilation pipeline.** Justfile target that runs `cargo component build` then `jco transpile` and produces JS-importable bindings in `shell/src/wasm/jmap-client/`. *AI session: build-pipeline.*
4. **First capability contract: `session.get`.** Define in `tools/codegen/contracts/session.ts`. Codegen produces React hook (`useSessionGet`) and MCP tool registration stub. *AI session: codegen-first-pass.*
5. **Implement `session.get` in jmap-client.** Real HTTP call to `/.well-known/jmap` with `Authorization: Bearer <token>`. Return parsed Session object. Unit-tested against a recorded JSON fixture. *AI session: jmap-client-session.*
6. **OAuth 2.1 + PKCE flow with token-exchange backend.** Use a vetted client library (e.g., `oauth4webapi`) — do NOT hand-roll PKCE crypto. Wire to the pre-registered `client_id` from P-1.1. **Stalwart treats the client as confidential**, so the secret cannot live in the browser. Architecture: shell starts the auth-code+PKCE flow in the browser; the auth code is POSTed to a token-exchange host (Tauri Rust glue when running native; a small co-deployed Node/Rust function when running as a web bundle); that host holds the `client_secret`, exchanges code+verifier for tokens, and returns them to the shell. Tokens stored in IndexedDB-encrypted-blob behind an interface. *AI session: oauth-flow + token-exchange-backend (likely two sessions).*
7. **Login UI: minimal.** "Sign in" → redirect to OIDC issuer → return → display "Signed in as `<email>`" using the data from `useSessionGet`. *AI session: login-ui.*
8. **Action log component scaffold.** Rust→WASM component with append-only API and hash-chained entries. **Hash function: SHA-384 via Web Crypto API / Node Web Crypto** (PQC-conservative, zero-dependency). Storage backend: IndexedDB stub. Records the login event. *AI session: action-log-scaffold.*
9. **Capability scope vocabulary v0.** Lock the initial scope vocabulary in `docs/capability-scopes.md` (full list from the brief, including `memory:annotations.*`, `memory:profile.*`, `behavior:read`). Each codegen'd capability declares the scope(s) it requires. *AI session: scope-vocabulary.*

13. **Memory backend trait + Tier-1 default scaffold.** Define the `MemoryBackend` WIT contract covering annotations, profile, and (placeholder) behavior signals. Scaffold the Tier-1 default impl as a Rust→WASM component backed by SQLite-via-OPFS (web) / Tauri filesystem (native). Empty implementations OK; the seam exists. The Tier-2 Open Brain adapter lands in Phase 5+. *AI session: memory-backend-scaffold.*

14. **Discovery URN scaffold.** Webmail's MCP server advertises a `urn:iarsma:agent-context` capability extension carrying the webmail MCP URL, action log URL, and (when configured) memory backend URL. Defined now even if only the webmail URL is populated in Phase 0. *AI session: discovery-urn.*
10. **MCP server scaffold.** Node + TypeScript + the official `@modelcontextprotocol/sdk`. Exposes one tool: `session.get`. Registers via the codegen output. Auth: passes through Bearer token from the calling agent. Runs separately from the shell on a different port. *AI session: mcp-scaffold.*

10a. **Token-exchange sidecar scaffold.** Node + TypeScript binary at `token-exchange/`. Single route: `POST /auth/token` exchanging an auth code + PKCE verifier for tokens against Stalwart's OIDC endpoint. Holds the `client_secret` server-side. Co-deployable with the webmail (single VM) or as a serverless function. Required because Stalwart treats the OAuth client as confidential. *AI session: token-exchange.*
11. **Tauri 2 desktop wrap.** Minimal `tauri.conf.json` that wraps the existing Vite dev server. `cargo tauri dev` launches a native window. No native APIs called yet — just packaging. *AI session: tauri-scaffold.*
12. **Bundle build → `iarsma.zip`.** Justfile target runs Vite build, copies `config.json`, zips the `dist/` directory. Tag-driven release publishes to GitHub Releases. *AI session: bundle-pipeline.*
13. **Reference deployment to Stalwart Web Applications.** Configure a `webmail` Web Application entry pointing at the GitHub Releases zip. Confirm the bundle loads at `https://<your-mail-server>/webmail/`. *AI session: deploy-reference.*

### Definition of done
A user navigates to `https://<your-mail-server>/webmail/`, clicks "Sign in", completes OAuth via Stalwart's OIDC Provider, and sees their account email displayed. The action log records the login. The MCP server, run separately, exposes `session.get` and returns the same data when called with a valid Bearer token. `iarsma.zip` is reproducible from a tag.

### Phase 0 risks
- **`jco` toolchain rough edges.** Browser-side WASM Component composition is rapidly evolving in 2026; budget a day for transpilation issues. Mitigation: have a non-Component WASM fallback path (regular `wasm-bindgen` modules) ready to swap in if blocked.
- **OAuth callback path on the dev origin vs production origin.** Common source of "works in prod, not in dev" issues. Register both redirect URIs upfront.
- **Token storage in browser.** IndexedDB-encrypted-blob is the right v1 answer but the encryption key needs an honest design. Phase 0 can stub this; `// TODO Phase 1: real key derivation` with a follow-up issue is acceptable.

---

## Phase 1: Inbox MVP

**Goal:** read-only mail. Mailbox tree, thread list, thread view with sanitized HTML rendering. Keyboard navigable from the start.

**Prereqs:** Phase 0 complete.

### Work items

1. **`mailbox.list` capability.** Contract → React hook + MCP tool. JMAP method: `Mailbox/get`. *AI session: mailbox-list.*
2. **MailboxList component.** Sidebar tree. Recursive rendering. Selection state in Zustand store. Keyboard nav (up/down arrow, enter to select). Semantic HTML: `<nav>` + `<ul>` + ARIA `treeitem`. *AI session: mailbox-list-ui.*
3. **`thread.list` capability.** Contract → hook + tool. JMAP: `Email/query` (sorted by `receivedAt desc`) + `Email/get` (metadata only). Pagination by JMAP `position` + `limit`. *AI session: thread-list.*
4. **ThreadList component.** Virtualized list (use `@tanstack/react-virtual` — boring, well-trained). Each row: subject, sender, snippet, date, flags. Keyboard: j/k to move, enter to open, x to mark read. Live region announces selection changes. *AI session: thread-list-ui.*
5. **Sanitizer component.** Rust → WASM via `ammonia`. WIT interface: `sanitize(html: string, allow_external_images: bool) -> string`. Test corpus from P-1.4 plus pathological cases (script tags, event handlers, `javascript:` URIs, CSS expressions). *AI session: sanitizer-component.*
6. **`thread.get` capability.** Full thread + message bodies + attachments metadata. JMAP: `Thread/get` + `Email/get` with body parts. *AI session: thread-get.*
7. **ThreadView + MessageView components.** Messages in chronological order. HTML renders sanitized; plain text renders with markdown. Inline images blocked by default with a per-message "Show external content" toggle. Quoted-reply blocks collapse. Keyboard: n/p between messages, e to expand all. *AI session: thread-view-ui.*
8. **Storage layer: IndexedDB cache.** Cache mailbox tree + most recent N email metadata + thread bodies opened in this session. JMAP `state` token stored per type for delta sync later. *AI session: storage-layer.*
9. **Real action-log writes.** Every `mailbox.list`, `thread.list`, `thread.get` invocation gets a log entry. Hash-chained, with prev-hash verified on read. *AI session: action-log-real.*
10. **Keyboard model document.** `docs/keyboard.md` with the full v1 binding map (j/k/n/p/c/r/x/?/etc). Ship as `?` overlay in the UI. *AI session: keyboard-doc.*
11. **A11y baseline audit.** Run axe-core in Vitest against every component. Fix issues. Run pa11y against a built bundle in CI. *AI session: a11y-pass.*

### Definition of done
You sign in, see your mailbox tree, click Inbox, see your threads, open a thread, read the messages with HTML rendered safely, navigate everything by keyboard, and the action log shows the read trail. axe-core reports zero violations on the rendered components. The MCP server can answer `mailbox.list` and `thread.list` calls with the same data.

### Phase 1 risks
- **Sanitizer false positives breaking real email.** Messages from marketing tools and old Outlook will look broken. Mitigation: exhaustive test corpus from real mail; sanitizer is a tunable component, not a black box.
- **Inline image policy UX.** "Show external content" defaults differ between users. Make it per-message and per-sender, with sensible memory.
- **JMAP delta sync vs full refetch.** Phase 1 can refetch on every navigation. Phase 3 push subscriptions will need real delta handling. Don't over-engineer this in Phase 1.
- **Virtualized list + keyboard focus management.** The classic gotcha. Test with VoiceOver early and often.

---

## Phase 2: Compose, Send, MCP Read Surface

**Goal:** the user can send email. Agents can read mail through MCP.

**Prereqs:** Phase 1 complete.

### Work items

1. **Squire integration.** `npm i squire-rte`. Composer component wraps it. `sanitizeToDOMFragment` callback routes through the WASM ammonia component. Paste handler (`willPaste`) strips Word/Outlook noise. Quoted blocks rendered as `contenteditable="false"`. *AI session: composer-squire.*
2. **`mail.draft` capability.** Contract → hook + tool. JMAP: `Email/set` create with `\Draft` flag. `dry_run` returns the proposed Email object without committing. *AI session: mail-draft.*
3. **`mail.send` capability.** Contract → hook + tool. JMAP: `Email/set` create + `EmailSubmission/set` create in one call. `dry_run` returns recipients, subject, body preview, blob list, estimated send time. *AI session: mail-send.*
4. **Compose UI: new message.** Modal or split-pane (decide and document). Squire editor + recipient fields + subject + attachments + identity selector. Save-on-blur to draft. Send button shows preview confirmation modal driven by `mail.send` dry-run. *AI session: compose-ui-new.*
5. **Reply / reply-all / forward.** Quoted body prefilled (Squire respects `contenteditable="false"` for the quote block). Subject auto-prefixed (`Re:` / `Fwd:`). Recipients prefilled per JMAP rules. *AI session: compose-ui-reply.*
6. **Identity selector.** Dropdown of identities from `Identity/get`. Default identity per mailbox or per recipient domain (config). *AI session: identity-selector.*
7. **Attachments via JMAP Blob upload.** `POST /jmap/upload/<accountId>/`. Inline images: rewrite `<img src="blob:...">` to `cid:<blobId>` on send. Image-resize component slot reserved (Phase 5 fills it in). *AI session: attachments.*
8. **Drafts panel.** ThreadList variant filtered to the Drafts mailbox. Click a draft → opens composer with content. *AI session: drafts-panel.*
9. **`thread.search` capability.** JMAP `Email/query` with `text` filter. Server-side search; no local index in Phase 2. *AI session: thread-search.*
10. **MCP read tools live.** `mailbox.list`, `thread.list`, `thread.get`, `thread.search`, `mail.draft` (read drafts; not write yet). Agents can list and read mail. *AI session: mcp-read-tools.*

10a. **MCP transport: Streamable HTTP for production.** Phase 0 ships stdio (correct for local dev and the in-process test harness). Production deployments and external agent platforms (Claude Desktop, generic MCP clients) connect over HTTP. Per the 2025-2026 MCP spec, **Streamable HTTP** supersedes the deprecated HTTP+SSE transport. Implement Streamable HTTP with Bearer-token auth derived from each agent's per-task identity (Phase 3 issues the tokens; Phase 2 wires the transport). Stdio remains supported for local dev and CI. *AI session: mcp-streamable-http.*

11. **First end-to-end agent flow.** Document at `docs/agent-quickstart.md`: how an external MCP client connects, authenticates, lists threads, reads a message. Example using Anthropic's MCP SDK or a curl call. *AI session: agent-quickstart-doc.*
12. **Action log: writes on every send.** Send action records: recipients (hashed for log compactness, full in JMAP store), subject, blob references, identity used, dry-run preview content. *AI session: action-log-send.*

### Definition of done
You compose, save as draft, reopen, edit, and send a message — both new and reply — through the UI. The dry-run modal shows a faithful preview before commit. An external MCP client lists the user's mail and reads a thread. The send action appears in the action log with a hash-verified chain.

### Phase 2 risks
- **Squire + ammonia + React lifecycle.** Triple integration point. Squire's lifecycle (`new Squire(...)` then `.destroy()`) needs a clean React useEffect dance. Test paste, focus management, undo/redo across re-renders.
- **Identity vs From-header subtleties.** JMAP identities are not the same as the From header; misaligned, replies break. Read RFC 8621 carefully here.
- **Inline image cid rewriting.** Off-by-one in src rewriting silently breaks images for recipients but not for the sender.
- **MCP token scoping for read tools.** Phase 2 can pass through the user's token. Phase 3 introduces per-agent identity — don't accidentally bake user-only assumptions in.

---

## Phase 3: MCP Write Surface, Dry-Run, Approval Queue

**Goal:** agents can act, not just read. Dry-run is universal. Approval queue surfaces require-approval items to humans. Push subscription replaces polling.

**Prereqs:** Phase 2 complete.

### Work items

1. **MCP write tools.** `mail.send`, `mail.draft.create`, `mail.modify` (move, label, mark), `mail.delete`. All implement `dry_run`. *AI session: mcp-write-tools.*
2. **Per-agent identity issuance.** UI: Settings → Agents → Issue token. Pick scope set, lifetime, name. Result: a `client_id` + `client_secret` (or refresh token). Each issuance is logged. *AI session: agent-identity.*
3. **Per-agent identity revocation.** Kill switch on each agent's dashboard. Revocation propagates immediately (token invalidation list cached for the access-token TTL). *AI session: agent-revocation.*
4. **Policy seam wired into every destructive tool.** Interface: `(toolName, dryRunPreview, callerIdentity) -> {decision: "allow"|"deny"|"require_approval", reason?}`. Default v1 engine returns `allow` always. *AI session: policy-seam.*
5. **Approval queue: storage.** New JMAP-adjacent storage (own SQLite or a special mailbox) for pending approvals. Each entry: tool name, params, dry-run preview, requesting identity, timestamp, status. *AI session: approval-queue-storage.*
6. **Approval queue: UI surface.** New top-level navigation item: "Approvals" with a count badge. Each pending item renders the dry-run preview with Approve / Deny / Modify-and-Approve actions. Modify routes back through the same dry-run before commit. *AI session: approval-queue-ui.*
7. **Approval queue: notification path.** When a `require_approval` lands, the requesting agent receives a structured response indicating where to find the approval; the user gets a UI badge plus optional native notification. *AI session: approval-notify.*
8. **Push subscription: EventSource client.** JMAP push registration on shell mount. EventSource handles state-token-keyed deltas; the JMAP client component reconciles the state into the cache. *AI session: push-eventsource.*
9. **In-app new-mail badge.** Subscribe to push events, increment unread count, render in sidebar. Live region announces "new message from `<sender>`". *AI session: new-mail-badge.*
10. **Action log: agent-attributed entries.** Every entry has identity (user or agent name) and capability scope used. Filterable in the action log UI. *AI session: action-log-attribution.*
11. **Action log UI surface.** New top-level navigation: "Activity". Filter by identity, time range, tool, mailbox. Each entry expandable to show full params + result. Verify hash-chain integrity on load and surface any tampering. *AI session: action-log-ui.*
12. **OpenInference trace schema decision.** Adopt OpenInference for log entry schemas, or document a custom schema with a stated migration path. *AI session: openinference-decision.*
13. **Capability scope enforcement in MCP server.** When an agent token presents, filter the tool list returned to that agent to only tools the scope set permits. Tools called out-of-scope return a structured error + log a denial. *AI session: scope-enforcement.*

### Definition of done
You issue an agent token with scope `mail:read,mail:draft`. The agent sees only those tools in its MCP list, can read mail, can create drafts, but cannot send. You issue a second agent token with `mail:send`; the agent sends a message through MCP, which goes through dry-run and policy (default allow), commits, and shows up in the action log as "sent by `<agent name>`". You revoke the second token; subsequent calls fail. The push subscription delivers new mail to the UI without polling.

### Phase 3 risks
- **Approval queue race conditions.** Agent submits, user takes 30 seconds, JMAP state has changed. The approval flow must re-run dry-run on commit, not blindly execute the original params.
- **Token revocation latency.** Access tokens are short-lived but not zero-lived. Document the revocation window (≤ access-token TTL) honestly.
- **Push subscription resilience.** EventSource drops; the client must reconnect with the last seen state token and JMAP `Email/changes` to catch up. Don't assume network reliability.
- **Hash-chain verification cost.** Verifying the entire log on every load is O(n). Cache the last verified hash; only verify deltas. Plan for log truncation/archival in Phase 7.

---

## Phase 4: Calendar, Contacts, Agent UX Polish

**Goal:** calendar and contacts as first-class surfaces with agent symmetry. The agent dashboard becomes pleasant.

**Prereqs:** Phase 3 complete; JMAP Calendar/Contacts URNs verified in P-1.2.

### Work items

1. **`calendar.list`, `event.list`, `event.get` capabilities.** Contract → hook + tool. *AI session: calendar-read-caps.*
2. **CalendarView component.** Month/week/day toggles. Event blocks colored by calendar. Keyboard nav (arrow keys, t for today, m/w/d for views). *AI session: calendar-view.*
3. **`event.create`, `event.update`, `event.cancel`, `event.rsvp` capabilities.** Each with `dry_run`. *AI session: calendar-write-caps.*
4. **Event composer.** Modal with title/time/attendees/location/description. RSVP from the message viewer when a `text/calendar` part is present. *AI session: event-composer.*
5. **`text/calendar` MIME extraction.** When viewing a message, parse `.ics` parts, surface as a structured block with Accept/Decline/Tentative. Wires into `event.rsvp`. *AI session: ics-extraction.*
6. **`contact.list`, `contact.get`, `contact.create`, `contact.update`, `contact.delete` capabilities.** Each with `dry_run` for writes. *AI session: contacts-caps.*
7. **ContactsView component.** Searchable list, detail pane, edit form. *AI session: contacts-view.*
8. **Composer recipient autocomplete.** Reads contacts + recent senders; ranks by recency. *AI session: recipient-autocomplete.*
9. **Agent dashboard.** Per-agent: name, scopes, recent activity, rate, kill switch. Aggregate: agent count, total actions/day, denied actions. *AI session: agent-dashboard.*
10. **Provenance UI on drafts.** When an agent drafts a message, the composer shows "Drafted by `<agent>`" with the agent's reasoning trace if available. Human review-and-edit flow before send. *AI session: agent-drafts-ui.*
11. **Action log: thread-grouped view.** Group sequences of related actions (e.g., agent triages 5 messages → 1 grouped entry expandable to 5). *AI session: action-log-grouped.*

### Definition of done
The calendar shows your events. You can RSVP to a `.ics` invite from the message viewer. Contacts show up and autocomplete in compose. An agent with `mail:draft,calendar:read` can summarize today's meetings into a draft email; you see "Drafted by `<agent>`" in the composer, review, and send.

### Phase 4 risks
- **JMAP calendar/contacts spec churn.** The drafts may evolve. Pin against the Stalwart version verified in P-1.2.
- **Time zone handling.** Always a source of bugs. Use Temporal API or `date-fns-tz`; do not hand-roll TZ math.
- **Recurring events.** RRULE parsing is the classic shipwreck. Use `rrule` (battle-tested JS library); do not parse RRULE by hand.

---

## Phase 5: Files (Tier 1 GitHub)

**Goal:** the user can read/edit/commit text files in a configured GitHub repo. Agents can read and propose changes.

**Prereqs:** Phase 4 complete; GitHub OAuth callback infrastructure decided.

### Work items

1. **GitHub OAuth flow.** New auth path: `Settings → Files → Connect GitHub`. OAuth via GitHub App (preferred) or PAT (fallback). Token scope: `repo` for private, `public_repo` for public. *AI session: github-oauth.*
2. **`FileBackend` trait + WIT contract.** Defined in `components/git-backend/wit/git.wit`. *AI session: git-backend-contract.*
3. **GitHub adapter implementation.** Rust, `octocrab` crate, compiled to WASM. Implements `list`, `read`, `write`, `delete`, `history`. *AI session: github-adapter.*
4. **`files.*` capabilities.** Contract → hook + tool. Each write has `dry_run` showing the diff before commit. *AI session: files-caps.*
5. **FilesView component.** File tree (left), content (center), commit history (right). Keyboard nav consistent with thread list. *AI session: files-view.*
6. **Text file editor.** Monaco Editor (boring choice, well-trained). Syntax highlighting per extension. Save-on-explicit-action-only (no auto-save in Phase 5). *AI session: files-editor.*
7. **Commit dialog.** Message field + dry-run preview (shows the diff). *AI session: commit-dialog.*
8. **Binary handling.** Binaries show metadata + download button. No preview in Phase 5; image preview lands in Phase 7. *AI session: files-binary.*
9. **MCP files tools.** Agents can list, read, propose-write (always require_approval default). *AI session: mcp-files.*
10. **Open Brain co-deployment recipe.** Docker Compose recipe under `deployment/openbrain/` for co-deploying OB1 alongside the webmail. Includes Postgres + pgvector, OB1 MCP gateway, env-var configuration. *AI session: openbrain-recipe.*
11. **Memory backend OB1 adapter.** Wires the webmail's `MemoryBackend` trait through to a configured OB1 endpoint for the structured stores (annotations, profile). Webmail does NOT proxy free-text/vector queries — those go agent-direct to OB1's MCP via the discovery URN. *AI session: memory-ob1-adapter.*
12. **Discovery URN populates OB1 URL.** When `memoryBackend.url` is configured in `config.json`, the `urn:iarsma:agent-context` capability extension carries the OB1 MCP URL alongside the webmail's. *AI session: discovery-ob1.*

### Definition of done
You connect a GitHub repo, browse it in the Files panel, edit a Markdown file, commit with a message, see the commit appear in history. An agent with `files:read,files:write` proposes a change to a file; the policy default routes it to the approval queue; you approve, the commit happens. An OB1 instance is running (either via the Docker Compose recipe or pre-existing); the webmail's session resource advertises its URL via the discovery URN; an agent connecting to the webmail discovers OB1 and connects to it directly for vector search and free-text memory queries.

### Phase 5 risks
- **GitHub rate limits.** OAuth tokens get 5000 req/hr per user — adequate for personal use but easy to burn during dev. Cache aggressively; surface rate-limit errors clearly.
- **Large files.** GitHub API limits content endpoints to ~1 MB. Larger files need the Git Trees API or Git Data API. Document the boundary; don't try to handle it transparently in Phase 5.
- **Conflict resolution.** No real merge UI in Tier 1. Concurrent writes from agent + human can collide. Document this honestly; full conflict UI lands when Tier 2 (gitoxide) ships.

---

## Phase 6: Desktop & Mobile via Tauri 2

**Goal:** native desktop apps for macOS, Linux, Windows. Native mobile builds for iOS and Android.

**Prereqs:** Phase 5 complete.

### Work items

1. **Tauri 2 desktop build for macOS.** First because the user uses macOS. Code signing setup. Notarization. *AI session: tauri-macos.*
2. **Native notifications on macOS.** Hooked to push subscription events. Click → opens the relevant thread/event/file. *AI session: native-notifs-macos.*
3. **System tray on macOS.** Unread count, quick actions (compose, search). *AI session: tray-macos.*
4. **Native filesystem access.** Drag-drop attachments work natively (not just via web file input). *AI session: native-fs.*
5. **Tauri 2 desktop builds for Linux + Windows.** GitHub Actions release workflow. *AI session: tauri-linux-windows.*
6. **Tauri 2 iOS build.** TestFlight distribution. Apple Developer account required. *AI session: tauri-ios.*
7. **Mobile push: PWA Web Push best-effort.** VAPID keys, service worker, browser push. Documented limitations on iOS Safari. *AI session: web-push.*
8. **Tauri 2 Android build.** Internal testing track on Play. *AI session: tauri-android.*
9. **Mobile-specific UI tweaks.** Touch targets, swipe gestures (swipe to archive/delete), reduced sidebar to a hamburger menu under tablet width. *AI session: mobile-ui.*
10. **Auto-update on desktop.** Tauri's updater plugin against GitHub Releases. *AI session: auto-update.*

### Definition of done
Native macOS app installable from a `.dmg`, opens to your inbox, native notifications fire, system tray works. Linux `.AppImage` and Windows `.msi` build in CI. iOS app installs via TestFlight; Android via Play Internal. Same React bundle in all six targets.

### Phase 6 risks
- **iOS code signing and provisioning profiles.** Always painful. Budget extra time.
- **Tauri Mobile maturity.** Beta-grade in 2026; some plugin ecosystem gaps. Have React Native as a documented fallback for any feature that breaks.
- **Mobile push without enterprise certs.** Web Push on iOS Safari is partial; Android is better. Document honestly; native APNS/FCM is post-v1.
- **Auto-update security.** Updater verifies signatures; key management for releases needs to be solid before this ships to anyone other than you.

---

## Phase 7: Polish, OPA Default Bundle, Performance

**Goal:** the app is pleasant to live in for an extended period. Default policy bundle ships. Performance is measured and budgeted.

**Prereqs:** Phase 6 complete.

### Work items

1. **Performance budget enforcement.** Lighthouse CI in GitHub Actions. Bundle size budget: 2 MB compressed for the web target. Per-route load time budget. *AI session: perf-budget.*
2. **Virtualization audit.** Confirm every list >50 items is virtualized. Add where missing. *AI session: perf-virtualization.*
3. **Suspense and skeletons.** Loading states everywhere, no jank on slow networks. *AI session: perf-suspense.*
4. **Preload-on-hover.** Hovering a thread row prefetches its bodies. *AI session: perf-preload.*
5. **Themes: light, dark, auto.** CSS custom properties wired through shadcn. User-customizable accent color. *AI session: themes.*
6. **i18n framework.** `react-i18next` or equivalent. Don't translate everything yet — make the strings extractable and the framework wired. *AI session: i18n.*
7. **Default OPA policy bundle.** Ships in `policy/` directory. Reasonable defaults: agents may not delete; agents may not send to external recipients without approval; no calendar changes within 30 minutes of a meeting. Documented; opt-in. *AI session: opa-bundle.*
8. **Action log retention policy.** Configurable: keep N entries, archive to cold storage, or keep forever. Truncation never breaks hash-chain verification. *AI session: log-retention.*
9. **WCAG 2.1 AA audit and remediation.** Full pa11y + axe-core + manual VoiceOver pass. Fix everything that comes up. *AI session: a11y-audit.*
10. **Sieve filter editor (deferred from earlier).** Visual filter builder. Agent can author Sieve via MCP. *AI session: sieve-editor.*

### Definition of done
Lighthouse score ≥ 95 on the desktop target. axe-core + pa11y report zero violations. Default OPA bundle deny tests pass in CI. The action log handles 100k entries without UI degradation.

### Phase 7 risks
- **a11y issues found late are expensive.** Mitigation: the per-component axe checks from Phase 1 onwards have caught most of them already.
- **Performance budget creep.** The bundle wants to grow. Be willing to defer features or move them to lazy-loaded chunks.
- **OPA policy correctness.** Wrong policies block legitimate work. The default bundle should be commented heavily and labeled "starting point, not gospel."

---

## Cross-Phase Tracks

These items don't fit cleanly into one phase but require attention throughout. Track them as standing concerns.

### CT-1. Accessibility
- Per-component axe-core in Vitest (Phase 1 onwards).
- Per-PR pa11y check in CI (Phase 1 onwards).
- VoiceOver smoke test before each phase ships.
- Full WCAG 2.1 AA audit in Phase 7.

### CT-2. Performance budget
- 2 MB compressed bundle for web target. Measured per PR; CI fails if exceeded without explicit override.
- WASM component sizes tracked individually. Each component has a stated budget.
- Time-to-interactive measured against a Stalwart Docker fixture.

### CT-3. Security review
- Per-component threat-model exercise when introduced (sanitizer, OAuth, action log, MCP server, file backend).
- External security review before any public reference deployment goes live.
- CVE monitoring on dependencies (`cargo audit`, `npm audit`, GitHub Dependabot).

### CT-4. Documentation
- `README.md` is always runnable: clone, follow, you have a working dev environment.
- `docs/architecture.md` mirrors the brief but with more diagrams.
- `docs/agent-collaboration.md` walks an agent author through tool authoring, scopes, dry-run, and approval flows.
- `docs/decisions.md` (the decision log) is updated with every architectural choice. Closed PRs that introduce new decisions reference an entry here.

### CT-5. Stalwart upstream alignment
- Track Stalwart releases. Pin per phase.
- File issues against Stalwart for any JMAP edge case the webmail surfaces.
- Reach out to Stalwart Labs around Phase 1–2 ship to discuss component sharing.

### CT-6. Schema versioning
- `config.json`, capability contracts, action-log entries, MCP tool inputs/outputs — all carry a `schemaVersion` field. The eight versioned boundaries are catalogued in `docs/versioning.md` (D-044).
- Breaking schema changes go through the migration policy in `docs/schema-migration.md` (D-042).
- Capability contracts additionally carry a `stability` annotation (D-045): `'experimental'` (default), `'stable'`, or `'deprecated'`.

### CT-7. Native-app codegen targets
- The brief's Library API path lists fully native applications (SwiftUI, Jetpack Compose, GTK, AppKit) as embedding consumers alongside tuatha. Codegen generators for non-TypeScript SDKs — Swift package, Kotlin Multiplatform module, Rust crate — are a post-v1.0 deliverable; the AST is shaped to accommodate them per D-035.
- The error envelope, dry-run shape, pagination convention, and contract versioning (D-041, D-042, D-043 and successors) pass through unchanged across all SDK targets — generator-level differences are syntactic only.
- Reference apps under `examples/native/` (one per platform, post-v1.0) demonstrate embedding the WASM components alongside the codegen'd SDK against a live Iarsma deployment.
- Native clients are not forks of the React shell. The Tauri 2 path (Phase 6) wraps the React shell across desktop/mobile and remains the canonical packaged distribution; native-app embedding is a separate consumer pattern that ships components and contracts, not UI.

---

## Risk Register

Phase-level risks are listed within each phase. The five highest-priority cross-cutting risks are:

1. **Capability contract format wrong.** Catches: every phase. Mitigation: Pre-Phase F-3 picks the format and proves it end-to-end with `session.get` before Phase 0 closes. If `session.get` is awkward to define, redo before adding more.

2. **WASM Component Model browser tooling regression.** Catches: any phase. Mitigation: Pre-Phase F-3 includes a non-Component WASM fallback path that's exercised in CI. If `jco` breaks, the project keeps moving.

3. **OAuth flow edge cases.** Catches: Phase 0, Phase 3 (per-agent identities). Mitigation: use `oauth4webapi` (vetted), document the redirect URIs and grant types in `docs/stalwart-setup.md`, integration tests against a Docker Stalwart in CI.

4. **JMAP calendar/contacts/files spec churn.** Catches: Phase 4, Phase 5. Mitigation: pin Stalwart versions per phase; keep capability contracts narrow (don't speculatively model the full draft).

5. **Solo-developer burnout.** Catches: any phase. Mitigation: each phase ships a daily-driver-able state. After every phase, take a full week of just using what's built before starting the next phase. The review will surface the right priorities for what comes next.

---

## How to use this plan

- Each work item is sized for one AI-assisted session. The "AI session" label suggests a focused context window.
- Number ordering within a phase suggests sequencing but isn't strict. Items without a stated dependency can run in parallel if context allows.
- Definitions of done are written to be testable by a human or by automation — they should be falsifiable.
- The plan is a living document. After each phase ships, revisit and refine the next phase based on what was learned. Update `docs/decisions.md` with anything that changed.
- When in doubt, the brief is the source of truth on *what and why*. This plan is the *how and when*. If they conflict, the brief wins; update this plan.
