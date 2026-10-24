# Event → calendar assignment + bulk Flag + move-undo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users assign an event to a specific calendar (create + reassign-on-edit), expose event create/update/delete to agents as MCP tools, add bulk Flag/Unflag to the multi-select bar, and show an Undo toast on move.

**Architecture:** Pure JMAP `CalendarEvent/set` (probe-confirmed: `calendarIds` is settable on create AND mutable on update — not CalDAV). The runtime fetch/parse functions and invoker cases for `event.create/update/delete` already exist and are uncontracted; this plan adds the missing reassignment patch, three MCP contracts, the form selector, and presentation wiring for two already-built subsystems (the bulk Label menu and the move-inverse undo registry).

**Tech Stack:** TypeScript, React + jotai, zod contracts → codegen MCP tools, vitest, pnpm workspace.

## Global Constraints

- Ships **v0.16.0**. Tag-driven release (root `package.json` stays `0.0.0`).
- All event mutation tools use the existing **`calendar:write`** scope — already in `ALL_SCOPES` and already mapped to `jmapCalendarEventCreate/Update/Destroy` in `mcp-server/src/stalwart-permissions.ts`. **No scope or permission-map changes.**
- JMAP "remove keyword" patches use `null`, never `false` (e.g. unflag = `{ $flagged: null }`), mirroring the existing mark-unread convention.
- ToolError shape is `{ code, message, payload? }` (field is `.code`). `makeError(code,message,payload?)` lives in `jmap-client.ts`; `makeToolError(code,message)` in `invoker.ts`.
- Contracts are auto-discovered by directory scan of `tools/codegen/contracts/`. The expected-tool-count assertion in `tools/codegen/src/__tests__/run.test.ts` (currently `29`) MUST be bumped when adding contracts.
- Account id for calendars/events = `session.primaryAccountIdMail` (resolved inside the existing fetch functions).
- Event participant field is named **`participants`** (JSCalendar), not "attendees", at the runtime/contract layer; the form-level type is `EventFormAttendee[]` mapped to participants by the host.
- TDD: write the failing test, watch it fail, implement minimally, watch it pass, commit. Run focused tests during a task; run the full multi-package gate in the final task.

---

### Task 1: Runtime — `calendarId` reassignment on event update

**Files:**
- Modify: `shell/src/runtime/jmap-client.ts` (`EventUpdateInput` ~3222, `buildEventUpdateRequest` ~3303)
- Test: `shell/src/runtime/__tests__/event-set.test.ts` (create if absent; otherwise add to the existing event builder test file)

**Interfaces:**
- Consumes: existing `buildEventUpdateRequest({ accountId, params })`, `EventUpdateInput`, `JMAP_USING_CALENDARS`.
- Produces: `EventUpdateInput` gains `readonly calendarId?: string`; `buildEventUpdateRequest` emits `calendarIds: { [calendarId]: true }` in the patch **iff** `calendarId` is provided.

- [ ] **Step 1: Write the failing test**

```typescript
// shell/src/runtime/__tests__/event-set.test.ts
import { describe, it, expect } from 'vitest';
import { buildEventUpdateRequest } from '../jmap-client.js';

describe('buildEventUpdateRequest — calendar reassignment', () => {
  it('includes a calendarIds patch when calendarId is provided', () => {
    const body = JSON.parse(
      buildEventUpdateRequest({
        accountId: 'b',
        params: { eventId: 'ev1', calendarId: 'cal2', title: 'Renamed' },
      }),
    );
    const patch = body.methodCalls[0][1].update.ev1;
    expect(patch.calendarIds).toEqual({ cal2: true });
    expect(patch.title).toBe('Renamed');
  });

  it('omits calendarIds when calendarId is absent', () => {
    const body = JSON.parse(
      buildEventUpdateRequest({
        accountId: 'b',
        params: { eventId: 'ev1', title: 'Only title' },
      }),
    );
    const patch = body.methodCalls[0][1].update.ev1;
    expect(patch.calendarIds).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd shell && pnpm vitest run src/runtime/__tests__/event-set.test.ts`
Expected: FAIL — `calendarIds` is `undefined` in the first test (field not yet emitted).

- [ ] **Step 3: Implement minimally**

In `EventUpdateInput` (jmap-client.ts ~3222), add the field after `eventId`:

```typescript
export type EventUpdateInput = {
  readonly eventId: string;
  readonly calendarId?: string;
  readonly title?: string;
  // ...unchanged...
};
```

In `buildEventUpdateRequest`, add this block at the top of the patch assembly (right after `const patch: Record<string, unknown> = {};`):

```typescript
  if (params.calendarId !== undefined) {
    patch.calendarIds = { [params.calendarId]: true };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd shell && pnpm vitest run src/runtime/__tests__/event-set.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add shell/src/runtime/jmap-client.ts shell/src/runtime/__tests__/event-set.test.ts
git commit -m "feat(calendar): support calendarId reassignment in buildEventUpdateRequest"
```

---

### Task 2: Runtime — map JMAP `notFound` to `event_not_found` in update/delete parsers

**Files:**
- Modify: `shell/src/runtime/jmap-client.ts` (`parseEventUpdateResponse` ~3450, `parseEventDeleteResponse` ~3498)
- Test: `shell/src/runtime/__tests__/event-parse.test.ts` (create)

