# Folder management (P1.2) — design

**Date:** 2026-06-23
**Status:** Design — approved in brainstorm, pending spec review.
**Source:** Follow-up usability plan, P1.2 (folds in P1.4 "persistent row actions" and P2.5 "mailbox-list auto-refresh").

## Goal

Let humans (and, at parity, agents) organize mail into folders: create, rename, delete (incl. nested subfolders), and move messages between folders. Today the shell only has `mailbox.list`; the folder set is fixed. JMAP `Mailbox/set` supports the rest, and message-move already exists via `mail.modify`.

**Acceptance:** create a nested folder, rename it, move a message into it, delete it (contents → Trash). Every refusal produces an understandable message. The same operations are available as MCP tools. Sidebar tree + counts stay consistent without a manual refresh.

## Capabilities (codegen contracts → TS types + React hooks + MCP tools)

All new contracts live in `tools/codegen/contracts/` and generate the runtime types, the React hooks, and the MCP tool registrations from one source — that is the human/agent parity mechanism.

| Capability | Scope | Destructive | Input | Output |
|---|---|---|---|---|
| `mailbox.create` | `mail:mailbox` | no | `{ name: string, parentId?: string }` | `{ mailboxId: string }` |
| `mailbox.update` | `mail:mailbox` | no | `{ mailboxId: string, name: string }` | `{ updated: boolean }` |
| `mailbox.delete` | `mail:mailbox` | **yes** (dry-run) | `{ mailboxId: string }` | `{ deleted: boolean, movedToTrash: number }` |

- `mailbox.update` carries `name` only in v1 (rename). A `parentId` reparent field is intentionally deferred.
- `mailbox.delete` is **compound and encapsulated** so agents get the same safe behavior as the UI: resolve the Trash mailbox → `Email/set` move every message whose membership includes the target out of it and into Trash → `Mailbox/set` destroy the now-empty mailbox. Its dry-run preview reports `{ affectedCount }` = messages that would move to Trash.
- **Move a message** reuses existing `mail.modify` (`mailboxIds` patch); no new capability.

New scope `mail:mailbox` is added to the scope registry (mirrors `mail:modify`, `files:write`).

## Runtime (`shell/src/runtime/jmap-client.ts`)

Pure, unit-tested builders + parsers, plus `fetch*Commit`, plus invoker dispatch cases:

- `buildMailboxCreateRequest` → `Mailbox/set` `create`.
- `buildMailboxUpdateRequest` → `Mailbox/set` `update` (name).
- `mailbox.delete` orchestration (in `fetchMailboxDeleteCommit`): (1) resolve Trash id via `mailbox.list`/role; (2) list message ids in the target mailbox; (3) `Email/set` update each: remove target mailbox, add Trash; (4) `Mailbox/set` destroy the target. Returns `movedToTrash` count.

## Errors & refusals — all human-readable

Every refusal returns a `ToolError` with a stable `code` and a `message` written for a person. The UI shows `message` verbatim in the dialog/notice (never a raw JMAP `notCreated`/`notDestroyed` blob); MCP callers receive the same `message`. The tree pre-gates the menu items so most refusals never fire, but the capability still enforces them (defense in depth, and agents call the capability directly).

| Trigger | code | User-facing message |
|---|---|---|
| Delete a folder that has child folders | `mailbox_has_children` | `Can't delete "<name>" — it has <N> subfolder<s>. Delete or move those first.` |
| Delete/rename a system folder (role inbox/sent/drafts/trash/junk/archive) | `mailbox_protected` | `"<name>" is a system folder and can't be renamed or deleted.` |
| Delete/rename without `myRights.mayDelete` / `mayRename` | `mailbox_forbidden` | `You don't have permission to <rename\|delete> "<name>".` |
| Create/rename to a name that already exists under the same parent | `mailbox_name_conflict` | `A folder named "<name>" already exists here. Pick a different name.` |
| Create/rename with an empty or whitespace-only name | `mailbox_name_invalid` | `Folder name can't be empty.` |
| Delete but no Trash mailbox exists on the account | `trash_not_found` | `Can't delete "<name>" safely — no Trash folder was found on this account.` |
| Underlying `Mailbox/set` / `Email/set` rejects unexpectedly | `mailbox_set_failed` | `Couldn't <action> "<name>": <server reason>.` (server reason mapped from the JMAP `setError` description) |

`<name>` is the human folder label (role-canonical label for system folders); `<N>` pluralized. The capability layer composes these; the UI passes them straight through.

## UI (`shell/src/components/`)

- **`MenuButton`** (new, accessible): a trigger button + popover list; `role="menu"`/`menuitem`, arrow-key navigation, Enter/Esc, click-outside close, focus return. Reused for the folder "…" menu and the "Move to" picker. Persistent (not hover-gated) so it is keyboard- and agent-reachable (P1.4).
- **`mailbox-tree-view.tsx`:** each row renders a persistent "…" `MenuButton` **and** an `onContextMenu` handler opening the same menu — items: *New subfolder · Rename · Delete*, each gated by the refusal rules above (hidden/disabled when not allowed). The Folders section header (sidebar) gets a **"+ New folder"** button (creates a top-level folder).
- **Create / Rename:** `Dialog` + text input (Create also takes an optional parent, prefilled when launched from "New subfolder"). On submit, calls the capability; on a refusal `ToolError`, renders `message` inline in the dialog and keeps it open.
- **Delete:** the existing destructive-confirm `Dialog`, showing the dry-run line (`This will move N message(s) to Trash, then delete the folder.`). Refusals (children/protected) are pre-checked so the menu item is disabled with a tooltip carrying the reason; if the capability still refuses, the message shows in the dialog.
- **Move to…:** an item in the thread-list row "…" menu and the thread-view toolbar opens a `MenuButton` folder picker (the mailbox list, excluding the message's current mailbox); selection fires `mail.modify` to remove the current mailbox and add the target (mirrors the U-3 restore path).

## Refresh / consistency (folds in P2.5)

After any successful create/rename/delete/move, bump `pushGenerationAtom`. The read-hook folds it into its cache key, so `mailbox.list` (sidebar tree + counts) and the active thread list refetch immediately — no manual refresh. This also fixes the P2.5 "Trash didn't auto-refresh on delete" observation, since deletes now invalidate consistently.

## Testing

- **Runtime (unit):** `buildMailboxCreate/UpdateRequest` payload shape; `mailbox.delete` orchestration issues the Trash-resolve → Email/set move → Mailbox/set destroy sequence and returns the right `movedToTrash`; each refusal path returns the right `code` + `message`.
- **Components:** `MenuButton` (keyboard nav, Esc, click-outside); tree-view menu gating (system roles show no Rename/Delete; folder with children disables Delete with the reason tooltip); create/rename dialog surfaces a refusal message inline; move-to picker fires `mail.modify` with the correct patch.
- **Full suite + build + CI** green before merge, per project norm.

## MCP parity

`mailbox.create` / `mailbox.update` / `mailbox.delete` ship as MCP tools in the same PR (generated from the contracts); move is already `mail.modify`. Agents create/rename/delete folders and move mail exactly as humans do, and hit the same human-readable refusals.

## Out of scope (v1)

Drag-to-move; folder reparenting via the UI; recursive delete of an entire folder subtree (refused with `mailbox_has_children`).
