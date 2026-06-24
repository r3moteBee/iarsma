# Iarsma — Agent Collaboration Guide

Reference for agent authors integrating with Iarsma. The [project brief](project-brief.md) "Agent/Human Collaboration Model" section is the authoritative design; this document is the operator/integrator-facing how-to.

## Status

Phase 0 scaffold. Sections grow in:

- **Phase 0:** discovery via `urn:iarsma:agent-context`, OAuth 2.1 + PKCE for agent identities, capability scope vocabulary (see [`capability-scopes.md`](capability-scopes.md)).
- **Phase 2:** registering an agent identity, the read-tool surface, the first agent flow (list mail, read a thread).
- **Phase 3:** the propose-preview-approve-commit pattern, dry-run conventions, approval queue UX, per-agent token revocation, action log query patterns.
- **Phase 4–5:** memory backend integration, OB1 discovery and direct connection, annotation/profile tool patterns.

For now, the brief covers the design.

## Labels

Labels are colored tags on messages. Agents work with five `label.*` tools.

### The keyword join

A message's `keywords` array carries label keys directly. The **JMAP keyword stored on each tagged message is the label's `key`** — a stable, human-readable slug like `work` or `read_later`. To resolve a key to its display name and color, call `label.list`.

```
message.keywords = ["$seen", "work", "urgent"]
                          ↑         ↑
                     label keys — pass to label.list to resolve
```

### The five label tools

| Tool | Scope | Purpose |
|---|---|---|
| `label.list` | `mail:label:read` | List all label definitions. Returns `[{ key, name, color, order }]`. Call this to resolve keys from message keywords. |
| `label.create` | `mail:label:write` | Create a new label. Pass a `name` and optional `color`. Returns the stable `key`. |
| `label.update` | `mail:label:write` | Rename, recolor, or reorder a label. Rename rewrites only the registry — no messages are touched. |
| `label.delete` | `mail:label:write` | Remove a label from all messages, then destroy the definition. Dry-run first to see `affectedCount`. |
| `label.apply` | `mail:label:read` + `mail:modify` | Add or remove labels on a set of messages. Accepts names **or** keys in the `add`/`remove` arrays. Dry-run first. |

### Scopes

- `mail:label:read` — `label.list` and the name-to-key resolution inside `label.apply`.
- `mail:label:write` — `label.create`, `label.update`, `label.delete`.
- `mail:modify` — required alongside `mail:label:read` to actually write keyword changes via `label.apply`.

An agent with only `mail:label:read` + `mail:modify` can tag with existing labels but cannot reshape definitions (create/rename/delete). Grant `mail:label:write` only to agents that need to manage label definitions.

### Typical agent workflow

```ts
// 1. Get the label registry — resolve names and colors.
const { labels } = await client.callTool({ name: 'label.list', arguments: {} });
const urgentKey = labels.find(l => l.name === 'Urgent')?.key;

// 2. Tag messages — accepts names or keys.
await client.callTool({
  name: 'label.apply',
  arguments: {
    mode: 'commit',
    params: { emailIds: ['Em-01', 'Em-02'], add: ['Urgent'] },
  },
});

// 3. Create a new label if it doesn't exist yet.
const { key } = await client.callTool({
  name: 'label.create',
  arguments: { params: { name: 'Review', color: '#ff6b35' } },
});
```

### Refusal codes

| Code | Meaning |
|---|---|
| `label_name_invalid` | Name is blank or slugifies to empty. |
| `label_key_conflict` | Derived key collides with an existing label; pick a different name. |
| `label_limit_reached` | Account has hit the 200-label cap. |
| `label_not_found` | Key or name not in the registry. The error message lists valid names. |
| `email_not_found` | One or more `emailIds` are inaccessible. |
| `label_registry_conflict` | Concurrent edit detected; retry once. |
| `label_untag_failed` | Could not remove the label from some messages; retry. |

Human-readable messages for these codes (for surfacing to users) are in `docs/labels.md`.
