# Folders — Iarsma user guide

Organize your mail into folders. Create top-level folders, nest subfolders within them, rename, move messages, and delete folders safely.

**Last updated:** 2026-06-23  
**Status:** Phase 1

## Create a folder

### Create a top-level folder

1. In the sidebar, look for the **Folders** section header.
2. Click **+ New folder** next to the header.
3. In the dialog, enter a folder name (required, no empty names).
4. Click **Create**.

The new folder appears in your Folders list immediately.

### Create a nested subfolder

1. In the sidebar, locate the parent folder where you want to create a subfolder.
2. Hover over the folder or click its **…** menu button.
3. Select **New subfolder** from the menu.
4. In the dialog, enter the subfolder name.
5. Click **Create**.

The subfolder appears nested under its parent.

## Rename a folder

1. In the sidebar, locate the folder to rename.
2. Hover over it or click its **…** menu button.
3. Select **Rename** from the menu.
4. In the dialog, enter the new name.
5. Click **Rename**.

The folder name updates immediately.

## Move a message into a folder

1. In the thread list or thread view, locate the message to move.
2. Click the **…** menu button on the thread row (thread list) or toolbar (thread view).
3. Select **Move to…** from the menu.
4. A folder picker opens, showing all your folders except the one the message is already in.
5. Click the destination folder.

The message is moved immediately. The Inbox (or current folder) count decreases, and the destination folder count increases.

## Delete a folder — safe delete

Deleting a folder is **safe**: Iarsma moves all messages in the folder to Trash first, then deletes the now-empty folder.

1. In the sidebar, locate the folder to delete.
2. Hover over it or click its **…** menu button.
3. Select **Delete** from the menu.
4. A confirmation dialog appears, showing: **"This will move N message(s) to Trash, then delete the folder."**
5. Click **Delete** to confirm.

All messages move to Trash. The folder is deleted. If you change your mind, restore messages from Trash.

### Why safe delete?

A safe delete prevents accidental data loss. If you delete a folder with mail, the messages don't vanish — they're recoverable from Trash. Once you're sure you don't need them, delete them from Trash permanently.

## What the refusals mean

If a folder operation is blocked, the UI shows a human-readable message. Here's what each one means:

| Error code | Message | What to do |
|---|---|---|
| `mailbox_has_children` | `Can't delete "<name>" — it has <N> subfolder<s>. Delete or move those first.` | The folder has subfolders. Delete or move the subfolders first, then delete the parent. |
| `mailbox_protected` | `"<name>" is a system folder and can't be renamed or deleted.` | You're trying to rename or delete a system folder (Inbox, Sent, Drafts, Trash, Junk, Archive). These are protected and can't be modified. |
| `mailbox_forbidden` | `You don't have permission to <rename\|delete> "<name>".` | Your account doesn't have permission to perform this operation on this folder. Contact your mail administrator. |
| `mailbox_name_conflict` | `A folder named "<name>" already exists here. Pick a different name.` | A folder with that name already exists under the same parent. Choose a different name. |
| `mailbox_name_invalid` | `Folder name can't be empty.` | The folder name is blank or contains only spaces. Enter a name with at least one character. |
| `trash_not_found` | `Can't delete "<name>" safely — no Trash folder was found on this account.` | The Trash folder is missing from your account. Contact your mail administrator to restore it before deleting folders. |
| `mailbox_set_failed` | `Couldn't <action> "<name>": <server reason>.` | The mail server rejected the operation unexpectedly. The error details appear in the message. Retry, or contact your mail administrator if the problem persists. |

## Folder operations are menu-driven

All folder operations in Iarsma v1 use the folder menu (the **…** button or right-click context menu). Keyboard bindings for folders are intentionally deferred to a future pass.

For keyboard shortcuts on other operations, see `docs/keyboard.md`.
