# Event → calendar assignment + bulk Label/Flag + move-undo — design

**Date:** 2026-06-25
**Status:** Design — approved, building.
**Source:** v0.15.0 live re-test follow-up (items #1, #2, #3). Ships **v0.16.0**.

## Goal

Complete the multi-calendar feature shipped in v0.15.0. Today a user can create
a second calendar but **cannot put anything on it** — the New/Edit Event forms
have no calendar selector, so every event lands on the default calendar and
cannot be moved. This batch:

1. **#1 (Med-High) — Event → calendar assignment.** Let a human choose the
   calendar when creating an event and reassign it when editing, render the
   event chip in the chosen calendar's color, and (standing parity rule) expose
   event create/update/delete to agents as MCP tools in the same change.
2. **#2 (Low) — Bulk Label + Flag.** Add **Apply label** and **Flag/Unflag** to
   the multi-select bulk action bar (today: Mark read, Mark unread, Move,
   Delete).
3. **#3 (Low) — Undo on move.** A move (single-row and bulk) gets an Undo toast,
   matching the existing delete-undo pattern.

**Acceptance:**
- Create an event on a non-default calendar ("Personal") → it shows in that
  calendar's color; hide "Personal" → the event hides; Edit the event and
  reassign it to another calendar → it moves and recolors.
- Agents can create / reassign / delete events via MCP (`event.create`,
  `event.update`, `event.delete`) with a `calendarId`.
- The bulk bar applies a label to, and flags/unflags, many selected messages.
- Moving message(s) shows "Moved to <folder> / Undo"; Undo returns them.

## Backend reality (live-probed on Stalwart, 2026-06-25, account `b`)

Event → calendar assignment is **pure JMAP `CalendarEvent/set`** (not CalDAV).
Verified against `sw-mail.r3motely.net` (throwaway calendar + event, then
cleaned up):

- **Create** with `CalendarEvent/set { create: { e: { calendarIds: { <calId>:
  true }, title, start, timeZone, duration } } }` → the event lands on the
  chosen calendar (not the default). Confirmed by readback.
- **Reassign** with `CalendarEvent/set { update: { <eventId>: { calendarIds: {
  <newCalId>: true } } } }` → succeeds (`updated`), readback shows the new
  calendar. `calendarIds` is **not** immutable — an earlier agent claim to the
  contrary was disproven by this probe.
- Account id for calendars/events = `primaryAccounts[urn:ietf:params:jmap:calendars]`
  (= `b`), the same id `fetchCalendarList` resolves.
- The Stalwart permission names `jmapCalendarEventCreate` /
  `jmapCalendarEventUpdate` / `jmapCalendarEventDestroy` were verified and mapped
  under `calendar:write` in v0.15.0 — **no new permission probe needed**.

## What already exists (so the change stays small)

Code map (citations from the current branch base):

- **Runtime create already wraps the id.** `buildEventCreateRequest`
  (`shell/src/runtime/jmap-client.ts:3258`) already emits `calendarIds: {
  [params.calendarId]: true }`. The host (`App.tsx:~1388`) hardcodes
  `calendars[0]` as the target — that hardcode is the only thing forcing the
  default.
- **`CalendarEvent` carries `calendarIds`** (`jmap-client.ts:2400`) and the
  parser reads it (`:2700`).
- **Color is already wired.** `calendar-transform.ts:46` maps event →
  first `calendarIds` entry → calendar color via the `colorByCalId` map
  (`App.tsx:~798`); the chip renders `evt.calendarColor`
  (`calendar-view.tsx:735`). **No rendering work** — assign the right
  `calendarIds` and the color follows.
- **Visibility is already wired.** Hiding a calendar (`hiddenCalendarIdsAtom`)
  already drops its events from the grid. **No work** — reassignment hides/shows
  for free.
- **Bulk MCP tools already exist.** `mail.modify` (`emailIds` array +
  arbitrary keyword/`mailboxIds` patch), `mail.delete` (`emailIds` array), and
  `label.apply` (`emailIds` array, add/remove) all accept **one or more** ids
  today. Bulk move = `mail.modify` mailboxIds patch; bulk flag = `mail.modify`
  `$flagged` keyword patch; bulk label = `label.apply`; bulk delete =
  `mail.delete`. **The agent surface for #2 is already at parity — no new
  `bulk.*` contracts.** #2 is human-UI only.
- **Event MCP contracts do NOT exist.** `event.list` / `event.get` are
  contracted (`calendar:read`), but `event.create` / `event.update` /
  `event.delete` exist only in the runtime invoker
  (`shell/src/runtime/invoker.ts:561`), uncontracted — agents cannot mutate
  events today. This is the parity gap #1 closes.

## #1 — Event → calendar assignment

### Human UI (`shell/src/views/calendar-view.tsx`)

- **`EventFormDialog`** (`:1306`) gains a **Calendar `<select>`** (native select
  styled to match the existing inputs). It lists all calendars from the
  `calendars` prop. `EventFormData` (`:73`) gains `calendarId: string`.
- **Default selection:** create mode → the default calendar (`isDefault`), or
  the first calendar if none flagged; edit mode → the event's current calendar
  (first key of `calendarIds`), falling back to default.
- **Plumbing:** `CalendarView` already receives `calendars: CalendarInfo[]`
  (`:273`); pass it into `EventFormDialog` (currently not received) and render
  the select. On submit, `EventFormData.calendarId` flows to the host.
- **Writable filtering:** out of scope — this is a single-user mailbox with no
  shared calendars, so all calendars are writable. List all. (If sharing is
  added later, filter on `myRights.mayAddItems`, which would also require
  parsing `myRights` — deferred.)

### Host (`shell/src/App.tsx`)

- Create: pass `EventFormData.calendarId` to `invoker.invoke('event.create',
  { calendarId, ... })` instead of the hardcoded `calendars[0].id` (`:~1388`).
- Edit: prefill the form's `calendarId` from the event's `calendarIds`; on
  submit, if it changed, the update carries the new calendar (see runtime).
- After create/update: existing refetch/repaint path already repaints the grid
  with the new color (no extra refresh wiring needed beyond what edit already
  does).

### Runtime (`shell/src/runtime/jmap-client.ts`)

- `EventUpdateInput` (`:3222`) gains optional `calendarId?: string`.
- `buildEventUpdateRequest` (`:3303`) includes `calendarIds: { [calendarId]:
  true }` in the patch **only when `calendarId` is provided** (reassignment;
  probe-confirmed). Other fields unchanged.
- Create path already correct; no change to `buildEventCreateRequest` beyond
  what already exists.

### MCP parity — new contracts (`tools/codegen/contracts/`)

Three new contracts, generated into MCP tools, shipped in the **same** change,
wired to the existing runtime invoker `event.create` / `event.update` /
`event.delete` cases:

- **`event.create`** — input `{ calendarId: string, title: string (min 1),
  start: string, timeZone?: string, duration?: string, description?: string,
  location?: string, attendees?: [...] }`, output `{ eventId: string }`. Scope
  `calendar:write`. `isDestructive: false`. (Input mirrors the existing
  `EventCreateInput` runtime type.)
- **`event.update`** — input `{ eventId: string, calendarId?: string, title?,
  start?, timeZone?, duration?, description?, location?, attendees? }` (at least
  one mutable field; reject all-empty → `nothing_to_update`), output
  `{ updated: true }`. `calendarId` reassigns the event. Scope `calendar:write`.
  Errors: `event_not_found`, `nothing_to_update`. `isDestructive: false`.
- **`event.delete`** — input `{ eventId: string }`. **Destructive**: declares
  `dryRun.preview { title: string }` and honors `_options.dryRun`; commit is
  `CalendarEvent/set { destroy: [eventId] }`. Scope `calendar:write`. Error:
  `event_not_found`. No undo (consistent with the other destructive deletes).

**Scope:** reuse `calendar:write` (already in `ALL_SCOPES`, already mapped to
`jmapCalendarEventCreate/Update/Destroy`). No `agent-settings-view.tsx` or
permission-map change. The codegen expected-tool count bumps by **+3**.

The contract attendee/field shapes are aligned to the existing `event.list` /
`event.get` `CalendarEvent` zod shape and the runtime `EventCreateInput` /
`EventUpdateInput` types so the invoker needs no input-shape translation.

## #2 — Bulk Label + Flag (human UI only)

`shell/src/components/bulk-action-bar.tsx` + dispatch in
`shell/src/views/thread-list.tsx`:

- **Apply label** — reuse the per-row label picker (the same menu/component the
  single-row Label action uses) so the selection's emails get the chosen
  label(s) via `label.apply` (already array-capable). Resolve the selection's
  email ids the same way the existing bulk Move/Delete do
  (`resolveThreadEmailIds`).
- **Flag / Unflag** — a pair (mirroring Mark read / Mark unread), each a
  `mail.modify` keyword patch: Flag → `{ $flagged: true }`, Unflag →
  `{ $flagged: null }` (clear, mirroring how mark-unread uses `{ $seen: null }`
  — never `false`).
- **No MCP work** — `mail.modify` / `label.apply` already accept `emailIds`
  arrays (see "What already exists"). Parity already holds.

## #3 — Undo on move

A move today (single-row `handleMove` and the bulk Move) calls `mail.modify`
with a `mailboxIds` patch and shows no toast. Delete shows "Moved to Trash /
Undo" via the existing toast + `onUndoRegistered` mechanism (`delete-toast.tsx`,
`mail.delete`/ui).

