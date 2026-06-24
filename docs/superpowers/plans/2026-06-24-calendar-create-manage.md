# Calendar Create + Manage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a human create, rename/recolor, and delete calendars from the Calendars rail, and expose `calendar.create` / `calendar.update` / `calendar.delete` to agents as MCP tools in the same change.

**Architecture:** Pure JMAP `Calendar/set` create/update/destroy (verified live on Stalwart — NOT CalDAV), mirroring the Labels feature end-to-end: runtime builders/parsers/commits in `jmap-client.ts` → MCP contracts → scope+permission wiring → invoker cases → a `CalendarDialog` + rail affordances. Calendars share the mail account (`session.primaryAccountIdMail`).

**Tech Stack:** React + TypeScript (Vite), jotai, CSS modules, vitest + @testing-library/react, JMAP `Calendar/set` over `urn:ietf:params:jmap:calendars`; codegen (zod contracts → MCP tools).

## Global Constraints

- **Pure JMAP `Calendar/set`** — no CalDAV. Verified: create accepts `{ name, color }`; `Calendar/set { onDestroyRemoveEvents: true, destroy: [...] }` cascades; destroy without the flag on a non-empty calendar is refused with `notDestroyed: { type: "calendarHasEvent" }`. Account id = `session.primaryAccountIdMail`. Reuse `JMAP_USING_CALENDARS`.
- **Human/agent parity:** ship `calendar.create`, `calendar.update`, `calendar.delete` MCP contracts in this change; all three use scope **`calendar:write`** (reused, not a new `calendar:manage`).
- **No exact event count is available** (`CalendarEvent/query` `inCalendars` filter is unsupported on Stalwart). Delete is empty-aware: attempt → on `calendar_not_empty` refusal escalate to a typed confirm → re-issue with `removeEvents: true`.
- **The default calendar is never deletable** (`isDefault: true` → UI hides Delete; capability refuses with `calendar_is_default`).
- **Color:** reuse the existing `ColorPalette` + `LABEL_PALETTE` / `DEFAULT_LABEL_COLOR` (`#ff6b35`). No new palette.
- **Stalwart validates permission names** (bogus → `invalidPatch`); the calendar scope→permission map MUST be live-probed before hardcoding (Labels `jmapFileNode*` lesson). This probe is controller-run (credentials stay with the controller).
- `ToolError` is `{ code, message, payload? }` (field is `.code`). `makeError(code, message, payload?)`. TDD throughout; commit per task; ships **v0.15.0**.

---

## File Structure

**Create:**
- `tools/codegen/contracts/calendar-create.ts`, `calendar-update.ts`, `calendar-delete.ts`
- `shell/src/components/calendar-dialogs.tsx` — `CalendarDialog` (create/edit) + `DeleteCalendarDialog` (light + typed-confirm)
- `shell/src/runtime/calendar-delete-helpers.ts` — pure `resolveCalendarDeleteState`
- Test files alongside each.

**Modify:**
- `shell/src/runtime/jmap-client.ts` — add `isDefault` to `Calendar` + `parseCalendar`; add `Calendar/set` create/update/destroy builders, parsers, fetch-commits.
- `tools/codegen/contracts/calendar-list.ts` — add `isDefault` to output.
- `tools/codegen/src/__tests__/run.test.ts` — tool count 26 → 29 (+ comment).
- `mcp-server/src/stalwart-permissions.ts` — add `calendar:read` + `calendar:write` → JMAP calendar permission names (probed).
- `shell/src/views/agent-settings-view.tsx` — add `'calendar:read'`, `'calendar:write'` to `ALL_SCOPES`.
- `shell/src/runtime/invoker.ts` — add `calendar.create` / `calendar.update` / `calendar.delete` cases.
- `shell/src/views/calendar-view.tsx` (+ `.module.css`) — `CalendarInfo` gains `isDefault`; `CalendarRail` "+" header + per-row Edit/Delete `MenuButton`; new `CalendarViewProps` callbacks.
- `shell/src/App.tsx` — calendar dialog state + handlers + `refetchCalendars` + wiring.

---

## Task 1: Add `isDefault` to the Calendar model + calendar.list output

**Files:**
- Modify: `shell/src/runtime/jmap-client.ts` (`Calendar` type ~2265–2270; `parseCalendar` ~2372–2392)
- Modify: `tools/codegen/contracts/calendar-list.ts` (output `Calendar` zod ~19–27)
- Test: `shell/src/runtime/__tests__/calendar-parse.test.ts` (create; or extend an existing calendar test if present)

**Interfaces:**
- Consumes: nothing new.
- Produces: `Calendar = { id, name, color?, isVisible, isDefault }`; `calendar.list` output objects gain `isDefault: boolean`.

- [ ] **Step 1: Write the failing test**

Create `shell/src/runtime/__tests__/calendar-parse.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { parseCalendarListResponse } from '../jmap-client.js';

function resp(list: unknown[]): string {
  return JSON.stringify({
    methodResponses: [['Calendar/get', { accountId: 'b', list }, '0']],
  });
}

describe('parseCalendar isDefault', () => {
  it('captures isDefault:true', () => {
    const out = parseCalendarListResponse(resp([
      { id: 'b', name: 'Personal', isDefault: true },
    ]));
    expect(out[0]).toMatchObject({ id: 'b', name: 'Personal', isDefault: true });
  });
  it('defaults isDefault to false when absent', () => {
    const out = parseCalendarListResponse(resp([{ id: 'c', name: 'Work' }]));
    expect(out[0].isDefault).toBe(false);
  });
});
```