**Interfaces:**
- Consumes: existing `parseEventUpdateResponse(body)`, `parseEventDeleteResponse(body)`, `makeError`.
- Produces: both throw `makeError('event_not_found', …)` when the relevant `notUpdated`/`notDestroyed` entry has `type === 'notFound'` (the RFC 8620 standard SetError for an unknown id); any other rejection still throws `jmap_set_error`. Success unchanged.

- [ ] **Step 1: Write the failing test**

```typescript
// shell/src/runtime/__tests__/event-parse.test.ts
import { describe, it, expect } from 'vitest';
import { parseEventUpdateResponse, parseEventDeleteResponse } from '../jmap-client.js';

const wrap = (method: string, result: unknown) =>
  JSON.stringify({ methodResponses: [[method, result, '0']] });

describe('event parsers — event_not_found mapping', () => {
  it('update: notFound → event_not_found', () => {
    const body = wrap('CalendarEvent/set', { notUpdated: { ev1: { type: 'notFound' } } });
    expect(() => parseEventUpdateResponse(body)).toThrowError(/not found|event_not_found/i);
    try { parseEventUpdateResponse(body); } catch (e) { expect((e as { code: string }).code).toBe('event_not_found'); }
  });

  it('update: other rejection stays jmap_set_error', () => {
    const body = wrap('CalendarEvent/set', { notUpdated: { ev1: { type: 'forbidden' } } });
    try { parseEventUpdateResponse(body); } catch (e) { expect((e as { code: string }).code).toBe('jmap_set_error'); }
  });

  it('delete: notFound → event_not_found', () => {
    const body = wrap('CalendarEvent/set', { notDestroyed: { ev1: { type: 'notFound' } } });
    try { parseEventDeleteResponse(body); } catch (e) { expect((e as { code: string }).code).toBe('event_not_found'); }
  });

  it('delete: success returns {deleted:true}', () => {
    const body = wrap('CalendarEvent/set', { destroyed: ['ev1'] });
    expect(parseEventDeleteResponse(body)).toEqual({ deleted: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd shell && pnpm vitest run src/runtime/__tests__/event-parse.test.ts`
Expected: FAIL — code is `jmap_set_error`, not `event_not_found`.

- [ ] **Step 3: Implement minimally**

In `parseEventUpdateResponse`, replace the existing `if (result.notUpdated !== undefined)` block body with:

```typescript
  if (result.notUpdated !== undefined) {
    const entries = Object.entries(result.notUpdated);
    if (entries.length > 0) {
      const [id, err] = entries[0]!;
      if (err.type === 'notFound') {
        throw makeError('event_not_found', `CalendarEvent ${id} not found.`, result.notUpdated);
      }
      throw makeError(
        'jmap_set_error',
        `CalendarEvent/set update rejected for ${id}: ${err.type ?? 'unknown'}${err.description !== undefined ? ` — ${err.description}` : ''}`,
        result.notUpdated,
      );
    }
  }
```

In `parseEventDeleteResponse`, replace the existing `if (result.notDestroyed !== undefined && …)` block with:

```typescript
  if (result.notDestroyed !== undefined && Object.keys(result.notDestroyed).length > 0) {
    const ids = Object.keys(result.notDestroyed);
    const firstId = ids[0]!;
    const firstEntry = result.notDestroyed[firstId]!;
    if (firstEntry.type === 'notFound') {
      throw makeError('event_not_found', `CalendarEvent ${firstId} not found.`, result.notDestroyed);
    }
    const details = ids
      .map((id) => {
        const entry = result.notDestroyed![id]!;
        return `${id}: ${entry.type ?? 'unknown'}${entry.description !== undefined ? ` — ${entry.description}` : ''}`;
      })
      .join('; ');
    throw makeError('jmap_set_error', `CalendarEvent/set notDestroyed: ${details}`, result.notDestroyed);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd shell && pnpm vitest run src/runtime/__tests__/event-parse.test.ts`
Expected: PASS (4 cases).

- [ ] **Step 5: Commit**

```bash
git add shell/src/runtime/jmap-client.ts shell/src/runtime/__tests__/event-parse.test.ts
git commit -m "feat(calendar): map JMAP notFound to event_not_found in event update/delete parsers"
```

---

### Task 3: Invoker — `calendarId` in update dry-run echo + `nothing_to_update` guard

**Files:**
- Modify: `shell/src/runtime/invoker.ts` (`case 'event.update':` ~582)
- Test: `shell/src/runtime/__tests__/invoker-event.test.ts` (create)

**Interfaces:**
- Consumes: existing invoker `invoke(tool, input, options)`, `makeToolError`, the `event.update` case.
- Produces: `event.update` throws `makeToolError('nothing_to_update', …)` when no mutable field (`calendarId|title|start|duration|description|location|participants`) is present; the dry-run echo includes `calendarId` when provided.

- [ ] **Step 1: Write the failing test**

```typescript
// shell/src/runtime/__tests__/invoker-event.test.ts
import { describe, it, expect } from 'vitest';
import { createInvoker } from '../invoker.js';

// Minimal invoker wired with a fetch stub; mirror the construction used in
// the existing invoker tests in this directory (copy their `makeInvoker`
// helper if present). The dry-run path needs no network.
function makeTestInvoker() {
  return createInvoker({
    getAuthToken: async () => 'tok',
    getSession: async () => { throw new Error('network not expected in dry-run'); },
  } as never);
}

describe('invoker event.update', () => {
  it('rejects an update with no mutable fields', async () => {
    const invoker = makeTestInvoker();
    await expect(
      invoker.invoke('event.update', { eventId: 'ev1' }, { dryRun: true }),
    ).rejects.toMatchObject({ code: 'nothing_to_update' });
  });

  it('dry-run echoes calendarId when provided', async () => {
    const invoker = makeTestInvoker();
    const preview = await invoker.invoke(
      'event.update',
      { eventId: 'ev1', calendarId: 'cal2' },
      { dryRun: true },
    );
    expect(preview).toMatchObject({ eventId: 'ev1', calendarId: 'cal2' });
  });
});
```

