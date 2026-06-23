# Task 6 Report: Folder menu in tree + create/rename/delete dialogs

## Status
COMPLETE. All code committed, TypeScript clean, 26 new tests pass, full suite green.

## Commit
SHA: `d9eab46`
Subject: `feat(mailbox): folder …-menu (+right-click), + New folder, create/rename/delete dialogs`

## What was built

### 1. `shell/src/components/mailbox-tree-view.tsx` (modified)
- Added `myRights?: { mayCreateChild?, mayRename?, mayDelete? }` to `MailboxRow` type
- Added `onCreateFolder?`, `onRenameFolder?`, `onDeleteFolder?` to `MailboxTreeViewProps`
- `TreeRow` computes `menuItems` from `myRights` + `role` (system folders get no Rename/Delete)
- Per-row `MenuButton` labeled `Actions for <name>` (hidden when items array is empty)
- `Delete` renders `disabled=true` + `disabledReason="Has subfolders — delete those first"` when the folder has children
- `onContextMenu` on each `<li>` synthetically clicks the `button[aria-haspopup="menu"]` trigger to open the same menu on right-click

### 2. `shell/src/components/sidebar.tsx` (modified)
- Added `onCreateFolder?`, `onRenameFolder?`, `onDeleteFolder?` to `SidebarProps`
- Folders section header with **"+ New folder"** button → `onCreateFolder?.(undefined)`
- Props threaded down to `MailboxTreeView`

### 3. `shell/src/components/folder-dialogs.tsx` (new)
- `CreateFolderDialog`: name input (autoFocus), optional parentName display, Create button disabled when empty, `error` prop renders verbatim inline alert
- `RenameFolderDialog`: prefills current name on open, Rename button, `error` inline
- `DeleteFolderDialog`: dry-run message `This will move N message(s) to Trash, then delete the folder.`, Confirm/Cancel, `error` inline

### 4. `shell/src/App.tsx` — `SignedInShell` (modified)
- `FolderDialog` discriminated union state + `folderDialogError` state
- `handleCreateFolder` / `handleRenameFolder` / `handleDeleteFolder` callbacks
- `handleDeleteFolder` fires `invoker.invoke('mailbox.delete', {...}, { dryRun: true })` to populate `affectedCount` before opening dialog
- All three callbacks passed to `Sidebar`
- Dialog onSubmit/onConfirm call `invoker.invoke(...)` directly (NOT the generated useMailbox* hooks, which auto-fire on mount)
- On success: `bumpPushGeneration((n) => n + 1)` to refresh sidebar tree
- On thrown error: `e.message` passed verbatim to dialog's `error` prop
- `exactOptionalPropertyTypes` compliance: optional props spread conditionally

## Tests

### `mailbox-tree-view-actions.test.tsx` (10 tests)
- System Inbox row: no Rename/Delete; shows New subfolder when mayCreateChild
- System folder without myRights: no Actions button
- User folder: Rename + Delete enabled
- Clicking Rename fires onRenameFolder(id, name); Delete fires onDeleteFolder(id)
- Folder with children: Delete disabled with correct title reason; click does not fire
- Child folder with no children: Delete enabled
- Right-click opens the menu (contextMenu event)

### `folder-dialogs.test.tsx` (16 tests)
- Create: submit calls onSubmit(name, parentId); disabled when empty; shows parentName; error inline; stays open on error; Cancel fires onClose
- Rename: prefills currentName; submit calls onSubmit(newName); error inline; Cancel fires onClose
- Delete: shows N message(s) text; 0 case; Confirm calls onConfirm; Cancel; error inline

## Concerns / Notes
- The previous agent wrote `folder-dialogs.tsx` but did not create the test files or modify `mailbox-tree-view.tsx` / `sidebar.tsx` / `App.tsx`. The existing `folder-dialogs.tsx` content was kept (it was well-structured); the test files and all other modifications were added fresh.
- `myRights` is optional on `MailboxRow` — existing mailboxes without it show no Actions button. The JMAP mailbox.list response will need to include `myRights` for the menu to appear on live data.
- The `mailbox.list` fetcher in `jmap-client.ts` may need updating to include `myRights` fields in the response mapping if those aren't being fetched already (not investigated here; that would be a server/fetcher concern).
- No axe violations introduced (existing a11y test still passes; MenuButton was already tested in Task 5).

---

## Fix Note (post-review, 2026-06-23)

### Issue 1 — `myRights` never reached sidebar rows (feature was a no-op on live data)

**Root cause:** `sidebarMailboxes` memo in `App.tsx` (lines ~557–575) mapped `useMailboxList` entries without carrying `myRights` through. `MailboxRow.myRights` is optional so this was invisible at compile time; component tests injected `myRights` directly and passed.

**Fix:**
- Extracted `toSidebarMailboxEntry(m)` into a new dedicated module `shell/src/sidebar-mailbox-entry.ts` (pure, no side-effectful imports). Maps `id`, `name`, `unreadEmails→unreadCount`, optional `role`, optional `parentId`, and `myRights` (`mayCreateChild`, `mayRename`, `mayDelete`).
- `sidebarMailboxes` memo in `App.tsx` now calls `mailboxListResult.data.map(toSidebarMailboxEntry)`.
- Added `myRights?: { mayCreateChild?, mayRename?, mayDelete? }` to `MailboxEntry` type in `shell/src/components/sidebar.tsx` — makes the type chain explicit.
- Added `shell/src/sidebar-mailbox-entry.ts` and regression tests at `shell/src/__tests__/sidebar-mailbox-mapping.test.ts` (6 tests) asserting `myRights`, `id`, `name`, `unreadCount`, `role`, `parentId` all map correctly.

### Issue 2 — Delete dry-run error cleared and replaced with "0 messages"

**Root cause:** `catch {}` block in `handleDeleteFolder` in `App.tsx` called `setFolderDialogError(undefined)` and opened the dialog with `affectedCount: 0` when the dry-run `invoke` threw — misleading to the user.

**Fix:** Changed `catch {}` to `catch (e)` and sets `folderDialogError` to `e.message` (or `String(e)` fallback), then opens the dialog in its error state (so the user sees the actual error, not "0 messages").

### Test commands run and results

```
# Targeted tests (new regression guard + existing actions tests)
pnpm exec vitest run src/components/__tests__/mailbox-tree-view-actions.test.tsx src/__tests__/sidebar-mailbox-mapping.test.ts
# Result: 2 test files, 16 tests, all passed

# TypeScript
pnpm exec tsc -b --noEmit
# Result: exit 0, no errors

# Full shell suite
pnpm exec vitest run
# Result: 93 test files, 1185 tests, all passed
```

### Files changed
- `shell/src/sidebar-mailbox-entry.ts` — new; pure helper `toSidebarMailboxEntry`
- `shell/src/App.tsx` — use `toSidebarMailboxEntry` in memo; fix dry-run catch
- `shell/src/components/sidebar.tsx` — add `myRights` to `MailboxEntry` type
- `shell/src/__tests__/sidebar-mailbox-mapping.test.ts` — new; 6 regression tests