> Before writing: confirm `parseCalendarListResponse` is exported (the agent report shows `fetchCalendarList` → `parseCalendarListResponse`). If it's not exported, export it (it's the unit-testable seam), or test via the existing exported parser used by calendar tests.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/ubuntu/code/iarsma/shell && pnpm vitest run src/runtime/__tests__/calendar-parse.test.ts`
Expected: FAIL — `isDefault` undefined.

- [ ] **Step 3: Implement** — in `jmap-client.ts`, extend the `Calendar` type:

```typescript
export type Calendar = {
  readonly id: string;
  readonly name: string;
  readonly color?: string;
  readonly isVisible: boolean;
  readonly isDefault: boolean;
};
```

And in `parseCalendar`, add to the returned object (after `isVisible`):

```typescript
    isDefault: typeof r.isDefault === 'boolean' ? r.isDefault : false,
```

- [ ] **Step 4: Update the contract output** — in `tools/codegen/contracts/calendar-list.ts`, add to the `Calendar` zod object:

```typescript
  isDefault: z.boolean().describe('Whether this is the account default calendar (cannot be deleted).'),
```

- [ ] **Step 5: Run tests + typecheck + codegen**

Run: `cd /home/ubuntu/code/iarsma/shell && pnpm vitest run src/runtime/__tests__/calendar-parse.test.ts && pnpm tsc --noEmit`
Then regenerate + test codegen: `cd /home/ubuntu/code/iarsma && pnpm --filter @iarsma/codegen build && pnpm --filter @iarsma/codegen test` (confirm script names in root/package.json; the calendar.list tool schema now includes isDefault).
Expected: PASS, tsc clean, codegen green.

- [ ] **Step 6: Commit**

```bash
cd /home/ubuntu/code/iarsma
git add shell/src/runtime/jmap-client.ts shell/src/runtime/__tests__/calendar-parse.test.ts tools/codegen/contracts/calendar-list.ts
git commit -m "feat(calendar): surface isDefault on Calendar + calendar.list"
```

---

## Task 2: `Calendar/set` create + update (runtime)

**Files:**
- Modify: `shell/src/runtime/jmap-client.ts` (add near the `Calendar/get` machinery + the `CalendarEvent/set` precedent ~3256–3618)
- Test: `shell/src/runtime/__tests__/calendar-set.test.ts` (create)

**Interfaces:**
- Consumes: `JMAP_USING_CALENDARS`, `makeError`, `describe`, `Session`, `JmapClientOptions`.
- Produces:
  - `buildCalendarCreateRequest({ accountId, name, color? }): string`
  - `fetchCalendarCreateCommit(opts: JmapClientOptions & { session: Session; name: string; color?: string }): Promise<{ calendarId: string }>`
  - `buildCalendarUpdateRequest({ accountId, calendarId, name?, color? }): string`
  - `fetchCalendarUpdateCommit(opts: JmapClientOptions & { session: Session; calendarId: string; name?: string; color?: string }): Promise<{ updated: true }>`

- [ ] **Step 1: Write the failing test**

Create `shell/src/runtime/__tests__/calendar-set.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import {
  buildCalendarCreateRequest,
  buildCalendarUpdateRequest,
  fetchCalendarCreateCommit,
  type Session,
} from '../jmap-client.js';

function fakeSession(): Session {
  return { apiUrl: 'https://jmap.example/api', primaryAccountIdMail: 'b' } as unknown as Session;
}
function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('Calendar/set create + update request shapes', () => {
  it('create request carries name + color under create', () => {
    const body = JSON.parse(buildCalendarCreateRequest({ accountId: 'b', name: 'Work', color: '#ff6b35' }));
    expect(body.methodCalls[0][0]).toBe('Calendar/set');
    const create = body.methodCalls[0][1].create;
    const obj = create[Object.keys(create)[0]];
    expect(obj).toMatchObject({ name: 'Work', color: '#ff6b35' });
  });
  it('update request patches only provided fields', () => {
    const body = JSON.parse(buildCalendarUpdateRequest({ accountId: 'b', calendarId: 'c', name: 'Renamed' }));
    expect(body.methodCalls[0][1].update).toEqual({ c: { name: 'Renamed' } });
  });
});

