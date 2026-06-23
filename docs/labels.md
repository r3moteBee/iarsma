# Labels — Iarsma user guide

Organize your mail with labels. Create labels, tag messages with one or more labels, rename or recolor them, filter the thread list to a single label, and delete labels safely.

**Last updated:** 2026-06-23  
**Status:** Phase 1

## What a label is

A label is a colored tag you attach to messages. Unlike folders, a message can carry many labels at once; labels can be applied across different mailboxes.

Every label has four properties:

| Property | What it is |
|---|---|
| `key` | A short, lowercase slug like `work` or `read_later`. Minted once from the label name, then **immutable**. |
| `name` | The full display string — may contain spaces and unicode. You see this in the UI. |
| `color` | A CSS hex color, e.g. `#ff6b35`. Used for the colored chip in the thread list and sidebar. |
| `order` | An integer controlling the display order in the sidebar. Lower comes first. |

### The key model — why it matters

When you tag a message, Iarsma stores the label `key` directly as a JMAP keyword on the message (e.g. `work`). The display name, color, and order live separately in a registry document. This has three practical consequences:

1. **Rename and recolor are instant.** Changing a label's name from "Work" to "Job" edits only the registry — no messages are rewritten. Chips update everywhere immediately.
2. **Labels survive export and import.** The keyword `work` travels with the message in mbox/EML/IMAP exports. In another mail client the keyword shows up as the readable slug `work` rather than an opaque ID.
3. **Keys never change.** Once a label is created, its key is fixed. You can rename, recolor, and reorder freely without touching any messages.

### Key minting

When you create a label, Iarsma derives the key from the name automatically: lowercase, runs of non-alphanumeric characters collapsed to `_`, leading/trailing punctuation trimmed, truncated to 63 characters. If the key already exists, a suffix `_2`, `_3`, … is appended automatically. If the name contains only punctuation (slugifies to empty), creation is refused with `label_name_invalid`.

Keys must match `^[a-z0-9][a-z0-9_-]{0,62}$`.

## Create a label

1. In the sidebar, look for the **Labels** section header.
2. Click **+ New label** next to the header.
3. In the dialog, enter a label name (required, non-empty).
4. Optionally pick a color from the palette.
5. Click **Create**.

The new label appears in the Labels list immediately.

## Tag a message

1. In the thread list or thread view, locate the message to tag.
2. Click the **label icon** or the **…** menu button.
3. Select **Labels…** to open the label picker.
4. Check or uncheck labels in the picker — changes apply immediately.

The colored label chip appears on the message row and in the thread header.

## Rename a label

1. In the sidebar, locate the label to rename.
2. Click its **…** menu button.
3. Select **Rename** from the menu.
4. In the dialog, enter the new name.
5. Click **Rename**.

The name updates everywhere immediately. The underlying key is unchanged, so no messages are rewritten.

## Recolor a label

1. In the sidebar, locate the label to recolor.
2. Click its **…** menu button.
3. Select **Change color** from the menu.
4. Pick a color from the palette.
5. Click **Save**.

All chips for that label update immediately.

## Filter by label

Click any label name in the sidebar. The thread list shows only messages carrying that label, across all mailboxes.

Click again (or navigate to a mailbox) to clear the filter.

## Delete a label — safe delete

Deleting a label removes it from every message that carries it, then destroys the label definition.

1. In the sidebar, locate the label to delete.
2. Click its **…** menu button.
3. Select **Delete** from the menu.
4. A confirmation dialog shows: **"This will remove the label from N message(s), then delete it."**
5. Click **Delete** to confirm.

The label is removed from all messages and the definition is destroyed. Messages are not deleted.

## What the refusals mean

If a label operation is blocked, the UI shows a human-readable message. Here is what each one means:

| Error code | Message | What to do |
|---|---|---|
| `label_name_invalid` | `Enter a label name using letters or numbers.` | The label name is blank or contains only punctuation. Enter a name with at least one letter or digit. |
| `label_key_conflict` | `A label with a similar name already exists. Pick a different name.` | The derived key for your new name collides with an existing label and the auto-suffix was exhausted. Choose a different name. |
| `label_limit_reached` | `You've reached the maximum of 200 labels. Delete one to add another.` | The account has hit the 200-label cap. Delete a label you no longer need. |
| `label_not_found` | `That label doesn't exist. Available labels: <names>.` | The label name or key you specified is not in the registry. Check the label name and try again. |
| `email_not_found` | `One or more of those messages no longer exist.` | One or more messages in a bulk tag operation are no longer accessible. Refresh and retry. |
| `label_registry_conflict` | `Labels were changed elsewhere just now. Reopen and try again.` | A concurrent edit (another tab or agent) modified the registry at the same time. Reopen the dialog and retry. |
| `label_untag_failed` | `Could not remove the label from some messages. Please try again.` | The keyword patch on one or more messages failed. Retry the operation; if the problem persists contact your mail administrator. |

## Agent and automation use

Agents interact with labels through five MCP tools. The join between a message's keywords and its labels is explicit: the JMAP keyword stored on each tagged message is the label's `key`. Call `label.list` to resolve keys to names and colors.

See `docs/agent-collaboration.md` for the full Labels section.

## Future: import

The label key model is designed to accept Gmail/Takeout/mbox import without a model change:

- **External label name → derived slug key.** Iarsma applies the same slugification used at create time: lowercase, collapse non-alphanumeric runs to `_`, trim, truncate to 63 characters.
- **Nested labels flatten.** Gmail nested labels like `Work/ProjectX` become `work_projectx`. The flat key is stored on every message imported under that nested label.
- **Color mapping.** Gmail's per-label colors are mapped to the nearest hex value in Iarsma's palette. A custom hex can be set after import via `label.update`.
- **Unadopted keywords.** An imported message carrying keyword `work` will automatically match any existing label with key `work`. If no matching label exists, the keyword is visible but renders no chip until you create a label whose key collides with it — at which point `label.create` reuses the existing key rather than minting a new one, and all previously-imported messages gain the chip automatically.

This contract means a Gmail Takeout import can be built as a batch of `label.create` + `label.apply` calls, with no schema or model change required.
