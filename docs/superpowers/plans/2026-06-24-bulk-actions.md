# Multi-select + Bulk Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a human select several conversations in the message list and act on them in one gesture — mark read/unread, move to a folder, add/remove labels, or delete — with selection state, a bulk action bar, and whole-conversation semantics.

**Architecture:** UI-only. A pure selection reducer (`thread-selection.ts`) drives two jotai atoms in `mail-state.ts`. At action time, selected `threadId`s are resolved to their flattened `emailId`s through a new batched-`Thread/get` invoker method (`resolveThreadEmailIds`, mirroring the existing optional `uploadAttachment`), then handed to the already-array-accepting `mail.modify` / `mail.delete` / `label.apply` capabilities in one `Email/set`. A new `BulkActionBar` component renders in the list header's toolbar slot when a selection is active. The v0.13.1 write-invalidation (`cacheInvalidationsFor`) already drops the affected cache purposes, so source/destination/counts refresh with no manual reload.

**Tech Stack:** React + TypeScript (Vite), jotai atoms, CSS modules, vitest + @testing-library/react, JMAP over `Email/set` / `Thread/get`.

## Global Constraints

- **No contract / codegen changes, no new MCP tools.** Parity is already satisfied: `mail.modify`, `mail.delete`, `label.apply` all accept `emailIds: string[]`. The new `resolveThreadEmailIds` is an *internal invoker method*, NOT an MCP-exposed tool — it must not be added to `tools/codegen/contracts/`.
- **Whole-conversation semantics for bulk actions** ("delete these conversations", not "delete their newest message"). Single-row hover actions stay latest-email-only (no regression, accepted inconsistency).
- **Select-all scope is the loaded/visible threads only** — never act on unloaded pages.
- **Bulk delete = no confirm + the existing Undo toast** (worded for the batch). No new confirm dialog.
- **Selection never survives a context switch** — clear on mailbox / label-filter / search-mode change.
- Orange accent tokens already in CSS; use existing CSS variables (`--surface-1`, `--text-1`, `--border`, `--accent`, etc.) — no hardcoded colors.
- Version is tag-driven (`package.json` stays `0.0.0`); this ships as **v0.14.0**.
- TDD throughout; commit after each green task.

---

## File Structure

**Create:**
- `shell/src/runtime/thread-selection.ts` — pure selection reducer (no React).
- `shell/src/runtime/__tests__/thread-selection.test.ts`
- `shell/src/components/bulk-action-bar.tsx` — the bulk action bar.
- `shell/src/components/bulk-action-bar.module.css`
- `shell/src/components/__tests__/bulk-action-bar.test.tsx`

**Modify:**
- `shell/src/mail-state.ts` — add `selectedThreadIdsAtom`, `selectionAnchorIndexAtom`.
- `shell/src/runtime/jmap-client.ts` — add `fetchResolveThreadEmailIds` + option type.
- `shell/src/runtime/invoker.ts` — add optional `resolveThreadEmailIds` to `Invoker`, implement in `jmapInvoker`, support in `mockInvoker`.
- `shell/src/runtime/cached-invoker.ts` — forward `resolveThreadEmailIds`.
- `shell/src/runtime/logging-invoker.ts` — forward `resolveThreadEmailIds`.
- `shell/src/views/thread-list.tsx` — checkbox column, click/keyboard interactions, select-all, bulk dispatch, render `BulkActionBar`.
- `shell/src/views/thread-list.module.css` — checkbox styles.
- `shell/src/runtime/keyboard-bindings.ts` — add `x` binding.
- `shell/src/runtime/__tests__/keyboard-bindings.test.ts` — bump thread-list count 8→9.
- `docs/keyboard.md` — move `x` from "Reserved" to the active thread-list table.
- Existing `shell/src/views/__tests__/thread-list.test.tsx` — interaction + dispatch tests.

---

## Task 1: Pure selection reducer

**Files:**
- Create: `shell/src/runtime/thread-selection.ts`
- Test: `shell/src/runtime/__tests__/thread-selection.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `toggle(set: ReadonlySet<string>, id: string): Set<string>`
  - `selectRange(orderedIds: readonly string[], anchorIdx: number, clickIdx: number, base: ReadonlySet<string>): Set<string>`
  - `selectAll(orderedIds: readonly string[]): Set<string>`
  - `clearSelection(): Set<string>`

- [ ] **Step 1: Write the failing test**

Create `shell/src/runtime/__tests__/thread-selection.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  toggle,
  selectRange,
  selectAll,
  clearSelection,
} from '../thread-selection.js';

const IDS = ['a', 'b', 'c', 'd', 'e'];