describe('fetchCalendarCreateCommit', () => {
  it('returns the created calendar id', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ methodResponses: [['Calendar/set', { created: { c0: { id: 'c' } } }, '0']] }));
    const out = await fetchCalendarCreateCommit({
      baseUrl: 'https://jmap.example', getAuthToken: () => 'tok',
      fetch: fetchImpl as unknown as typeof fetch, session: fakeSession(), name: 'Work', color: '#ff6b35',
    });
    expect(out).toEqual({ calendarId: 'c' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /home/ubuntu/code/iarsma/shell && pnpm vitest run src/runtime/__tests__/calendar-set.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement** (mirror `buildEventCreateRequest` / `fetchEventCreateCommit` dispatch shape exactly). Add to `jmap-client.ts`:

```typescript
export function buildCalendarCreateRequest(opts: {
  readonly accountId: string;
  readonly name: string;
  readonly color?: string;
}): string {
  const cal: Record<string, unknown> = { name: opts.name };
  if (opts.color !== undefined) cal.color = opts.color;
  return JSON.stringify({
    using: JMAP_USING_CALENDARS,
    methodCalls: [['Calendar/set', { accountId: opts.accountId, create: { c0: cal } }, '0']],
  });
}

export function buildCalendarUpdateRequest(opts: {
  readonly accountId: string;
  readonly calendarId: string;
  readonly name?: string;
  readonly color?: string;
}): string {
  const patch: Record<string, unknown> = {};
  if (opts.name !== undefined) patch.name = opts.name;
  if (opts.color !== undefined) patch.color = opts.color;
  return JSON.stringify({
    using: JMAP_USING_CALENDARS,
    methodCalls: [['Calendar/set', { accountId: opts.accountId, update: { [opts.calendarId]: patch } }, '0']],
  });
}
```

Add commit fns mirroring `fetchEventCreateCommit` (token → POST `session.apiUrl` → status check → parse). Parse the `Calendar/set` response: read `created.c0.id` for create (throw `makeError('jmap_set_error', ...)` on `notCreated`); for update, throw on `notUpdated`, else return `{ updated: true }`. Use `accountId = opts.session.primaryAccountIdMail`. Add a `parseCalendarSetCreateResponse` helper that extracts `created.c0.id` and throws on `notCreated[c0]`.

- [ ] **Step 4: Run test + tsc**

Run: `cd /home/ubuntu/code/iarsma/shell && pnpm vitest run src/runtime/__tests__/calendar-set.test.ts && pnpm tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
cd /home/ubuntu/code/iarsma
git add shell/src/runtime/jmap-client.ts shell/src/runtime/__tests__/calendar-set.test.ts
git commit -m "feat(calendar): Calendar/set create + update runtime"
```

---

## Task 3: `Calendar/set` destroy with empty-aware semantics (runtime)

**Files:**
- Modify: `shell/src/runtime/jmap-client.ts`
- Test: `shell/src/runtime/__tests__/calendar-destroy.test.ts` (create)

**Interfaces:**
- Consumes: as Task 2.
- Produces:
  - `buildCalendarDeleteRequest({ accountId, calendarId, removeEvents }): string`
  - `fetchCalendarDeleteCommit(opts: JmapClientOptions & { session: Session; calendarId: string; removeEvents: boolean }): Promise<{ deleted: true }>` — throws `makeError('calendar_not_empty', …)` when the server refuses with `calendarHasEvent` and `removeEvents` was false; throws other `notDestroyed` reasons as `jmap_set_error`.

- [ ] **Step 1: Write the failing test**

Create `shell/src/runtime/__tests__/calendar-destroy.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { buildCalendarDeleteRequest, fetchCalendarDeleteCommit, type Session } from '../jmap-client.js';

function fakeSession(): Session {
  return { apiUrl: 'https://jmap.example/api', primaryAccountIdMail: 'b' } as unknown as Session;
}
function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('Calendar/set destroy', () => {
  it('omits onDestroyRemoveEvents when removeEvents is false', () => {
    const b = JSON.parse(buildCalendarDeleteRequest({ accountId: 'b', calendarId: 'c', removeEvents: false }));
    expect(b.methodCalls[0][1].destroy).toEqual(['c']);
    expect(b.methodCalls[0][1].onDestroyRemoveEvents).toBeUndefined();
  });
  it('sets onDestroyRemoveEvents:true when removeEvents is true', () => {
    const b = JSON.parse(buildCalendarDeleteRequest({ accountId: 'b', calendarId: 'c', removeEvents: true }));
    expect(b.methodCalls[0][1].onDestroyRemoveEvents).toBe(true);
  });

  it('maps calendarHasEvent refusal to calendar_not_empty', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ methodResponses: [['Calendar/set', { notDestroyed: { c: { type: 'calendarHasEvent', description: 'Calendar is not empty.' } } }, '0']] }));
    await expect(fetchCalendarDeleteCommit({
      baseUrl: 'x', getAuthToken: () => 'tok', fetch: fetchImpl as unknown as typeof fetch,
      session: fakeSession(), calendarId: 'c', removeEvents: false,
    })).rejects.toMatchObject({ code: 'calendar_not_empty' });
  });

  it('resolves on successful destroy', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ methodResponses: [['Calendar/set', { destroyed: ['c'] }, '0']] }));
    const out = await fetchCalendarDeleteCommit({
      baseUrl: 'x', getAuthToken: () => 'tok', fetch: fetchImpl as unknown as typeof fetch,
      session: fakeSession(), calendarId: 'c', removeEvents: true,
    });
    expect(out).toEqual({ deleted: true });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /home/ubuntu/code/iarsma/shell && pnpm vitest run src/runtime/__tests__/calendar-destroy.test.ts`
Expected: FAIL — function not exported.

- [ ] **Step 3: Implement** (mirror the `Mailbox/set` / `CalendarEvent/set` destroy `notDestroyed` parsing). Builder:

```typescript
export function buildCalendarDeleteRequest(opts: {
  readonly accountId: string;
  readonly calendarId: string;
  readonly removeEvents: boolean;
}): string {
  return JSON.stringify({
    using: JMAP_USING_CALENDARS,
    methodCalls: [['Calendar/set', {
      accountId: opts.accountId,
      ...(opts.removeEvents ? { onDestroyRemoveEvents: true } : {}),
      destroy: [opts.calendarId],
    }, '0']],
  });
}
```

`fetchCalendarDeleteCommit`: dispatch like the others; parse the first method response's `notDestroyed`. If `notDestroyed[calendarId]?.type === 'calendarHasEvent'` → `throw makeError('calendar_not_empty', 'Calendar is not empty.', notDestroyed)`. Any other `notDestroyed` entry → `throw makeError('jmap_set_error', ...)`. Else return `{ deleted: true }`.

- [ ] **Step 4: Run test + tsc**

Run: `cd /home/ubuntu/code/iarsma/shell && pnpm vitest run src/runtime/__tests__/calendar-destroy.test.ts && pnpm tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
cd /home/ubuntu/code/iarsma
git add shell/src/runtime/jmap-client.ts shell/src/runtime/__tests__/calendar-destroy.test.ts
git commit -m "feat(calendar): Calendar/set destroy with empty-aware refusal"
```

---

## Task 4: MCP contracts (create / update / delete) + tool-count bump

**Files:**
- Create: `tools/codegen/contracts/calendar-create.ts`, `calendar-update.ts`, `calendar-delete.ts`
- Modify: `tools/codegen/src/__tests__/run.test.ts` (line ~161: `26` → `29`; update the comment list)
- Test: codegen suite + any contract-shape test mirroring the label contracts' tests.

**Interfaces:**
- Produces three MCP tools, all scope `calendar:write`:
  - `calendar.create` `{ name: string(min1), color?: string }` → `{ calendarId: string }`, `isDestructive: false`.
  - `calendar.update` `{ calendarId: string, name?: string, color?: string }` → `{ updated: boolean }`, `isDestructive: false`.
  - `calendar.delete` `{ calendarId: string, removeEvents?: boolean }` → `{ deleted: boolean }`, `isDestructive: true`, `dryRun.preview { isDefault: boolean }`, errors `calendar_not_found` / `calendar_is_default` / `calendar_not_empty`.

- [ ] **Step 1: Write `calendar-create.ts`** (mirror `label-create.ts` structure):

```typescript
import { z } from 'zod';
import { capability } from '../capability.js'; // confirm import path against label-create.ts

export const calendarCreate = capability({
  name: 'calendar.create',
  version: '0.0.1',
  scopes: ['calendar:write'],
  description: 'Create a new calendar (JMAP Calendar/set create). Returns the new calendar id.',
  isDestructive: false,
  input: z.object({
    name: z.string().min(1).describe('Display name for the new calendar.'),
    color: z.string().optional().describe('CSS color, e.g. "#ff6b35". Optional.'),
  }),
  output: z.object({
    calendarId: z.string().describe('Server-issued id of the created calendar.'),
  }),
  errors: ['calendar_name_invalid'],
});
```

> Match the exact `capability(...)` factory import + shape used by `label-create.ts` (the agent confirmed it exists). If contracts are auto-discovered by directory scan, no registry edit is needed; if there's an index, add the three exports there.

- [ ] **Step 2: Write `calendar-update.ts`** (mirror `label-update.ts`):

```typescript
import { z } from 'zod';
import { capability } from '../capability.js';

export const calendarUpdate = capability({
  name: 'calendar.update',
  version: '0.0.1',
  scopes: ['calendar:write'],
  description: 'Rename and/or recolor a calendar (JMAP Calendar/set update). At least one of name/color.',
  isDestructive: false,
  input: z.object({
    calendarId: z.string().describe('Calendar to update.'),
    name: z.string().min(1).optional().describe('New display name.'),
    color: z.string().optional().describe('New CSS color.'),
  }),
  output: z.object({ updated: z.boolean() }),
  errors: ['calendar_not_found', 'calendar_name_invalid', 'nothing_to_update'],
});
```

- [ ] **Step 3: Write `calendar-delete.ts`** (mirror `label-delete.ts` destructive+dryRun):

```typescript
import { z } from 'zod';
import { capability } from '../capability.js';

export const calendarDelete = capability({
  name: 'calendar.delete',
  version: '0.0.1',
  scopes: ['calendar:write'],
  description:
    'Delete a calendar (JMAP Calendar/set destroy). Refuses the default calendar. A non-empty ' +
    'calendar is refused unless removeEvents:true, which cascade-deletes its events. No undo.',
  isDestructive: true,
  input: z.object({
    calendarId: z.string().describe('Calendar to delete.'),
    removeEvents: z.boolean().optional().describe('When true, also delete all events in the calendar (cascade). Required to delete a non-empty calendar.'),
  }),
  output: z.object({ deleted: z.boolean() }),
  dryRun: {
    preview: z.object({
      isDefault: z.boolean().describe('Whether the target is the default calendar (deletion will be refused).'),
    }),
  },
  errors: ['calendar_not_found', 'calendar_is_default', 'calendar_not_empty'],
});
```

> Confirm the exact `dryRun`/`errors` field spelling against `label-delete.ts` (the agent showed `dryRun: { preview: z.object({...}) }` and an `errors` array). Match verbatim.

- [ ] **Step 4: Bump the tool count** — in `tools/codegen/src/__tests__/run.test.ts` (~line 161), change `expect(r.capabilities).toBe(26)` to `expect(r.capabilities).toBe(29)` and append `calendar.create + calendar.update + calendar.delete` to the inline comment list.

- [ ] **Step 5: Build + test codegen**

Run: `cd /home/ubuntu/code/iarsma && pnpm --filter @iarsma/codegen build && pnpm --filter @iarsma/codegen test`
Expected: 29 capabilities; suite green; three new tool JSONs emitted.

- [ ] **Step 6: Commit**

```bash
cd /home/ubuntu/code/iarsma
git add tools/codegen/contracts/calendar-create.ts tools/codegen/contracts/calendar-update.ts tools/codegen/contracts/calendar-delete.ts tools/codegen/src/__tests__/run.test.ts
git commit -m "feat(calendar): calendar.create/update/delete MCP contracts"
```

---

## Task 5: Scope wiring — ALL_SCOPES + Stalwart permission map (controller-probed)

**Files:**
- Modify: `shell/src/views/agent-settings-view.tsx` (`ALL_SCOPES` ~36–47)
- Modify: `mcp-server/src/stalwart-permissions.ts` (`SCOPE_PERMISSIONS` ~18–69)
- Test: `mcp-server/src/__tests__/stalwart-permissions.test.ts` (extend; mirror the label scope test)

**Interfaces:**
- Produces: `calendar:read` + `calendar:write` present in `ALL_SCOPES` and mapped to verified Stalwart JMAP calendar permission names.

> **CONTROLLER PROBE REQUIRED (do this before hardcoding — Labels `jmapFileNode*` lesson):** Stalwart validates permission names (bogus → `invalidPatch`). The exact JMAP permission identifiers gating `Calendar/get` / `CalendarEvent/get` / `Calendar/set` / `CalendarEvent/set` must be confirmed against the live server (admin creds, controller-only — NOT passed to subagents). Record the verified names in the progress ledger, then this task hardcodes them. Do NOT ship guessed names.

- [ ] **Step 1: Add to `ALL_SCOPES`** in `agent-settings-view.tsx` (after `'mail:label:write'`):

```typescript
  'calendar:read',
  'calendar:write',
```

- [ ] **Step 2: Write the failing permission-map test** in `mcp-server/src/__tests__/stalwart-permissions.test.ts` (mirror the existing label scope assertions). Assert `calendar:write` maps to the verified create/update/destroy permission set and `calendar:read` to the read set. Use the EXACT permission names recorded from the controller probe — fill them in at Step 3 once confirmed:

```typescript
it('calendar:write grants calendar mutation permissions', () => {
  const perms = scopesToStalwartPermissions(['calendar:write']);
  // <PROBED_NAMES> — e.g. expect(perms['jmapCalendarSet']).toBe(true) etc. Fill from ledger.
  expect(perms['<calendar-create-perm>']).toBe(true);
});
```

- [ ] **Step 3: Add the mapping** in `stalwart-permissions.ts` `SCOPE_PERMISSIONS` (after the `mail:label:write` entry), using the probed names:

```typescript
  'calendar:read': { /* probed: jmapCalendarGet / jmapCalendarEventGet / jmapCalendarEventQuery, etc. */ },
  'calendar:write': { /* probed: calendar + event create/update/destroy perms */ },
```

- [ ] **Step 4: Run tests + typecheck (both packages)**

Run: `cd /home/ubuntu/code/iarsma && pnpm --filter @iarsma/mcp-server test && pnpm --filter @iarsma/mcp-server typecheck && pnpm --filter @iarsma/shell tsc --noEmit`
Expected: PASS (with the real probed names), tsc clean.

- [ ] **Step 5: Commit**

```bash
cd /home/ubuntu/code/iarsma
git add shell/src/views/agent-settings-view.tsx mcp-server/src/stalwart-permissions.ts mcp-server/src/__tests__/stalwart-permissions.test.ts
git commit -m "feat(calendar): map calendar:read/write scopes to Stalwart permissions"
```

---

## Task 6: Invoker cases (create / update / delete)

**Files:**
- Modify: `shell/src/runtime/invoker.ts` (after the `event.*` cases ~558–611)
- Test: `shell/src/runtime/__tests__/invoker-calendar.test.ts` (create — drive the real jmapInvoker through the new cases, asserting outgoing request bodies, like the Labels invoker-seam test)

**Interfaces:**
- Consumes: `fetchCalendarCreateCommit` / `fetchCalendarUpdateCommit` / `fetchCalendarDeleteCommit` (Tasks 2–3).
- Produces: invoker dispatch for `calendar.create` / `calendar.update` / `calendar.delete`. `calendar.delete` dry-run returns `{ isDefault }` (resolved from a `calendar.list`/`Calendar/get` lookup of the target); commit calls `fetchCalendarDeleteCommit` with `removeEvents` from input.

- [ ] **Step 1: Write the failing test** — a `mockFetch`-backed jmapInvoker test asserting `calendar.create` issues a `Calendar/set` with the name/color, and `calendar.delete` commit sends `onDestroyRemoveEvents` per `removeEvents`. Mirror the structure of the existing `invoker-labels.test.ts`.

```typescript
import { describe, expect, it, vi } from 'vitest';
import { jmapInvoker } from '../invoker.js';

// session bootstrap is fetched once; provide a fake fetch that answers
// /.well-known/jmap then the Calendar/set POST. Mirror invoker-labels.test.ts setup.
```

> Read `invoker-labels.test.ts` first and copy its session-bootstrap fake-fetch harness; assert on the second POST body.

- [ ] **Step 2: Run to verify it fails**

Run: `cd /home/ubuntu/code/iarsma/shell && pnpm vitest run src/runtime/__tests__/invoker-calendar.test.ts`
Expected: FAIL — cases not handled (`no handler for calendar.create`).

- [ ] **Step 3: Implement** the three cases in `invoker.ts` (mirror `event.create`/`event.delete` + the `label.delete` dry-run/commit split):

```typescript
case 'calendar.create': {
  const p = _input as unknown as { name: string; color?: string };
  const session = await getSession();
  return (await fetchCalendarCreateCommit({ ...opts, session, name: p.name, ...(p.color !== undefined ? { color: p.color } : {}) })) as unknown as O;
}
case 'calendar.update': {
  const p = _input as unknown as { calendarId: string; name?: string; color?: string };
  const session = await getSession();
  return (await fetchCalendarUpdateCommit({ ...opts, session, calendarId: p.calendarId, ...(p.name !== undefined ? { name: p.name } : {}), ...(p.color !== undefined ? { color: p.color } : {}) })) as unknown as O;
}
case 'calendar.delete': {
  const p = _input as unknown as { calendarId: string; removeEvents?: boolean };
  const session = await getSession();
  if (_options.dryRun === true) {
    const cals = await fetchCalendarList({ ...opts, session });
    const target = cals.find((c) => c.id === p.calendarId);
    return { isDefault: target?.isDefault === true } as unknown as O | DryRunPreview<O>;
  }
  return (await fetchCalendarDeleteCommit({ ...opts, session, calendarId: p.calendarId, removeEvents: p.removeEvents === true })) as unknown as O;
}
```

Add the new fetch fns to the `jmap-client.js` import group at the top of `invoker.ts`.

- [ ] **Step 4: Run test + tsc**

Run: `cd /home/ubuntu/code/iarsma/shell && pnpm vitest run src/runtime/__tests__/invoker-calendar.test.ts && pnpm tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
cd /home/ubuntu/code/iarsma
git add shell/src/runtime/invoker.ts shell/src/runtime/__tests__/invoker-calendar.test.ts
git commit -m "feat(calendar): invoker cases for calendar create/update/delete"
```

---

## Task 7: Pure delete-state helper + CalendarDialog (create/edit)

**Files:**
- Create: `shell/src/runtime/calendar-delete-helpers.ts` + `__tests__/calendar-delete-helpers.test.ts`
- Create: `shell/src/components/calendar-dialogs.tsx` + `__tests__/calendar-dialogs.test.tsx`

**Interfaces:**
- Produces:
  - `resolveCalendarDeleteState(input: { refusal: 'not_empty' | null; error: string | null }): { mode: 'light' | 'typed'; errorMsg?: string }` — `not_empty` → `'typed'`; otherwise `'light'`; passes through an error message.
  - `CalendarDialog` (create/edit modes): props `{ open: boolean; mode: 'create' | 'edit'; initialName?: string; initialColor?: string; onClose: () => void; onSubmit: (name: string, color: string) => void; error?: string }`.

- [ ] **Step 1: Write the failing helper test**

```typescript
import { describe, expect, it } from 'vitest';
import { resolveCalendarDeleteState } from '../calendar-delete-helpers.js';

describe('resolveCalendarDeleteState', () => {
  it('escalates to typed confirm on not_empty refusal', () => {
    expect(resolveCalendarDeleteState({ refusal: 'not_empty', error: null }).mode).toBe('typed');
  });
  it('stays light with no refusal', () => {
    expect(resolveCalendarDeleteState({ refusal: null, error: null }).mode).toBe('light');
  });
  it('passes an error through', () => {
    expect(resolveCalendarDeleteState({ refusal: null, error: 'boom' }).errorMsg).toBe('boom');
  });
});
```

- [ ] **Step 2: Run → fail; implement the helper:**

```typescript
export function resolveCalendarDeleteState(input: {
  readonly refusal: 'not_empty' | null;
  readonly error: string | null;
}): { mode: 'light' | 'typed'; errorMsg?: string } {
  const mode = input.refusal === 'not_empty' ? 'typed' : 'light';
  return input.error !== null ? { mode, errorMsg: input.error } : { mode };
}
```

- [ ] **Step 3: Write the failing CalendarDialog test** (mirror a label-dialogs test): create mode renders empty name + ColorPalette; submit calls `onSubmit(name, color)`; edit mode prefills `initialName`/`initialColor`.

- [ ] **Step 4: Implement `CalendarDialog`** mirroring `CreateLabelDialog` (reuse `Dialog`, `Input`, `ColorPalette` from `label-dialogs.tsx` exports / shared component, and `DEFAULT_LABEL_COLOR`). Title is `mode === 'create' ? 'New calendar' : 'Edit calendar'`; submit button label `Create`/`Save`. Reset state from `initialName`/`initialColor` on open.

> If `ColorPalette` is not exported from `label-dialogs.tsx`, lift it into a shared component (e.g. `shell/src/components/color-palette.tsx`) and import it in both — note the refactor in your report.

- [ ] **Step 5: Run tests + tsc**

Run: `cd /home/ubuntu/code/iarsma/shell && pnpm vitest run src/runtime/__tests__/calendar-delete-helpers.test.ts src/components/__tests__/calendar-dialogs.test.tsx && pnpm tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 6: Commit**

```bash
cd /home/ubuntu/code/iarsma
git add shell/src/runtime/calendar-delete-helpers.ts shell/src/runtime/__tests__/calendar-delete-helpers.test.ts shell/src/components/calendar-dialogs.tsx shell/src/components/__tests__/calendar-dialogs.test.tsx
git commit -m "feat(calendar): CalendarDialog (create/edit) + delete-state helper"
```

---

## Task 8: DeleteCalendarDialog (light + typed confirm)

**Files:**
- Modify: `shell/src/components/calendar-dialogs.tsx` (add `DeleteCalendarDialog`)
- Test: `shell/src/components/__tests__/calendar-dialogs.test.tsx` (extend)

**Interfaces:**
- Produces: `DeleteCalendarDialog` props `{ open: boolean; calendarName: string; mode: 'light' | 'typed'; onClose: () => void; onConfirm: () => void; error?: string }`. In `'typed'` mode the confirm button is disabled until the user types `DELETE`.

- [ ] **Step 1: Write the failing test**:

```typescript
it('typed mode requires typing DELETE to enable confirm', () => {
  const onConfirm = vi.fn();
  render(<DeleteCalendarDialog open mode="typed" calendarName="Work" onClose={() => {}} onConfirm={onConfirm} />);
  const confirm = screen.getByRole('button', { name: /delete/i });
  expect(confirm).toBeDisabled();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'DELETE' } });
  expect(confirm).toBeEnabled();
});
it('light mode confirm is immediately enabled', () => {
  render(<DeleteCalendarDialog open mode="light" calendarName="Work" onClose={() => {}} onConfirm={() => {}} />);
  expect(screen.getByRole('button', { name: /delete/i })).toBeEnabled();
});
```

- [ ] **Step 2: Run → fail; implement** `DeleteCalendarDialog` (reuse `Dialog`). Light mode: body `Delete "<name>"?`. Typed mode: body warns events will be permanently removed + an `Input` requiring the exact phrase `DELETE`; confirm disabled until `typed.trim() === 'DELETE'`. Render `error` via `role="alert"`.

- [ ] **Step 3: Run tests + tsc**

Run: `cd /home/ubuntu/code/iarsma/shell && pnpm vitest run src/components/__tests__/calendar-dialogs.test.tsx && pnpm tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 4: Commit**