> Implementer note: align `makeTestInvoker` with the existing invoker-test
> construction in this folder (e.g. `invoker-calendar.test.ts`). The two
> assertions above are the behavior contract; adapt only the wiring.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd shell && pnpm vitest run src/runtime/__tests__/invoker-event.test.ts`
Expected: FAIL — no `nothing_to_update` guard; dry-run echo lacks `calendarId`.

- [ ] **Step 3: Implement minimally**

In `invoker.ts`, at the top of `case 'event.update': {`, before the dry-run branch:

```typescript
        case 'event.update': {
          const params = _input as unknown as EventUpdateInput;
          const hasMutable =
            params.calendarId !== undefined ||
            params.title !== undefined ||
            params.start !== undefined ||
            params.duration !== undefined ||
            params.description !== undefined ||
            params.location !== undefined ||
            params.participants !== undefined;
          if (!hasMutable) {
            throw makeToolError('nothing_to_update', 'event.update requires at least one field to change.');
          }
          if (_options.dryRun === true) {
            return {
              eventId: params.eventId,
              ...(params.calendarId !== undefined ? { calendarId: params.calendarId } : {}),
              ...(params.title !== undefined ? { title: params.title } : {}),
              ...(params.start !== undefined ? { start: params.start } : {}),
              ...(params.duration !== undefined ? { duration: params.duration } : {}),
              ...(params.description !== undefined ? { description: params.description } : {}),
              ...(params.location !== undefined ? { location: params.location } : {}),
            } as unknown as O | DryRunPreview<O>;
          }
          // ...existing getSession + fetchEventUpdateCommit unchanged...
```

(Leave the existing `getSession()` / `fetchEventUpdateCommit` tail intact.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd shell && pnpm vitest run src/runtime/__tests__/invoker-event.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shell/src/runtime/invoker.ts shell/src/runtime/__tests__/invoker-event.test.ts
git commit -m "feat(calendar): event.update nothing_to_update guard + calendarId dry-run echo"
```

---

### Task 4: MCP contracts — `event.create` / `event.update` / `event.delete`

**Files:**
- Create: `tools/codegen/contracts/event-create.ts`, `event-update.ts`, `event-delete.ts`
- Modify: `tools/codegen/src/__tests__/run.test.ts` (count `29` → `32`, line ~162; add the three names to the comment block ~159)
- Test: the codegen run test (existing)

**Interfaces:**
- Consumes: `capability` from `../src/index.js`; the runtime `EventCreateInput` / `EventUpdateInput` shapes (jmap-client.ts ~3206 and ~3222) and `EventParticipantInput` (~3186) — the contract inputs mirror them so the invoker needs no translation.
- Produces: three MCP tools under `calendar:write`. `event.create` → `{eventId}`; `event.update` → `{updated}` (errors `nothing_to_update`, `event_not_found`); `event.delete` destructive → `{deleted}`, dry-run preview `{eventId}`, error `event_not_found`.

- [ ] **Step 1: Write the failing test** (bump the count assertion first, so the suite fails until the files exist)

In `tools/codegen/src/__tests__/run.test.ts`, append to the comment block (~159) and change the assertion (~162):

```typescript
    // ...calendar.create + calendar.update + calendar.delete +
    // event.create + event.update + event.delete.
    // Bump explicitly when adding contracts so a missing or duplicate
    // contract surfaces in code review.
    expect(r.capabilities).toBe(32);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tools/codegen && pnpm vitest run src/__tests__/run.test.ts -t 'walks the real contracts'`
Expected: FAIL — `expected 29 to be 32` (contracts not created yet).

- [ ] **Step 3: Create the three contract files**

`tools/codegen/contracts/event-create.ts`:

```typescript
import { z } from 'zod';
import { capability } from '../src/index.js';

const Participant = z.object({
  email: z.string().describe('Participant email address.'),
  name: z.string().optional().describe('Display name.'),
  roles: z.record(z.boolean()).describe('JSCalendar roles map, e.g. { attendee: true } or { owner: true }.'),
  participationStatus: z
    .enum(['needs-action', 'accepted', 'declined', 'tentative', 'delegated'])
    .optional()
    .describe('RSVP status. Defaults server-side.'),
  expectReply: z.boolean().optional().describe('Whether an RSVP is expected.'),
});

export const eventCreate = capability({
  name: 'event.create',
  version: '0.0.1',
  scopes: ['calendar:write'],
  description:
    'Create a calendar event (JMAP CalendarEvent/set create). The event is ' +
    'placed on `calendarId` — resolve writable calendars via calendar.list. ' +
    '`start` is an ISO local datetime (e.g. "2026-07-01T10:00:00"); pass ' +
    '`timeZone` to anchor it. Returns the server-issued `eventId`.',
  isDestructive: false,
  input: z.object({
    calendarId: z.string().describe('Calendar to create the event on (from calendar.list).'),
    title: z.string().min(1).describe('Event title / summary.'),
    start: z.string().describe('ISO local datetime, e.g. "2026-07-01T10:00:00".'),
    duration: z.string().optional().describe('ISO 8601 duration, e.g. "PT1H", "P1D".'),
    timeZone: z.string().optional().describe('IANA time zone, e.g. "America/New_York".'),
    description: z.string().optional().describe('Event description / notes.'),
    location: z.string().optional().describe('Single location name.'),
    participants: z.array(Participant).optional().describe('Attendees + organizer; triggers iTIP when emails resolve.'),
  }),
  output: z.object({
    eventId: z.string().describe('Server-issued id of the created event.'),
  }),
  examples: [
    {
      title: 'Create an event on a specific calendar',
      input: { calendarId: 'cal-personal', title: 'Dentist', start: '2026-07-01T10:00:00', timeZone: 'America/New_York', duration: 'PT1H' },
      output: { eventId: 'ev-abc123' },
    },
  ],
});
```

`tools/codegen/contracts/event-update.ts`:

```typescript
import { z } from 'zod';
import { capability } from '../src/index.js';

const Participant = z.object({
  email: z.string().describe('Participant email address.'),
  name: z.string().optional().describe('Display name.'),
  roles: z.record(z.boolean()).describe('JSCalendar roles map.'),
  participationStatus: z
    .enum(['needs-action', 'accepted', 'declined', 'tentative', 'delegated'])
    .optional()
    .describe('RSVP status.'),
  expectReply: z.boolean().optional().describe('Whether an RSVP is expected.'),
});

export const eventUpdate = capability({
  name: 'event.update',
  version: '0.0.1',
  scopes: ['calendar:write'],
  description:
    'Update a calendar event (JMAP CalendarEvent/set update). Pass `eventId` ' +
    'and at least one field to change. Set `calendarId` to MOVE the event to ' +
    'another calendar (reassignment). Passing `participants: []` clears ' +
    'attendees. Refusals (stable codes you can branch on): `nothing_to_update` ' +
    '(no mutable field given), `event_not_found` (eventId does not exist).',
  isDestructive: false,
  input: z.object({
    eventId: z.string().describe('Event to update (from event.list / event.get).'),
    calendarId: z.string().optional().describe('Move the event to this calendar.'),
    title: z.string().optional().describe('New title.'),
    start: z.string().optional().describe('New ISO local datetime.'),
    duration: z.string().optional().describe('New ISO 8601 duration.'),
    description: z.string().optional().describe('New description.'),
    location: z.string().optional().describe('New single location name.'),
    participants: z.array(Participant).optional().describe('Replacement participants; empty array clears.'),
  }),
  output: z.object({
    updated: z.boolean().describe('True when the event was updated.'),
  }),
  errors: [
    { code: 'nothing_to_update', description: 'No mutable field was provided.' },
    { code: 'event_not_found', description: 'The eventId does not exist or is inaccessible.' },
  ],
  examples: [
    { title: 'Move an event to another calendar', input: { eventId: 'ev-abc123', calendarId: 'cal-work' }, output: { updated: true } },
    { title: 'Rename an event', input: { eventId: 'ev-abc123', title: 'Dentist (rescheduled)' }, output: { updated: true } },
  ],
});
```

`tools/codegen/contracts/event-delete.ts`:

```typescript
import { z } from 'zod';
import { capability } from '../src/index.js';

export const eventDelete = capability({
  name: 'event.delete',
  version: '0.0.1',
  scopes: ['calendar:write'],
  description:
    'Delete a calendar event (JMAP CalendarEvent/set destroy). No undo. ' +
    'Dry-run echoes the eventId that would be deleted. Refusals (stable codes ' +
    'you can branch on): `event_not_found` (eventId does not exist).',
  isDestructive: true,
  input: z.object({
    eventId: z.string().describe('Event to delete.'),
  }),
  output: z.object({
    deleted: z.boolean().describe('True when the event was destroyed.'),
  }),
  dryRun: {
    preview: z.object({
      eventId: z.string().describe('The event id that would be deleted.'),
    }),
  },
  errors: [
    { code: 'event_not_found', description: 'The eventId does not exist or is inaccessible.' },
  ],
  examples: [
    { title: 'Delete an event', input: { eventId: 'ev-abc123' }, output: { deleted: true } },
  ],
});
```

- [ ] **Step 4: Run the codegen test + verify counts**

Run: `cd tools/codegen && pnpm vitest run src/__tests__/run.test.ts`
Expected: PASS — `r.capabilities` is now `32`; per-capability schema files generate without error.

- [ ] **Step 5: Commit**

```bash
git add tools/codegen/contracts/event-create.ts tools/codegen/contracts/event-update.ts tools/codegen/contracts/event-delete.ts tools/codegen/src/__tests__/run.test.ts
git commit -m "feat(calendar): event.create/update/delete MCP contracts (calendar:write)"
```

---

### Task 5: Event form — Calendar selector (create + reassign) wired through to the host

**Files:**
- Modify: `shell/src/views/calendar-view.tsx` (`EventFormData` ~73; `EventFormDialog` ~1306; the `<EventFormDialog … />` render site — grep `editEvent=` / `onSave=` within `CalendarView`)
- Modify: `shell/src/App.tsx` (`onSaveEvent` ~1377, `onUpdateEvent` ~1398)
- Test: `shell/src/views/__tests__/event-form-calendar.test.tsx` (create)

**Interfaces:**
- Consumes: `EventFormData`, `CalendarInfo` (has `id`, `name`, `color?`, `isDefault?`), `CalendarViewEvent.calendarId`, the existing `calendars` prop on `CalendarView`.
- Produces: `EventFormData` gains `readonly calendarId?: string`; `EventFormDialog` accepts `calendars: readonly CalendarInfo[]`, renders a `<select id="event-calendar">`, defaults to the event's calendar (edit) or the default/first calendar (create), and includes `calendarId` in the submitted `EventFormData`. The host forwards it to `event.create` / `event.update`.

- [ ] **Step 1: Write the failing test**

```tsx
// shell/src/views/__tests__/event-form-calendar.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CalendarView } from '../calendar-view.js';

const calendars = [
  { id: 'cal-default', name: 'Stalwart Calendar', isDefault: true },
  { id: 'cal-personal', name: 'Personal', color: '#ff6b35' },
];

function openCreateForm() {
  // Render CalendarView with calendars and trigger the New Event affordance.
  // Mirror the harness used by the existing calendar-view tests in this dir
  // (they already render CalendarView and open EventFormDialog).
}

describe('EventFormDialog — calendar selector', () => {
  it('create mode defaults the selector to the default calendar', async () => {
    const onSaveEvent = vi.fn().mockResolvedValue(undefined);
    render(
      <CalendarView
        events={[]} calendars={calendars} view="month"
        onViewChange={() => {}} currentDate={new Date('2026-07-01T00:00:00')}
        onDateChange={() => {}} onSaveEvent={onSaveEvent}
      />,
    );
    // Open the New Event dialog (use the same control the existing tests use).
    fireEvent.click(screen.getByRole('button', { name: /new event/i }));
    const select = screen.getByLabelText(/calendar/i) as HTMLSelectElement;
    expect(select.value).toBe('cal-default');

    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Lunch' } });
    fireEvent.change(select, { target: { value: 'cal-personal' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(onSaveEvent).toHaveBeenCalledWith(expect.objectContaining({ calendarId: 'cal-personal' }));
  });
});
```

> Implementer note: match the open-the-dialog mechanics to the existing
> `calendar-view` test(s) in `shell/src/views/__tests__/`. The behavioral
> assertions (default = `cal-default`; submitted data carries the chosen
> `calendarId`) are the contract. Add an edit-mode case asserting the selector
> defaults to `editEvent.calendarId`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd shell && pnpm vitest run src/views/__tests__/event-form-calendar.test.tsx`
Expected: FAIL — no calendar `<select>` / `getByLabelText(/calendar/i)` not found.

- [ ] **Step 3: Implement**

(a) `EventFormData` (~73) — add the field:

```typescript
export type EventFormData = {
  readonly title: string;
  readonly date: string;
  readonly startTime: string;
  readonly duration: string;
  readonly calendarId?: string;
  readonly description?: string;
  readonly location?: string;
  readonly attendees?: readonly EventFormAttendee[];
};
```

(b) `EventFormDialog` (~1306) — accept `calendars`, compute the initial id, render the select, include it on submit. Add to the prop type: `readonly calendars: readonly CalendarInfo[];`. After the existing `initialDuration` line:

```typescript
  const defaultCalendarId =
    calendars.find((c) => c.isDefault)?.id ?? calendars[0]?.id ?? '';
  const initialCalendarId = editEvent?.calendarId ?? defaultCalendarId;
  const [calendarId, setCalendarId] = useState(initialCalendarId);
```

In `handleSubmit`, add to the `data` object (only when a calendar exists):

```typescript
      ...(calendarId !== '' ? { calendarId } : {}),
```

Render the select as the first `formField` inside `.eventForm` (above Title), only when there are calendars to choose from:

```tsx
        {calendars.length > 0 ? (
          <div className={styles.formField}>
            <label htmlFor="event-calendar" className={styles.formLabel}>
              Calendar
            </label>
            <select
              id="event-calendar"
              className={styles.formSelect}
              value={calendarId}
              onChange={(e) => setCalendarId(e.target.value)}
            >
              {calendars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
```

At the `<EventFormDialog … />` render site inside `CalendarView`, pass the prop: `calendars={calendars ?? []}`.

(c) `App.tsx` `onSaveEvent` (~1378) — use the chosen calendar, falling back to the default:

```typescript
            onSaveEvent={async (data) => {
              const targetCalendarId = data.calendarId ?? calendars[0]?.id;
              if (targetCalendarId === undefined) {
                throw new Error('No calendar available to create event in.');
              }
              const startIso = `${data.date}T${data.startTime}:00`;
              const participants = buildEventParticipants(data.attendees, organizerIdentity);
              await invoker.invoke('event.create', {
                calendarId: targetCalendarId,
                title: data.title,
                start: startIso,
                duration: data.duration,
                ...(data.description !== undefined ? { description: data.description } : {}),
                ...(data.location !== undefined ? { location: data.location } : {}),
                ...(participants !== undefined ? { participants } : {}),
              });
              setCrudRefresh((n) => n + 1);
            }}
```

`onUpdateEvent` (~1404) — forward `calendarId` when present:

```typescript
              await invoker.invoke('event.update', {
                eventId: id,
                ...(data.calendarId !== undefined ? { calendarId: data.calendarId } : {}),
                title: data.title,
                start: startIso,
                duration: data.duration,
                ...(data.description !== undefined ? { description: data.description } : {}),
                ...(data.location !== undefined ? { location: data.location } : {}),
                ...(participants !== undefined ? { participants } : {}),
              });
```

- [ ] **Step 4: Run test + typecheck**

Run: `cd shell && pnpm vitest run src/views/__tests__/event-form-calendar.test.tsx && pnpm typecheck`
Expected: PASS; 0 type errors.

- [ ] **Step 5: Commit**

```bash
git add shell/src/views/calendar-view.tsx shell/src/App.tsx shell/src/views/__tests__/event-form-calendar.test.tsx
git commit -m "feat(calendar): event form calendar selector (assign on create, reassign on edit)"
```

---

### Task 6: Bulk bar — Flag / Unflag (+ Move/Label menu captions)

**Files:**
- Modify: `shell/src/components/bulk-action-bar.tsx`
- Modify: `shell/src/views/thread-list.tsx` (bulk handlers ~714-744; `<BulkActionBar … />` render ~918)
- Test: `shell/src/components/__tests__/bulk-action-bar.test.tsx` (create or extend)

**Interfaces:**
- Consumes: existing `BulkActionBarProps`, `runBulk`, `invoker.invoke('mail.modify', …)`.
- Produces: `BulkActionBarProps` gains `onFlag: () => void` and `onUnflag: () => void`; the bar renders Flag and Unflag buttons. `thread-list.tsx` gains `handleBulkFlag` (`{ keywords: { $flagged: true } }`) and `handleBulkUnflag` (`{ keywords: { $flagged: null } }`) and passes them.

- [ ] **Step 1: Write the failing test**

```tsx
// shell/src/components/__tests__/bulk-action-bar.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BulkActionBar } from '../bulk-action-bar.js';

const base = {
  count: 2, moveTargets: [], labels: [],
  onMarkRead: () => {}, onMarkUnread: () => {}, onMove: () => {},
  onLabelToggle: () => {}, onDelete: () => {}, onClear: () => {},
};

describe('BulkActionBar — flag', () => {
  it('renders Flag and Unflag and dispatches them', () => {
    const onFlag = vi.fn();
    const onUnflag = vi.fn();
    render(<BulkActionBar {...base} onFlag={onFlag} onUnflag={onUnflag} />);
    fireEvent.click(screen.getByRole('button', { name: /^flag$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^unflag$/i }));
    expect(onFlag).toHaveBeenCalledOnce();
    expect(onUnflag).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd shell && pnpm vitest run src/components/__tests__/bulk-action-bar.test.tsx`
Expected: FAIL — `onFlag` not a prop; no Flag button.

- [ ] **Step 3: Implement**

In `bulk-action-bar.tsx`: add `FlagIcon` to the icon import (use the existing flag icon from `./icons.js`; if the name differs, match the per-row flag icon used in `thread-list.tsx`). Add to `BulkActionBarProps`:

```typescript
  readonly onFlag: () => void;
  readonly onUnflag: () => void;
```

Add the two buttons after Mark unread (line ~51):

```tsx
      <Button variant="ghost" size="sm" onClick={props.onFlag} aria-label="Flag">
        <FlagIcon /> Flag
      </Button>
      <Button variant="ghost" size="sm" onClick={props.onUnflag} aria-label="Unflag">
        <FlagIcon /> Unflag
      </Button>
```

Give the Move and Label menu buttons a visible caption (discoverability — the re-test missed the icon-only Label menu). Change the `MenuButton` children to include text:

```tsx
        <MenuButton size="sm" label="Move selected to…" items={/* unchanged */}>
          <MoveToFolderIcon /> Move
        </MenuButton>
```
```tsx
        <MenuButton size="sm" label="Label selected" items={/* unchanged */}>
          <LabelTagIcon /> Label
        </MenuButton>
```

In `thread-list.tsx`, add after `handleBulkMarkUnread` (~723):

```typescript
  const handleBulkFlag = useCallback(
    () => runBulk((emailIds) => invoker.invoke('mail.modify', { emailIds, patch: { keywords: { $flagged: true } } })),
    [runBulk, invoker],
  );
  const handleBulkUnflag = useCallback(
    () => runBulk((emailIds) => invoker.invoke('mail.modify', { emailIds, patch: { keywords: { $flagged: null } } })),
    [runBulk, invoker],
  );
```

Pass them to `<BulkActionBar>` (~918):

```tsx
            onFlag={handleBulkFlag}
            onUnflag={handleBulkUnflag}
```

- [ ] **Step 4: Run test + typecheck**

Run: `cd shell && pnpm vitest run src/components/__tests__/bulk-action-bar.test.tsx && pnpm typecheck`
Expected: PASS; 0 type errors (every other `<BulkActionBar>` usage — incl. tests — must now pass `onFlag`/`onUnflag`; update any that break).

- [ ] **Step 5: Commit**

```bash
git add shell/src/components/bulk-action-bar.tsx shell/src/views/thread-list.tsx shell/src/components/__tests__/bulk-action-bar.test.tsx
git commit -m "feat(mail): bulk Flag/Unflag + visible Move/Label menu captions"
```

---

### Task 7: Move-undo — surface the already-registered inverse as a toast

**Files:**
- Create: `shell/src/runtime/move-undo.ts` (pure resolver) + `shell/src/runtime/__tests__/move-undo.test.ts`
- Modify: `shell/src/mail-state.ts` (`PendingDeleteUndo` type ~62; add optional `message`)
- Modify: `shell/src/components/delete-toast.tsx` (use `pending.message ?? <default>`)
- Modify: `shell/src/App.tsx` (`onUndoRegistered` ~249)

**Interfaces:**
- Consumes: the `onUndoRegistered` `info` object `{ tool, callerClass, seq, params }`; `pendingDeleteUndoAtom`; the registered inverse (already built by `buildInverse` for `mail.modify` mailboxId patches).
- Produces: `resolveMoveUndo(info, lookupMailboxName)` → `{ seq, count, message } | null`. Returns a record only for a UI `mail.modify` whose `patch.mailboxIds` adds exactly one destination (`=== true`); message is `"Moved to <name>"` (count 1) or `"<n> messages moved to <name>"`. `PendingDeleteUndo` gains `readonly message?: string`; `DeleteToast` renders it.

- [ ] **Step 1: Write the failing test**

```typescript
// shell/src/runtime/__tests__/move-undo.test.ts
import { describe, it, expect } from 'vitest';
import { resolveMoveUndo } from '../move-undo.js';

const name = (id: string) => (id === 'mb-archive' ? 'Archive' : id);

describe('resolveMoveUndo', () => {
  it('builds a move-undo record for a UI move', () => {
    const r = resolveMoveUndo(
      { tool: 'mail.modify', callerClass: 'ui', seq: 7,
        params: { emailIds: ['E1', 'E2'], patch: { mailboxIds: { 'mb-inbox': false, 'mb-archive': true } } } },
      name,
    );
    expect(r).toEqual({ seq: 7, count: 2, message: '2 messages moved to Archive' });
  });

  it('uses singular copy for one message', () => {
    const r = resolveMoveUndo(
      { tool: 'mail.modify', callerClass: 'ui', seq: 9,
        params: { emailIds: ['E1'], patch: { mailboxIds: { 'mb-inbox': false, 'mb-archive': true } } } },
      name,
    );
    expect(r?.message).toBe('Moved to Archive');
  });

  it('returns null for a keyword-only modify (flag/read)', () => {
    expect(resolveMoveUndo(
      { tool: 'mail.modify', callerClass: 'ui', seq: 1, params: { emailIds: ['E1'], patch: { keywords: { $flagged: true } } } },
      name,
    )).toBeNull();
  });

  it('returns null for non-ui callers and non-modify tools', () => {
    expect(resolveMoveUndo({ tool: 'mail.modify', callerClass: 'agent', seq: 1, params: { emailIds: ['E1'], patch: { mailboxIds: { 'mb-archive': true } } } }, name)).toBeNull();
    expect(resolveMoveUndo({ tool: 'mail.delete', callerClass: 'ui', seq: 1, params: { emailIds: ['E1'] } }, name)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd shell && pnpm vitest run src/runtime/__tests__/move-undo.test.ts`
Expected: FAIL — `move-undo.js` does not exist.

- [ ] **Step 3: Implement the resolver**

`shell/src/runtime/move-undo.ts`:

```typescript
/**
 * Pure resolver: turn an `onUndoRegistered` notification for a UI folder
 * MOVE into the toast record the DeleteToast surfaces. A move is a
 * `mail.modify` whose patch sets exactly one mailbox to `true` (the
 * destination) — keyword-only modifies (flag/read) and agent-issued
 * calls return null (no toast). The inverse itself is already registered
 * by the loggingInvoker/undo-registry under `seq`.
 */
export type UndoRegisteredInfo = {
  readonly tool: string;
  readonly callerClass: string;
  readonly seq: number;
  readonly params: unknown;
};

export type MoveUndoRecord = {
  readonly seq: number;
  readonly count: number;
  readonly message: string;
};

export function resolveMoveUndo(
  info: UndoRegisteredInfo,
  lookupMailboxName: (id: string) => string,
): MoveUndoRecord | null {
  if (info.tool !== 'mail.modify' || info.callerClass !== 'ui') return null;
  const params = info.params as {
    emailIds?: readonly string[];
    patch?: { mailboxIds?: Readonly<Record<string, boolean>> };
  };
  const mailboxIds = params.patch?.mailboxIds;
  if (mailboxIds === undefined) return null;
  const destinations = Object.entries(mailboxIds)
    .filter(([, v]) => v === true)
    .map(([id]) => id);
  if (destinations.length !== 1) return null;
  const count = params.emailIds?.length ?? 0;
  if (count === 0) return null;
  const dest = lookupMailboxName(destinations[0]!);
  const message = count === 1 ? `Moved to ${dest}` : `${count} messages moved to ${dest}`;
  return { seq: info.seq, count, message };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd shell && pnpm vitest run src/runtime/__tests__/move-undo.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Wire it in (type + toast + handler)**

In `shell/src/mail-state.ts`, add to the `PendingDeleteUndo` type:

```typescript
  readonly message?: string;
```

In `shell/src/components/delete-toast.tsx`, replace the hardcoded label expression (the `pending.count === 1 ? 'Message moved to Trash' : …` block ~37) with:

```typescript
  const label =
    pending.message ??
    (pending.count === 1 ? 'Message moved to Trash' : `${pending.count} messages moved to Trash`);
```

In `shell/src/App.tsx` `onUndoRegistered` (~249), handle moves alongside deletes. Add a mailbox-name lookup (use the mailbox list already in scope; if the handy structure is `mailboxesById`/`mailboxes`, map id→name, falling back to the id) and:

```typescript
        onUndoRegistered: (info) => {
          if (info.callerClass !== 'ui') return;
          if (info.tool === 'mail.delete') {
            const emailIds = (info.params as { emailIds?: readonly string[] }).emailIds ?? [];
            setPendingDeleteUndo({ seq: info.seq, count: emailIds.length, createdAtMs: Date.now() });
            return;
          }
          const move = resolveMoveUndo(info, (id) => lookupMailboxName(id));
          if (move !== null) {
            setPendingDeleteUndo({ seq: move.seq, count: move.count, message: move.message, createdAtMs: Date.now() });
          }
        },
```

Import `resolveMoveUndo` at the top of `App.tsx`. Implement `lookupMailboxName(id)` from whatever mailbox collection is already available in the invoker-construction scope (the same data the move targets / sidebar use); fall back to returning `id` when unknown. Keep `setPendingDeleteUndo` and the dep array correct.

> Implementer note: `buildInverse` already registers the correct inverse for
> a move (the move patch is `{ [from]: false, [to]: true }`, so the inverse is
> `{ [from]: true, [to]: false }`). Do NOT add inverse logic here — only the
> toast record. Verify the inverse path is untouched.

- [ ] **Step 6: Run focused tests + typecheck**

Run: `cd shell && pnpm vitest run src/runtime/__tests__/move-undo.test.ts src/components/__tests__ && pnpm typecheck`
Expected: PASS; 0 type errors.

- [ ] **Step 7: Commit**

```bash
git add shell/src/runtime/move-undo.ts shell/src/runtime/__tests__/move-undo.test.ts shell/src/mail-state.ts shell/src/components/delete-toast.tsx shell/src/App.tsx
git commit -m "feat(mail): Undo toast on folder move (single + bulk)"
```

---

### Task 8: Full multi-package gate + a11y + build

**Files:** none (verification only); add an axe assertion to the form/bulk component tests if not already present.

- [ ] **Step 1: a11y on the new controls**

Add an `axe` assertion (mirror the existing axe usage in `shell/src/views/__tests__` / `components/__tests__`) covering: the event form with the Calendar select open, and the bulk bar with Flag/Unflag. Run:

`cd shell && pnpm vitest run src/views/__tests__/event-form-calendar.test.tsx src/components/__tests__/bulk-action-bar.test.tsx`
Expected: PASS, no axe violations.

- [ ] **Step 2: Per-package test suites**

```bash
cd shell && pnpm vitest run
cd ../tools/codegen && pnpm vitest run
cd ../mcp-server && pnpm vitest run
cd ../token-exchange && pnpm vitest run
```
Expected: all green. (shell count grows by the new tests; codegen `run.test.ts` asserts 32 tools.)

- [ ] **Step 3: Typecheck all packages**

Run: `pnpm -r typecheck`
Expected: 0 errors across packages.

- [ ] **Step 4: Codegen + shell build**

```bash
cd tools/codegen && pnpm build && pnpm start   # regenerate shell/src/generated/* from contracts
cd ../../shell && pnpm --filter @iarsma/shell build
```
Expected: codegen writes the 3 new event tool schemas into `shell/src/generated/`; Vite build succeeds. Commit any regenerated artifacts:

```bash
git add -A && git commit -m "chore(codegen): regenerate MCP tool artifacts for event.create/update/delete"
```

- [ ] **Step 5: Manual smoke (live or /run)**

- Calendar → create a second calendar → New Event → pick "Personal" in the Calendar dropdown → event shows in Personal's color; hide Personal → event hides; Edit the event → change Calendar → it moves + recolors.
- Mail → select several messages → bulk bar shows Mark read/unread, **Flag**, **Unflag**, **Move**, **Label**, Delete → Flag flags all; Label applies; Move shows "**N messages moved to <folder> / Undo**" → Undo restores them to the source folder.

---

## Self-Review

**Spec coverage:**
- #1 human assignment → Task 5 (form select + host). Reassign-on-edit → Task 1 (runtime patch) + Task 5 (host forwards `calendarId`). Color/visibility → already wired (no task; verified in Task 8 smoke).
- #1 MCP parity → Task 4 (3 contracts) + Tasks 2-3 (runtime error/guard semantics the contracts declare).
- #2 bulk Label → already wired; discoverability caption in Task 6. Bulk Flag → Task 6.
- #2 MCP parity → already satisfied (array-based `mail.modify`/`label.apply`/`mail.delete`); no task, documented in the spec.
- #3 move-undo (single + bulk) → Task 7.
- Testing/gate → Task 8.

**Deviations from the spec (flagged for the user):**
1. Event participant field is `participants` (JSCalendar), matching the runtime, not "attendees".
2. `event.delete` dry-run preview returns `{ eventId }` (matches existing runtime) rather than `{ title }`; a title preview would need an extra `event.get` roundtrip — deferred.
3. `event_not_found` is emitted by mapping the JMAP standard `notFound` SetError type in the parsers (no pre-check roundtrip), instead of a `calendar.update`-style existence pre-check.

**Placeholder scan:** none — every code step shows the code. Two implementer notes (Task 3 invoker-test wiring, Task 5 dialog-open mechanics) point at existing sibling tests to mirror; the behavioral assertions are concrete.

**Type consistency:** `EventUpdateInput.calendarId?` (Task 1) is read by the invoker guard/echo (Task 3) and forwarded by the host (Task 5) and declared in the `event.update` contract (Task 4). `EventFormData.calendarId?` (Task 5) flows form→host. `resolveMoveUndo` / `MoveUndoRecord` (Task 7) match the `PendingDeleteUndo.message?` field and the `DeleteToast` read. Contract `calendar:write` scope matches the existing permission map (no change).
