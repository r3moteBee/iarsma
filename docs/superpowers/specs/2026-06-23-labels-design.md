# Labels (P1.1) — design

**Date:** 2026-06-23
**Status:** Design — approved in brainstorm, building.
**Source:** Follow-up usability plan, P1.1 ("keywords + metadata doc model").

## Goal

Let humans (and, at parity, agents) organize mail with Gmail-style labels: tag a
message with one or more labels, manage label definitions (create / rename /
recolor / reorder / delete), see labels as colored chips, and click a label to
see every message carrying it. Today the shell exposes only system keywords
(`$seen`, `$flagged`); `mail.modify` already accepts arbitrary keyword patches,
so message *tagging* is wired — the missing pieces are label *definitions*
(display name, color, order), a label UI, filtering, and agent capabilities.

**Acceptance:** create a label, tag a message with it from the picker, see the
colored chip on the row and in the thread, click the label in the sidebar to see
all messages with it, rename/recolor it (chips update everywhere, no message
rewrites), delete it (messages untagged). Every refusal produces an
understandable message. The same operations are available as MCP tools, and an
email surfaced to an agent carries its labels resolved to human names.

## Label → keyword model (Approach A′: human-readable stable key)

This is the load-bearing decision; it drives portability, interop, and rename cost.

- A **label** is a registry entry `{ key, name, color, order }`.
- `key` is a charset-safe slug matching `^[a-z0-9][a-z0-9_-]{0,62}$`, **minted
  once from `name` at creation time**, case-insensitively unique, and
  **immutable** thereafter.
- The JMAP **keyword stored on each message *is* the `key`** (e.g. `work`). It is
  a real, meaningful token that travels with the message on export (mbox / EML /
  IMAP) and survives import into any other JMAP/IMAP system — semantics are not
  trapped in a sidecar doc.
- `name` (the full display string, may contain spaces / unicode), `color`, and
  `order` are **presentation only** and live in the registry. Therefore
  **rename / recolor / reorder are registry-only edits** — O(1), zero message
  rewrites, no batch `Email/set`, no cross-mailbox race. Cosmetic drift (keyword
  `work` displaying as "Job" after a rename) is accepted as the price of cheap,
  safe renames and is still far more legible in a foreign client than an opaque
  token.

**Key minting & conflicts (create time only):** slugify `name` →
lowercase, collapse runs of non-`[a-z0-9]` to `_`, trim leading/trailing `_-`,
truncate to 63 chars. If the resulting key already exists (case-insensitive),
auto-suffix `_2`, `_3`, … If `name` slugifies to empty (e.g. all punctuation),
refuse `label_name_invalid`. Keys never change after this point.

**Unadopted keywords:** a keyword present on a message but absent from the
registry is **not** a label — it renders no chip and is omitted from
`label.list`. It can be promoted to a label via `label.create` (which reuses an
existing matching key rather than minting a new one). This is the seam through
which imported / externally-tagged mail gets adopted, and the basis for the
deferred Gmail-import path.

## Storage — the label registry document

A single JSON document is the source of truth for definitions:

```json
{ "version": 1, "labels": [ { "key": "work", "name": "Work", "color": "#ff6b35", "order": 0 } ] }
```

- Persisted as **one FileNode** (`urn:ietf:params:jmap:filenode`) named
  `.iarsma/labels.json`, whose content is a **blob**
  (`urn:ietf:params:jmap:blob`). Both capabilities are advertised by the Stalwart
  session for the account (verified live, 2026-06-23). The shell does not use
  filenode/blob today — this is genuinely new runtime surface.
- **Read:** `FileNode/get` (find the node by name under root) → download its blob
  → parse JSON. Missing node ⇒ empty registry `{ version: 1, labels: [] }`.
- **Write:** serialize → `Blob/upload` → `FileNode/set` (create the node if
  absent, else update its `blobId`).
- **Concurrency:** read-modify-write guarded by the FileNode `state` token
  returned from `FileNode/get`. On a `stateMismatch` from `FileNode/set`,
  re-read once and re-apply the mutation; if it still mismatches, refuse
  `label_registry_conflict`. Single-user last-write-wins is acceptable; the guard
  exists to avoid silently clobbering a concurrent agent edit.