```bash
cd /home/ubuntu/code/iarsma
git add shell/src/components/calendar-dialogs.tsx shell/src/components/__tests__/calendar-dialogs.test.tsx
git commit -m "feat(calendar): DeleteCalendarDialog with empty-aware typed confirm"
```

---

## Task 9: CalendarRail affordances + App wiring (create / edit / delete flow)

**Files:**
- Modify: `shell/src/views/calendar-view.tsx` (+ `.module.css`) — `CalendarInfo` gains `isDefault`; `CalendarRail` "+" header + per-row `MenuButton`; `CalendarViewProps` callbacks.
- Modify: `shell/src/App.tsx` — calendar dialog state, handlers, `refetchCalendars`, wiring.
- Test: `shell/src/views/__tests__/calendar-view.test.tsx` (extend or create) — "+" opens create; row menu hides Delete on default; edit/delete callbacks fire.

**Interfaces:**
- Consumes: `CalendarDialog`, `DeleteCalendarDialog`, `resolveCalendarDeleteState`, the three invoker capabilities.
- Produces: end-to-end create/edit/delete from the rail; list refresh after mutation; events refresh on cascade delete.

- [ ] **Step 1: Write the failing component test** (mirror calendar-view / label sidebar tests):

```typescript
it('shows "+ New calendar" and fires onCreateCalendar', async () => {
  const onCreateCalendar = vi.fn();
  renderCalendarView({ calendars: [{ id: 'b', name: 'Personal', isDefault: true }], onCreateCalendar });
  fireEvent.click(screen.getByRole('button', { name: /new calendar/i }));
  expect(onCreateCalendar).toHaveBeenCalled();
});
it('hides Delete on the default calendar row', async () => {
  renderCalendarView({ calendars: [{ id: 'b', name: 'Personal', isDefault: true }], onEditCalendar: vi.fn(), onDeleteCalendar: vi.fn() });
  // open the row menu, assert Edit present + Delete absent for the default row
});
```

