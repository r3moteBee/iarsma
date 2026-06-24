# Multi-select + bulk actions (P-followup #5) — design

**Date:** 2026-06-24
**Status:** Design — approved in brainstorm, building.
**Source:** v0.13.0 re-test follow-up, item #5 ("No multi-select / bulk actions").

## Goal

Let a human select several conversations in the message list and act on them
in one gesture — mark read/unread, move to a folder, add/remove labels, or
delete — instead of repeating per-row hover actions. Keep human and agent (MCP)
surfaces at parity.

**Acceptance:** select multiple threads (checkbox, Shift-click range,
Cmd/Ctrl-click toggle, `x` to toggle the focused row, header select-all over the
loaded list); a bulk action bar appears showing "N selected"; Mark read / Mark
unread / Move / Label / Delete each apply to every message in every selected
conversation in a single operation; after the action the selection clears and
both the source and any destination view refresh with no manual reload. Every
action is available to agents through the existing array-accepting MCP tools.

## Parity — why this is UI-only

The runtime + MCP layer is **already bulk-capable** (verified, 2026-06-24):

- `mail.modify` input is `emailIds: string[]` + a keywords/mailboxIds patch.
- `mail.delete` input is `emailIds: string[]` (soft-delete to Trash, Undo-enabled).
- `label.apply` input is `emailIds: string[]` + `add[]` / `remove[]`.

All three are registered MCP tools with the dry-run preview/commit pattern, and
the invoker passes the id array straight through to a single JMAP `Email/set`.
Agents already operate on multiple ids (they resolve ids via
`thread.list`/`thread.search`/`thread.get`). **No contract changes and no new
MCP tools** — parity is preserved precisely by not diverging the human path from
the array tools agents already use. This spec adds only the missing human
selection model + action bar + a lazy thread→email-id resolver.

## Selection unit — whole conversation

The list renders **threads** (`thread.id`); today every per-row action targets
only `thread.latestEmail.id`. Bulk actions instead operate on **all emails in
each selected thread** (whole-conversation semantics — "delete these
conversations", not "delete their newest message").

Because `thread.list` surfaces only `latestEmail` (not the full id list), the
full ids are resolved **lazily, at action time** (not eagerly on every list
fetch): when a bulk action fires, one batched `Thread/get` over the selected
thread ids expands them to the flattened set of `emailIds`, which is then handed
to the existing array-accepting call. `thread.list` is unchanged.

> Note: single-row hover actions keep their current latest-email-only behavior
> in this change (no regression, no scope creep). The cosmetic inconsistency
> (row delete = newest message; bulk delete = whole conversation) is accepted;
> unifying single-row to whole-thread can be a later follow-up.

## State (`shell/src/mail-state.ts`)

- `selectedThreadIdsAtom: atom<ReadonlySet<string>>` — the current multi-select.
- `selectionAnchorIndexAtom: atom<number | null>` — anchor for Shift-range,
  set on each plain checkbox toggle / row click.
- Both are cleared by the **same effect that already clears
  `selectedThreadIdAtom`** when the mailbox / search query / label filter
  changes — selection never silently survives a context switch.
- A small pure reducer module (`shell/src/runtime/thread-selection.ts`) holds the
  selection transitions so they are unit-testable without React:
  `toggle(set, id)`, `selectRange(orderedIds, anchorIdx, clickIdx)`,
  `selectAll(orderedIds)`, `clear()`. The atom writers call these.

## Interaction (`shell/src/views/thread-list.tsx` + row)

- **Checkbox column** prepended to the row grid (`grid-template-columns` gains a
  leading `auto`). Visible on row hover, and always visible once any thread is
  selected. `role`/`aria-checked`/labelled by subject.
- **Checkbox click** → toggle one (updates anchor). **Shift-click** → range
  select from anchor to clicked index across the loaded order. **Cmd/Ctrl-click
  on the row** → toggle selection without opening. Plain row click / Enter still
  opens the thread (unchanged).
- **Keyboard:** `x` toggles the focused thread's selection (the binding reserved
  in `keyboard-bindings.ts`); `Esc` clears the selection when non-empty. `j/k`,
  Home/End, Enter/Space, `#`, Shift-I/U unchanged. The `x` binding is added to
  `KEYBOARD_BINDINGS` so it appears in the help overlay.
