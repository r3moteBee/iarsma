# Calendar create + manage (P-followup #6) — design

**Date:** 2026-06-24
**Status:** Design — approved in brainstorm, building.
**Source:** v0.13.0 re-test follow-up, item #6 ("Cannot add a second calendar — Calendars panel has no '+' affordance"). Ships **v0.15.0**.

## Goal

Let a human create a new calendar, rename/recolor it, and delete it — from the
Calendars rail in the calendar view — and expose the same three operations to
agents as MCP tools in the same change (standing human/agent parity rule).
Today calendars are read-only in iarsma: `calendar.list` + `event.*` exist, but
there is no way to create or manage a calendar.

**Acceptance:** a "+ New calendar" affordance in the Calendars rail opens a
dialog (name + color) that creates a calendar; each calendar row has an Edit
(rename/recolor) and Delete control; the default calendar cannot be deleted;
deleting a non-empty calendar requires a typed confirmation and then cascades;
the rail and event view refresh without a manual reload. `calendar.create`,
`calendar.update`, and `calendar.delete` are available to agents via MCP with
the same semantics.

## Backend reality (live-probed on Stalwart, 2026-06-24, account `b`)

Creation is **pure JMAP `Calendar/set`** — NOT CalDAV `MKCALENDAR`. Verified
against `sw-mail.r3motely.net`:

- `Calendar/set { create: { x: { name, color } } }` succeeds → returns a short
  calendar id. `color` (`#ff6b35`) round-trips. The object also carries
  `description`, `timeZone`, `sortOrder`, `isDefault`, `isSubscribed`,
  `myRights`. We only set `name` + `color` (YAGNI).
- `Calendar/set { update }` and `{ destroy }` work.
- **Destroy guard:** `destroy` of a non-empty calendar is refused with
  `notDestroyed: { type: "calendarHasEvent", description: "Calendar is not
  empty." }`. `Calendar/set { onDestroyRemoveEvents: true, destroy: [...] }`
  cascade-deletes the calendar and its events. (The calendar analogue of
  Mailbox `onDestroyRemoveEmails`.)
- **No cheap event count:** `CalendarEvent/query` with a `filter.inCalendars`
  condition is rejected (`unsupportedFilter: inCalendars`). An exact
  "N events will be deleted" preview is therefore not feasible — we use
  empty-vs-non-empty (the `calendarHasEvent` refusal) instead.
- The default calendar reports `isDefault: true`. Account id for calendars =
  `primaryAccounts['urn:ietf:params:jmap:calendars']` (= `b`), resolved the
  same way the existing `fetchCalendarList` resolves it.

This mirrors the **Labels** feature shape end-to-end (runtime builders/parsers →
invoker cases → MCP contracts → UI dialog + affordances), which is the
precedent to follow.

## Runtime layer (`shell/src/runtime/jmap-client.ts`)

Add next to the existing `Calendar/get` machinery (`buildCalendarListRequest` /
`parseCalendar`, ~line 2262):

- `buildCalendarCreateRequest({ accountId, name, color? })` →
  `Calendar/set { create: { c: { name, ...(color?) } } }`.
- `fetchCalendarCreateCommit(opts) → { calendarId: string }` — parses the
  `created` map, returns the new id. Mirrors `fetchMailModifyCommit` dispatch
  (token → POST `session.apiUrl` → status check → parse).
- `buildCalendarUpdateRequest({ accountId, calendarId, name?, color? })` →
  `Calendar/set { update: { [calendarId]: { ...patch } } }` (only the provided
  fields).
- `fetchCalendarUpdateCommit(opts) → void` (throws on `notUpdated`).
- `fetchCalendarDeleteCommit({ accountId, calendarId, removeEvents })` →
  `Calendar/set { ...(removeEvents ? { onDestroyRemoveEvents: true } : {}),
  destroy: [calendarId] }`. Returns a typed result that distinguishes the
  `calendarHasEvent` refusal (so callers can tell "blocked, non-empty" from
  other failures) from success.
- `JMAP_USING_CALENDARS` already exists; reuse it.

These are pure where practical (request builders + parsers unit-tested without
network, like the label/mailbox builders).

## Capabilities + MCP parity (`tools/codegen/contracts/`)

Three new contracts, generated into MCP tools, shipped in the **same** change:

- **`calendar.create`** — input `{ name: string (min 1), color?: string }`,
  output `{ calendarId: string }`. `isDestructive: false`, direct commit
  (mirrors `mailbox.create` / `label.create`).
- **`calendar.update`** — input `{ calendarId: string, name?: string,
  color?: string }` (at least one of name/color; reject all-empty),
  output `{}` / success. `isDestructive: false`.
- **`calendar.delete`** — input `{ calendarId: string }`. **Destructive**:
  declares `dryRun.preview { hasEvents: boolean }` (resolved via a
  destroy-without-flag attempt or equivalent cheap check) and honors
  `_options.dryRun`. Commit cascades with `onDestroyRemoveEvents: true`.
  Refuses the **default** calendar (returns a typed refusal, e.g.
  `calendar_is_default`). No undo (consistent with folder delete).