- A `shell/src/runtime/label-store.ts` module isolates the blob+filenode dance
  behind `readRegistry()` and `writeRegistry(mutator)`, so capabilities never
  touch the wire shape directly.

## Capabilities (codegen contracts → TS types + React hooks + MCP tools)

All new contracts live in `tools/codegen/contracts/` and generate runtime types,
React hooks, MCP tool registrations, and docs from one source — the human/agent
parity mechanism. Each carries an **agent-grade `description` + `examples`** that
explain what the tool does, how to resolve a `key` (via `label.list`), and which
refusal `code`s the caller may receive — for an agent the description *is* the
interface.

| Capability | Scope | Destructive | Input | Output |
|---|---|---|---|---|
| `label.list` | `mail:label:read` | no (read) | `{}` | `{ labels: [{ key, name, color, order }] }` |
| `label.create` | `mail:label:write` | no | `{ name: string, color?: string }` | `{ key: string }` |
| `label.update` | `mail:label:write` | no | `{ key: string, name?: string, color?: string, order?: number }` | `{ updated: boolean }` |
| `label.delete` | `mail:label:write` | **yes** (dry-run) | `{ key: string }` | `{ deleted: boolean, untagged: number }` |
| `label.apply` | `mail:label:read` + `mail:modify` | **yes** (dry-run) | `{ emailIds: string[], add?: string[], remove?: string[] }` | `{ modifiedCount: number }` |

- `label.list` is a genuine read → its generated `useReadHook` (auto-fires on
  mount) is correct here, unlike the non-destructive *write* caps.
- `label.create` / `label.update` are non-destructive writes: invoked
  imperatively via `invoker.invoke(...)` (never the generated read-hook, to avoid
  mutate-on-render), bumping `pushGenerationAtom` on success — the Folders
  pattern.
- `label.delete` is **compound**: remove the registry entry **and** untag every
  message carrying the key via a paging `Email/set` loop (the exact machinery
  built for `mailbox.delete`, no message-count cap). Dry-run preview reports
  `{ affectedCount }` = messages that would be untagged.
- `label.apply` accepts label **names or keys** in `add`/`remove` (resolved
  against the registry server-side) so agents and humans operate in display
  terms. It maps to `mail.modify`'s keyword patch under the hood. Dry-run preview
  reports `{ affectedCount }` = emails that would change.

New scopes `mail:label:read` and `mail:label:write` are added to the scope
registry (split for agent least-privilege — see below).

## Agent / human interoperability

Three mitigations make the stable-key model transparent to agents:

1. **`label.apply` by name** — resolve name → key in the runtime; an unknown
   entry refuses `label_not_found` and the message lists the valid label names.
2. **Resolved labels on read** — when an email is surfaced to an agent (MCP read
   path), attach a derived `labels: [{ key, name, color }]` field joined from the
   registry, alongside the raw keywords. Agents see meaning, not tokens.
3. **Adoptable keywords** — unknown keywords are surfaced as unadopted (no chip);
   `label.create` reusing an existing key promotes them.

## Scopes / Stalwart permissions

Split so an agent can be granted the minimum:

- `mail:label:read` → `label.list` + the registry-resolve inside `label.apply`
  (needs FileNode read). `label.apply` *additionally* requires the existing
  `mail:modify` scope for the `Email/set` keyword write, so the email-mutation
  privilege is explicit rather than smuggled into a "read" scope. Net: an agent
  with `mail:label:read` + `mail:modify` can tag with existing labels and read
  names, but **not** reshape the registry.
- `mail:label:write` → `label.create` / `update` / `delete` (needs FileNode
  write). Only trusted agents reshape definitions.

Wired into `mcp-server/src/stalwart-permissions.ts` and
`shell/src/runtime/stalwart-apikey-issuer.ts` using the established
`jmap<Method>` method→permission convention. **The exact Stalwart FileNode
permission names must be verified against the server before building** (the same
"verify the convention" discipline that caught `jmapMailboxDestroy`).

## Runtime (`shell/src/runtime/`)

Pure, unit-tested builders + parsers, plus `fetch*Commit`, plus invoker dispatch:

- `label-store.ts`: `readRegistry()` / `writeRegistry(mutator)` over
  FileNode/get + Blob/upload + FileNode/set, with the state-token retry.