- **Header select-all checkbox** in the list header: checked → select every
  **loaded** thread; indeterminate when a partial subset is selected; unchecked
  → clear. Scope is deliberately the loaded/visible threads only (honest with a
  virtualized, paginated list — no hidden action on unloaded pages).

## Bulk action bar

When `selectedThreadIds.size > 0`, the header's toolbar region renders the bulk
bar instead (same sticky header slot, reusing `.toolbar` layout + `Button` /
`iconBtn` styles):

- **"N selected"** label + a clear-selection (✕) control.
- **Mark read** / **Mark unread** — `mail.modify` `{ keywords: { $seen: true | null } }`.
- **Move** — the existing move `MenuButton` (folder list, current folder
  omitted), dispatching one `mail.modify` `{ mailboxIds: { [current]: false,
  [target]: true } }`.
- **Label** — the existing multi-select checkbox `MenuButton`; toggling a label
  dispatches `label.apply` `{ add: [...] }` or `{ remove: [...] }`.
- **Delete** — `mail.delete` (soft-delete to Trash), no confirm; shows the
  existing Undo toast worded for the batch ("N conversations moved to Trash ·
  Undo").

## Action dispatch flow

1. `resolveThreadEmailIds(selectedThreadIds)` (new helper in
   `shell/src/runtime/jmap-client.ts`) → one batched `Thread/get` → flattened
   `emailIds` (deduped, order-stable).
2. One existing invoker call with that array (`mail.modify` / `label.apply` /
   `mail.delete`), via `invoker.invoke(...)` (imperative, never a read-hook).
3. On success: clear the selection, `refetch()` the current view, and bump
   `pushGenerationAtom`. The v0.13.1 write-invalidation (`cacheInvalidationsFor`)
   already drops the affected cache purposes for these mutations, so the
   source/destination/counts refresh correctly with no manual reload.
4. On failure: leave the selection intact and surface the error the same way the
   per-row handlers do (console.warn + no destructive state change); the resolve
   step failing aborts before any mutation.

## Errors / edge cases

- Empty selection → bulk bar hidden; actions unreachable.
- A thread that vanished server-side between selection and action → its
  `Thread/get` returns no ids; it's simply excluded (no hard failure). If the
  whole resolve returns zero ids, the action is a no-op and the selection clears.
- Move while viewing a folder: `current` = the active `mailboxId`; whole-thread
  emails already in other mailboxes are unaffected beyond the add/remove of the
  current/target membership (mirrors single-row `handleMove`).
- Large selections: no artificial cap in v1 beyond what the loaded list holds;
  `Thread/get` and `Email/set` take the full array in one request each (the JMAP
  server enforces its own limits). Select-all is loaded-only, bounding N.

## Out of scope (deferred)

- "Select all N in mailbox" escalation beyond the loaded page.
- Undo-on-move (no inverse-patch path yet) — tracked separately.
- Unifying single-row hover actions to whole-conversation semantics.
- A dedicated `mail.flag` / `mail.read` convenience MCP tool (agents use
  `mail.modify`).

## Testing

- Pure reducer (`thread-selection.ts`): toggle, Shift-range across an ordered
  list, select-all, clear; idempotence; range with a moved anchor.
- `resolveThreadEmailIds`: batched `Thread/get` request shape; multi-email
  threads flatten correctly; missing/empty threads excluded; dedupe.
- Component: checkbox visibility (hover + selected), Shift/Cmd-click behavior,
  header select-all + indeterminate, `x`/`Esc` keyboard, bulk bar shows
  "N selected" and each action dispatches the expected invoker call with the
  resolved id set, selection clears + refetch on success.
- a11y: checkbox `aria-checked` + labels, bulk bar is a labelled region, no
  contrast/role regressions (axe).
- Integration: `tsc` clean, full suite green, `pnpm build` ✓ (no codegen change
  expected — assert codegen still emits the same tool set).

## Size

Medium, UI-centric (~6–8 TDD tasks): state/reducer → resolver → checkbox column +
row interaction → keyboard → bulk bar + dispatch → select-all → docs/a11y. One
cohesive spec.
