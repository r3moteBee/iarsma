# Iarsma — Capability Scopes (v0)

The agent capability scope vocabulary. Every capability contract declares which scope(s) it requires; an agent token's scope set determines which tools it sees.

> Scopes are additive. An agent with `mail:read` does not implicitly get `mail:read.metadata` (or vice versa) — both must be declared explicitly. This avoids confusing implication trees.

## Session

| Scope | Description |
|---|---|
| `session:read` | Read the authenticated session resource (account email, JMAP endpoint URLs, primary account ID, server state token). Required to bootstrap any Iarsma client; foundational for every other capability. Non-destructive. |

The `session.get` capability declares this scope. Any agent token without `session:read` cannot resolve where the JMAP endpoints are, and so cannot exercise any other capability — clients are expected to grant it by default.

## Mail

| Scope | Description |
|---|---|
| `mail:read` | Read full message content including bodies and attachments. |
| `mail:read.metadata` | Read headers, threading, flags only. No bodies, no attachments. |
| `mail:draft` | Create and edit drafts. Does not send. |
| `mail:send` | Send mail (always routes through dry-run + policy seam). |
| `mail:modify` | Move, label, mark read/unread. Non-destructive mutations. |
| `mail:delete` | Move to Trash and/or permanently delete. Always routes through approval queue by default. |
| `mail:mailbox` | Create, rename, and delete mail folders (JMAP Mailbox/set). Required for folder-management capabilities: mailbox.create, mailbox.update, mailbox.delete. |

## Calendar

| Scope | Description |
|---|---|
| `calendar:read` | Read calendars and events. |
| `calendar:write` | Create / update events. Through dry-run. |
| `calendar:rsvp` | Respond to invitations on the user's behalf. |

## Contacts

| Scope | Description |
|---|---|
| `contacts:read` | Read contacts and address books. |
| `contacts:write` | Create / update contacts. Through dry-run. |

## Files

| Scope | Description |
|---|---|
| `files:read` | Read configured Git-backed files. |
| `files:write` | Propose changes (defaults to require_approval). |
| `files:delete` | Delete files. Always require_approval by default. |

## Memory

| Scope | Description |
|---|---|
| `memory:annotations.read` | Read annotations on JMAP entities (threads, messages, contacts, events). |
| `memory:annotations.write` | Add or modify annotations. |
| `memory:profile.read` | Read the user's structured profile (communication style, important contacts, etc.). |
| `memory:profile.propose` | Propose updates to the profile. Writes always go through the approval queue. |

> **Note:** `memory:thoughts.*` and `memory:search.*` scopes are *not* part of Iarsma's vocabulary. Free-text and vector search live with the configured Memory Backend (e.g., Open Brain) and use that system's scope vocabulary directly. Discovery via the `urn:iarsma:agent-context` URN tells agents where to find it.

## Behavior signals (opt-in, sensitive)

| Scope | Description |
|---|---|
| `behavior:read` | Read coarse-grained engagement signals (read-receipts, time-on-thread, reply-latency distributions). Each signal category is opted in by the user separately. Default: all OFF. |

There is no `behavior:write` scope. Signals are recorded by the client based on user actions; they are not agent-writable.

## Audit / Action Log

| Scope | Description |
|---|---|
| `agent-log:read.own` | An agent reads its own log entries. |
| `agent-log:read.all` | Read the full action log across all identities. Sensitive — typically human-only. |

There is no `agent-log:write` scope. Log entries are produced by the system as a consequence of other actions, never directly written by callers.

## Policy

| Scope | Description |
|---|---|
| `policy:propose` | Suggest policy changes (additions, modifications). Never executes them — humans review and apply. |

There is no `policy:write`. Policy is human-administered.

## Admin

| Scope | Description |
|---|---|
| `admin:*` | Reserved for human use by convention. Issuing this to an agent is a deliberate, audit-logged choice. |

---

## Conventions

- **Dot syntax (`.`)** indicates a refinement, not a sub-permission. `mail:read.metadata` is a *narrower* version of `mail:read`, not a child of it. They're independent scopes.
- **Wildcards (`*`)** are reserved for `admin:*` only. Avoid them elsewhere — they make audit logs ambiguous.
- **Per-tool scope declaration.** Every capability contract declares its required scope set. The MCP server filters the visible tool list by the agent's scope set; out-of-scope tool calls return a structured error and log a denial.
- **Default-deny.** A capability with no declared scope is unreachable from MCP. The contract author must opt in explicitly.

## Versioning

This is v0. New scopes append; existing scope names never change meaning. If a scope's semantics need to change, deprecate the old name (keep it functional for existing tokens) and introduce a new one.