- **Capture before move:** record each affected email's current destination
  context — for a move, the source mailbox id(s) being replaced — before
  issuing the patch.
- **Register inverse:** on a successful move, register an Undo action through
  the same `onUndoRegistered` path the delete toast uses; the inverse is a
  `mail.modify` that restores the captured `mailboxIds`. Toast copy: "Moved to
  <destination folder> / Undo".
- **Scope:** both the single-row move and the bulk-bar move. Undo restores all
  moved messages in one inverse modify.
- This is the move-undo deferred from v0.13.1; it is now in scope because the
  bulk bar makes accidental mass-moves more likely.

## State

No new persistent atoms. The calendars list is App-level state from
`calendar.list` (already fetched, already passed to `CalendarView`). Event-form
calendar choice is local form state (`EventFormData.calendarId`). Move-undo
state rides the existing toast/undo registration; no new store.

## Errors / edge cases

- **Event create with a calendar the user can't write:** not reachable in this
  single-user deployment (all calendars writable); the server would reject and
  the existing capability error surfaces inline.
- **Reassign to the same calendar:** the update simply re-sets the same
  `calendarIds` (no-op server-side) — harmless; the form only sends `calendarId`
  in the patch when it differs, so typically omitted.
- **`event.update` with no mutable fields** → `nothing_to_update`.
- **`event.delete` / `event.update` of a missing event** → `event_not_found`
  (pre-check or map the JMAP `notFound`/`notDestroyed`).
