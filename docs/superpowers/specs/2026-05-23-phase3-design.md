# Phase 3 Design: MCP Write Surface, Dry-Run, Approval Queue

**Date:** 2026-05-23
**Status:** Approved
**Prereqs:** Phase 2 complete (v0.4.1 deployed)

## Overview

Phase 3 turns Iarsma from an agent-readable webmail into an agent-writable one. Agents can send mail, modify messages, and delete — all gated by scoped tokens, dry-run previews, and a human approval queue. Push subscriptions replace polling, and a full action-log UI surfaces the tamper-evident audit trail.

Thirteen work items ship across three release cuts:

| Cut | Version | Subsystems | Items |
|-----|---------|-----------|-------|
| 3a  | v0.5.0  | MCP write tools, per-agent identity, scope enforcement, policy seam | 1, 2, 3, 4, 13 |
| 3b  | v0.6.0  | Approval queue (storage + UI + notification), policy engine wired | 5, 6, 7 |
| 3c  | v0.7.0  | Push subscriptions, new-mail badge, action-log attribution, Activity UI, OpenInference decision | 8, 9, 10, 11, 12 |

The policy seam ships in 3a returning `allow` always, designed so 3b wires the approval queue without refactoring.

---

## Cut 3a: MCP Write Tools + Agent Identity (v0.5.0)

### Item 1 — MCP Write Tools

`mail.send` and `mail.draft` already exist in the shell invoker (Phase 2). This item wires them through the MCP server and adds two new capabilities.

**New capabilities:**

`mail.modify` — move between mailboxes, toggle keywords (`$seen`, `$flagged`, custom labels), batch by email IDs. Maps to JMAP `Email/set` update.

- Input: `{ emailIds: string[], patch: { mailboxIds?: Record<string, boolean>, keywords?: Record<string, boolean> } }`
- Preview: `{ affectedCount: number, changes: Array<{ emailId: string, before: Record<string, unknown>, after: Record<string, unknown> }> }`

`mail.delete` — destroy emails by ID. Maps to JMAP `Email/set` destroy. Policy enforces two-step: email must be in Trash before destroy. Direct destroy from Inbox is a policy denial.

- Input: `{ emailIds: string[] }`
- Preview: `{ affectedCount: number, emails: Array<{ id: string, subject: string, from: string }> }`

**Dry-run:** All four write tools implement dry-run. MCP handler checks `x-iarsma-dry-run: true` header (already wired in Phase 2). Commit requires `x-iarsma-preview-hash` header binding the approved preview.

**Registration:** Both new tools are added to `DESTRUCTIVE_TOOLS` and `AFFECTED_JSON_BUILDERS` in `provenance-policy.ts`.

**MCP handler pattern:** Each write tool gets a handler in `mcp-server/src/handlers/` following the existing `mail-draft.ts` pattern: extract identity, validate scopes, run policy seam, branch on dry-run vs. commit.

### Items 2–3 — Per-Agent Identity (Issuance + Revocation)

**`AgentTokenIssuer` interface (pluggable):**

```typescript
interface AgentTokenIssuer {
  issueToken(opts: {
    name: string;
    scopes: readonly string[];
    lifetimeSec: number;
  }): Promise<{
    tokenId: string;
    clientId: string;
    clientSecret: string;
    expiresAt: string;
  }>;
  revokeToken(tokenId: string): Promise<void>;
  listTokens(): Promise<ReadonlyArray<{
    tokenId: string;
    name: string;
    scopes: readonly string[];
    issuedAt: string;
    expiresAt: string;
    revoked: boolean;
  }>>;
  introspectToken(bearerToken: string): Promise<{
    active: boolean;
    agentId: string;
    name: string;
    scopes: readonly string[];
  } | null>;
}
```

**Stalwart implementation (default):** Uses OIDC discovery (`/.well-known/openid-configuration`) to find the token endpoint. Issues via OAuth2 `client_credentials` grant with scope parameters. Revocation hits RFC 7009 endpoint. Introspection hits RFC 7662 endpoint. All endpoints are discovered, not hardcoded — any OIDC-compliant server works.

**Pluggability:** A different mail server provides a different `AgentTokenIssuer` implementation. Iarsma's contract is the interface, not Stalwart-specific APIs.

**Iarsma metadata store:** IDB database `iarsma-agents` (version 1, single object store `tokens`) mapping `tokenId` to:

```typescript
{
  tokenId: string;
  name: string;
  scopes: readonly string[];
  issuedAt: string;
  expiresAt: string;
  revoked: boolean;
  issuanceLogEntryHash: string; // links to action-log entry
}
```

The metadata store is the UI-facing data. The actual bearer token lifecycle is delegated to the OAuth server.

**UI:** New Settings panel (accessible from the header user section) with an "Agents" tab:

- "Issue new token" form: name (text), scopes (checkboxes), lifetime (dropdown: 1 hour, 1 day, 7 days, 30 days, 90 days).
- Table of active/revoked tokens: name, scopes, issued date, expiry, status, "Revoke" button.
- Each issuance and revocation writes an action-log entry.

**Scope vocabulary (v1):**

| Scope | Grants |
|-------|--------|
| `mail:read` | session.get, mailbox.list, thread.list, thread.get, thread.search, identity.list |
| `mail:draft` | mail.draft |
| `mail:send` | mail.send |
| `mail:modify` | mail.modify |
| `mail:delete` | mail.delete |
| `mail:search` | thread.search (also requires mail:read) |

### Item 4 — Policy Seam

**Interface:**

```typescript
interface PolicyEngine {
  evaluate(ctx: {
    toolName: string;
    callerIdentity: AgentIdentity;
    dryRunPreview: DryRunPreview<unknown>;
  }): Promise<PolicyDecision>;
}

type PolicyDecision = {
  decision: 'allow' | 'deny' | 'require_approval';
  reason?: string;
};
```

**v1 engine (ships in 3a):** Returns `allow` for all calls where the agent's scopes include the tool's required scope. Returns `deny` with reason if scope is missing. Never returns `require_approval` — that activates in 3b.

**Plug position:** Called by the MCP handler after dry-run, before commit. The shell UI path (loggingInvoker) does not go through the policy engine — it's user-initiated, inherently approved.

### Item 13 — Scope Enforcement in MCP Server

**Tool-list filtering:** On MCP `tools/list` request, filter the returned tool set to only tools the agent's scopes permit. An agent with `mail:read` sees 6 tools; one with `mail:read, mail:send` sees 7.

**Call-time enforcement:** On `tools/call`, verify the agent's scopes include the tool's required scope before executing. Out-of-scope calls return:

```json
{
  "code": "scope_denied",
  "message": "Tool 'mail.send' requires scope 'mail:send' which is not granted to this agent.",
  "requiredScope": "mail:send",
  "grantedScopes": ["mail:read", "mail:draft"]
}
```

Every denial is logged in the action-log with `callerClass: 'agent'` and `mode: undefined` (the call never reached dry-run).

**Tool-to-scope mapping:** Defined in a `TOOL_SCOPES` constant in the MCP server, co-located with the handler registry.

---

## Cut 3b: Approval Queue (v0.6.0)

### Item 5 — Approval Queue Storage

**JMAP mailbox approach:** A dedicated mailbox with role `approvals` (custom role). Created on first use via `Mailbox/set` if absent.

Each pending approval is a JMAP email in this mailbox:

- **From:** Agent identity name (e.g., `drafting-agent@agents.iarsma`)
- **Subject:** `[approval] <toolName> — <summary>` (e.g., `[approval] mail.send — 3 recipients`)
- **Body:** `text/plain` part containing canonical JSON:

```json
{
  "schemaVersion": 1,
  "toolName": "mail.send",
  "requestingAgentId": "agent-xyz",
  "requestingAgentName": "Drafting Agent",
  "params": {},
  "preview": {},
  "previewHashHex": "abc123...",
  "requestedAt": "2026-05-23T21:00:00Z"
}
```

**Status via keywords:**

| Keyword | Meaning |
|---------|---------|
| `$approval_pending` | Awaiting human decision |
| `$approval_approved` | Approved and committed |
| `$approval_denied` | Denied by human |

Status transitions are keyword toggles via `Email/set` update. The original params and preview are never mutated.

**Modify-and-approve flow:** User edits params in the approval UI. New dry-run with modified params produces a new preview + new previewHashHex. Commit uses the modified preview. The approval email gets a second body part (`text/plain`, `Content-Disposition: attachment; filename="modification.json"`) with the modified params + preview for audit trail.

**Retention:** Resolved approvals stay in the mailbox for 30 days, then auto-archive to a `resolved-approvals` mailbox (created on first archive). Configurable via `config.json`. No auto-delete — audit trail preservation.