> Match the existing `calendar-view.test.tsx` render helper + `CalendarInfo` shape; add `isDefault` to the test fixtures.

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement the rail** — add `isDefault: boolean` to `CalendarInfo`; add `onCreateCalendar?`, `onEditCalendar?: (id) => void`, `onDeleteCalendar?: (id) => void` to `CalendarViewProps` and `CalendarRail`. In the rail heading add a `+ New calendar` button (`var(--accent)` text button, `aria-label="New calendar"`). Per row, after the name, add a `MenuButton size="sm"` with items `[{ key:'edit', label:'Edit…', onSelect: () => onEditCalendar?.(c.id) }]` plus, only when `!c.isDefault`, `{ key:'delete', label:'Delete', onSelect: () => onDeleteCalendar?.(c.id) }`. Keep the existing visibility checkbox/swatch/name; the row `<label>` must not wrap the MenuButton (button-in-label) — render the MenuButton as a sibling of the `<label>` inside the `<li>`.

- [ ] **Step 4: Implement App wiring** (mirror the Label dialog wiring exactly). Add:

```typescript
type CalendarDialogState =
  | { kind: 'none' }
  | { kind: 'create' }
  | { kind: 'edit'; calendarId: string; name: string; color: string }
  | { kind: 'delete'; calendarId: string; name: string; mode: 'light' | 'typed' };
const [calendarDialog, setCalendarDialog] = useState<CalendarDialogState>({ kind: 'none' });
const [calendarDialogError, setCalendarDialogError] = useState<string | undefined>(undefined);
```