**Scope:** reuse the existing **`calendar:write`** for all three (it already
denotes calendar-domain mutations in `docs/capability-scopes.md`). Accepted
tradeoff: destructive calendar-delete shares a scope with event-create; a
dedicated `calendar:manage` was considered and declined to avoid rippling a new
scope through token-exchange, `agent-settings-view.tsx` `ALL_SCOPES`, and the
Stalwart permission map for marginal benefit.

> **Implementation probe required (Labels `jmapFileNode*` lesson):** before
> hardcoding, live-probe the Stalwart permission name(s) that gate
> `Calendar/set` create/update/destroy, and confirm `calendar:write` maps to
> them. Stalwart validates permission names (bogus → `invalidPatch`), so verify
> against the live server, and add both directions to `ALL_SCOPES` if the matrix
> changes.

## Invoker (`shell/src/runtime/invoker.ts`)

Add cases `calendar.create` / `calendar.update` / `calendar.delete` next to the
existing `calendar.list` / `event.*` cases, dispatching to the new fetch
functions with the calendar account id from the session. `calendar.delete`
routes the dry-run vs commit per the existing destructive-capability pattern
(like `label.delete` / `mailbox.delete`).

## UI (`shell/src/views/calendar-view.tsx`, `CalendarRail`)

Today `CalendarRail` renders, per calendar: a visibility checkbox + color
swatch + name (a `<label>`). Changes:

- **"+ New calendar"** control in the rail header (mirrors the Sidebar
  "+ New folder" / "+ New label" buttons; `var(--accent)` text button).
- Each row gains a small **menu (Edit… / Delete)** beside the existing
  checkbox/swatch/name. The **default** calendar's row shows **Edit… only**
  (no Delete).
- **`CalendarDialog`** (new component, mirrors `CreateLabelDialog` /
  `folder-dialogs.tsx`): a single dialog with create/edit modes — `Input` for
  name + the reused `ColorPalette`. Edit mode is prefilled and calls
  `calendar.update`; create mode calls `calendar.create`. Surfaces capability
  errors inline (`role="alert"`).
- **Delete = empty-aware typed confirm.** A pure helper (e.g.
  `resolveCalendarDeleteState`) drives a confirm dialog: first attempt /
  dry-run reveals `hasEvents`. If empty → light confirm ("Delete <name>?"). If
  non-empty → typed confirm ("This calendar still contains events; deleting it
  permanently removes them. Type DELETE to confirm.") → commit with cascade.
  No exact event count (server can't provide one).
- After create/update/delete: refetch `calendar.list` (the App-level source);
  on a cascade delete also refresh events / bump the push generation so the
  event view drops the removed events without a manual reload. New calendars
  default to visible (existing `hiddenCalendarIdsAtom` semantics unchanged).

## State

No new persistent atoms required. The calendars list is App-level state from
`calendar.list` (refetched after mutations); visibility stays in the existing
`hiddenCalendarIdsAtom`. Dialog/confirm state is local (mirrors the Folder/Label
dialog state held in `App.tsx`).

## Errors / edge cases

- Default calendar delete → capability refuses (`calendar_is_default`); UI
  hides the Delete control on that row as the primary guard.
- Non-empty delete without confirm → never issued; the typed-confirm path is
  the only route to a cascade.
- Concurrent deletion (calendar already gone) → treat `notDestroyed` /
  not-found as success-equivalent (it's gone) and refetch.
- Create/update name blank → client disables submit + capability rejects
  (`min(1)` / all-empty update rejected).
- `calendar.update` with neither name nor color → reject (`nothing_to_update`).

## Out of scope (deferred)

- Sharing / permissions (`myRights`, principals).
- `timeZone`, `description`, `sortOrder`, `isSubscribed` editing (only
  name + color in v0.15.0).
- An exact event-count preview on delete (server can't supply it cheaply).
- A left-Sidebar calendars section (calendars stay in the calendar-view rail).
- `event.create/update/delete` MCP contracts (runtime exists; separate item).

## Testing

- Pure: request builders (`Calendar/set` create/update/destroy shapes incl.
  `onDestroyRemoveEvents`), response parsers, and the `resolveCalendarDeleteState`
  helper (empty → light confirm; non-empty → typed confirm; default → blocked).
- Runtime/invoker: the three new cases drive real `Calendar/set` request bodies
  through the invoker (the "invoker-seam" test that closed the Labels mocked-
  invoker gap), incl. dry-run vs commit routing for `calendar.delete` and the
  `calendarHasEvent` → `hasEvents:true` mapping.
- Component: "+ New calendar" opens the dialog; create/edit dispatch the
  expected capability calls; the row menu hides Delete on the default; the
  typed-confirm delete requires the exact phrase before cascading; list/events
  refresh after a mutation. a11y (axe) on the dialog + rail menu.
- Codegen: the 3 new tools appear in the generated set with `calendar:write`
  scope; expected-tool count bumped; both typechecks + full multi-package gate.

## Size

Medium (~8–10 TDD tasks): runtime builders/parsers → 3 contracts + scope map
(with the Stalwart permission probe) → invoker cases → CalendarDialog →
"+"/row-menu wiring → empty-aware delete confirm → list/event refresh → a11y +
gate. Mirrors the Labels plan structure.