**Race condition mitigation:** When the user clicks "Approve," the commit path re-runs dry-run with the original params against current JMAP state. If the new preview differs materially from the stored one (state has changed), the UI shows a diff and asks for re-approval. Never blind-commit a stale preview.

### Item 6 — Approval Queue UI

**Navigation:** "Approvals" tab in the header bar, between the search input and the Compose button. Badge shows pending count (from `$approval_pending` keyword query).

**Layout:** Single-column list of pending approvals, most recent first. Each card:

- Agent name + icon
- Tool name + summary (e.g., "mail.send to alice@example.com, bob@example.com — 2 attachments")
- Requested timestamp (relative)
- Expandable dry-run preview (structured, rendered readably — not raw JSON)
- Three actions: **Approve**, **Deny**, **Modify & Approve**

**Approve flow:**
1. Re-run dry-run with original params.
2. If preview matches stored → commit → set `$approval_approved` → action-log entry with `callerClass: 'ui'`, provenance binding both the agent's request and the user's approval.
3. If preview differs → show diff → require re-approval.

**Deny flow:** Set `$approval_denied` → action-log entry → agent receives structured denial on next poll/push.

**Modify & Approve:** Opens pre-filled editor with agent's params → user edits → new dry-run → new preview for confirmation → commit. Both original and modified previews stored.

**Filtering:** Tab bar: Pending | Approved | Denied | All. Text search by agent name or tool name.

### Item 7 — Approval Notification Path

**Agent side:** When the policy engine returns `require_approval`, the MCP response is:

```json
{
  "status": "pending_approval",
  "approvalId": "<email-id-in-approvals-mailbox>",
  "message": "This action requires human approval.",
  "pollUrl": "/approvals/{approvalId}/status"
}
```

The agent can poll `pollUrl` or subscribe to push events. Agents do not need to hold connections open — the approval is stored server-side. When approved, the poll response includes the committed result. When denied, it includes the reason.

**User side:**
- Badge count on the Approvals tab. Updated via JMAP push in 3c; polling (30s interval) in 3b until push lands.
- Optional browser `Notification` API — fires when a new `$approval_pending` email lands. Off by default, opt-in in Settings.

---

## Cut 3c: Push, Action-Log UI, OpenInference (v0.7.0)

### Item 8 — Push Subscriptions (EventSource)

**JMAP EventSource flow (RFC 8620 §7.3):**

1. On `SignedInView` mount, register a push subscription via `PushSubscription/set` with `types: ["StateChange"]`.
2. Open `EventSource` connection to the push URL from the session resource.
3. On `StateChange` events, extract the changed type and new state token.
4. Map state changes to cache-atom invalidations.

**State-to-cache mapping:**

| JMAP state change | Cache invalidation |
|---|---|
| `Email` | `threads`, `threadBodies`, `searchResults` |
| `Mailbox` | `mailboxes` |
| `EmailSubmission` | none (fire-and-forget) |
| `Identity` | `identities` |

**Reconnection:** `EventSource` auto-reconnects (browser API built-in). On reconnect, issue `Email/changes` + `Mailbox/changes` with last known state tokens to catch missed events. Apply deltas to cache.

**Lifecycle:**
- Close on sign-out (same handler that clears tokens + cache).
- Close after 5 minutes of tab `hidden` visibility (save server resources).
- Reopen + catch-up on `visible`.

**Module:** `shell/src/runtime/push-subscription.ts` — React hook `usePushSubscription(session)` managing EventSource lifecycle and dispatching cache invalidations via Jotai atom resets.

### Item 9 — New-Mail Badge

**Push-driven updates:** When the push handler sees a `Mailbox` state change and the Inbox mailbox's `unreadEmails` count has increased:

1. **Sidebar badge:** MailboxList already renders unread counts — cache invalidation from push triggers a SWR refetch that updates the count naturally.
2. **Live region:** `aria-live="polite"` region announces "New message from `<sender>`". Requires a lightweight `Email/get` for the new email ID to extract sender.
3. **Browser notification (opt-in):** If the user has granted `Notification` permission (prompted from Settings, never auto-prompted), fire a native notification with sender + subject. Click navigates to the thread.
4. **Tab title:** Update `document.title` to `(N) Iarsma` when unread count > 0. Reset when user views Inbox.

### Item 10 — Action-Log Agent Attribution

Every action-log entry already carries `identity` and `callerClass`. Phase 3 enrichment:

- MCP entries carry the agent's `name` and `scopes` from token introspection (not just opaque ID).
- New field `agentTokenId` links the entry to the specific token in `iarsma-agents`, enabling "show all actions by this token" queries and revocation cascade visibility.
- `callerClass` vocabulary gains `'agent'` distinct from `'mcp'`: `agent` means identified agent with scoped credentials; `mcp` means unauthenticated MCP call (dev mode).

### Item 11 — Action-Log UI (Activity View)

**Navigation:** "Activity" tab in the header, after "Approvals." No badge — passive audit view.

**Layout:** Full-width table, paginated (50 entries per page).

| Timestamp | Actor | Action | Mode | Details |
|---|---|---|---|---|
| 2 min ago | Drafting Agent | mail.send | commit | 3 recipients, 1 attachment |
| 5 min ago | You (UI) | mailbox.list | — | {} |

**Filters (top bar):**
- Actor: dropdown (You / specific agent names / All)
- Action: multi-select tool names
- Mode: preview / commit / all
- Time range: last hour / today / last 7 days / custom

**Expandable row:** Full `params` JSON, `provenance` (affectedJson, previewHashHex), raw hash-chain fields (prevHashHex, hashHex).

**Integrity verification strategy:**
- First load ever: full chain verification. Cache checkpoint (last verified hash + entry count) in IDB.
- Subsequent loads: delta verification (entries since checkpoint only).
- Once per 24 hours: full chain re-verification, update checkpoint.
- On failure: red banner "Integrity violation detected at entry #N" with inspect link.
- Manual "Verify full chain" button always available.

### Item 12 — OpenInference Decision

**Decision: Keep custom schema, add OI export layer.**

The current action-log schema and OpenInference solve different problems. Ours is "prove what happened" (audit/integrity with hash chain + cryptographic provenance). OI is "understand what happened" (observability/debugging with span hierarchies + latency tracking). They are complementary.

**Deliverables:**
1. Decision document mapping our entry fields to OpenInference span attributes.
2. Thin `exportToOpenInference(entries)` utility that transforms action-log entries into OI-compatible spans with extensions (hash chain, provenance) in custom attributes.
3. No schema migration. The exporter is a utility, not a runtime dependency.

---

## New Runtime Components Summary

| Component | Location | Purpose |
|---|---|---|
| `AgentTokenIssuer` | `shell/src/runtime/agent-token-issuer.ts` | Pluggable token issuance/revocation/introspection |
| `StalwartTokenIssuer` | `shell/src/runtime/stalwart-token-issuer.ts` | Default implementation via OIDC discovery |
| `PolicyEngine` | `shell/src/runtime/policy-engine.ts` | Evaluate tool calls → allow/deny/require_approval |
| `ApprovalStore` | `shell/src/runtime/approval-store.ts` | JMAP-mailbox-backed approval queue CRUD |
| `usePushSubscription` | `shell/src/runtime/push-subscription.ts` | EventSource lifecycle + cache invalidation |
| `ActivityView` | `shell/src/views/activity-view.tsx` | Action-log query UI with integrity verification |
| `ApprovalsView` | `shell/src/views/approvals-view.tsx` | Approval queue UI with approve/deny/modify |
| `AgentSettingsView` | `shell/src/views/agent-settings-view.tsx` | Token issuance/revocation management |
| `OI exporter` | `shell/src/runtime/openinference-export.ts` | Action-log → OpenInference span mapper |

## New MCP Handlers

| Handler | Tool | Scope required |
|---|---|---|
| `mail-send.ts` | mail.send | mail:send |
| `mail-modify.ts` | mail.modify | mail:modify |
| `mail-delete.ts` | mail.delete | mail:delete |

(`mail.draft` handler already exists from Phase 2.)

## Risks

**Approval queue race conditions.** Agent submits, user waits, JMAP state changes. Mitigation: re-run dry-run on approve; if preview differs, show diff and require re-approval.

**Token revocation latency.** Access tokens are short-lived but not zero-lived. Document the revocation window (less than or equal to access-token TTL). Instant revocation requires the token introspection endpoint to reflect revocation immediately.

**Push subscription resilience.** EventSource drops; client must reconnect with last state token and catch up via `Email/changes` + `Mailbox/changes`. Idle-tab optimization (close after 5 min hidden) prevents resource waste.

**Hash-chain verification cost.** Full chain is O(n). Mitigated by cached checkpoints + delta verification on most loads + daily full re-verification.

**IDB upgrade blocking (repeat of v0.4.0 bug).** All new IDB databases (`iarsma-agents`) must include `onblocked` + `onversionchange` handlers from the start.