Extract the existing `calendar.list` fetch into `const refetchCalendars = useCallback(async () => { const cals = await invoker.invoke('calendar.list', {}); setCalendars(cals as ...); }, [invoker]);` and call it on mount and after every mutation. Handlers:
- `handleCreateCalendar` → `setCalendarDialog({ kind: 'create' })`.
- `handleEditCalendar(id)` → look up name/color → `setCalendarDialog({ kind: 'edit', ... })`.
- `handleDeleteCalendar(id)` → look up name → `setCalendarDialog({ kind: 'delete', calendarId: id, name, mode: 'light' })`.
- Create submit → `invoker.invoke('calendar.create', { name, color })` → `refetchCalendars()` → close.
- Edit submit → `invoker.invoke('calendar.update', { calendarId, name, color })` → `refetchCalendars()` → close.
- Delete confirm (light) → `invoker.invoke('calendar.delete', { calendarId })`; on success → `refetchCalendars()` + `bumpPushGeneration` (events) + close; on error `code === 'calendar_not_empty'` → `setCalendarDialog({ ...delete, mode: 'typed' })` (escalate, no close); other errors → show message.
- Delete confirm (typed) → `invoker.invoke('calendar.delete', { calendarId, removeEvents: true })` → `refetchCalendars()` + `bumpPushGeneration` + close.