- **Undo after the underlying message changed again:** best-effort — the inverse
  modify restores the captured mailboxIds; if the message moved again meanwhile,
  last-write-wins (same semantics as delete-undo today).
- **Bulk Flag on a mixed selection** (some already flagged): Flag sets
  `$flagged:true` idempotently; Unflag clears — no per-item branching.

## Out of scope (deferred)

- Calendar sharing / `myRights`-based writable filtering (single-user mailbox).
- Multi-calendar-per-event UX (`calendarIds` map supports it; UI stays
  one-calendar-per-event).
- Event recurrence / RRULE editing.
- A dedicated calendar column in any list view.
- New `bulk.*` MCP contracts (existing array-based mail/label tools already
  cover it).

## Testing

- **Pure:** `buildEventUpdateRequest` emits a `calendarIds` patch iff
  `calendarId` is provided (and omits it otherwise); the create request shape is
  unchanged. Event-form default-calendar selection logic (create → default;
  edit → current).
- **Runtime/invoker:** the three event contracts drive real `CalendarEvent/set`
  request bodies through the invoker (the "invoker-seam" test that closed the
  Labels mocked-invoker gap), incl. `event.delete` dry-run vs commit and the
  `event_not_found` mapping.
- **Component:** the event form renders a Calendar select, defaults correctly in
  create vs edit, and dispatches the chosen `calendarId`; the bulk bar's
  Label/Flag/Unflag controls dispatch the expected `label.apply` / `mail.modify`
  calls over the resolved selection; the move toast appears and Undo restores
  the source mailbox. a11y (axe) on the new form control and bulk controls.
- **Codegen:** the 3 new event tools appear with `calendar:write` scope;
  expected-tool count bumped (+3); both typechecks + full multi-package gate.

## Size

Medium (~8–10 TDD tasks): runtime update-builder + EventUpdateInput → 3 event
contracts → event-form calendar select + default logic → host wiring →
bulk Label/Flag controls + dispatch → move-undo capture + inverse + toast →
a11y + full gate. The event-CRUD contracts mirror the v0.15.0 calendar-CRUD
shape end-to-end.
