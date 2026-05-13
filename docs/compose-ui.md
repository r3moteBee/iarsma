# Compose UI design

**Last updated:** 2026-05-11
**Status:** authoritative for Phase 2 item 4 (new-message compose) and item 5 (reply / reply-all / forward).

## Decision: modal, not split-pane

The compose surface is a **modal dialog** rendered above the inbox layout. Both new messages and replies share the same dialog component.

### Why modal

- **Single composition surface.** One ComposeView component handles new, reply, and forward. Different entry points (`compose` button, `r` keybinding, etc.) populate the same form differently. A split-pane variant would need two layouts (inline-in-thread for reply, full-pane for new) — extra code path with no UX benefit we can name.
- **Familiar.** Gmail, Apple Mail (when composing new), Outlook web all use modals for new mail. Users don't need a mental model shift.
- **Focused.** The composer demands attention; treating it as a modal makes its "you're doing one thing right now" stance explicit.
- **State is simple.** A modal owns its form state for its lifetime and unmounts on close. No "what does the inbox look like behind the half-open composer" concern.

### Why not split-pane

The argument for split-pane is "you can see the original thread while replying." Two reasons we're OK without that:
- Squire renders the **quoted block inline** at the top of the body (with `contenteditable=false`), so the reply text and the quoted history sit in the same scrollable surface. The original is visible IN the composer; no need to see it elsewhere on screen.
- The modal can be large enough that the composer feels roomy. 80% viewport height + ~40em wide is plenty for prose. We don't need to give up the inbox underneath.

If a future case needs "reply while pinning a different thread's content for reference," we can add a "minimize to a dock chip" affordance to the modal — same component, lifecycle just gets a `minimized: boolean` state. That's a follow-up, not a v1.

## Lifecycle

```
Closed  ──┐
          │ (click "Compose" / `c` key / reply button)
          ▼
Open ─────────────────────────────────────┐
   - Empty fields, or                     │
   - Pre-filled (reply: prefills to/      │
     subject + quoted body)               │
                                          │
   ┌─ on field blur (debounced 500ms) ────┤
   │                                      │
   │      ┌─ commit ─→ JMAP Email/set ──→ saved-draft-id stamped
   │      ▼
   │  mail.draft  ←─ creates draft on
   │                  first save; future
   │                  saves update the
   │                  same draft via the
   │                  /update path (future
   │                  capability)
   │
   ├─ Click "Send" ──────────────────────────┐
   │                                         │
   │     ┌─ preview ─→ mail.send dry-run ───→ Preview modal renders
   │     ▼                                    (recipients, subject,
   │  Preview modal                           body snippet, est. size)
   │     │
   │     ├─ "Cancel" ──→ close preview, stay in composer
   │     └─ "Send" ────→ mail.send.commit() ─→ on success: close modal,
   │                                            close composer,
   │                                            refresh thread list.
   │
   └─ Click "Cancel" / "Discard" / Esc / backdrop click ─→
      close (draft persists unless user picks Discard
      from the Cancel menu — Discard support lands with
      mail.draft.delete, future)
```

## Wire-up to capabilities

| Surface | Capability | Notes |
|---------|-----------|-------|
| Save-on-blur | `mail.draft.commit()` | Debounced 500ms. First save creates the draft; future saves *replace* by recreating + deleting the old one (Phase 2 simplification — JMAP Email/set has separate `update` and `destroy` operations; we'll add a dedicated `mail.draft.update` capability later). |
| Send button | `mail.send.preview()` | Renders into a confirmation modal. |
| Confirmation modal | `mail.send.commit()` | Closes on success. Errors surface inline. |

## Identity (item 6 dependency)

`mail.send` requires `identityId`. Item 4 ships with a **placeholder** identity (`'placeholder-identity'`) plus a TODO pointing at Phase 2 item 6. Until item 6 lands, the JMAP server will reject submissions with `forbiddenMailFrom` — the UI surfaces the error correctly but you can't send for real. Save-as-draft works end-to-end.

`mail.draft` doesn't need `identityId`, so the draft path is fully functional today.

## Recipients

The `to` / `cc` / `bcc` fields are plain text inputs that accept comma-separated addresses. Two formats parsed:

- `Alice <alice@example.net>` → `{ name: "Alice", email: "alice@example.net" }`
- `alice@example.net` → `{ email: "alice@example.net" }`

Empty entries are dropped. Invalid entries (no `@`, malformed) surface as a form error before save / send. The contract layer validates emails as strings; the UI's job is to keep the parsed list aligned with what the user typed.

A richer chip-based recipient field (autocomplete from address book, drag-to-reorder, etc.) is a Phase 4 / 5 polish pass. Phase 2 ships text.

## Mailbox resolution

The composer needs two mailbox ids:

- `Drafts` for `mail.draft.mailboxId`.
- `Sent` for `mail.send.sentMailboxId`.

Both resolve via `useMailboxList()` filtered by `role: 'drafts' | 'sent'`. The hook is cached (D-051), so the resolution is a no-op after first render. If the role isn't found (operator misconfigured), the Send button is disabled and a banner explains why.

## A11y

- Modal: `role="dialog"`, `aria-modal="true"`, `aria-labelledby` pointing at the dialog title.
- Esc closes (consistent with the keyboard help overlay).
- Backdrop click closes.
- Focus trap: the focus moves into the dialog on open, leaves to the previously-focused element on close. The first focusable element gets focus by default.
- The composer textbox is `role="textbox"` `aria-multiline="true"` (Squire's own ARIA, surfaced via item 1's `Composer` component).

## Attachments (item 7)

The Attachments section sits between the body and the footer. The user picks one or more files via a standard `<input type="file" multiple>`; each file uploads to JMAP's blob endpoint (`POST /jmap/upload/{accountId}/`) immediately on selection. Successful uploads add a row to the list with name / type / size and a Remove button. The Send button disables while any upload is in flight; the label flips to "Uploading…".

On Send, every uploaded attachment is referenced from `mail.send.attachments` as `{ blobId, name, type, size, disposition: 'attachment' }`. JMAP fills the `attachments` array on the `Email/set` create with the same shape (per RFC 8621 §4.1.4).

### Reserved: image-resize slot

The picker UI reserves a slot for an image-resize component (Phase 5 fills it in). Today's flow is "drop file → upload at full size" — fine for small files, punishing for 12+ MB phone photos. The slot will land an inline downscale-to-N-px / quality-Q affordance before the upload fires.

### Reserved: inline image rewriting

The plan's note that "`<img src="blob:...">` rewrites to `cid:<blobId>` on send" lands in a future polish PR. The plumbing is wired (attachments accept `disposition: 'inline'` + a `cid` field), but the body-scanning + upload-and-rewrite flow needs:
- The composer's sanitizer policy to accept `<img>` from local paste/drop (currently strips them).
- An on-Send body-scan pass to find `<img src="blob:...">`, fetch the blob, upload, and replace the src.

Until then, dropping an image into the composer body gets stripped by the sanitizer. The Attachments section is the working surface for sending images today.

## Out of scope (item 4)

- ~~Identity selector~~ → item 6.
- ~~Attachments~~ → item 7.
- Drafts panel (list + reopen) → item 8.
- `mail.draft.update` / `mail.draft.delete` → future capabilities.
- ~~Reply / reply-all / forward variants~~ → item 5.
- ~~`c` keyboard binding~~ → wired with item 5.
- Inline image cid: rewriting — Phase 2 polish PR (see "Reserved" above).