- `jmap-client.ts`: `FileNode/get`, `FileNode/set`, `Blob/upload` builders +
  parsers; add `urn:ietf:params:jmap:filenode` and `:blob` to the `using` set for
  label operations.
- Slug minting helper (`mintLabelKey(name, existingKeys)`), pure + unit-tested
  for the collision/empty/truncation cases.
- `invoker.ts`: dispatch `label.list/create/update/delete/apply`. `label.delete`
  honors `_options.dryRun`; `label.apply` honors `_options.dryRun`.

## UI (`shell/src/`)

- **Sidebar** (`sidebar.tsx`): a collapsible **Labels** section below the mailbox
  tree — each row a colored dot + display name + message count; a "+ New label"
  affordance. Click a label → a label-filtered message view (`Email/query`
  filtered by the keyword). Collapse state persisted to localStorage, matching
  the mailbox tree.
- **Label picker** on `views/thread-list.tsx` + `views/thread-view.tsx`: a
  multi-select `MenuButton` (checkbox items, reusing the Folders MenuButton) that
  toggles labels on the selected message(s) via `label.apply`.
- **Colored chips**: a `LabelChip` component rendered on message rows and the
  thread header, driven by the registry. Default color is the orange accent
  `#ff6b35` (standing UI preference), with a small fixed palette in the
  create/recolor dialog.
- **Dialogs** (`label-dialogs.tsx`): create / rename / recolor / delete, reusing
  the `folder-dialogs.tsx` structure; refusal messages shown verbatim; delete
  dialog states "This will remove the label from N message(s)."

## Errors & refusals — all human-readable

Every refusal is a typed `code` + a sentence a person (or agent) can act on:

| Code | When | Message |
|---|---|---|
| `label_name_invalid` | blank name, or slugifies to empty | "Enter a label name using letters or numbers." |
| `label_key_conflict` | minted key collides and auto-suffix disabled/exhausted | "A label with a similar name already exists. Pick a different name." |
| `label_limit_reached` | registry at cap (200) | "You've reached the maximum of 200 labels. Delete one to add another." |
| `label_not_found` | unknown key/name on update/delete/apply | "That label doesn't exist. Available labels: <names>." |
| `email_not_found` | `label.apply` target email missing | "One or more of those messages no longer exist." |
| `label_registry_conflict` | FileNode state mismatch after one retry | "Labels were changed elsewhere just now. Reopen and try again." |

These exact messages appear in `docs/labels.md` and in the contract `errors`.

## Documentation & help

Mirrors Folders:

- Agent-intended MCP **tool descriptions** that name every refusal `code` and
  explain key resolution — generated from the contracts.
- `docs/labels.md`: human guide with the verbatim refusal messages and the
  label model (what a key is, why rename is cheap, what export/import preserves).
- Linked from the docs index and `docs/a11y.md`.
- A short **"Future: import"** subsection documents the import contract (key
  derivation from external label names, nested-label flattening
  `Work/ProjectX` → `work_projectx`, color mapping) so Gmail/Takeout import drops
  in later as its own spec without a model change.

## Out of scope (deferred)

- Gmail / Takeout / mbox **import** build-out (registry is designed to accept it).
- **Nested** labels (flat list in v1).
- Per-label notification / filter rules.
- A `parentId`-style reparent on labels.

## Testing

- Pure units: `mintLabelKey` (collision, empty, truncation, case-fold); registry
  serialize/parse; builders/parsers for FileNode/Blob; `label.apply` name→key
  resolution; refusal taxonomy.
- Runtime: `label-store` read-modify-write incl. missing-node and state-mismatch
  retry; `label.delete` paging untag with >500 messages (no cap regression).
- Component: label picker toggling, sidebar Labels section + filter navigation,
  LabelChip rendering, dialogs surfacing refusals verbatim.
- Integration: `tsc` clean, full test suite green, `pnpm build` ✓.

## Size

Larger than Folders (~10–12 TDD tasks) because the filenode/blob registry store
is new runtime surface. One cohesive spec; the plan sequences it: store → slug →
contracts → runtime/invoker → scopes → sidebar/filter → picker/chips → dialogs →
resolved-on-read → docs.