Use `resolveCalendarDeleteState` to derive the dialog mode/error from the last attempt. Render `CalendarDialog` (gated by `kind==='create'||'edit'`) and `DeleteCalendarDialog` (gated by `kind==='delete'`), and pass `onCreateCalendar`/`onEditCalendar`/`onDeleteCalendar` + the `isDefault`-carrying calendars to `CalendarView`.

- [ ] **Step 5: Run tests + tsc + full calendar-view file**

Run: `cd /home/ubuntu/code/iarsma/shell && pnpm vitest run src/views/__tests__/calendar-view.test.tsx && pnpm tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 6: Commit**

```bash
cd /home/ubuntu/code/iarsma
git add shell/src/views/calendar-view.tsx shell/src/views/calendar-view.module.css shell/src/App.tsx shell/src/views/__tests__/calendar-view.test.tsx
git commit -m "feat(calendar): rail + / row menu and end-to-end create/edit/delete wiring"
```

---

## Task 10: Accessibility + full multi-package gate

**Files:** none new — verification + any small a11y fix.

- [ ] **Step 1: a11y** — confirm: "+ New calendar" has an accessible name; each row `MenuButton` has a per-calendar label (e.g. `Actions for <name>`); the create/edit dialog and the delete dialog are labelled; the typed-confirm `Input` is labelled. If the repo runs axe in component tests, add an axe assertion to `calendar-dialogs.test.tsx`.

- [ ] **Step 2: Full gate (repo root)**

Run:
```bash
cd /home/ubuntu/code/iarsma
pnpm -r typecheck
pnpm -r test
pnpm --filter @iarsma/shell build
pnpm --filter @iarsma/codegen build && pnpm --filter @iarsma/codegen test
```
Expected: 0 type errors all packages; all suites green (shell + mcp-server + codegen=29 tools + token-exchange); shell build ✓. Fix intended snapshot/count drift deliberately (note it); a real break → STOP and report.

- [ ] **Step 3: Manual smoke** (dev server or preview): "+ New calendar" creates one (appears in rail, color applied, events can be added to it); Edit renames/recolors; Delete on an empty calendar → light confirm → gone; Delete on a non-empty calendar → typed confirm (type DELETE) → calendar + its events removed; default calendar has no Delete; list + event view refresh without reload.

- [ ] **Step 4: Commit any gate fixes**

```bash
cd /home/ubuntu/code/iarsma
git add -A
git commit -m "test(calendar): a11y assertions + gate fixes"
```

---

## Ship (after all tasks green)

PR → CI (6 checks) → squash-merge → tag `v0.15.0` → release workflow publishes `iarsma-base-webmail.zip` → fire Stalwart `UpdateApps` (admin@r3motely.net, acct `b`) → confirm `…/webmail/version.json` reports `0.15.0`.

---

## Self-review notes (author)

- **Spec coverage:** native `Calendar/set` (T2/T3), `isDefault` model (T1), 3 parity contracts (T4), scope+permission map (T5, controller-probed), invoker (T6), CalendarDialog + delete helper (T7), typed-confirm delete (T8), rail "+"/menu + App wiring + refresh (T9), a11y + gate (T10). All spec sections map to a task.
- **Spec refinement flagged:** the spec's `calendar.delete` dry-run `{hasEvents}` is replaced by `{isDefault}` (the only cheaply, non-mutatingly knowable fact) + a commit-time `calendar_not_empty` refusal that drives the empty-aware typed-confirm escalation. This preserves the approved *behavior* ("empty-aware typed confirm") while being honest about the `inCalendars`-query limitation. Surfaced to the user at plan handoff.
- **Verification points flagged inline (do not skip):** `parseCalendarListResponse` export; `capability(...)`/`dryRun`/`errors` exact contract shape vs `label-*`; the real Stalwart calendar permission names (T5 controller probe); `invoker-labels.test.ts` session-bootstrap harness to copy; whether `ColorPalette` is exported or needs lifting; MenuButton must be a sibling of the row `<label>` (no button-in-label).
- **Parity:** three MCP tools ship with the human UI; `calendar:write` scope mapped for agent tokens.