describe('thread-selection reducer', () => {
  it('toggle adds an id not present', () => {
    expect([...toggle(new Set(), 'a')]).toEqual(['a']);
  });

  it('toggle removes an id already present', () => {
    expect([...toggle(new Set(['a', 'b']), 'a')]).toEqual(['b']);
  });

  it('toggle does not mutate the input set', () => {
    const input = new Set(['a']);
    toggle(input, 'b');
    expect([...input]).toEqual(['a']);
  });

  it('selectRange unions the inclusive range into the base set', () => {
    const result = selectRange(IDS, 1, 3, new Set(['a']));
    expect([...result].sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('selectRange handles a reversed range (click before anchor)', () => {
    const result = selectRange(IDS, 3, 1, new Set());
    expect([...result].sort()).toEqual(['b', 'c', 'd']);
  });

  it('selectRange with equal anchor/click selects the single row', () => {
    expect([...selectRange(IDS, 2, 2, new Set())]).toEqual(['c']);
  });

  it('selectAll selects every id in order', () => {
    expect([...selectAll(IDS)]).toEqual(IDS);
  });

  it('clearSelection returns an empty set', () => {
    expect(clearSelection().size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/ubuntu/code/iarsma/shell && pnpm vitest run src/runtime/__tests__/thread-selection.test.ts`
Expected: FAIL — `Cannot find module '../thread-selection.js'`.

- [ ] **Step 3: Write the implementation**

Create `shell/src/runtime/thread-selection.ts`:

```typescript
/**
 * Pure thread-selection transitions (multi-select / bulk actions, #5).
 *
 * Deliberately React-free so the selection logic is unit-testable in
 * isolation. The atom writers in `mail-state.ts` call these; the view
 * (`thread-list.tsx`) decides WHEN to call them from clicks/keys.
 *
 * Every function returns a fresh `Set` and never mutates its inputs —
 * jotai atom identity changes are how subscribers re-render.
 */

/** Add `id` if absent, remove it if present. */
export function toggle(set: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}

/**
 * Union the inclusive range of `orderedIds` between `anchorIdx` and
 * `clickIdx` (either order) into `base`. Used for Shift-click range
 * selection — additive, so an existing selection is preserved.
 */
export function selectRange(
  orderedIds: readonly string[],
  anchorIdx: number,
  clickIdx: number,
  base: ReadonlySet<string>,
): Set<string> {
  const next = new Set(base);
  const lo = Math.max(0, Math.min(anchorIdx, clickIdx));
  const hi = Math.min(orderedIds.length - 1, Math.max(anchorIdx, clickIdx));
  for (let i = lo; i <= hi; i++) {
    const id = orderedIds[i];
    if (id !== undefined) next.add(id);
  }
  return next;
}

/** Select every id in `orderedIds` (the loaded/visible list). */
export function selectAll(orderedIds: readonly string[]): Set<string> {
  return new Set(orderedIds);
}

/** Empty selection. */
export function clearSelection(): Set<string> {
  return new Set();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/ubuntu/code/iarsma/shell && pnpm vitest run src/runtime/__tests__/thread-selection.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
cd /home/ubuntu/code/iarsma
git add shell/src/runtime/thread-selection.ts shell/src/runtime/__tests__/thread-selection.test.ts
git commit -m "feat(bulk-actions): pure thread-selection reducer"
```

---

## Task 2: Batched Thread/get resolver in jmap-client

**Files:**
- Modify: `shell/src/runtime/jmap-client.ts` (add after the existing `parseThreadGet` machinery; types near the `Thread` type at lines 777–785)
- Test: `shell/src/runtime/__tests__/resolve-thread-email-ids.test.ts` (create)

**Interfaces:**
- Consumes: existing module-level helpers `makeError`, `describe`, constant `JMAP_USING_MAIL`, type `Session`, type `JmapClientOptions`.
- Produces:
  - `type ResolveThreadEmailIdsOptions = JmapClientOptions & { readonly session: Session; readonly threadIds: readonly string[] }`
  - `async function fetchResolveThreadEmailIds(opts: ResolveThreadEmailIdsOptions): Promise<ReadonlyMap<string, readonly string[]>>` — one batched `Thread/get` over `threadIds`; returns `Map<threadId, emailIds[]>`. Missing threads are simply absent from the map. Empty `threadIds` → empty map without a network call.

- [ ] **Step 1: Write the failing test**

Create `shell/src/runtime/__tests__/resolve-thread-email-ids.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import {
  fetchResolveThreadEmailIds,
  type Session,
} from '../jmap-client.js';

function fakeSession(): Session {
  // Only the fields the resolver reads need to be real.
  return {
    apiUrl: 'https://jmap.example/api',
    primaryAccountIdMail: 'acct-1',
  } as unknown as Session;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('fetchResolveThreadEmailIds', () => {
  it('returns an empty map without fetching when threadIds is empty', async () => {
    const fetchImpl = vi.fn();
    const out = await fetchResolveThreadEmailIds({
      baseUrl: 'https://jmap.example',
      getAuthToken: () => 'tok',
      fetch: fetchImpl as unknown as typeof fetch,
      session: fakeSession(),
      threadIds: [],
    });
    expect(out.size).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends one batched Thread/get and maps threadId -> emailIds', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        methodResponses: [
          [
            'Thread/get',
            {
              list: [
                { id: 'T1', emailIds: ['E1a', 'E1b'] },
                { id: 'T2', emailIds: ['E2a'] },
              ],
            },
            '0',
          ],
        ],
      }),
    );
    const out = await fetchResolveThreadEmailIds({
      baseUrl: 'https://jmap.example',
      getAuthToken: () => 'tok',
      fetch: fetchImpl as unknown as typeof fetch,
      session: fakeSession(),
      threadIds: ['T1', 'T2'],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = JSON.parse(
      (fetchImpl.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.methodCalls[0][0]).toBe('Thread/get');
    expect(body.methodCalls[0][1].ids).toEqual(['T1', 'T2']);
    expect([...out.get('T1')!]).toEqual(['E1a', 'E1b']);
    expect([...out.get('T2')!]).toEqual(['E2a']);
  });

  it('omits threads the server did not return', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        methodResponses: [['Thread/get', { list: [{ id: 'T1', emailIds: ['E1'] }] }, '0']],
      }),
    );
    const out = await fetchResolveThreadEmailIds({
      baseUrl: 'https://jmap.example',
      getAuthToken: () => 'tok',
      fetch: fetchImpl as unknown as typeof fetch,
      session: fakeSession(),
      threadIds: ['T1', 'T-gone'],
    });
    expect(out.has('T1')).toBe(true);
    expect(out.has('T-gone')).toBe(false);
  });

  it('throws unauthorized when no token is available', async () => {
    await expect(
      fetchResolveThreadEmailIds({
        baseUrl: 'https://jmap.example',
        getAuthToken: () => null,
        fetch: vi.fn() as unknown as typeof fetch,
        session: fakeSession(),
        threadIds: ['T1'],
      }),
    ).rejects.toMatchObject({ kind: 'unauthorized' });
  });
});
```

> Note: the `.rejects.toMatchObject({ kind: 'unauthorized' })` assumes `makeError` produces an object carrying the error kind. If the existing `makeError` shape differs (e.g. `.code`), adjust the matcher to the project's `ToolError` shape — check one existing jmap-client test (e.g. a `fetchMailModifyCommit` test) for the exact field before finalizing.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/ubuntu/code/iarsma/shell && pnpm vitest run src/runtime/__tests__/resolve-thread-email-ids.test.ts`
Expected: FAIL — `fetchResolveThreadEmailIds` is not exported.

- [ ] **Step 3: Write the implementation**

In `shell/src/runtime/jmap-client.ts`, add near the `Thread` / `ThreadGet` types (after line ~785) the option type, and add the function after the `parseThreadGet` block (after line ~885). Mirror the dispatch shape of `fetchMailModifyCommit` (token → fetch → status check → parse):

```typescript
export type ResolveThreadEmailIdsOptions = JmapClientOptions & {
  readonly session: Session;
  readonly threadIds: readonly string[];
};

/**
 * Resolve a set of thread ids to each thread's full email-id list via a
 * single batched `Thread/get`. Returns `Map<threadId, emailIds[]>`;
 * threads the server doesn't return are absent from the map. Used by the
 * bulk-action path to expand whole-conversation selections before a
 * single `Email/set` — see `resolveThreadEmailIds` on the Invoker.
 *
 * No `Email/get` back-reference here: bulk actions only need the ids,
 * not the bodies (contrast `fetchThreadGet`, which fetches full bodies).
 */
export async function fetchResolveThreadEmailIds(
  opts: ResolveThreadEmailIdsOptions,
): Promise<ReadonlyMap<string, readonly string[]>> {
  if (opts.threadIds.length === 0) {
    return new Map();
  }
  const token = await opts.getAuthToken();
  if (token === null) {
    throw makeError('unauthorized', 'No auth token available.');
  }
  const fetchImpl = opts.fetch ?? fetch;
  const accountId = opts.session.primaryAccountIdMail;
  const body = JSON.stringify({
    using: JMAP_USING_MAIL,
    methodCalls: [['Thread/get', { accountId, ids: opts.threadIds }, '0']],
  });

  let response: Response;
  try {
    response = await fetchImpl(opts.session.apiUrl, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body,
    });
  } catch (e) {
    throw makeError('network_error', `JMAP fetch failed: ${describe(e)}`);
  }
  if (!response.ok) {
    throw makeError(
      response.status === 401 ? 'unauthorized' : 'jmap_http_error',
      `JMAP Thread/get (batch) returned ${response.status} ${response.statusText}`,
    );
  }

  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw makeError(
      'jmap_parse_error',
      `Failed to parse Thread/get batch: ${describe(e)}`,
    );
  }
  const responses = (parsed as { methodResponses?: unknown }).methodResponses;
  if (!Array.isArray(responses) || responses.length === 0) {
    throw makeError('jmap_parse_error', 'Thread/get batch: no methodResponses.');
  }
  const first = responses[0];
  if (!Array.isArray(first) || first.length < 2) {
    throw makeError('jmap_parse_error', 'Thread/get batch: malformed response.');
  }
  const result = first[1] as { list?: unknown };
  const items = Array.isArray(result.list) ? result.list : [];
  const out = new Map<string, readonly string[]>();
  for (const item of items) {
    if (item === null || typeof item !== 'object') continue;
    const t = item as { id?: unknown; emailIds?: unknown };
    if (typeof t.id !== 'string') continue;
    const ids: string[] = [];
    if (Array.isArray(t.emailIds)) {
      for (const eid of t.emailIds) {
        if (typeof eid === 'string') ids.push(eid);
      }
    }
    out.set(t.id, ids);
  }
  return out;
}
```

> Before writing: confirm the exact spelling of `makeError`'s first argument (the error-kind strings `'unauthorized'`, `'network_error'`, `'jmap_http_error'`, `'jmap_parse_error'`) against existing calls in this file (e.g. `fetchMailModifyCommit` at ~line 2011 and `fetchThreadGet` at ~line 826). Use whatever kinds those use verbatim.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/ubuntu/code/iarsma/shell && pnpm vitest run src/runtime/__tests__/resolve-thread-email-ids.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd /home/ubuntu/code/iarsma
git add shell/src/runtime/jmap-client.ts shell/src/runtime/__tests__/resolve-thread-email-ids.test.ts
git commit -m "feat(bulk-actions): batched Thread/get email-id resolver"
```

---

## Task 3: Invoker method + wrapper forwarding + mock support

**Files:**
- Modify: `shell/src/runtime/invoker.ts` (interface ~line 153; `jmapInvoker` impl after `uploadAttachment` ~line 713; `MockInvokerOptions` ~line 732 + `mockInvoker` ~line 739)
- Modify: `shell/src/runtime/cached-invoker.ts` (after the `uploadAttachment` spread ~line 165)
- Modify: `shell/src/runtime/logging-invoker.ts` (after the `uploadAttachment` spread ~line 212)
- Test: `shell/src/runtime/__tests__/invoker-resolve-thread-email-ids.test.ts` (create)

**Interfaces:**
- Consumes: `fetchResolveThreadEmailIds` (Task 2); the `Invoker` interface; `jmapInvoker`'s `getSession()` closure + `opts`.
- Produces: optional `Invoker.resolveThreadEmailIds?(threadIds: readonly string[]): Promise<ReadonlyMap<string, readonly string[]>>`, implemented in `jmapInvoker`, forwarded by both wrappers, and supported by `mockInvoker` via `MockInvokerOptions.resolveThreadEmailIds`.

- [ ] **Step 1: Write the failing test**

Create `shell/src/runtime/__tests__/invoker-resolve-thread-email-ids.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { cachedInvoker } from '../cached-invoker.js';
import { inMemoryCacheStorage } from '../cache-storage.js';
import type { Invoker } from '../invoker.js';

function innerWithResolver(
  map: ReadonlyMap<string, readonly string[]>,
): Invoker {
  return {
    async invoke() {
      throw new Error('not used');
    },
    resolveThreadEmailIds: vi.fn(async () => map),
  };
}

describe('cachedInvoker forwards resolveThreadEmailIds', () => {
  it('passes through to the inner invoker', async () => {
    const inner = innerWithResolver(new Map([['T1', ['E1', 'E2']]]));
    const wrapped = cachedInvoker({ inner, store: inMemoryCacheStorage() });
    const out = await wrapped.resolveThreadEmailIds!(['T1']);
    expect([...out.get('T1')!]).toEqual(['E1', 'E2']);
    expect(inner.resolveThreadEmailIds).toHaveBeenCalledWith(['T1']);
  });

  it('omits the method when the inner invoker lacks it', () => {
    const inner: Invoker = {
      async invoke() {
        return undefined as never;
      },
    };
    const wrapped = cachedInvoker({ inner, store: inMemoryCacheStorage() });
    expect(wrapped.resolveThreadEmailIds).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/ubuntu/code/iarsma/shell && pnpm vitest run src/runtime/__tests__/invoker-resolve-thread-email-ids.test.ts`
Expected: FAIL — `wrapped.resolveThreadEmailIds` is `undefined` (not yet forwarded).

- [ ] **Step 3a: Add the interface method** in `shell/src/runtime/invoker.ts`, immediately after the `uploadAttachment?(...)` declaration (~line 153, inside `interface Invoker`):

```typescript
  /**
   * Resolve a set of thread ids to each thread's full flattened email
   * ids via a single batched `Thread/get`. Used by bulk actions to
   * expand whole-conversation selections before a single mutating call.
   *
   * Optional for the same reason as `uploadAttachment`: test mocks can
   * skip it unless the test under exercise resolves threads. The JMAP
   * invoker always implements it.
   */
  resolveThreadEmailIds?(
    threadIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly string[]>>;
```

- [ ] **Step 3b: Implement in `jmapInvoker`** in `shell/src/runtime/invoker.ts`, as a sibling method after `uploadAttachment` (~line 713). First add the import to the existing `jmap-client.js` import group at the top of the file: `fetchResolveThreadEmailIds`.

```typescript
    async resolveThreadEmailIds(threadIds) {
      const session = await getSession();
      return fetchResolveThreadEmailIds({
        ...opts,
        session,
        threadIds,
      });
    },
```

- [ ] **Step 3c: Forward in `cachedInvoker`** in `shell/src/runtime/cached-invoker.ts`, right after the `uploadAttachment` conditional spread (~line 165), inside the returned object:

```typescript
    ...(opts.inner.resolveThreadEmailIds !== undefined
      ? {
          resolveThreadEmailIds: (threadIds: readonly string[]) =>
            opts.inner.resolveThreadEmailIds!(threadIds),
        }
      : {}),
```

- [ ] **Step 3d: Forward in `loggingInvoker`** in `shell/src/runtime/logging-invoker.ts`, right after its `uploadAttachment` conditional spread (~line 212). Resolution is a read — no log entry, same as attachment uploads:

```typescript
    ...(opts.inner.resolveThreadEmailIds !== undefined
      ? {
          resolveThreadEmailIds: (threadIds: readonly string[]) =>
            opts.inner.resolveThreadEmailIds!(threadIds),
        }
      : {}),
```

- [ ] **Step 3e: Support in `mockInvoker`** in `shell/src/runtime/invoker.ts`. Add to `MockInvokerOptions` (~line 732):

```typescript
  /** Optional `resolveThreadEmailIds` handler for bulk-action tests. */
  readonly resolveThreadEmailIds?: (
    threadIds: readonly string[],
  ) => Promise<ReadonlyMap<string, readonly string[]>>;
```

Then in `mockInvoker` (~line 739), conditionally include it the same way `uploadAttachment` is included:

```typescript
    ...(options.resolveThreadEmailIds !== undefined
      ? { resolveThreadEmailIds: options.resolveThreadEmailIds }
      : {}),
```

- [ ] **Step 4: Run test + typecheck**

Run: `cd /home/ubuntu/code/iarsma/shell && pnpm vitest run src/runtime/__tests__/invoker-resolve-thread-email-ids.test.ts && pnpm tsc --noEmit`
Expected: tests PASS (2), tsc clean.

- [ ] **Step 5: Commit**

```bash
cd /home/ubuntu/code/iarsma
git add shell/src/runtime/invoker.ts shell/src/runtime/cached-invoker.ts shell/src/runtime/logging-invoker.ts shell/src/runtime/__tests__/invoker-resolve-thread-email-ids.test.ts
git commit -m "feat(bulk-actions): resolveThreadEmailIds invoker method + forwarding"
```

---

## Task 4: Selection atoms + checkbox column + click selection

**Files:**
- Modify: `shell/src/mail-state.ts` (after `selectedThreadIdAtom`, ~line 41)
- Modify: `shell/src/views/thread-list.tsx` (`ThreadRow` JSX; `ThreadListBody`; clearing effects at ~173 and ~267)
- Modify: `shell/src/views/thread-list.module.css` (new `.rowCheckbox` rule)
- Test: `shell/src/views/__tests__/thread-list.test.tsx` (extend)

**Interfaces:**
- Consumes: `toggle`, `selectRange` (Task 1); `selectedThreadIdsAtom`, `selectionAnchorIndexAtom` (this task).
- Produces:
  - `selectedThreadIdsAtom: atom<ReadonlySet<string>>` (initial empty set)
  - `selectionAnchorIndexAtom: atom<number | null>` (initial null)
  - `ThreadRow` gains props: `selected: boolean`, `selectionActive: boolean`, `onToggleSelect: (threadId: string, index: number, mods: { shift: boolean; meta: boolean }) => void`.

- [ ] **Step 1: Add the atoms** in `shell/src/mail-state.ts`, immediately after `selectedThreadIdAtom` (line 41):

```typescript
/**
 * Multi-select set for bulk actions (#5). Holds `thread.id`s. Cleared by
 * the same effects that clear `selectedThreadIdAtom` (mailbox / label /
 * search context change) — selection never survives a context switch.
 */
export const selectedThreadIdsAtom = atom<ReadonlySet<string>>(new Set());

/**
 * Anchor row index for Shift-click range selection. Set on each plain
 * checkbox toggle / plain row click; consumed by Shift-click. `null`
 * means "no anchor yet" (a Shift-click then anchors on itself).
 */
export const selectionAnchorIndexAtom = atom<number | null>(null);
```

- [ ] **Step 2: Write the failing test** — add to `shell/src/views/__tests__/thread-list.test.tsx` (mirror the existing `renderThreadList` / `waitForList` helpers already in the file):

```typescript
describe('multi-select checkbox', () => {
  it('shows a selection checkbox per row and selects on click', async () => {
    renderThreadList({});
    await waitForList();
    const checkboxes = screen.getAllByRole('checkbox', { name: /select conversation/i });
    expect(checkboxes.length).toBeGreaterThan(0);
    fireEvent.click(checkboxes[0]);
    expect(checkboxes[0]).toBeChecked();
  });

  it('clicking a checkbox does not open the thread', async () => {
    const onSelect = vi.fn();
    renderThreadList({ onOpen: onSelect });
    await waitForList();
    const checkbox = screen.getAllByRole('checkbox', { name: /select conversation/i })[0];
    fireEvent.click(checkbox);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
```

> Adjust `onOpen` to whatever prop the existing tests use to detect a thread being opened (check the file's `renderThreadList` signature — it may be `onSelect`/`onOpenThread`). Use the existing convention.

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /home/ubuntu/code/iarsma/shell && pnpm vitest run src/views/__tests__/thread-list.test.tsx -t "multi-select checkbox"`
Expected: FAIL — no checkboxes rendered.

- [ ] **Step 4a: Render the checkbox in `ThreadRow`.** Read `ThreadRow` (lines ~1060–1250). Inside the `<li className={styles['rowLi']}>` wrapper (the element that already contains the `.row` button and the absolutely-positioned `.rowActions` div), add as the **first child**, before the row `<button>`:

```tsx
<input
  type="checkbox"
  className={styles['rowCheckbox']}
  checked={selected}
  readOnly
  data-active={selectionActive ? 'true' : undefined}
  aria-label={`Select conversation: ${subject}`}
  onClick={(ev) => {
    ev.stopPropagation();
    onToggleSelect(thread.id, index, {
      shift: ev.shiftKey,
      meta: ev.metaKey || ev.ctrlKey,
    });
  }}
/>
```

Add the three props to the `ThreadRow` prop type and destructuring: `selected`, `selectionActive`, `onToggleSelect` (signatures in the Interfaces block above). `subject` and `thread`/`index` are already in scope in `ThreadRow`.

- [ ] **Step 4b: Add CSS** in `shell/src/views/thread-list.module.css`. The checkbox overlays the left avatar slot; visible on hover/focus-within or whenever any selection is active or this row is selected (mirrors the `.rowActions` visibility pattern at lines 325–353):

```css
.rowCheckbox {
  position: absolute;
  left: var(--space-md);
  top: 50%;
  transform: translateY(-50%);
  z-index: 2;
  width: 18px;
  height: 18px;
  margin: 0;
  cursor: pointer;
  display: none;
  accent-color: var(--accent);
}

.rowLi:hover .rowCheckbox,
.rowLi:focus-within .rowCheckbox,
.rowCheckbox:checked,
.rowCheckbox[data-active='true'] {
  display: block;
}
```

- [ ] **Step 4c: Wire selection state + handler in `ThreadListBody`.** Add near the other atom hooks (the file already imports `useAtom`/`useSetAtom`; `selectedThreadId` is read around line 348):

```typescript
const [selectedThreadIds, setSelectedThreadIds] = useAtom(selectedThreadIdsAtom);
const [selectionAnchor, setSelectionAnchor] = useAtom(selectionAnchorIndexAtom);
const selectionActive = selectedThreadIds.size > 0;

const handleToggleSelect = useCallback(
  (threadId: string, index: number, mods: { shift: boolean; meta: boolean }) => {
    if (mods.shift && selectionAnchor !== null) {
      const orderedIds = threads.map((t) => t.id);
      setSelectedThreadIds((prev) =>
        selectRange(orderedIds, selectionAnchor, index, prev),
      );
      return;
    }
    setSelectedThreadIds((prev) => toggle(prev, threadId));
    setSelectionAnchor(index);
  },
  [threads, selectionAnchor, setSelectedThreadIds, setSelectionAnchor],
);
```

Add imports at the top of `thread-list.tsx`:

```typescript
import {
  selectedThreadIdsAtom,
  selectionAnchorIndexAtom,
} from '../mail-state.js';
import { toggle, selectRange } from '../runtime/thread-selection.js';
```

(`selectedThreadIdsAtom`/`selectionAnchorIndexAtom` join the existing `../mail-state.js` import if one exists — merge, don't duplicate.)

- [ ] **Step 4d: Pass the new props where rows are mapped** (lines ~810–839):

```tsx
<ThreadRow
  key={thread.id}
  ref={virtualizer.measureElement}
  index={vi.index}
  thread={thread}
  selected={selectedThreadIds.has(thread.id)}
  selectionActive={selectionActive}
  onToggleSelect={handleToggleSelect}
  /* ...existing props... */
/>
```

- [ ] **Step 4e: Meta/Shift-click on the row body** toggles selection instead of opening. In the row `<button>`'s click path, modify the parent handler that currently calls `onSelect(index)`. Locate the `onClick` passed to `ThreadRow`/the row button and update it to inspect modifiers first:

```typescript
const handleRowActivate = useCallback(
  (index: number, ev: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; preventDefault: () => void }) => {
    const thread = threads[index];
    if (thread === undefined) return;
    if (ev.metaKey || ev.ctrlKey || ev.shiftKey) {
      ev.preventDefault();
      handleToggleSelect(thread.id, index, {
        shift: ev.shiftKey,
        meta: ev.metaKey || ev.ctrlKey,
      });
      return;
    }
    onSelect(index);
  },
  [threads, handleToggleSelect, onSelect],
);
```

Wire the row button's `onClick={(ev) => handleRowActivate(index, ev)}` (the `ThreadRow` `onClick` prop currently forwards to `onClick={onClick}` at line ~1080 — change the parent to pass `handleRowActivate`-backed click, keeping the plain-click open behavior intact). Keep `aria-current` / focus behavior unchanged.

- [ ] **Step 4f: Clear selection on context change.** In the two existing clearing effects, add the new atoms. In `ThreadListWithMailbox` (~lines 267–270) and `ThreadListWithLabel` (~lines 173–175), these components call `useSetAtom(selectedThreadIdAtom)`. Add sibling setters and clear all three together:

```typescript
const setSelectedThreadIds = useSetAtom(selectedThreadIdsAtom);
const setSelectionAnchor = useSetAtom(selectionAnchorIndexAtom);
useEffect(() => {
  setSelectedThreadId(null);
  setSelectedThreadIds(new Set());
  setSelectionAnchor(null);
}, [mailboxId, setSelectedThreadId, setSelectedThreadIds, setSelectionAnchor]);
```

(For `ThreadListWithLabel` use its `hasKeyword` dependency instead of `mailboxId`, matching the existing effect. Search mode renders `ThreadListSearchMode`, a separate component branch, so switching into/out of search remounts the body — but add the same clearing effect keyed on the search query there if `ThreadListSearchMode` persists across query changes; if it remounts per query, no effect is needed. Verify by reading the component; default to adding the effect for safety.)

- [ ] **Step 5: Run the targeted test + typecheck**

Run: `cd /home/ubuntu/code/iarsma/shell && pnpm vitest run src/views/__tests__/thread-list.test.tsx -t "multi-select checkbox" && pnpm tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 6: Commit**

```bash
cd /home/ubuntu/code/iarsma
git add shell/src/mail-state.ts shell/src/views/thread-list.tsx shell/src/views/thread-list.module.css shell/src/views/__tests__/thread-list.test.tsx
git commit -m "feat(bulk-actions): selection atoms + row checkbox + click selection"
```

---

## Task 5: Keyboard `x` toggle + `Esc` clear + binding registry

**Files:**
- Modify: `shell/src/runtime/keyboard-bindings.ts` (thread-list group, after the `Shift-U` entry ~line 88)
- Modify: `shell/src/runtime/__tests__/keyboard-bindings.test.ts` (count 8→9)
- Modify: `shell/src/views/thread-list.tsx` (`onKeyDown` switch, lines 626–682)
- Modify: `docs/keyboard.md` (move `x` from Reserved to the thread-list table)
- Test: `shell/src/views/__tests__/thread-list.test.tsx` (extend)

**Interfaces:**
- Consumes: `selectedThreadIdsAtom`, `handleToggleSelect` (Task 4); `clearSelection` (Task 1).
- Produces: an `x` binding in `KEYBOARD_BINDINGS`; `case 'x'` / `case 'Escape'` in `onKeyDown`.

- [ ] **Step 1: Add the binding** in `shell/src/runtime/keyboard-bindings.ts`, right after the `Shift-U` entry (~line 88):

```typescript
  { keys: 'x', action: 'Toggle selection of focused thread', scope: 'thread-list' },
```

- [ ] **Step 2: Update the count test** in `shell/src/runtime/__tests__/keyboard-bindings.test.ts` (the `expect(grouped.get('thread-list')?.length).toBe(8)` assertion → `9`, and update the inline comment "thread list 8 (...)" → "9 (... + x toggle selection)").

- [ ] **Step 3: Write the failing view test** in `shell/src/views/__tests__/thread-list.test.tsx`:

```typescript
describe('multi-select keyboard', () => {
  it('toggles selection of the focused thread on "x"', async () => {
    renderThreadList({});
    await waitForList(); // first row auto-focused
    const list = screen.getByRole('list', { name: 'Threads' });
    fireEvent.keyDown(list, { key: 'x' });
    const checkboxes = screen.getAllByRole('checkbox', { name: /select conversation/i });
    expect(checkboxes[0]).toBeChecked();
  });

  it('clears the selection on Escape', async () => {
    renderThreadList({});
    await waitForList();
    const list = screen.getByRole('list', { name: 'Threads' });
    fireEvent.keyDown(list, { key: 'x' });
    fireEvent.keyDown(list, { key: 'Escape' });
    const checkboxes = screen.getAllByRole('checkbox', { name: /select conversation/i });
    expect(checkboxes[0]).not.toBeChecked();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd /home/ubuntu/code/iarsma/shell && pnpm vitest run src/views/__tests__/thread-list.test.tsx -t "multi-select keyboard"`
Expected: FAIL — `x` does nothing.

- [ ] **Step 5: Implement the cases** in `onKeyDown` (after the `case 'U':` block, ~line 670):

```typescript
      case 'x': // toggle selection of the focused thread
        if (i < 0) break;
        event.preventDefault();
        {
          const focusedThread = threads[i];
          if (focusedThread !== undefined) {
            handleToggleSelect(focusedThread.id, i, { shift: false, meta: false });
          }
        }
        break;
      case 'Escape': // clear an active selection (only when non-empty,
                     // so the global overlay-close handler still works)
        if (selectedThreadIds.size === 0) break;
        event.preventDefault();
        setSelectedThreadIds(clearSelection());
        setSelectionAnchor(null);
        break;
```

Add `threads`, `handleToggleSelect`, `selectedThreadIds`, `setSelectedThreadIds`, `setSelectionAnchor` to the `onKeyDown` `useCallback` dependency array. Add the import `import { clearSelection } from '../runtime/thread-selection.js';` (merge with the Task 4 import line: `import { toggle, selectRange, clearSelection } from '../runtime/thread-selection.js';`).

- [ ] **Step 6: Update docs** in `docs/keyboard.md`: remove the `x` row from the "Reserved (Phase 2)" table (lines ~67–75) and add it to the active Thread-list section: `| <kbd>x</kbd> | Toggle selection of focused thread | Thread list |`.

- [ ] **Step 7: Run tests**

Run: `cd /home/ubuntu/code/iarsma/shell && pnpm vitest run src/runtime/__tests__/keyboard-bindings.test.ts src/views/__tests__/thread-list.test.tsx -t "multi-select keyboard"`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
cd /home/ubuntu/code/iarsma
git add shell/src/runtime/keyboard-bindings.ts shell/src/runtime/__tests__/keyboard-bindings.test.ts shell/src/views/thread-list.tsx shell/src/views/__tests__/thread-list.test.tsx docs/keyboard.md
git commit -m "feat(bulk-actions): x toggles selection, Esc clears; help binding + docs"
```

---

## Task 6: Header select-all checkbox (with indeterminate)

**Files:**
- Modify: `shell/src/views/thread-list.tsx` (header `titleRow`, ~lines 717–753)
- Modify: `shell/src/views/thread-list.module.css` (optional small style)
- Test: `shell/src/views/__tests__/thread-list.test.tsx` (extend)

**Interfaces:**
- Consumes: `selectedThreadIdsAtom`, `threads`, `selectAll`, `clearSelection`.
- Produces: a select-all checkbox in the header; `selectAllRef` for the indeterminate property.

- [ ] **Step 1: Write the failing test**:

```typescript
describe('select-all', () => {
  it('selects all loaded threads when the header checkbox is clicked', async () => {
    renderThreadList({});
    await waitForList();
    const selectAll = screen.getByRole('checkbox', { name: /select all/i });
    fireEvent.click(selectAll);
    const rowBoxes = screen.getAllByRole('checkbox', { name: /select conversation/i });
    for (const box of rowBoxes) expect(box).toBeChecked();
    expect(selectAll).toBeChecked();
  });

  it('clears the selection when clicked while all selected', async () => {
    renderThreadList({});
    await waitForList();
    const selectAll = screen.getByRole('checkbox', { name: /select all/i });
    fireEvent.click(selectAll); // all
    fireEvent.click(selectAll); // none
    const rowBoxes = screen.getAllByRole('checkbox', { name: /select conversation/i });
    for (const box of rowBoxes) expect(box).not.toBeChecked();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/ubuntu/code/iarsma/shell && pnpm vitest run src/views/__tests__/thread-list.test.tsx -t "select-all"`
Expected: FAIL — no "select all" checkbox.

- [ ] **Step 3: Implement** in `ThreadListBody`, computing derived flags and rendering the checkbox. Add near the selection state (Task 4):

```typescript
const loadedSelectedCount = useMemo(
  () => threads.reduce((n, t) => (selectedThreadIds.has(t.id) ? n + 1 : n), 0),
  [threads, selectedThreadIds],
);
const allLoadedSelected = threads.length > 0 && loadedSelectedCount === threads.length;
const someLoadedSelected = loadedSelectedCount > 0 && !allLoadedSelected;
const selectAllRef = useRef<HTMLInputElement>(null);
useEffect(() => {
  if (selectAllRef.current !== null) {
    selectAllRef.current.indeterminate = someLoadedSelected;
  }
}, [someLoadedSelected]);

const handleSelectAllToggle = useCallback(() => {
  if (allLoadedSelected) {
    setSelectedThreadIds(clearSelection());
    setSelectionAnchor(null);
  } else {
    setSelectedThreadIds(selectAll(threads.map((t) => t.id)));
  }
}, [allLoadedSelected, threads, setSelectedThreadIds, setSelectionAnchor]);
```

Add `selectAll` to the `thread-selection.js` import. Render in the header `titleRow` (line ~719), as the first child before `<h2>`:

```tsx
<input
  ref={selectAllRef}
  type="checkbox"
  className={styles['selectAll']}
  checked={allLoadedSelected}
  onChange={handleSelectAllToggle}
  aria-label="Select all conversations"
/>
```

Add a minimal style in the CSS module:

```css
.selectAll {
  width: 18px;
  height: 18px;
  margin: 0 var(--space-sm) 0 0;
  accent-color: var(--accent);
  cursor: pointer;
}
```

- [ ] **Step 4: Run test**

Run: `cd /home/ubuntu/code/iarsma/shell && pnpm vitest run src/views/__tests__/thread-list.test.tsx -t "select-all" && pnpm tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
cd /home/ubuntu/code/iarsma
git add shell/src/views/thread-list.tsx shell/src/views/thread-list.module.css shell/src/views/__tests__/thread-list.test.tsx
git commit -m "feat(bulk-actions): header select-all with indeterminate state"
```

---

## Task 7: BulkActionBar component

**Files:**
- Create: `shell/src/components/bulk-action-bar.tsx`
- Create: `shell/src/components/bulk-action-bar.module.css`
- Test: `shell/src/components/__tests__/bulk-action-bar.test.tsx`

**Interfaces:**
- Consumes: `MenuButton` (`../menu-button.js`), `Button` (`../button.js` — confirm the path used by `thread-list.tsx`), the move/label icon components used in `thread-list.tsx` (`MoveToFolderIcon`, `LabelTagIcon`, `MarkReadIcon`, `MarkUnreadIcon`, `TrashIcon`).
- Produces: `BulkActionBar` with props:
  ```typescript
  type BulkActionBarProps = {
    readonly count: number;
    readonly moveTargets: ReadonlyArray<{ readonly id: string; readonly label: string }>;
    readonly labels: ReadonlyArray<{ readonly key: string; readonly name: string }>;
    readonly onMarkRead: () => void;
    readonly onMarkUnread: () => void;
    readonly onMove: (targetMailboxId: string) => void;
    readonly onLabelToggle: (labelKey: string) => void;
    readonly onDelete: () => void;
    readonly onClear: () => void;
  };
  ```
  Note: bulk label toggle is an add-only affordance per click (the bar can't know per-thread keyword state across a mixed selection), so each label entry just calls `onLabelToggle(key)` which the parent treats as "add this label to all selected".

- [ ] **Step 1: Write the failing test** in `shell/src/components/__tests__/bulk-action-bar.test.tsx`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BulkActionBar } from '../bulk-action-bar.js';

function setup(overrides: Partial<Parameters<typeof BulkActionBar>[0]> = {}) {
  const props = {
    count: 3,
    moveTargets: [{ id: 'mb-archive', label: 'Archive' }],
    labels: [{ key: 'work', name: 'Work' }],
    onMarkRead: vi.fn(),
    onMarkUnread: vi.fn(),
    onMove: vi.fn(),
    onLabelToggle: vi.fn(),
    onDelete: vi.fn(),
    onClear: vi.fn(),
    ...overrides,
  };
  render(<BulkActionBar {...props} />);
  return props;
}

describe('BulkActionBar', () => {
  it('shows the selected count', () => {
    setup({ count: 5 });
    expect(screen.getByText(/5 selected/i)).toBeInTheDocument();
  });

  it('fires onMarkRead / onMarkUnread / onDelete', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: /mark read/i }));
    fireEvent.click(screen.getByRole('button', { name: /mark unread/i }));
    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    expect(props.onMarkRead).toHaveBeenCalledTimes(1);
    expect(props.onMarkUnread).toHaveBeenCalledTimes(1);
    expect(props.onDelete).toHaveBeenCalledTimes(1);
  });

  it('fires onClear from the clear control', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: /clear selection/i }));
    expect(props.onClear).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/ubuntu/code/iarsma/shell && pnpm vitest run src/components/__tests__/bulk-action-bar.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `shell/src/components/bulk-action-bar.tsx`. Reuse `MenuButton` (the move/label menus) exactly as `thread-list.tsx` does (with `size="sm"`), and `Button` for the discrete actions. Confirm the icon import paths against `thread-list.tsx` (they are imported there already):

```tsx
/**
 * Bulk action bar (#5) — rendered in the thread-list header toolbar slot
 * when one or more conversations are selected. Reuses MenuButton for the
 * Move / Label menus (parity with the per-row actions) and plain Buttons
 * for the discrete mark-read / mark-unread / delete actions.
 */
import { MenuButton } from './menu-button.js';
import { Button } from './button.js';
import {
  MoveToFolderIcon,
  LabelTagIcon,
  MarkReadIcon,
  MarkUnreadIcon,
  TrashIcon,
} from './icons.js'; // confirm the actual icon module path used by thread-list.tsx
import styles from './bulk-action-bar.module.css';

export type BulkActionBarProps = {
  readonly count: number;
  readonly moveTargets: ReadonlyArray<{ readonly id: string; readonly label: string }>;
  readonly labels: ReadonlyArray<{ readonly key: string; readonly name: string }>;
  readonly onMarkRead: () => void;
  readonly onMarkUnread: () => void;
  readonly onMove: (targetMailboxId: string) => void;
  readonly onLabelToggle: (labelKey: string) => void;
  readonly onDelete: () => void;
  readonly onClear: () => void;
};

export function BulkActionBar(props: BulkActionBarProps): JSX.Element {
  return (
    <div className={styles['bar']} role="region" aria-label="Bulk actions">
      <span className={styles['count']} aria-live="polite">
        {props.count} selected
      </span>
      <button
        type="button"
        className={styles['clear']}
        onClick={props.onClear}
        aria-label="Clear selection"
        title="Clear selection"
      >
        ✕
      </button>
      <span className={styles['spacer']} />
      <Button variant="ghost" size="sm" onClick={props.onMarkRead} aria-label="Mark read">
        <MarkReadIcon /> Mark read
      </Button>
      <Button variant="ghost" size="sm" onClick={props.onMarkUnread} aria-label="Mark unread">
        <MarkUnreadIcon /> Mark unread
      </Button>
      {props.moveTargets.length > 0 ? (
        <MenuButton
          size="sm"
          label="Move selected to…"
          items={props.moveTargets.map((m) => ({
            key: m.id,
            label: m.label,
            onSelect: () => props.onMove(m.id),
          }))}
        >
          <MoveToFolderIcon />
        </MenuButton>
      ) : null}
      {props.labels.length > 0 ? (
        <MenuButton
          size="sm"
          label="Label selected"
          items={props.labels.map((lbl) => ({
            key: lbl.key,
            label: lbl.name,
            onSelect: () => props.onLabelToggle(lbl.key),
          }))}
        >
          <LabelTagIcon />
        </MenuButton>
      ) : null}
      <Button variant="destructive" size="sm" onClick={props.onDelete} aria-label="Delete selected">
        <TrashIcon /> Delete
      </Button>
    </div>
  );
}
```

> Confirm: `Button`'s `variant` values (`'ghost'` / `'destructive'`) and the icon module path against the existing imports in `thread-list.tsx` (it imports all five icons and `MenuButton`/`Button` already). Use the exact symbols/paths it uses.

```css
/* shell/src/components/bulk-action-bar.module.css */
.bar {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  width: 100%;
}
.count {
  font-weight: 600;
  color: var(--text-1);
  white-space: nowrap;
}
.clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-1);
  cursor: pointer;
}
.spacer {
  flex: 1;
}
```

- [ ] **Step 4: Run test**

Run: `cd /home/ubuntu/code/iarsma/shell && pnpm vitest run src/components/__tests__/bulk-action-bar.test.tsx && pnpm tsc --noEmit`
Expected: PASS (3), tsc clean.

- [ ] **Step 5: Commit**

```bash
cd /home/ubuntu/code/iarsma
git add shell/src/components/bulk-action-bar.tsx shell/src/components/bulk-action-bar.module.css shell/src/components/__tests__/bulk-action-bar.test.tsx
git commit -m "feat(bulk-actions): BulkActionBar component"
```

---

## Task 8: Wire bulk dispatch into the thread list

**Files:**
- Modify: `shell/src/views/thread-list.tsx` (`ThreadListBody`: bulk handlers + render `BulkActionBar` in the header toolbar slot)
- Test: `shell/src/views/__tests__/thread-list.test.tsx` (extend — dispatch assertions)

**Interfaces:**
- Consumes: `invoker.resolveThreadEmailIds` (Task 3), `invoker.invoke` (`mail.modify` / `mail.delete` / `label.apply`), `BulkActionBar` (Task 7), `clearSelection`, `selectedThreadIdsAtom`, `refetch`, `bumpPushGeneration`, `moveTargets`/`labels` (already computed in `ThreadListBody` for the per-row menus).
- Produces: a single shared `resolveSelectedEmailIds()` + five bulk handlers; `BulkActionBar` rendered when `selectionActive`.

- [ ] **Step 1: Write the failing test** in `shell/src/views/__tests__/thread-list.test.tsx`. Use a mock invoker that records `mail.modify` calls and supplies `resolveThreadEmailIds`:

```typescript
describe('bulk actions dispatch', () => {
  it('resolves selected threads and marks them read in one mail.modify', async () => {
    const modifyCalls: unknown[] = [];
    const resolveThreadEmailIds = vi.fn(
      async (ids: readonly string[]) =>
        new Map(ids.map((id) => [id, [`${id}-e1`, `${id}-e2`]])),
    );
    renderThreadList({
      invokerOverrides: {
        resolveThreadEmailIds,
        invoke: async (name: string, input: unknown) => {
          if (name === 'mail.modify') modifyCalls.push(input);
          return {} as never;
        },
      },
    });
    await waitForList();
    // select the first two rows
    const boxes = screen.getAllByRole('checkbox', { name: /select conversation/i });
    fireEvent.click(boxes[0]);
    fireEvent.click(boxes[1]);
    fireEvent.click(screen.getByRole('button', { name: /mark read/i }));

    await waitFor(() => expect(modifyCalls).toHaveLength(1));
    expect(resolveThreadEmailIds).toHaveBeenCalledTimes(1);
    const call = modifyCalls[0] as { emailIds: string[]; patch: { keywords?: Record<string, unknown> } };
    expect(call.emailIds.length).toBe(4); // 2 threads × 2 emails
    expect(call.patch.keywords).toMatchObject({ $seen: true });
  });

  it('clears the selection after a successful bulk action', async () => {
    renderThreadList({
      invokerOverrides: {
        resolveThreadEmailIds: async (ids: readonly string[]) =>
          new Map(ids.map((id) => [id, [`${id}-e1`]])),
        invoke: async () => ({}) as never,
      },
    });
    await waitForList();
    const boxes = screen.getAllByRole('checkbox', { name: /select conversation/i });
    fireEvent.click(boxes[0]);
    fireEvent.click(screen.getByRole('button', { name: /mark read/i }));
    await waitFor(() =>
      expect(screen.queryByText(/1 selected/i)).not.toBeInTheDocument(),
    );
  });
});
```

> The `renderThreadList` helper must allow injecting an invoker. If it doesn't already accept `invokerOverrides`, extend the helper to build its mock invoker via `mockInvoker({...})` (Task 3 added `resolveThreadEmailIds` support there) and merge overrides. Follow the file's existing invoker-injection convention — check how current tests stub `invoke` (e.g. the `'#'` delete test asserts on `{ emailIds: ['E-T1'] }`, so an injection path already exists).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/ubuntu/code/iarsma/shell && pnpm vitest run src/views/__tests__/thread-list.test.tsx -t "bulk actions dispatch"`
Expected: FAIL — no "Mark read" bulk button rendered.

- [ ] **Step 3: Implement the shared resolver + handlers** in `ThreadListBody`:

```typescript
const resolveSelectedEmailIds = useCallback(async (): Promise<string[]> => {
  if (invoker.resolveThreadEmailIds === undefined) return [];
  const map = await invoker.resolveThreadEmailIds([...selectedThreadIds]);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const ids of map.values()) {
    for (const id of ids) {
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
  }
  return out;
}, [invoker, selectedThreadIds]);

const runBulk = useCallback(
  (mutate: (emailIds: string[]) => Promise<unknown>) => {
    void (async () => {
      try {
        const emailIds = await resolveSelectedEmailIds();
        if (emailIds.length === 0) {
          setSelectedThreadIds(clearSelection());
          setSelectionAnchor(null);
          return;
        }
        await mutate(emailIds);
        setSelectedThreadIds(clearSelection());
        setSelectionAnchor(null);
        await refetch();
        bumpPushGeneration((n) => n + 1);
      } catch (e) {
        // Leave the selection intact so the user can retry.
        // eslint-disable-next-line no-console
        console.warn('[iarsma] bulk action failed:', e);
      }
    })();
  },
  [resolveSelectedEmailIds, refetch, bumpPushGeneration, setSelectedThreadIds, setSelectionAnchor],
);

const handleBulkMarkRead = useCallback(
  () => runBulk((emailIds) => invoker.invoke('mail.modify', { emailIds, patch: { keywords: { $seen: true } } })),
  [runBulk, invoker],
);
const handleBulkMarkUnread = useCallback(
  () => runBulk((emailIds) => invoker.invoke('mail.modify', { emailIds, patch: { keywords: { $seen: false } } })),
  [runBulk, invoker],
);
const handleBulkMove = useCallback(
  (targetMailboxId: string) => {
    const fromId = mailboxId;
    if (fromId === null) return;
    runBulk((emailIds) =>
      invoker.invoke('mail.modify', {
        emailIds,
        patch: { mailboxIds: { [fromId]: false, [targetMailboxId]: true } },
      }),
    );
  },
  [runBulk, invoker, mailboxId],
);
const handleBulkLabel = useCallback(
  (labelKey: string) => runBulk((emailIds) => invoker.invoke('label.apply', { emailIds, add: [labelKey] })),
  [runBulk, invoker],
);
const handleBulkDelete = useCallback(
  () => runBulk((emailIds) => invoker.invoke('mail.delete', { emailIds })),
  [runBulk, invoker],
);
const handleClearSelection = useCallback(() => {
  setSelectedThreadIds(clearSelection());
  setSelectionAnchor(null);
}, [setSelectedThreadIds, setSelectionAnchor]);
```

> The `$seen: true`/`false` patch shape mirrors the existing single-row `toggleKeyword` (the row mark-read/unread path that already ships). Confirm against `toggleKeyword` (~lines 473–484) and use the identical value convention (boolean vs `null`). Bulk delete reuses `mail.delete`, which already registers the Undo toast via the App-level `onUndoRegistered` (it fires for `mail.delete` + `callerClass==='ui'`), so the existing toast appears for the batch with `count = emailIds.length` — no extra wiring needed.

- [ ] **Step 4: Render `BulkActionBar`** in the header. Import it (`import { BulkActionBar } from '../components/bulk-action-bar.js';`). In the header (`headerEl`, ~lines 717–753), render the bar in place of the normal `.toolbar` contents when `selectionActive`. Replace the toolbar block:

```tsx
<div className={styles['toolbar']} aria-label="Mailbox actions">
  {selectionActive ? (
    <BulkActionBar
      count={selectedThreadIds.size}
      moveTargets={(moveTargets ?? []).map((m) => ({ id: m.id, label: getMailboxLabel(m, m.id) }))}
      labels={(labels ?? []).map((l) => ({ key: l.key, name: l.name }))}
      onMarkRead={handleBulkMarkRead}
      onMarkUnread={handleBulkMarkUnread}
      onMove={handleBulkMove}
      onLabelToggle={handleBulkLabel}
      onDelete={handleBulkDelete}
      onClear={handleClearSelection}
    />
  ) : (
    <>
      <button
        type="button"
        className={styles['iconBtn']}
        onClick={() => void refetch()}
        aria-label="Refresh"
        title="Refresh"
      >
        <RefreshIcon />
      </button>
      <span className={styles['toolbarSpacer']} />
      {isTrash ? (
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setEmptyConfirmOpen(true)}
          disabled={(data?.total ?? 0) === 0 || emptying}
          aria-label="Empty trash"
        >
          {emptying ? 'Emptying…' : 'Empty trash'}
        </Button>
      ) : null}
    </>
  )}
</div>
```

> `moveTargets`, `labels`, `getMailboxLabel` are already in scope in `ThreadListBody` (they feed the per-row menus). Reuse them verbatim; confirm the `labels` element shape exposes `.key` and `.name` as the per-row Label menu uses (`lbl.key`, `lbl.name`).

- [ ] **Step 5: Run test + typecheck**

Run: `cd /home/ubuntu/code/iarsma/shell && pnpm vitest run src/views/__tests__/thread-list.test.tsx -t "bulk actions dispatch" && pnpm tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 6: Commit**

```bash
cd /home/ubuntu/code/iarsma
git add shell/src/views/thread-list.tsx shell/src/views/__tests__/thread-list.test.tsx
git commit -m "feat(bulk-actions): wire bulk dispatch + render BulkActionBar"
```

---

## Task 9: Accessibility, full gate, and manual smoke

**Files:** none new — verification + any small a11y fixes surfaced.

- [ ] **Step 1: a11y check on the new surfaces.** Ensure: row checkboxes have unique `aria-label`s (subject-qualified ✓ Task 4); select-all has `aria-label` ✓; `BulkActionBar` is a labelled `region` ✓; the clear/✕ control has an accessible name ✓. If the repo runs axe in tests (search for `axe` usage), add an axe assertion to `bulk-action-bar.test.tsx` mirroring an existing component a11y test.

- [ ] **Step 2: Full shell suite**

Run: `cd /home/ubuntu/code/iarsma/shell && pnpm vitest run`
Expected: all green (existing + new). Fix any snapshot/count drift (e.g. a thread-list a11y snapshot that now includes checkboxes — update intentionally).

- [ ] **Step 3: Typecheck + build all packages**

Run from repo root the project's standard scripts (confirm names in root `package.json`):
```bash
cd /home/ubuntu/code/iarsma
pnpm -r typecheck
pnpm -r test
pnpm --filter @iarsma/shell build
```
Expected: 0 type errors; all suites green; build ✓. **Run codegen build too** to assert the tool set is unchanged (no contract was touched): the codegen package's build/test should pass with no diff in emitted contracts.

- [ ] **Step 4: Manual smoke** (`/run` dev server or a local preview):
  - Hover a row → selection checkbox appears at left; row hover-action icons unchanged.
  - Click two checkboxes → bulk bar shows "2 selected"; Shift-click a third extends the range; Cmd/Ctrl-click a row toggles it without opening.
  - Press `x` on a focused row → toggles; `Esc` → clears.
  - Header select-all → all loaded rows checked + indeterminate when partial.
  - Mark read / unread, Move, Label, Delete each act on every message in every selected conversation; selection clears; source + destination + counts refresh with no manual reload; Delete shows the Undo toast worded for the batch.
  - Switch mailbox / apply a label filter / run a search → selection clears.

- [ ] **Step 5: Commit any gate fixes**

```bash
cd /home/ubuntu/code/iarsma
git add -A
git commit -m "test(bulk-actions): a11y assertions + gate fixes"
```

---

## Ship (after all tasks green)

PR → CI (6 checks) → squash/merge to main → tag `v0.14.0` → release workflow publishes `iarsma-base-webmail.zip` → fire Stalwart `UpdateApps` (admin@r3motely.net, acct `b`) → confirm `…/webmail/version.json` reports `0.14.0`.

---

## Self-review notes (author)

- **Spec coverage:** selection unit (Task 1/4), lazy batched resolve (Task 2/3), atoms + clear-on-context (Task 4), checkbox column + Shift/Cmd interactions (Task 4), `x`/`Esc` keyboard + help binding (Task 5), select-all loaded-only + indeterminate (Task 6), bulk bar with Mark read/unread/Move/Label/Delete + no-confirm delete + Undo (Task 7/8), dispatch → clear → refetch → bump relying on v0.13.1 invalidation (Task 8), a11y + gate (Task 9). All spec sections map to a task.
- **Parity:** no contract/codegen change; `resolveThreadEmailIds` is internal-only. Verified in Task 9 step 3.
- **Known verification points flagged inline** (do not skip): exact `makeError` kind strings; `toggleKeyword` `$seen` value convention; icon/`Button` import paths + variant names; `renderThreadList` invoker-injection convention; whether `ThreadListSearchMode` remounts per query.
