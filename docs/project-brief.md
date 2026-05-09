# Iarsma — Project Brief

> **Iarsma** (Irish, /ˈiərˠsˠmə/, "EER-sma") — *relic, artifact, durable remnant*. The thing that endures.

## Vision

A self-hosted, JMAP-native communications client where humans and agents work as peers, not where agents are bolted onto a legacy mail UI. Mail, calendar, contacts, and lightweight files are the surface area; the interesting design work is the collaboration model layered through every capability.

The name comes from the Irish for *relic* — the durable artifact that carries meaning across time. Mail is, fundamentally, durable communication; iarsma names what mail actually is.

The client targets a Stalwart Mail Server backend (or any JMAP-compliant server) and uses Git as the file storage and collaboration substrate. The shell is TypeScript + React + Tauri 2; the security-critical and reusable logic lives in WebAssembly components written in whatever language fits the job. Squire (Fastmail's open-source editor) handles rich text. Outbound mail relays through SendGrid because the deployment target is the OCI free tier and PTR records aren't available there.

The project is intentionally pragmatic at the shell level (TypeScript, React, Tauri — well-trodden, AI-friendly, mature) and intentionally polyglot at the component level (Rust where Rust crates exist; JS where the DOM lives; future room for any language that compiles to a WASM Component). The goal is to keep architectural doors open, not to chase language variety for its own sake.

## Core Identity: Agent/Human Collaboration as Foundation

This client is not a mail client with AI features. It is a mail/calendar/contacts/files client whose foundational assumption is that some of the actors are humans and some are agents, that both deserve first-class capability surfaces, and that the trust model has to make agent participation safe by construction.

The five principles that follow shape every architectural choice in this brief:

1. **Symmetric capability surface.** Every capability the user has is exposed three ways: a UI surface (React component), an MCP tool (for agents), and a library/component API (for embedding). The three are generated from a single typed contract — no shadow paths.
2. **Propose, preview, approve, commit.** Both humans and agents operate by producing a proposal that the system can evaluate before it commits. `dry_run` is a protocol convention, not a per-tool feature. Humans see previews as confirmation dialogs; agents receive previews as structured responses; policy engines evaluate previews before allowing commits.
3. **Tamper-evident action log as inbox-adjacent surface.** Agent activity is not buried in a settings panel. The action log is a peer to the inbox — viewable, filterable, undoable, and queryable by agents themselves. Hash-chained for integrity.
4. **Capability-scoped, ephemeral, per-agent identity.** No shared API keys. Every agent identity gets its own credential, its own scope set, its own audit trail. Tokens are ephemeral and per-task by default. OAuth 2.1 + PKCE for both human and agent auth.
5. **Policy engine seam at the dry-run boundary.** Every preview can be sent to a pluggable policy engine (OPA, Cerbos, custom) that returns `allow | deny | require_approval`. The engine is deferred past v1; the seam exists from Phase 0.

These aren't future-phase features. They are the shape of the product from the first commit.

## Goals

1. **Agent/human collaboration is the platform, not a feature.** Symmetric surfaces, propose-preview-approve-commit semantics, tamper-evident audit, capability scoping, policy seam.
2. **JMAP-native end to end.** No IMAP polyfills, no shims. Push, threading, search, accounts, identities — all via JMAP. Take advantage of the protocol's efficiency.
3. **WASM-first composition for reusable, security-critical, or polyglot logic.** Each significant capability is a sandboxed WebAssembly component with an explicit interface (WIT). Components are independently buildable, testable, replaceable, and reusable across the UI shell, the MCP server, and any future host (the tuatha agent harness, a CLI, a server-side worker).
4. **Cross-platform from one shell.** Web (PWA), desktop (Tauri 2 native shell on macOS/Linux/Windows), and mobile (Tauri 2 iOS/Android, with React Native or Capacitor as fallback if Tauri Mobile gaps emerge). PWA-on-mobile is acceptable for v1 but the install-to-home-screen experience must be solid — opening a browser to check mail is not the v1 mobile UX.
5. **Buy/integrate aggressively, build only what's missing.** Stalwart for mail/calendar/contacts. Git for files. SendGrid for outbound. Squire for the composer. Ammonia for sanitization. We build the glue, the agent collaboration layer, and the UX.
6. **Self-hostable and forkable.** Dual MIT OR Apache-2.0 license (Rust ecosystem standard). Minimal hard dependencies on any vendor. GitHub for files is the default but the file backend is a pluggable interface so any git host works.
7. **Pleasant to vibe-code with AI assistance.** Clear module boundaries. Heavy use of typed interfaces (TypeScript at the shell, WIT at the component boundary). Tests are concrete. Smaller surface per file. README-driven design so an LLM can pick up any module and contribute without holding the whole world in context.
8. **Accessibility (WCAG 2.1 AA) is a Phase 1 design constraint**, not Phase 7 polish. Keyboard model, semantic HTML, focus management, contrast — designed in, not added on.

## Non-Goals

- **Building our own mail server.** Use Stalwart.
- **Building our own file storage / sync engine.** Use Git.
- **Building our own outbound deliverability infrastructure.** Use SendGrid (constrained by OCI free-tier PTR limitations) or any SMTP relay.
- **Reinventing rich text.** Wrap Squire (purpose-built for email, used by Fastmail/ProtonMail/Tutanota/Superhuman, MIT, ~16.5 KB gzipped, no dependencies).
- **A Rust-everywhere shell.** The polyglot principle is "don't lock out a great integration because a Rust equivalent doesn't exist yet." TypeScript is the right shell language for AI-friendly velocity, mature mobile tooling, and native composition with a JS-host WASM component model.
- **Multi-tenant SaaS.** This is a self-hosted product first; SaaS later if at all. A public reference instance running the code is expected.
- **Real-time collaborative document editing in v1.** Yjs-based collab is great but out of scope for the initial composer; revisit after core mail works.
- **Email encryption (PGP/S-MIME) in v1.** Architecture leaves room for it as a component, but it doesn't ship in early phases.
- **Treating AI as an optional plugin.** AI-driven agents are first-class users of the platform. What is *out* of scope is shipping LLM API keys or model integrations in the core product — those belong with the agent platform (e.g., the user's tuatha harness), not in the webmail.
- **Firecracker as an architectural pillar.** WASM components already provide capability confinement. Firecracker remains available as a deployment option for operators who need full kernel isolation; it is not a foundational design constraint. Agents talk to the system through MCP, not through driving a GUI in a microVM.

## Why WASM Components

Microservices' best ideas (isolation, polyglot, independent deploy) without their worst (network reliability, ops complexity, latency, serialize/deserialize tax). Components share an address space, communicate via typed function calls, are confined by capabilities (no ambient authority), and can be authored in any language that targets the Component Model.

For a security-critical app where untrusted email content gets parsed, sanitized, and rendered, the capability-confinement story matters. An HTML sanitizer that can't make network calls or read other components' state is structurally safer than one that just promises not to.

For a project where agents are first-class actors, the same primitive — capability-scoped components — applies twice. Agent tokens carry capability scopes. Components carry capability imports. The two compose naturally: an agent with `mail:read` can call any tool that requires only `mail:read` capabilities; the component model enforces that the tool itself can't escalate.

## Why TypeScript + React + Tauri 2

The brief originally specified Rust + Dioxus. After review, the shell choice flipped to TypeScript + React + Tauri 2. The reasoning:

- **JS is the native host for browser-side WASM components today.** `jco` is JS-first by design; `wit-bindgen` produces JS bindings as a primary target. A JS shell composes WASM components more smoothly, with more tooling, than a Rust shell does in 2026. This makes the WASM-component story stronger, not weaker.
- **AI-assisted development velocity.** TypeScript and React have orders of magnitude more training data than Dioxus. For a solo developer relying on AI assistance, this matters concretely — fewer hallucinated APIs, more reliable diff suggestions, more boilerplate the AI gets right on the first try.
- **Mobile maturity.** Tauri 2 ships iOS and Android today. Dioxus Mobile is beta-grade and unproven for complex UIs. React Native exists as a credible fallback if Tauri Mobile has gaps.
- **Squire is a JS library.** With a JS shell, Squire integrates natively. No wasm-bindgen bridge to design.
- **Component libraries.** shadcn/ui, headlessui, radix, and the broader React ecosystem accelerate the visual design work that a webmail needs.
- **MCP server is a separate process.** With a JS shell, the MCP server is naturally a separate Node or Rust binary, which is the typical MCP shape anyway. Both the shell and the MCP server import the same Rust-→-WASM JMAP-client component.

What is given up: the "single binary, no Node toolchain" aesthetic, and tight coupling with Stalwart Labs' first-party Dioxus webmail. The Stalwart alignment moves from "shared rsx components" to "shared WASM components" — the integration boundary moves from the shell to the component, which is arguably where it belonged anyway.

---

## Architecture

### High-Level Picture

```
┌──────────────────────────────────────────────────────────────────┐
│                  Shell (TypeScript + React)                       │
│  routing · components · state · platform-specific entry points    │
│  Tauri 2 packages this for desktop and mobile; PWA for web        │
└──────┬──────────────────────────────────────────────────────┬────┘
       │                                                       │
       │  WASM Component Boundaries (typed via WIT, jco-loaded)│
       ▼                                                       ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ JMAP Client  │  │ HTML         │  │ Markdown     │  │ Git Backend  │
│ (Rust)       │  │ Sanitizer    │  │ ↔ HTML       │  │ (Rust)       │
│              │  │ (Rust)       │  │ (Rust)       │  │              │
└──────┬───────┘  └──────────────┘  └──────────────┘  └──────────────┘
       │                                                       │
       │  reused by both shell and MCP server                  │
       ▼                                                       │
┌──────────────────────────────────────────────────────────────────┐
│              MCP Server (Node or Rust binary)                     │
│  exposes capability-scoped tools for agents                       │
│  every destructive tool returns dry-run preview                   │
│  policy engine seam at the dry-run boundary                       │
└──────┬──────────────────────────────────────────────────────────┘
       │
       │  HTTPS (JMAP over JSON, same-origin via Stalwart Web App)
       ▼
┌──────────────────────────────────────────────────────────────────┐
│                  Stalwart Mail Server                             │
│  Mail · Calendar · Contacts (JMAP) · OIDC Provider                │
│  optionally serves the Iarsma bundle via Web Applications         │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│         Token-Exchange Sidecar (Node, co-deployed)                │
│  holds OAuth client_secret · POST /auth/token endpoint            │
│  required because Stalwart treats clients as confidential         │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│         File Storage Adapter (pluggable FileBackend trait)        │
│  default: GitHub API · alts: Gitea, self-hosted git, S3-like      │
│  Tier 2 future: gitoxide compiled to WASM with OPFS               │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│         Memory Backend (pluggable, optional)                      │
│  Tier 1 default: structured-only browser-side store (annotations, │
│    profile, behavior signals). No external infra.                 │
│  Tier 2 (opt-in): co-deployed Open Brain (Postgres + pgvector).   │
│    Independent service. Discovery via JMAP capability URN.        │
│    Iarsma does not proxy — agents connect to OB1 directly.        │
│  Future: Mem0, Letta, custom — same trait.                        │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│         Tamper-Evident Agent/Human Action Log                     │
│  SHA-384 hash-chained, OpenInference-compatible, queryable via    │
│  MCP. PQC-conservative second-preimage resistance.                │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│         Composer (Squire, JS library, embedded directly)          │
└──────────────────────────────────────────────────────────────────┘
```

### Symmetric Capability Surface

Every capability is defined once in a typed contract and exposed three ways:

```
                    ┌─────────────────────────┐
                    │  Capability Contract    │
                    │  (WIT / TypeScript IDL) │
                    └────────────┬────────────┘
                                 │
            ┌────────────────────┼────────────────────┐
            ▼                    ▼                    ▼
   ┌────────────────┐  ┌─────────────────┐  ┌───────────────────┐
   │  React UI      │  │  MCP Tool       │  │  Library API      │
   │  (humans)      │  │  (agents)       │  │  (embedding —     │
   │                │  │                 │  │   tuatha, native  │
   │                │  │                 │  │   apps, CLIs)     │
   └────────────────┘  └─────────────────┘  └───────────────────┘
```

A `mail.send` capability has a single source-of-truth definition. The React composer wires its "Send" button to it, the MCP server exposes it as a tool, and the library API exports it for tuatha or any other host to consume. All three paths go through the same dry-run pipeline, the same policy seam, and the same action log. There is no "agent path" that bypasses what the human path does, and there is no "human path" that does things agents can't.

The Library API path is also the embedding surface for **fully native applications** — a SwiftUI iOS client, a Jetpack Compose Android client, a GTK or AppKit desktop client — that want Iarsma's dry-run, policy, and action-log semantics without adopting the React shell. Such hosts consume the same capability contracts (codegen targeting non-TypeScript languages is a future deliverable; the AST is shaped to accommodate it per D-035) and load the same Rust→WASM components via any WASI-Preview-2 runtime (Wasmtime, WasmEdge, or a JS engine). This is distinct from the Tauri 2 path described below, which wraps the React shell across desktop and mobile; native-app embedding ships *components and contracts*, not UI. Each native client is its own project — Iarsma facilitates the shared substrate; it does not ship the native UIs itself.

### Cross-Platform Strategy

**Web (primary target).** Vite-built React app served as static files. Service worker enables PWA install + offline shell.

**Desktop.** Tauri 2 wraps the same React app in a small native shell (WebView2 / WKWebView / WebKitGTK). Tauri's Rust runtime provides filesystem access, native dialogs, system tray, and native notifications.

**Mobile.** Tauri 2 ships iOS and Android. Same React app inside a thin native shell. Push notifications via APNS/FCM bridged to the JMAP push subscription. If Tauri Mobile gaps emerge, the fallback is React Native or Capacitor wrapping the same component layer — but the WASM components (JMAP client, sanitizer, etc.) move with us regardless.

**Code organization** keeps platform-specific concerns minimal. Platform adapters are TypeScript modules with a shared interface; the React app calls *interfaces*, never platform APIs directly.

---

## The Agent/Human Collaboration Model

This is the section that distinguishes this project from other JMAP webmails.

### Identities and Authentication

OAuth 2.1 + PKCE for both human and agent auth, against the Stalwart authorization server. There is no "API key" mode in the core product.

Each *agent* gets its own identity — not a shared service account. Agent identities can be:

- **Persistent** — long-lived agents (an inbox-triage agent, a calendar-scheduling agent) registered with stable credentials and a fixed scope set.
- **Ephemeral / per-task** — short-lived, scope-narrowed credentials issued for a specific job, expiring on completion or after a timeout. The default for agents driven by the tuatha harness or any external agent platform.

Per-agent virtual credentials make the audit log meaningful: every action in the log binds to an identity, and identities don't share secrets.

### Capability Scopes

Drawn from a small fixed vocabulary. Indicative starting set:

- `mail:read`, `mail:read.metadata` (just headers, no body)
- `mail:send`, `mail:draft`
- `mail:modify` (move, label, mark read/unread)
- `mail:delete`
- `calendar:read`, `calendar:write`, `calendar:rsvp`
- `contacts:read`, `contacts:write`
- `files:read`, `files:write`, `files:delete`
- `memory:annotations.read`, `memory:annotations.write`
- `memory:profile.read`, `memory:profile.propose` (writes go through approval)
- `behavior:read` (opt-in, sensitive — engagement signals)
- `agent-log:read.own`, `agent-log:read.all`
- `policy:propose` (suggest policy changes — never execute them)
- `admin:*` (human-only by convention)

Token's scope set filters the MCP tool surface presented to that agent. A `mail:read.metadata`-only agent does not see `mail.get_body` in its tool list at all.

### Propose / Preview / Approve / Commit

Every destructive or external-effect tool follows the same four-step shape:

1. **Propose** — caller supplies parameters.
2. **Preview** — system computes what would happen and returns a structured preview (which JMAP methods would be invoked, what would change, side effects, estimated cost). Always available via `dry_run: true`.
3. **Approve** — preview is evaluated. For humans: a confirmation dialog. For agents: optionally fed to the policy engine for `allow | deny | require_approval`. Agents in `require_approval` mode hand the preview back to a human (via inbox or notification surface).
4. **Commit** — the system executes and writes the result to the action log.

Non-destructive tools (reads, searches) skip the preview/approve steps.

This pattern unifies UI confirmation flows, agent dry-runs, and policy enforcement into a single mechanism. Building it once is cheaper than building it three times.

### Tamper-Evident Action Log

Every commit (and every preview, optionally) writes an entry to an append-only, hash-chained log. Each entry includes:

- Identity (which user or agent)
- Timestamp
- Tool name and parameters (attachments hashed, not stored inline)
- JMAP methods invoked
- Result status
- Hash of the preceding entry (enabling integrity verification)
- Optional: OpenInference-compatible reasoning trace if the agent provided one

The log is exposed in the UI as an *inbox-adjacent* surface — not buried in settings. The user can:

- See what each agent has been doing, in chronological or thread-grouped view
- Filter by identity, time range, tool, or affected resource
- Undo recent actions where reversible (move-back, unsend within window, restore deleted)
- Adjust an agent's scopes inline if it's doing things they don't want
- Export the log for external compliance

Agents themselves can query their own history via the `agent-log:read.own` scope, which makes "what did I do for this user last week" answerable without giving them anyone else's data.

### Policy Engine Seam

At the dry-run boundary, every preview can optionally be sent to a configured policy engine. The engine returns one of:

- `allow` — proceed to commit
- `deny` — block, log the denial, surface the reason
- `require_approval` — return preview to the originating identity's approval channel

Engines plug in via a small interface; OPA, Cerbos, or a custom worker all satisfy it. v1 ships with a no-op engine and the seam wired through. Phase 2+ may ship a default policy bundle for common stances ("agents may never delete," "agents may not send to external recipients without approval," etc.). Enterprise users can BYO engine.

### Why This Matters for the User Experience

The collaboration model is not a hidden plumbing detail — it shapes the actual UI:

- **Inbox shows agent activity inline.** A thread that an agent triaged, replied to, or drafted in shows the agent's involvement as part of its activity timeline. Not as a "robot icon"; as a first-class participant.
- **Compose UI has an "Agent Assist" surface.** Drafts can be authored by an agent, presented for human review and edit, then sent. The draft carries provenance: who/what generated it, with what model, against what context.
- **Per-agent dashboards.** Every connected agent has a page showing its scopes, recent actions, current rate of activity, and a kill switch.
- **Approval inbox.** When an agent operates in `require_approval` mode, its proposed actions arrive in a dedicated approval queue with previews ready to inspect.
- **Conversation as metaphor for both.** Email threads and agent action threads (a sequence of related actions toward a goal) share UI primitives.

---

## Components

Each component below has: **Purpose · Language · Build vs Integrate · Status notes.** Order roughly matches build priority.

### Shell (React Application)

**Purpose.** The UI: layout, routing, state management, platform entry points. Hosts WASM components via `jco`. Embeds Squire for compose. Surfaces the action log and agent collaboration UX.
**Language.** TypeScript + React + Vite. Tailwind + shadcn/ui for primitives.
**Build vs Integrate.** Build.
**Notes.** Heart of the product. Components: `App`, `Layout`, `Sidebar`, `MailboxList`, `ThreadList`, `ThreadView`, `MessageView`, `Composer` (wraps Squire), `CalendarView`, `ContactsView`, `FilesView`, `ActionLog`, `AgentDashboard`, `ApprovalQueue`, `Settings`, `Login`. State via **Jotai** — atom-style derived state maps cleanly to our shape (server-cached JMAP entities as atoms, derived counts like unread/pending-approvals/active-agents as `atom(get => ...)`, UI state as smaller atoms). A typed JMAP-state-token reconciler consumes deltas from the JMAP client component.

### JMAP Client Component

**Purpose.** All mail/calendar/contacts API access against Stalwart. Session bootstrap, Email/get, Email/query, Email/changes, Email/set, Mailbox/*, Thread/get, SearchSnippet/get, Identity/*, push subscription via EventSource initially. Reused by both the shell and the MCP server.
**Language.** Rust, compiled to WASM Component.
**Build vs Integrate.** Build (thin), with `jmap-client` crate as a starting reference if WASM-Component-compatible — verify before depending on it.
**Notes.** This is not a JMAP server library; it's a thin client wrapper that exposes typed methods and hides the JSON wire format. Keep it minimal — add methods only as the UI/MCP needs them, not exhaustively cover the spec. State-token-keyed delta reconciliation lives here.

### MCP Server

**Purpose.** Expose capability-scoped tools for agents. Implements the propose/preview/approve/commit pattern. Calls into the JMAP Client component.
**Language.** Node (TypeScript) initially for ecosystem velocity. Could be re-written in Rust later if performance matters.
**Build vs Integrate.** Build.
**Notes.** Sibling to the shell, not nested inside it. Same WASM components; different host. Tool surface auto-generated from a single capability-contract definition shared with the React UI.

### Action Log Component

**Purpose.** Tamper-evident append-only audit log for all agent and human actions. Hash-chained entries; optional OpenInference traces.
**Language.** Rust, compiled to WASM Component (the integrity primitives are easier in Rust). Hash function: **SHA-384 via Web Crypto API / Node Web Crypto.** PQC-conservative second-preimage resistance (~128 bits under Grover), zero-dependency, native everywhere, drop-in upgrade path if longer hashes ever needed.
**Build vs Integrate.** Build.
**Notes.** Storage backend pluggable: SQLite via OPFS in browser, native SQLite for desktop, the JMAP server's native log facility if Stalwart eventually offers one. Reads exposed via MCP tools (scope-gated).

### Policy Engine Adapter

**Purpose.** Connect dry-run previews to a configured policy engine. v1 ships a no-op default; OPA/Cerbos adapters land in Phase 2+.
**Language.** TypeScript (interface lives in the shell + MCP server).
**Build vs Integrate.** Build the seam; integrate the engine.
**Notes.** The seam is non-negotiable for v1 even if the engine is no-op. Adding the seam later means refactoring every destructive tool — building it in is cheap.

### HTML Sanitizer

**Purpose.** Make incoming email HTML safe to render. Strip scripts, dangerous CSS, event handlers; block external resources by default, allow user opt-in per message.
**Language.** Rust (`ammonia`), compiled to WASM Component.
**Build vs Integrate.** Integrate (`ammonia`), wrap as a component.
**Notes.** Critical security boundary. Pure function: receives raw HTML, returns sanitized HTML. No network, no filesystem, no DOM. Easy to test, swap, and audit.

### Markdown ↔ HTML Converter

**Purpose.** Convert markdown drafts to HTML on send; render plain-text fallbacks as HTML for display.
**Language.** Rust (`pulldown-cmark` for MD→HTML, `html2md` for HTML→MD), compiled to WASM Component.
**Build vs Integrate.** Integrate.
**Notes.** Pure function. Useful in the composer for a markdown mode and in the message viewer for plain-text rendering.

### Composer

**Purpose.** Rich-text editing for outgoing mail. Bold/italic/lists/headings/links/images/quoted-replies/signatures. Round-trip arbitrary HTML from forwards without normalizing.
**Language.** **JavaScript via Squire.**
**Build vs Integrate.** Integrate (Squire — Fastmail's MIT-licensed editor, designed specifically for webmail).
**Notes.** Squire is purpose-built for the email use case TipTap fights. Used in production by Fastmail, ProtonMail, Tutanota, StartMail, Zoho Mail, and Superhuman. ~16.5 KB gzipped, no dependencies, headless (you bring your own toolbar). Pairs naturally with `ammonia` for sanitization. See the dedicated section below.

### Search & Indexing (Optional, Phase 4+)

**Purpose.** Local full-text search over cached messages, faster than re-querying JMAP every keystroke.
**Language.** Rust (`tantivy` or similar), compiled to WASM Component.
**Build vs Integrate.** Integrate.
**Notes.** Skip for v1; rely on JMAP `Email/query` with `text` filter. Add later as a perf optimization.

### Image Processing (Optional, Phase 5+)

**Purpose.** Resize images on attach (downscale 4K phone photos to sane email sizes), generate thumbnails for inline images.
**Language.** Rust (`image` crate), compiled to WASM Component.
**Build vs Integrate.** Integrate.
**Notes.** Component receives bytes, returns bytes. No I/O. Easy capability confinement.

### Encryption (Optional, Future)

**Purpose.** PGP/S-MIME if/when we want encrypted mail.
**Language.** Rust (`sequoia-openpgp`), compiled to WASM Component.
**Build vs Integrate.** Integrate.
**Notes.** Significant scope; explicitly future. Architecture leaves room for it as a component receiving plaintext + recipient keys, returning ciphertext.

### Storage Layer

**Purpose.** Persist UI state, drafts, cached email metadata, JMAP session token, user preferences. Offline support.
**Language.** TypeScript wrapping IndexedDB / OPFS (browser) and Tauri's filesystem APIs (native).
**Build vs Integrate.** Build (thin) on top of platform APIs.
**Notes.** Start with IndexedDB for cached metadata, OPFS for blobs, Tauri secure storage for tokens on desktop. Pluggable behind an interface so a Rust→WASM storage component could replace the TS impl later if useful.

### Push Notifications

**Purpose.** New mail arrives → user sees badge, desktop notification, mobile push. JMAP push subscription delivers events; the shell turns them into UI updates and (where supported) OS notifications.
**Language.** TypeScript (subscription management) + small service worker for web push.
**Build vs Integrate.** Build (thin).
**Notes.** v1 uses EventSource for push; Web Push (with VAPID + service worker) is a Phase 3 add. Mobile push for self-hosted deployments without Apple/Google enterprise certs is unsolved industry-wide; scope mobile push as PWA-best-effort for v1.

### File Adapter (Git-Backed Files)

**Purpose.** Read, write, list, version files in a Git repo. Default backend: GitHub API. Pluggable for Gitea, GitLab, self-hosted, etc.
**Language.** Rust (Tier 1 GitHub adapter) compiled to WASM Component. Tier 2: gitoxide compiled to WASM.
**Build vs Integrate.** Build the adapter; integrate the underlying API client.
**Notes.** See dedicated section below. Stalwart's WebDAV file storage is intentionally bypassed — Git gives versioning, branching, and an existing collab tool (PRs) for free, and shares state with the user's tuatha agent harness.

### Auth / Session

**Purpose.** OAuth 2.1 + PKCE flows for Stalwart, GitHub, and any future OIDC sources. Issue agent tokens with scope sets. Persist tokens securely.
**Language.** TypeScript (orchestration) calling into a Rust crypto component for any token-handling primitives that benefit from it.
**Build vs Integrate.** Build (thin).
**Notes.** Stalwart treats OAuth clients as confidential (verified during Phase -1) — a `client_secret` is always present. Because a browser bundle can't safely hold the secret, the flow uses a **co-deployed token-exchange sidecar** (Node + TypeScript, single `POST /auth/token` route) that holds the secret and performs the auth-code-plus-PKCE-verifier exchange. For Tauri desktop/mobile builds, the same exchange happens in the Tauri Rust glue. Tokens stored in OPFS-encrypted-blob (web) or platform secure storage (desktop). Agent tokens are first-class — issuing, revoking, and viewing them is a UI surface, not a config-file fix.

---

## Composer Integration: Squire

Squire is a JS library and integrates natively into the React shell with no wasm-bindgen bridge. Originally chosen by Fastmail because nothing else handled arbitrary forwarded-HTML round-tripping cleanly; the rest of the modern webmail world quietly converged on it for the same reason.

### Approach

```tsx
// composer/Composer.tsx (sketch)
import Squire from "squire-rte";

export function Composer({ initialHtml, onChange }: ComposerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Squire | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const editor = new Squire(ref.current, {
      blockTag: "DIV",
      sanitizeToDOMFragment: (html: string) =>
        // call into the WASM ammonia sanitizer here
        sanitizer.sanitize(html),
    });
    editor.setHTML(initialHtml ?? "");
    editor.addEventListener("input", () => onChange(editor.getHTML()));
    editorRef.current = editor;
    return () => editor.destroy();
  }, []);

  return <div ref={ref} className="composer-surface" />;
}
```

### Email-Specific Concerns

- **Paste handling.** Squire has a built-in `addEventListener("willPaste", ...)` hook for transforming pasted HTML — strip Word/Outlook noise here.
- **Quoted replies and signatures.** Wrap them in non-editable block elements (Squire respects `contenteditable="false"` regions). Users can quote-and-reply without accidentally destroying the quoted block.
- **HTML output.** Store as-is; don't lossy-convert to markdown.
- **Inline images.** Upload via JMAP Blob endpoints, reference as `cid:` in the HTML body. Image-resize component (Phase 5+) downsamples on the way in.
- **Sanitization on input.** Pasted HTML and forwarded mail content goes through the ammonia sanitizer before reaching Squire's DOM.

---

## File Storage via Git/GitHub

### Why Git, Not WebDAV / Dropbox / S3

- Versioning, branching, diffs, history — for free.
- Pull request workflow gives collaboration semantics without us building any.
- GitHub (or Gitea, GitLab, etc.) is a known quantity to most users.
- Self-hosting is a clean fallback (Gitea is a single binary).
- The data is portable: clone the repo, you have your files.
- **Cross-platform agent state sharing.** The user's tuatha agent harness already uses Git for file integration. Sharing the storage layer means an agent can edit a file in tuatha and Iarsma sees it without any transfer.
- **Tenant separation.** Files don't live on the webmail server. Users bring their own Git host; the webmail is purely a client.

### Two Tiers of Implementation

**Tier 1 (start here): GitHub API only.**

- No client-side git.
- All file ops are REST/GraphQL calls: list contents, get file, create/update file with commit message, list commits.
- Pros: trivial to ship, no WASM bundle bloat, no IndexedDB git object store.
- Cons: no offline, no branching/merge UI, every action is an HTTP round trip.

**Tier 2 (graduate to when needed): client-side git in WASM.**

- Compile `gitoxide` (`gix`) to WASM.
- Store git objects in OPFS or IndexedDB.
- Use GitHub as remote, but support arbitrary git remotes.
- Pros: offline, branching, real merge UI.
- Cons: large WASM bundle, more complex.

### Adapter Interface

A `FileBackend` contract defined as a WIT interface (component) and as a TypeScript interface (shell). Both impls satisfy it. The Files UI talks only to the contract.

### Auth

- **OAuth (GitHub Apps):** primary path. Requires a callback endpoint (a tiny Tauri-side handler for desktop, a serverless function for web).
- **PAT:** secondary fallback for users who can't or don't want to register an OAuth app.

---

## Memory Substrate

The agent-collaboration model has two halves: an action surface (what agents can *do* — covered above) and a perception surface (what agents can *understand*). The memory substrate is the perception half.

The principle that shapes this section: **the client owns a memory substrate; it does not own the inference.** The substrate stores structured user/mail context with capability-scoped access. Inference (semantic summarization, embedding-based search, persona derivation) happens at the agent platform — tuatha for Brent, someone else's harness for someone else. This keeps the substrate language-agnostic, agent-agnostic, and honest about what's stored vs. what's derived.

### Three layers

```
┌─────────────────────────────────────────────────────────────┐
│ Action Log (mandatory, immutable)                           │
│   what happened — SHA-384 hash-chained, OpenInference-      │
│   compatible. Already designed in Agent/Human Collaboration.│
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│ Memory Backend (mandatory contract, pluggable impl)         │
│                                                              │
│  Tier 1 default: structured-only browser-side store          │
│    - Annotations: tags/labels/notes on JMAP entities         │
│      (threads, messages, contacts, events) beyond JMAP       │
│      keywords. Mutable, contributor-attributed.              │
│    - Profile: user-edited structured profile                 │
│      (communication style, important contacts, working       │
│      hours, escalation contacts, signature templates).       │
│      Human-write by default; agents `memory:profile.propose` │
│      for changes that go through the approval queue.         │
│    - SQLite via OPFS (web) or Tauri filesystem (native).     │
│    - Zero external dependencies.                             │
│                                                              │
│  Tier 2 optional: co-deployed Open Brain                     │
│    - Independent service (Postgres + pgvector)               │
│    - Webmail does NOT proxy. Agents connect to OB1 directly. │
│    - Webmail advertises OB1 endpoint via discovery URN.      │
│                                                              │
│  Future impls: Mem0, Letta, custom — same shape.             │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│ Behavior Signals (opt-in, sensitive)                        │
│   how the user engages — coarse-grained, off by default,    │
│   each category opted in separately                         │
│   exposed only via `behavior:read`                          │
└─────────────────────────────────────────────────────────────┘
```

### Why the Memory Backend is co-deployed, not integrated

Open Brain ([github.com/NateBJones-Projects/OB1](https://github.com/NateBJones-Projects/OB1)) is a personal-memory infrastructure built by Nate B. Jones: PostgreSQL + pgvector, an MCP server, a recipes ecosystem for ingesting from various sources. Conceptually it's the right shape for the memory layer of an agent-first product. Practically, building the webmail to *contain* OB1 would couple us to a specific stack and fight the project's pluggability principle.

So the architecture is:
- The webmail's `MemoryBackend` trait describes the contract (annotations, profile, behavior signals — the structured stores).
- The Tier-1 default impl is browser-side and zero-infra. It works without OB1.
- The Tier-2 OB1 impl is an *operational* choice: deploy OB1 alongside the webmail (Docker Compose recipe shipped in the repo), or point the webmail at an existing OB1 instance via configuration.
- The webmail does not proxy through to OB1. The agent connects to both endpoints. The webmail advertises the OB1 URL through a JMAP capability URN extension so discovery is one-step.

### Discovery via JMAP capability URN

The webmail extends the JMAP session resource with a custom capability URN (working name: `urn:iarsma:agent-context`). Its value carries:

```json
{
  "webmailMcpUrl": "https://sw-mail.example.net/webmail/mcp",
  "actionLogUrl": "https://sw-mail.example.net/webmail/mcp/action-log",
  "memoryBackendUrl": "https://memory.r3motely.net/mcp"
}
```

Agents that understand the URN pick up all relevant endpoints in one discovery call. Agents that don't ignore it gracefully — they still get standard JMAP capabilities and the webmail's MCP is reachable through normal means.

### Vector search is the agent's responsibility

The webmail's MCP surface exposes structured queries only — `memory.annotations.list(filters)`, `memory.profile.get()`, `memory.thoughts.list(filters)` if Tier-2 is configured. There is no `memory.search.vector(query)` capability at the webmail boundary. Reasoning:

- Agent platforms (tuatha, others) have their own embedding pipelines with their own model choices. A webmail-level vector API would either lock everyone into one model or duplicate effort.
- Vector search via OB1 is still available — the agent connects to OB1's MCP directly using the URL the webmail advertised. OB1 exposes its own `search` tool there.
- The webmail stays a thin structured-context provider; the bundle has no embedding model and no inference compute path.

### How this composes with the action surface

Annotations, profile changes, and behavior-signal opt-ins all flow through the same propose/preview/approve/commit pattern as mail actions. An agent proposing a profile update produces a dry-run preview ("add `prefers-bullet-points` to communication-style"), which routes through the policy seam, lands in the approval queue if needed, and (on commit) writes an entry to the action log. One mechanism, multiple capability domains.

---

## Stalwart Upstream Alignment

Stalwart Labs is building a first-party webmail in Rust + Dioxus, targeted at 2026 (`stalwartlabs/stalwart#513`). This project sits adjacent, not in competition. The alignment plan is **deliberately low-touch**:

- **No proactive outreach.** This project is being developed independently. If it matures into something Stalwart Labs would want to be aware of, sharing it is a one-message later — not a Phase 0 commitment. We don't have a pre-existing relationship to leverage and they don't run a marketplace.
- **Share WASM components if/when convenient.** Our JMAP client, sanitizer, sieve helpers, and other reusable Rust→WASM components could in principle compile cleanly for both a Dioxus host (Stalwart) and a JS host (us). If sharing becomes valuable later, the integration boundary is the WASM component, not the shell.
- **File issues against Stalwart for legitimate JMAP edge cases.** Normal good-citizen behavior; not a special alignment effort.
- **Track Stalwart releases.** Pin a known-good Stalwart version per phase; don't chase main.

---

## Deployment Models

The webmail ships as a single static-site bundle (HTML, JS, CSS, WASM components, `config.json`). The bundle is deployment-target-agnostic: where it's served from is an operator choice, not an architectural constraint. Multiple deployment paths are supported as first-class options.

### Portability rules (non-negotiable)

Two simple rules keep the bundle portable across every deployment model below:

1. **No hardcoded server URLs in the bundle.** The JMAP endpoint, OIDC issuer, and any other server-side URLs come from a small `config.json` (or build-time env) loaded at startup. Default behavior is "same-origin" — point at `/jmap`, `/.well-known/jmap`, etc., on whatever host the bundle is served from. No domain name ever appears in the source.
2. **No reliance on host-injected runtimes.** The bundle treats the HTTP server as a dumb static-file server. No `window.stalwart`, no Caddy variables, no platform-specific runtime hooks. If the host happens to inject anything, the bundle ignores it.

With those rules, the same `iarsma.zip` artifact deploys identically to every option below.

### Default — Stalwart Web Application (recommended for solo / single-VM setups)

Stalwart has a built-in Web Applications feature (Settings → Web Applications) that downloads a static-site zip from a configured `Resource URL`, caches it, and serves it at one or more URL prefixes. We ship `iarsma.zip` to a GitHub Release; the operator points Stalwart at it and configures a URL prefix like `/webmail`.

**Pros**: single VM, same-origin automatically (no CORS, no proxy), update-frequency control built in, zero new infrastructure.
**Cons**: lifecycle bound to whatever host runs Stalwart. If Stalwart is down, the webmail is also down — but that's already true at the JMAP level, so it's not a real loss.
**Operator setup**: Web Applications → Create application → Resource URL = `https://github.com/<your-fork>/webmail/releases/latest/download/iarsma.zip`, URL Prefix = `/webmail`, Update Frequency = whatever fits the operator's release cadence.

This is the simplest path and the recommended default for personal/small-org deployments — including this project's own reference deployment.

### Alternative — Separate web server (Caddy / nginx / Apache)

For operators who want the webmail on a different host than Stalwart (different VM, different security zone, different scaling profile), the `iarsma.zip` is unpacked and served by any HTTPS-capable static-file server.

Setup outline:
- Webmail VM serves the static bundle at `https://webmail.example.com/`.
- Stalwart at `https://mail.example.com/` advertises CORS for the webmail origin.
- `config.json` points at the JMAP endpoint URL.
- OAuth callback URL is registered against the webmail origin.

Adds CORS configuration on Stalwart and OAuth client registration with explicit redirect URIs, but is otherwise identical from the user's perspective.

### Alternative — CDN / managed static hosting (Cloudflare Pages, Netlify, Vercel)

Same as the separate-web-server case, but the static bundle lives on a managed edge platform. Useful for public reference deployments or operators who already have CDN infrastructure. CORS and OAuth-redirect-URI considerations are the same.

### Alternative — Tauri 2 desktop and mobile apps

The Tauri 2 build wraps the same bundle in a native shell. The "static file server" is the Tauri runtime. The user configures the JMAP endpoint URL once at first launch (or via MDM/config profile in managed deployments). No web hosting is required at all — desktop and mobile apps work even if there's no public webmail URL anywhere.

### Alternative — Air-gapped / offline-bundled

For operators with no public internet egress, the bundle is unpacked next to whatever HTTP listener already exists. Stalwart's Web Application Resource URL accepts `file://` paths in addition to `https://`, which means an air-gapped operator can also drop the zip on the Stalwart VM directly without exposing GitHub Releases.

### What this means for the project

- Build target is **a single versioned `iarsma.zip`** published to GitHub Releases.
- `config.json` schema is documented and versioned. Operators edit it (or override via env vars at bundle-fetch time) to point the bundle at their JMAP/OIDC URLs.
- Documentation includes a quickstart for each of the four deployment paths.
- The reference deployment for `r3motely.net` uses the Stalwart Web Application path. Other paths are tested in CI but not the default for "spin up the project."

---

## Integrations vs Build (Decision Log)

| Capability             | Decision                  | Why                                                                            |
| ---------------------- | ------------------------- | ------------------------------------------------------------------------------ |
| Mail server            | **Integrate**             | Stalwart is excellent, free, Rust, JMAP-native.                                |
| Calendar/Contacts      | **Integrate**             | Stalwart already speaks JMAP for these.                                        |
| Outbound deliverability| **Integrate** (SendGrid)  | OCI free tier blocks PTR; SendGrid relays. Pluggable for any SMTP relay.       |
| File storage           | **Integrate** (Git/GitHub)| Versioning + collab + portability + tuatha state sharing.                      |
| Rich-text composer     | **Integrate** (Squire)    | Purpose-built for email, used by every modern webmail except Gmail/Outlook.    |
| HTML sanitizer         | **Integrate** (ammonia)   | Don't roll your own security-critical parser.                                  |
| Markdown               | **Integrate** (pulldown-cmark) | Standard.                                                                |
| Search                 | **Integrate** (when needed, tantivy) | Or just rely on JMAP server-side search forever.                    |
| Push notifications     | **Build** (thin)          | Service worker + JMAP push wrapper. Small surface.                             |
| Auth/session           | **Build** (thin)          | OAuth 2.1 + PKCE orchestration. Don't pull in heavyweight library.             |
| UI shell               | **Build** (TS+React+Tauri)| The product.                                                                   |
| JMAP client component  | **Build** (Rust→WASM)     | Layered on a JMAP-aware Rust crate where possible.                             |
| MCP server             | **Build** (TS, separate process) | The agent half of the symmetric capability surface.                     |
| Action log             | **Build** (Rust→WASM)     | Hash-chained integrity primitives are clean in Rust.                           |
| Policy engine seam     | **Build** (TS)            | Engine itself is pluggable (OPA, Cerbos, custom — deferred past v1).           |
| File adapter           | **Build**                 | Trait + GitHub impl + future gitoxide impl.                                    |

---

## Project Structure

A pnpm workspace at the top level for the TS code, with a Cargo workspace for the Rust→WASM components. A top-level `Justfile` orchestrates the cross-language build.

```
webmail/
├── package.json                  # pnpm workspace root
├── pnpm-workspace.yaml
├── Cargo.toml                    # cargo workspace (components only)
├── Justfile
├── README.md
├── docs/
│   ├── architecture.md
│   ├── agent-collaboration.md
│   └── decisions.md
│
├── shell/                        # React + Tauri 2 app
│   ├── package.json
│   ├── tauri.conf.json
│   ├── vite.config.ts
│   ├── index.html
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── layout/
│   │   │   ├── mail/
│   │   │   │   ├── MailboxList.tsx
│   │   │   │   ├── ThreadList.tsx
│   │   │   │   ├── ThreadView.tsx
│   │   │   │   ├── MessageView.tsx
│   │   │   │   └── Composer.tsx     # wraps Squire
│   │   │   ├── calendar/
│   │   │   ├── contacts/
│   │   │   ├── files/
│   │   │   ├── agent/
│   │   │   │   ├── ActionLog.tsx
│   │   │   │   ├── AgentDashboard.tsx
│   │   │   │   └── ApprovalQueue.tsx
│   │   │   ├── settings/
│   │   │   └── login/
│   │   ├── state/                  # Zustand/Jotai stores
│   │   ├── platform/               # adapter interfaces
│   │   ├── wasm/                   # jco-loaded component bindings
│   │   └── capabilities/           # contract definitions shared with mcp-server
│   └── src-tauri/                  # Tauri Rust glue
│
├── mcp-server/                   # MCP server (Node/TS)
│   ├── package.json
│   ├── src/
│   │   ├── index.ts
│   │   ├── tools/                  # generated from capability contracts
│   │   ├── policy.ts               # OPA seam
│   │   └── log.ts                  # action log writer
│   └── README.md
│
├── components/                   # WASM components (Rust)
│   ├── jmap-client/
│   │   ├── Cargo.toml
│   │   ├── wit/jmap.wit
│   │   └── src/lib.rs
│   ├── html-sanitizer/
│   │   ├── Cargo.toml
│   │   ├── wit/sanitizer.wit
│   │   └── src/lib.rs
│   ├── markdown/
│   │   ├── Cargo.toml
│   │   ├── wit/markdown.wit
│   │   └── src/lib.rs
│   ├── action-log/
│   │   ├── Cargo.toml
│   │   ├── wit/log.wit
│   │   └── src/lib.rs
│   ├── git-backend/
│   │   ├── Cargo.toml
│   │   ├── wit/git.wit
│   │   └── src/
│   │       ├── lib.rs
│   │       ├── github.rs           # tier 1
│   │       └── gitoxide.rs         # tier 2 (later)
│   ├── search/                     # phase 4+
│   └── image/                      # phase 5+
│
└── tools/
    └── codegen/                  # capability-contract → UI/MCP bindings generator
```

### Build Pipeline

- `pnpm dev` for the shell dev loop (web).
- `pnpm tauri dev` for desktop dev.
- `cargo build --target wasm32-wasip2 -p <component>` (and `jco transpile`) to produce JS-importable WASM components.
- `pnpm --filter mcp-server dev` for the MCP server.
- `just dev` boots all of the above in parallel against a local Stalwart.
- `just build` produces a release artifact: PWA (static site), Tauri desktop app per platform, MCP server bundle.

### Testing

- React components: Vitest + React Testing Library + axe-core for accessibility checks.
- WASM components: Rust `#[cfg(test)]` unit tests + a host-language integration suite that loads each component via `jco` and exercises its WIT surface.
- MCP server: contract tests against the capability-contract definitions; every tool tested at minimum for dry-run and commit paths.
- Integration: `tests/` directory with end-to-end flows against a test Stalwart instance running in Docker. Both human-driven (Playwright) and agent-driven (MCP client harness) flows.

---

## Accessibility

WCAG 2.1 Level AA is the design target, treated as a Phase 1 constraint. Concretely:

- **Semantic HTML by default.** `<nav>`, `<main>`, `<article>` for messages, `<button>` not clickable divs.
- **Keyboard model designed in.** Define j/k/c/r/s shortcuts and focus management when building `ThreadList` and `ThreadView`. Retrofitting is painful; we don't.
- **One ARIA live region** (polite, not assertive) for new-mail and agent-action announcements.
- **Color contrast ≥ 4.5:1 for body, ≥ 3:1 for UI controls** in both light and dark themes. Lock the palette with this constraint from day one.
- **Honor `prefers-reduced-motion`** for any animations.
- **Focus visibility never disabled.** No `outline: none` without a replacement.
- **Test with VoiceOver on macOS.** axe-core in CI for automated regression detection. pa11y as a release gate.

AAA is explicitly *not* the target — diminishing returns and some criteria conflict with reasonable design choices.

---

## Roadmap (Phased)

### Phase -1 — Stalwart Prep

Verified directly against the deployed Stalwart admin on 2026-04-26. Status reflects what was observed.

**Confirmed ready:**
- Stalwart deployed on OCI free tier, mail flowing, TLS valid at `sw-mail.r3motely.net`. ✅
- SendGrid outbound relay configured (`SendGrid587` route, port 587 via API). ✅ (One duplicate `SendGrid` route entry to clean up — cosmetic.)
- Test accounts exist: `brent@r3motely.net` and `admin@r3motely.net`. ✅
- JMAP service enabled (Network → Services → JMAP). ✅
- JMAP Push subscriptions configured with SSE delivery, throttle 1 s, max 15 subs/user. ✅
- JMAP WebSocket transport also available (optionality past v1). ✅
- OIDC Provider configured with ECDSA P-256 / SHA-256 JWT signing. ✅
- OAuth token lifetimes reasonable: 1 h access, 30 d refresh (4 d renew threshold), 15 min ID token. ✅
- Stalwart's Web Applications feature confirmed as static-bundle hosting only — no runtime injection, no coupling. ✅

**To do:**
- **Pre-register an OAuth client for the webmail.** Dynamic Client Registration is currently OFF on the OIDC Provider (both "Require client registration" and "Allow anonymous registration" disabled). Pre-register a stable `client_id` for the webmail with `token_endpoint_auth_method = "none"` and PKCE required. Find the canonical path (admin UI vs CLI vs config file).
- **Verify JMAP capabilities advertisement** with `curl -u '<your-email>:<password>' https://<your-mail-server>/.well-known/jmap | jq '.capabilities'`. Expect: `urn:ietf:params:jmap:core`, `urn:ietf:params:jmap:mail`, `urn:ietf:params:jmap:submission`, plus calendar/contacts/files draft URNs as available.
- **Pick a deployment model** (see Deployment Models above). Recommended default: register a Stalwart Web Application entry pointing at the GitHub Releases URL for `iarsma.zip` once the bundle exists. No separate VM, no Caddy, no CORS — strictly simpler than the original brief assumed.
- **Seed the test mailbox** with development messages: a few threads, a calendar invite, an inline-image attachment, a forwarded HTML message with quoted reply, a plain-text message. Used to exercise the inbox/composer/sanitizer in Phase 1–2.

**Not required (removed from earlier plan):**
- ~~Same-tenant private VLAN connection between webmail VM and Stalwart VM.~~ Replaced by Stalwart Web Application hosting (same-origin automatically).
- ~~Caddy proxy fronting both as same-origin.~~ Same as above.

### Phase 0 — Skeleton (week 1–2)

- pnpm + cargo workspaces scaffolded.
- React shell renders a static "Sign in" screen.
- JMAP client component exists with one method: `Session/get`. Built as a WASM component, loaded into the shell via jco.
- OAuth 2.1 + PKCE login flow against Stalwart, displays the account email.
- Action log component scaffolded; logs the login event.
- Capability contract format defined; one tool (`session.get`) flows through it end to end.
- **Done when:** the toolchain works, the auth path works, and adding a second capability is mechanical.

### Phase 1 — Inbox MVP (weeks 3–5)

- Mailbox list (sidebar) via `Mailbox/get`.
- Thread list for selected mailbox via `Email/query` + `Email/get`.
- Thread view: messages in order, sanitized HTML rendering via the sanitizer component.
- Read-only. No compose yet.
- Storage layer: cache the most recent N messages; cache mailbox tree.
- Keyboard model in place (j/k thread nav, focus management, screen reader landmarks).
- Action log records every read action when scope is `mail:read`-bound (initially the user themselves).

### Phase 2 — Compose, Send, MCP Read Surface (weeks 6–8)

- Composer component with Squire.
- New message, reply, reply-all, forward.
- Identity selector, attachments via JMAP Blob upload.
- Save draft, send, sent confirmation.
- MCP server scaffolded with read-only tools (`mail.list`, `mail.get`, `mail.search`).
- First end-to-end agent flow: an external MCP client lists messages and the action log records the calls.

### Phase 3 — MCP Write Surface, Dry-Run, Approval Queue (weeks 9–11)

- MCP write tools: `mail.send`, `mail.draft`, `mail.modify`, `mail.delete`. All implement `dry_run`.
- Policy seam wired through every destructive tool (no-op engine).
- Approval queue UI surface in the shell.
- Per-agent identity issuance and revocation UI.
- Push subscription via EventSource → in-app new-mail badge.

### Phase 4 — Calendar, Contacts, Agent UX Polish (weeks 12–14)

- Calendar view (month, week, day) via JMAP calendar extensions.
- Event create/edit/RSVP, both UI and MCP.
- Contacts view, autocomplete in composer.
- Agent dashboard: scopes, recent activity, kill switch.
- `text/calendar` extraction with structured RSVP UI.

### Phase 5 — Files (Tier 1 GitHub) (weeks 15–17)

- Files panel with tree from a configured GitHub repo.
- Read/edit/commit text files; binary files download.
- Commit history per file.
- OAuth flow for GitHub (with PAT fallback).
- MCP `files.*` tool surface.

### Phase 6 — Desktop & Mobile via Tauri 2 (weeks 18–22)

- Tauri 2 desktop build for macOS first, then Linux/Windows.
- Native notifications, system tray.
- Tauri 2 mobile build, starting iOS (TestFlight) then Android (Play Internal).
- Mobile push: PWA Web Push as best-effort; native APNS/FCM as Phase 7+ if a relay strategy emerges.

### Phase 7 — Polish, Themes, Performance, OPA Default Bundle (ongoing)

- Virtualized lists, suspense for slow loads, preload-on-hover.
- Light/dark/auto themes; user-customizable accent.
- i18n framework (don't translate everything yet, but make it possible).
- Default OPA policy bundle for common stances.
- WCAG 2.1 AA audit and remediation pass.

### Phase ∞ — Future Considerations (don't build yet)

- Tier-2 git backend (in-browser gitoxide).
- PGP/S-MIME encryption.
- Real-time collab editing on Files (Yjs).
- Sieve filter editor with agent-assisted authoring.
- Multi-account support (multiple Stalwart instances or other JMAP servers).
- Native APNS/FCM push (likely requires a relay service).
- Computer-use surface for agents that *do* need a visual UI (deliberately out of scope for v1; MCP is the agent path).

---

## Open Questions

Resolved from the previous brief: shell language (TS+React+Tauri), composer (Squire), license (MIT OR Apache-2.0), CORS (same-origin via Caddy on same OCI tenant), Firecracker (dropped as pillar). New and remaining:

1. **JMAP push at scale.** EventSource is the v1 transport. Web Push (with VAPID) is needed for closed-tab notifications. When does it land?
2. **Mobile push for self-hosted users.** Industry-wide unsolved without enterprise certs. Investigate whether a small relay service is acceptable.
3. **Default OPA policy bundle shape.** What stances does v1 ship as a starting library? "Agents may never delete," "agents may not send to external recipients," "no calendar changes within 30 minutes of a meeting"?
4. **Action log retention.** Forever? Configurable? What happens at scale (hundreds of agent actions per day)?
5. **Capability contract format.** Hand-authored TypeScript types? WIT? A custom DSL? Whatever it is, the codegen has to produce both UI hooks and MCP tool definitions from it.
6. **Stalwart's OAuth coverage.** Does Stalwart's current OAuth 2.1 implementation cover everything we need for agent token scope subsets? File a tracking issue if not.
7. **WASM bundle size budget.** 2 MB compressed for the deployed composed application. Measure regularly; don't drift.
8. **OpenInference adoption.** Is the format mature enough to commit to in v1, or do we ship our own log schema and migrate later?

---

## Decisions Log

Decisions made deliberately, with rationale.

| # | Decision                                              | Rationale                                                                                                                |
|---|-------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------|
| 1 | TS + React + Tauri 2 shell, not Rust + Dioxus         | JS is the native host for browser-side WASM components. Mature mobile via Tauri 2. Massive AI training corpus. Polyglot principle: don't lock the shell into Rust. |
| 2 | JMAP-only, no IMAP fallback                           | Force protocol benefits. Stalwart is JMAP-first. No legacy weight.                                                       |
| 3 | Squire for composer (not TipTap)                      | Purpose-built for email's arbitrary-HTML round-trip. MIT, used by Fastmail/Proton/Tutanota/Superhuman. Dodges TipTap's commercial-AI-upgrade tier (which belongs behind MCP anyway). |
| 4 | Git/GitHub for files                                  | Versioning + collab + portability + state-sharing with the tuatha agent harness.                                         |
| 5 | Stalwart for mail server                              | Excellent existing project. Position as adjacent, contribute upstream rather than fork.                                  |
| 6 | SendGrid for outbound                                 | OCI free-tier PTR constraint. Pluggable — any SMTP relay works.                                                          |
| 7 | WASM Component Model where mature, plain modules where not | Prefer Component Model; ship even if browser composition is occasionally rough.                                     |
| 8 | Phased roadmap; daily-driver each phase to self      | No big-bang releases.                                                                                                    |
| 9 | One language per component, not within                | Polyglot is the strength; mixing within a component is the trap.                                                         |
| 10| MIT OR Apache-2.0 dual license                        | Rust ecosystem standard. Patent grant from Apache, frictionless adoption from MIT.                                       |
| 11| Agent/human collaboration as foundational identity    | Not a feature on top of a mail client. Symmetric capability surface, propose-preview-approve-commit, tamper-evident audit, capability scoping, policy seam. |
| 12| Firecracker as deployment, not architecture           | WASM component model already provides confinement. Agents talk MCP, not pixels.                                          |
| 13| WCAG 2.1 AA from Phase 1                              | Cheaper to build in than retrofit. AAA is not the target.                                                                |
| 14| MCP server as separate process, sibling to shell      | Both consume the same WASM components. Symmetric surface.                                                                |
| 15| Tamper-evident hash-chained action log, OpenInference-compatible | Append-only is not enough; integrity matters for trust.                                                       |
| 16| OAuth 2.1 + PKCE for both human and agent auth        | One auth model, no API keys, ephemeral per-task tokens for agents.                                                       |
| 17| Policy engine seam at dry-run boundary                | Even with no engine in v1. Adding the seam later means refactoring every destructive tool — too expensive.               |

---

## How to Vibe-Code This (Notes for AI-Assisted Development)

1. **Capability contracts are the spec.** When defining a new capability, write the typed contract first. The AI generates the React hook, the MCP tool, the library API, and the tests from it. Review the generated code.
2. **One component per session.** When working on the JMAP client, the AI doesn't need shell context. When working on the composer, it doesn't need the file backend. The crate/package boundary is the context boundary.
3. **Tests-first for pure components.** Sanitizer, markdown, JMAP serialization, action log integrity — these have clear inputs and outputs. AI writes tests, then the impl, then run.
4. **Snapshots for UI.** Component visual regressions caught by storing render snapshots. The AI can update snapshots when changes are intentional.
5. **Don't let the AI design new architecture without buy-in.** New dependency, new component, new platform target — that's a human decision. The AI implements clearly within the architecture.
6. **The decisions log is sacred.** Every architectural choice goes there with rationale. The AI consults it before suggesting alternatives.
7. **Commit small.** One feature per commit, one PR per feature. AI-generated diffs that touch 30 files in 10 directions are unreviewable.
8. **Treat the AI as one of the agents you're building for.** Use the project's own MCP surface (once it exists) for the AI's interactions with mail/calendar in development. Eat the dogfood.

---

## References

### Stalwart

- [Stalwart Mail Server](https://stalw.art/)
- [Stalwart on GitHub](https://github.com/stalwartlabs/stalwart)
- [Stalwart Webmail Roadmap](https://stalw.art/blog/roadmap/)
- [Stalwart Dioxus posts](https://stalw.art/blog/tags/dioxus/)
- [Stalwart issue #513 — Webmail client](https://github.com/stalwartlabs/stalwart/issues/513)

### Existing JMAP Webmail (for reference / inspiration / non-overlap)

- [Bulwark](https://bulwarkmail.org) · [GitHub](https://github.com/bulwarkmail/webmail) (AGPL, Stalwart-targeted, study-don't-borrow)
- [root-fr/jmap-webmail](https://github.com/root-fr/jmap-webmail) (MIT)
- [TMail / linagora/tmail-flutter](https://github.com/linagora/tmail-flutter) (AGPL, Flutter, production-hardened)
- [jmapio/jmap-demo-webmail](https://github.com/jmapio/jmap-demo-webmail) (Fastmail reference; multi-level undo is the gem)

### JMAP Spec

- [RFC 8620 — JMAP Core](https://datatracker.ietf.org/doc/html/rfc8620)
- [RFC 8621 — JMAP for Mail](https://datatracker.ietf.org/doc/html/rfc8621)
- [RFC 8887 — JMAP over WebSocket](https://datatracker.ietf.org/doc/html/rfc8887)
- [JMAP for Calendars (draft)](https://datatracker.ietf.org/doc/draft-ietf-jmap-calendars/)
- [JMAP for Contacts (draft)](https://datatracker.ietf.org/doc/draft-ietf-jmap-contacts/)
- [Email Snooze (draft)](https://www.ietf.org/archive/id/draft-ietf-extra-email-snooze-00.html)
- [OAuth profile for open public clients (JMAP/IMAP/SMTP/CalDAV)](https://datatracker.ietf.org/doc/html/draft-jenkins-oauth-public-01)

### Shell Stack

- [React](https://react.dev/)
- [Vite](https://vitejs.dev/)
- [Tauri 2](https://v2.tauri.app/)
- [shadcn/ui](https://ui.shadcn.com/)
- [Tailwind CSS](https://tailwindcss.com/)
- [Zustand](https://zustand-demo.pmnd.rs/) / [Jotai](https://jotai.org/)

### WASM Component Model

- [Component Model Documentation](https://component-model.bytecodealliance.org/)
- [jco (JS Component Tools)](https://github.com/bytecodealliance/jco)
- [wit-bindgen](https://github.com/bytecodealliance/wit-bindgen)
- [WASI 2.0](https://github.com/WebAssembly/WASI)

### Composer

- [Squire (Fastmail)](https://github.com/fastmail/Squire)
- [Squire 2.0 announcement](https://www.fastmail.com/blog/squire-2-0-fastmail/)

### Sanitization, Markdown, Search, Git

- [ammonia](https://github.com/rust-ammonia/ammonia)
- [pulldown-cmark](https://github.com/pulldown-cmark/pulldown-cmark)
- [tantivy](https://github.com/quickwit-oss/tantivy)
- [gitoxide](https://github.com/Byron/gitoxide)
- [octocrab (Rust GitHub client)](https://github.com/XAMPPRocky/octocrab)

### Agent Patterns

- [Model Context Protocol](https://modelcontextprotocol.io/)
- [OAuth for MCP — emerging patterns](https://blog.gitguardian.com/oauth-for-mcp-emerging-enterprise-patterns-for-agent-authorization/)
- [MCP audit logging](https://tetrate.io/learn/ai/mcp/mcp-audit-logging)
- [OpenInference](https://github.com/Arize-ai/openinference)
- [Open Policy Agent (OPA)](https://www.openpolicyagent.org/)
- [Cerbos](https://www.cerbos.dev/)
