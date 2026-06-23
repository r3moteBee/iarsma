# Folder Management (P1.2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let humans and agents create, rename, and delete mail folders (incl. nested) and move messages between them, with understandable refusals and full MCP parity.

**Architecture:** Three new codegen contracts (`mailbox.create`/`mailbox.update`/`mailbox.delete`) generate TS types + React hooks + MCP tools + agent docs from one source; matching `Mailbox/set` builders + a compound `mailbox.delete` orchestration live in the runtime JMAP client; the sidebar tree gains a persistent "…" menu (+ right-click) and a "+ New folder" header; a "Move to…" picker reuses existing `mail.modify`. All refusals return a stable `code` + plain-English `message` shown verbatim in the UI and to MCP callers. Mutations bump `pushGenerationAtom` to refetch the tree (also fixing P2.5).

**Tech Stack:** TypeScript, React 18, Zod (codegen contracts), Vitest + Testing Library, JMAP (RFC 8621 `Mailbox/set` / `Email/set`).

## Global Constraints

- New scope: `mail:mailbox` (mirrors `mail:modify`). Verbatim string.
- Refusal taxonomy (codes + messages) is fixed by the spec — copy verbatim from `docs/superpowers/specs/2026-06-23-folder-management-design.md`.
- System roles never renamable/deletable: `inbox`, `sent`, `drafts`, `trash`, `junk`, `archive`.
- v1 refuses deleting a folder that has child folders (`mailbox_has_children`); no recursive delete, no drag-to-move, no reparent UI.
- TDD: failing test first, watch it fail, minimal code, watch it pass, commit. Run `pnpm exec tsc -b --noEmit` + `pnpm exec vitest run` before each commit; full suite + `pnpm build` green before the PR.
- Every human capability ships its MCP tool + docs in the same PR.

---

### Task 1: Scope + three contracts + codegen

**Files:**
- Create: `tools/codegen/contracts/mailbox-create.ts`, `tools/codegen/contracts/mailbox-update.ts`, `tools/codegen/contracts/mailbox-delete.ts`
- Modify: scope registry (find with `grep -rn "mail:modify" tools/codegen/src` — add `mail:mailbox` wherever the scope enum/list is declared)
- Test: `tools/codegen/__tests__/mailbox-contracts.test.ts` (or the existing codegen test file if one asserts tool descriptions)

**Interfaces:**
- Produces (contract input/output shapes, consumed by Tasks 2–4 + 6–7):
  - `mailbox.create`: in `{ name: string; parentId?: string }` → out `{ mailboxId: string }`
  - `mailbox.update`: in `{ mailboxId: string; name: string }` → out `{ updated: boolean }`
  - `mailbox.delete`: in `{ mailboxId: string }` → out `{ deleted: boolean; movedToTrash: number }`; dryRun preview `{ affectedCount: number }`

- [ ] **Step 1: Add the `mail:mailbox` scope to the registry.** Locate the scope definition (`grep -rn "'mail:modify'" tools/codegen/src`). Add `'mail:mailbox'` alongside it (same array/enum/union). 

- [ ] **Step 2: Write `mailbox-create.ts`** mirroring `mailbox-list.ts` / `mail-modify.ts` structure. Agent-grade description + examples:

```ts
import { z } from 'zod';
import { capability } from '../src/index.js';

export const mailboxCreate = capability({
  name: 'mailbox.create',
  version: '0.0.1',
  scopes: ['mail:mailbox'],
  description:
    'Create a mail folder (JMAP Mailbox/set create). Pass `name` and an ' +
    'optional `parentId` to nest it under an existing folder — resolve ids ' +
    'with mailbox.list first. Returns the new mailbox id. Fails with ' +
    '`mailbox_name_conflict` if a sibling folder already has that name, or ' +
    '`mailbox_name_invalid` if the name is blank.',
  isDestructive: false,
  input: z.object({
    name: z.string().min(1).describe('Folder display name. Must be non-empty and unique among its siblings.'),
    parentId: z.string().optional().describe('Parent mailbox id (from mailbox.list). Omit for a top-level folder.'),
  }),
  output: z.object({
    mailboxId: z.string().describe('Id of the newly created mailbox.'),
  }),
  examples: [
    { title: 'Top-level folder', input: { name: 'Projects' }, output: { mailboxId: 'Mb-99' } },
    { title: 'Nested subfolder', input: { name: 'Acme', parentId: 'Mb-99' }, output: { mailboxId: 'Mb-100' } },
  ],
});
```

- [ ] **Step 3: Write `mailbox-update.ts`** (rename):

```ts
import { z } from 'zod';
import { capability } from '../src/index.js';

export const mailboxUpdate = capability({
  name: 'mailbox.update',
  version: '0.0.1',
  scopes: ['mail:mailbox'],
  description:
    'Rename a mail folder (JMAP Mailbox/set update). Pass the `mailboxId` ' +
    '(from mailbox.list) and the new `name`. System folders (inbox, sent, ' +
    'drafts, trash, junk, archive) cannot be renamed — those return ' +
    '`mailbox_protected`. A blank name returns `mailbox_name_invalid`; a ' +
    'sibling-name clash returns `mailbox_name_conflict`.',
  isDestructive: false,
  input: z.object({
    mailboxId: z.string().describe('Id of the folder to rename (from mailbox.list).'),
    name: z.string().min(1).describe('New display name. Non-empty, unique among siblings.'),
  }),
  output: z.object({ updated: z.boolean().describe('True when the rename was applied.') }),
  examples: [{ title: 'Rename', input: { mailboxId: 'Mb-99', name: 'Archive 2025' }, output: { updated: true } }],
});
```

- [ ] **Step 4: Write `mailbox-delete.ts`** (destructive, dry-run, agent-grade safe-behavior + refusal docs):

```ts
import { z } from 'zod';
import { capability } from '../src/index.js';

export const mailboxDelete = capability({
  name: 'mailbox.delete',
  version: '0.0.1',
  scopes: ['mail:mailbox'],
  description:
    'Delete a mail folder safely. This is compound: it moves every message ' +
    'in the folder to Trash (JMAP Email/set), then destroys the now-empty ' +
    'folder (Mailbox/set destroy). Resolve `mailboxId` with mailbox.list. ' +
    'Dry-run returns how many messages would move to Trash (`affectedCount`). ' +
    'Refusals (stable codes you can branch on): `mailbox_has_children` (the ' +
    'folder has subfolders — delete those first), `mailbox_protected` (system ' +
    'folder), `mailbox_forbidden` (no delete permission), `trash_not_found` ' +
    '(no Trash folder on the account).',
  isDestructive: true,
  input: z.object({
    mailboxId: z.string().describe('Id of the folder to delete (from mailbox.list).'),
  }),
  output: z.object({
    deleted: z.boolean().describe('True when the folder was destroyed.'),
    movedToTrash: z.number().int().describe('Count of messages moved to Trash before deletion.'),
  }),
  dryRun: {
    preview: z.object({
      affectedCount: z.number().int().describe('Messages that would move to Trash before the folder is destroyed.'),
    }),
  },
  examples: [
    { title: 'Delete an empty folder', input: { mailboxId: 'Mb-100' }, output: { deleted: true, movedToTrash: 0 } },
    { title: 'Delete a folder with mail', input: { mailboxId: 'Mb-99' }, output: { deleted: true, movedToTrash: 12 } },
  ],
});
```

- [ ] **Step 5: Run codegen.** `pnpm codegen`. Expected: no errors; new files appear under `shell/src/generated/capabilities/` (`mailbox-create.ts`, `mailbox-update.ts`, `mailbox-delete.ts`) and `tools/codegen/dist/tools/`.

- [ ] **Step 6: Write a content test** asserting the generated agent doc can't silently regress:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
const del = readFileSync(new URL('../dist/tools/mailbox.delete.json', import.meta.url), 'utf8');
describe('mailbox.delete MCP tool doc', () => {
  it('documents safe-delete + refusal codes for agents', () => {
    expect(del).toContain('Trash');
    for (const code of ['mailbox_has_children', 'mailbox_protected', 'trash_not_found']) {
      expect(del).toContain(code);
    }
  });
});
```

- [ ] **Step 7: Run + verify, then commit.** `pnpm exec vitest run tools/codegen` (or the path the test lives at) → PASS. `git add tools/codegen shell/src/generated && git commit -m "feat(mailbox): codegen contracts + mail:mailbox scope for folder CRUD"`

---

### Task 2: Runtime — `mailbox.create`

**Files:**
- Modify: `shell/src/runtime/jmap-client.ts` (add types + `buildMailboxCreateRequest` + `parseMailboxCreateResponse` + `fetchMailboxCreateCommit`), `shell/src/runtime/invoker.ts` (dispatch case)
- Test: `shell/src/runtime/__tests__/jmap-client-mailbox-set.test.ts` (new)

**Interfaces:**
- Consumes: `JMAP_USING_MAIL`, `makeError`, `Session`, the fetch/POST helper used by `fetchMailboxList` (read `jmap-client.ts:133-160` for the exact fetch wrapper).
- Produces: `MailboxCreateInput = { readonly name: string; readonly parentId?: string }`, `MailboxCreateResult = { readonly mailboxId: string }`, `buildMailboxCreateRequest({accountId, params}): string`, `fetchMailboxCreateCommit(opts): Promise<MailboxCreateResult>`.

- [ ] **Step 1: Write failing builder test:**

```ts
import { describe, expect, it } from 'vitest';
import { buildMailboxCreateRequest } from '../jmap-client.js';

describe('buildMailboxCreateRequest', () => {
  it('builds a Mailbox/set create with name + parentId', () => {
    const body = buildMailboxCreateRequest({ accountId: 'c', params: { name: 'Projects', parentId: 'Mb-1' } });
    const p = JSON.parse(body);
    expect(p.methodCalls[0][0]).toBe('Mailbox/set');
    const create = p.methodCalls[0][1].create.n0;
    expect(create).toEqual({ name: 'Projects', parentId: 'Mb-1' });
  });
  it('omits parentId for a top-level folder', () => {
    const body = buildMailboxCreateRequest({ accountId: 'c', params: { name: 'Top' } });
    expect(JSON.parse(body).methodCalls[0][1].create.n0).toEqual({ name: 'Top' });
  });
});
```

- [ ] **Step 2: Run → FAIL** (`buildMailboxCreateRequest` not exported). `pnpm exec vitest run src/runtime/__tests__/jmap-client-mailbox-set.test.ts`

- [ ] **Step 3: Implement** in `jmap-client.ts` (near the other builders):

```ts
export type MailboxCreateInput = { readonly name: string; readonly parentId?: string };
export type MailboxCreateResult = { readonly mailboxId: string };

export function buildMailboxCreateRequest(opts: { readonly accountId: string; readonly params: MailboxCreateInput }): string {
  const { accountId, params } = opts;
  const create: Record<string, unknown> = { name: params.name };
  if (params.parentId !== undefined) create.parentId = params.parentId;
  return JSON.stringify({
    using: JMAP_USING_MAIL,
    methodCalls: [['Mailbox/set', { accountId, create: { n0: create } }, '0']],
  });
}

export function parseMailboxCreateResponse(body: string): MailboxCreateResult {
  const r = JSON.parse(body) as { methodResponses?: Array<[string, Record<string, unknown>, string]> };
  const args = r.methodResponses?.[0]?.[1] as
    | { created?: Record<string, { id: string }>; notCreated?: Record<string, { type: string; description?: string }> }
    | undefined;
  const created = args?.created?.n0;
  if (created !== undefined) return { mailboxId: created.id };
  const nc = args?.notCreated?.n0;
  // invalidProperties on a duplicate name → name conflict; otherwise generic.
  if (nc !== undefined) {
    const desc = nc.description ?? nc.type;
    if (/exist|already|duplicate|unique/i.test(desc)) {
      throw makeError('mailbox_name_conflict', 'A folder with that name already exists here. Pick a different name.');
    }
    throw makeError('mailbox_set_failed', `Couldn't create the folder: ${desc}.`);
  }
  throw makeError('jmap_parse_error', 'Mailbox/set create returned no result.');
}
```

Add `fetchMailboxCreateCommit` mirroring `fetchMailboxList` (read `jmap-client.ts:133-160` for the POST wrapper): build body → POST → `parseMailboxCreateResponse`.

- [ ] **Step 4: Add the invoker dispatch case** in `invoker.ts` (mirror `case 'mailbox.list'` at `invoker.ts:238`):

```ts
case 'mailbox.create': {
  const params = _input as unknown as MailboxCreateInput;
  const session = await getSession();
  return (await fetchMailboxCreateCommit({ ...opts, session, params })) as unknown as O;
}
```

(Import `MailboxCreateInput`, `fetchMailboxCreateCommit` at the top of `invoker.ts`.)

- [ ] **Step 5: Run → PASS.** Add a `parseMailboxCreateResponse` test for the `created` and `notCreated`(conflict) branches. `pnpm exec vitest run src/runtime/__tests__/jmap-client-mailbox-set.test.ts` → PASS. `pnpm exec tsc -b --noEmit` → clean.

- [ ] **Step 6: Commit.** `git commit -am "feat(mailbox): runtime mailbox.create (Mailbox/set) + invoker"`

---

### Task 3: Runtime — `mailbox.update` (rename)

**Files:** Modify `jmap-client.ts`, `invoker.ts`; extend `jmap-client-mailbox-set.test.ts`.

**Interfaces:** Produces `MailboxUpdateInput = { readonly mailboxId: string; readonly name: string }`, `MailboxUpdateResult = { readonly updated: boolean }`, `buildMailboxUpdateRequest`, `fetchMailboxUpdateCommit`.

- [ ] **Step 1: Failing test:**

```ts
import { buildMailboxUpdateRequest } from '../jmap-client.js';
it('builds a Mailbox/set update for rename', () => {
  const body = buildMailboxUpdateRequest({ accountId: 'c', params: { mailboxId: 'Mb-9', name: 'Renamed' } });
  const p = JSON.parse(body);
  expect(p.methodCalls[0][0]).toBe('Mailbox/set');
  expect(p.methodCalls[0][1].update).toEqual({ 'Mb-9': { name: 'Renamed' } });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement:**

```ts
export type MailboxUpdateInput = { readonly mailboxId: string; readonly name: string };
export type MailboxUpdateResult = { readonly updated: boolean };

export function buildMailboxUpdateRequest(opts: { readonly accountId: string; readonly params: MailboxUpdateInput }): string {
  const { accountId, params } = opts;
  return JSON.stringify({
    using: JMAP_USING_MAIL,
    methodCalls: [['Mailbox/set', { accountId, update: { [params.mailboxId]: { name: params.name } } }, '0']],
  });
}

export function parseMailboxUpdateResponse(body: string, mailboxId: string): MailboxUpdateResult {
  const r = JSON.parse(body) as { methodResponses?: Array<[string, Record<string, unknown>, string]> };
  const args = r.methodResponses?.[0]?.[1] as
    | { updated?: Record<string, unknown>; notUpdated?: Record<string, { type: string; description?: string }> }
    | undefined;
  if (args?.updated !== undefined && mailboxId in args.updated) return { updated: true };
  const nu = args?.notUpdated?.[mailboxId];
  if (nu !== undefined) {
    const desc = nu.description ?? nu.type;
    if (/exist|already|duplicate|unique/i.test(desc)) {
      throw makeError('mailbox_name_conflict', 'A folder with that name already exists here. Pick a different name.');
    }
    throw makeError('mailbox_set_failed', `Couldn't rename the folder: ${desc}.`);
  }
  throw makeError('jmap_parse_error', 'Mailbox/set update returned no result.');
}
```

Add `fetchMailboxUpdateCommit` (POST → `parseMailboxUpdateResponse(body, params.mailboxId)`).

- [ ] **Step 4: Invoker case** `mailbox.update` (mirror Task 2 Step 4).

- [ ] **Step 5: Run → PASS** (+ a parse test for updated/notUpdated). `tsc` clean.

- [ ] **Step 6: Commit.** `git commit -am "feat(mailbox): runtime mailbox.update rename + invoker"`

---

### Task 4: Runtime — `mailbox.delete` orchestration + structural refusals

**Files:** Modify `jmap-client.ts`, `invoker.ts`; new `shell/src/runtime/__tests__/jmap-client-mailbox-delete.test.ts`.

**Interfaces:**
- Consumes: `fetchMailboxList` (to read the full mailbox set: find Trash by role, detect children, read `myRights`/`role` of the target), the `mail.list-ids`/`Email/query` helper used by Empty-Trash (`grep -n "list-ids\|Email/query" jmap-client.ts` — reuse it to get message ids in the target mailbox), `mail.modify`/`Email/set` move (reuse `buildMailModifyRequest`).
- Produces: `MailboxDeleteInput = { readonly mailboxId: string }`, `MailboxDeleteResult = { readonly deleted: boolean; readonly movedToTrash: number }`, `MailboxDeletePreview = { readonly affectedCount: number }`, `fetchMailboxDeleteCommit(opts): Promise<MailboxDeleteResult>`, `makeMailboxDeletePreview(opts): Promise<MailboxDeletePreview>`, and pure `assertMailboxDeletable(target, all): void` (throws the structural refusals).

- [ ] **Step 1: Failing test for the pure guard** (`assertMailboxDeletable`):

```ts
import { describe, expect, it } from 'vitest';
import { assertMailboxDeletable } from '../jmap-client.js';

const mk = (over: any) => ({ id: 'X', name: 'X', sortOrder: 0, totalEmails: 0, unreadEmails: 0, totalThreads: 0, unreadThreads: 0, isSubscribed: true, myRights: { mayDelete: true, mayRename: true, mayCreateChild: true, mayReadItems: true, mayAddItems: true, mayRemoveItems: true, maySetSeen: true, maySetKeywords: true, maySubmit: true }, ...over });

describe('assertMailboxDeletable', () => {
  it('refuses a system folder', () => {
    const t = mk({ id: 'I', role: 'inbox', name: 'Inbox' });
    expect(() => assertMailboxDeletable(t, [t])).toThrow(/system folder/i);
  });
  it('refuses when it has child folders', () => {
    const t = mk({ id: 'P', name: 'Projects' });
    const child = mk({ id: 'C', name: 'Acme', parentId: 'P' });
    expect(() => assertMailboxDeletable(t, [t, child])).toThrow(/subfolder/i);
  });
  it('refuses without delete permission', () => {
    const t = mk({ id: 'P', name: 'Projects', myRights: { ...mk({}).myRights, mayDelete: false } });
    expect(() => assertMailboxDeletable(t, [t])).toThrow(/permission/i);
  });
  it('allows a deletable leaf folder', () => {
    const t = mk({ id: 'P', name: 'Projects' });
    expect(() => assertMailboxDeletable(t, [t])).not.toThrow();
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement the guard** (`SYSTEM_ROLES` set + checks; messages verbatim from the spec):

```ts
const SYSTEM_ROLES = new Set(['inbox', 'sent', 'drafts', 'trash', 'junk', 'archive']);

export function assertMailboxDeletable(target: Mailbox, all: readonly Mailbox[]): void {
  if (target.role !== undefined && SYSTEM_ROLES.has(target.role)) {
    throw makeError('mailbox_protected', `"${target.name}" is a system folder and can't be renamed or deleted.`);
  }
  if (target.myRights.mayDelete === false) {
    throw makeError('mailbox_forbidden', `You don't have permission to delete "${target.name}".`);
  }
  const children = all.filter((m) => m.parentId === target.id);
  if (children.length > 0) {
    const n = children.length;
    throw makeError('mailbox_has_children', `Can't delete "${target.name}" — it has ${n} subfolder${n === 1 ? '' : 's'}. Delete or move those first.`);
  }
}
```

- [ ] **Step 4: Run → PASS.** Commit the guard: `git commit -am "feat(mailbox): assertMailboxDeletable structural refusals"`

- [ ] **Step 5: Failing test for the orchestration** using a stubbed fetch (mirror `makeFetchSpy` in `jmap-client-modify.test.ts`). Sequence to assert: a `mailbox.list` (Mailbox/get), an `Email/query`-style id fetch for the target, an `Email/set` moving those ids (remove target, add Trash id), then `Mailbox/set` destroy of the target; result `{ deleted: true, movedToTrash: <n> }`. (Write the stub to return: one user folder `P` + a `trash`-role folder `T`; two emails in `P`.)

- [ ] **Step 6: Run → FAIL.**

- [ ] **Step 7: Implement `fetchMailboxDeleteCommit`:**

```ts
export type MailboxDeleteInput = { readonly mailboxId: string };
export type MailboxDeleteResult = { readonly deleted: boolean; readonly movedToTrash: number };

export async function fetchMailboxDeleteCommit(opts: FetchMailboxDeleteOptions): Promise<MailboxDeleteResult> {
  const all = await fetchMailboxList(opts);                       // Mailbox/get
  const target = all.find((m) => m.id === opts.params.mailboxId);
  if (target === undefined) throw makeError('not_found', 'That folder no longer exists.');
  assertMailboxDeletable(target, all);
  const trash = all.find((m) => m.role === 'trash');
  if (trash === undefined) throw makeError('trash_not_found', `Can't delete "${target.name}" safely — no Trash folder was found on this account.`);
  const ids = await fetchEmailIdsInMailbox(opts, target.id);     // Email/query filter inMailbox=target
  if (ids.length > 0) {
    await fetchMailModifyCommit({ ...opts, params: { emailIds: ids, patch: { mailboxIds: { [target.id]: false, [trash.id]: true } } } });
  }
  await postMailboxDestroy(opts, target.id);                     // Mailbox/set destroy
  return { deleted: true, movedToTrash: ids.length };
}
```

Implement helpers: `fetchEmailIdsInMailbox` (reuse the Empty-Trash id query — `grep -n "list-ids\|Email/query" jmap-client.ts`); `postMailboxDestroy` (build `Mailbox/set` `{ destroy: [id] }`, POST, throw `mailbox_set_failed` on `notDestroyed`). `makeMailboxDeletePreview` returns `{ affectedCount: ids.length }` after the same list+guard but no mutations.

- [ ] **Step 8: Run → PASS.** Add the invoker `mailbox.delete` case honoring `dryRun` (mirror `mail.modify` at `invoker.ts:367` — `if (_options.dryRun === true) return makeMailboxDeletePreview(...)`). `tsc` clean.

- [ ] **Step 9: Commit.** `git commit -am "feat(mailbox): mailbox.delete orchestration (move-to-Trash then destroy) + dry-run"`

---

### Task 5: `MenuButton` accessible component

**Files:** Create `shell/src/components/menu-button.tsx`, `shell/src/components/menu-button.module.css`; Test `shell/src/components/__tests__/menu-button.test.tsx`.

**Interfaces:** Produces
```ts
export type MenuItem = { readonly label: string; readonly onSelect: () => void; readonly disabled?: boolean; readonly disabledReason?: string };
export function MenuButton(props: {
  readonly label: string;              // aria-label for the trigger
  readonly items: readonly MenuItem[]; // rendered as role="menuitem"
  readonly children?: React.ReactNode; // trigger content (defaults to "⋯")
  readonly align?: 'start' | 'end';
}): JSX.Element;
```

- [ ] **Step 1: Failing test:**

```ts
/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MenuButton } from '../menu-button.js';
afterEach(cleanup);

describe('MenuButton', () => {
  it('opens on click and invokes the selected item', () => {
    const onSelect = vi.fn();
    render(<MenuButton label="Folder actions" items={[{ label: 'Rename', onSelect }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Folder actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
  it('does not invoke a disabled item and exposes its reason', () => {
    const onSelect = vi.fn();
    render(<MenuButton label="Folder actions" items={[{ label: 'Delete', onSelect, disabled: true, disabledReason: 'has subfolders' }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Folder actions' }));
    const item = screen.getByRole('menuitem', { name: /Delete/ });
    expect(item).toHaveAttribute('aria-disabled', 'true');
    expect(item).toHaveAttribute('title', 'has subfolders');
    fireEvent.click(item);
    expect(onSelect).not.toHaveBeenCalled();
  });
  it('closes on Escape', () => {
    render(<MenuButton label="Folder actions" items={[{ label: 'Rename', onSelect: () => {} }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Folder actions' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** `MenuButton`: a `<button aria-haspopup="menu" aria-expanded>` toggling a `<ul role="menu">` of `<li><button role="menuitem" aria-disabled={disabled} title={disabledReason} onClick={disabled ? undefined : () => { onSelect(); close(); }}>`. ArrowUp/Down move focus among enabled items; Escape + click-outside (a `useEffect` document listener) close and return focus to the trigger. Match existing component CSS-module conventions (see `send-toast.module.css`).

- [ ] **Step 4: Run → PASS.** `tsc` clean.

- [ ] **Step 5: Commit.** `git commit -am "feat(ui): accessible MenuButton (button + popover menu)"`

---

### Task 6: Folder menu in the tree + create/rename/delete dialogs

**Files:** Modify `shell/src/components/mailbox-tree-view.tsx`, `shell/src/components/sidebar.tsx` (the Folders section header gets "+ New folder"); Create `shell/src/components/folder-dialogs.tsx` (CreateFolderDialog / RenameFolderDialog / DeleteFolderDialog wrapping `Dialog`); Test `shell/src/components/__tests__/mailbox-tree-view-actions.test.tsx`.

**Interfaces:**
- Consumes: `MenuButton`/`MenuItem` (Task 5); the generated hooks `useMailboxCreate`/`useMailboxUpdate`/`useMailboxDelete` (Task 1) — read their generated signatures in `shell/src/generated/capabilities/`; `pending… ` n/a; `assertMailboxDeletable` semantics for gating; `pushGenerationAtom` (`shell/src/runtime/push-subscription.js`) to refetch after success.
- `mailbox-tree-view.tsx` gains props: `onCreate(parentId?: string)`, `onRename(id, currentName)`, `onDelete(id)` OR it owns the hooks directly — follow the existing pattern (the view currently takes `mailboxes`/`onSelect`; add optional action callbacks so tests can assert without the runtime).

- [ ] **Step 1: Failing test — menu gating + actions:**

```ts
/** @vitest-environment jsdom */
// render MailboxTreeView with a user folder "Projects" (mayDelete:true, no children)
// and a system "Inbox" (role:inbox). Assert:
//  - the Inbox row's "…" menu shows NO Rename/Delete items (only e.g. New subfolder if mayCreateChild)
//  - the Projects row's menu shows Rename + Delete enabled
//  - a folder with a child has Delete aria-disabled with the subfolder reason
//  - clicking Rename calls onRename('P','Projects'); Delete calls onDelete('P')
```

(Write the concrete render + assertions following `mailbox-tree-view.test.tsx`'s harness — `renderTree({ mailboxes })`. Use `getByRole('button', { name: /actions/i })` then `getByRole('menuitem', ...)`.)

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** the per-row `MenuButton` in `TreeRow` (label `Actions for <name>`), items computed from role/`myRights`/children:
  - `New subfolder` when `myRights.mayCreateChild` → `onCreate(mailbox.id)`
  - `Rename` when `role===undefined && myRights.mayRename` → `onRename(id, name)`
  - `Delete` when `role===undefined && myRights.mayDelete`; `disabled` + `disabledReason="Has subfolders — delete those first"` when it has children → `onDelete(id)`
  Add `onContextMenu` on the row opening the same menu. Add the "+ New folder" button in the Folders header (`sidebar.tsx`) → `onCreate(undefined)`.

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Failing test for the dialogs** (`folder-dialogs.tsx`): CreateFolderDialog submit calls its `onSubmit(name, parentId)`; surfaces a passed-in `error` string inline; RenameFolderDialog prefills the current name; DeleteFolderDialog shows the dry-run line `This will move N message(s) to Trash, then delete the folder.` and confirms.

- [ ] **Step 6: Run → FAIL → implement the three dialogs (wrap `Dialog`) → PASS.**

- [ ] **Step 7: Wire the hooks in `App.tsx`/sidebar host:** the create/rename/delete callbacks call `useMailboxCreate().commit(...)` etc.; on success bump `pushGenerationAtom`; on a thrown `ToolError`, pass `e.message` into the dialog's `error` prop (shown verbatim). Delete uses the hook's dry-run to populate the dialog's N, then commit. `tsc` clean; full suite green.

- [ ] **Step 8: Commit.** `git commit -am "feat(mailbox): folder …-menu (+right-click), + New folder, create/rename/delete dialogs"`

---

### Task 7: "Move to…" message action

**Files:** Modify `shell/src/views/thread-list.tsx` (row "…" menu gains Move to), `shell/src/views/thread-view.tsx` (toolbar Move to); Test: extend `shell/src/views/__tests__/thread-list.test.tsx`.

**Interfaces:** Consumes `MenuButton`, `useMailboxList` (folder choices), `invoker.invoke('mail.modify', …)`, `pushGenerationAtom`. Produces a `handleMove(emailId, targetId)` that calls `mail.modify` with `patch: { mailboxIds: { [currentMailboxId]: false, [targetId]: true } }` (mirror U-3 `handleRestore`).

- [ ] **Step 1: Failing test:** in Trash-less inbox view, open a row's "…" menu → "Move to…" → pick a folder → assert `mail.modify` called with `{ emailIds:[id], patch:{ mailboxIds:{ [current]:false, [target]:true } } }`. (Extend the existing `onModify`-capture harness; add a `mailboxes` fixture with two folders.)

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** the Move-to item: it opens a `MenuButton` (or nested submenu) listing mailboxes except the current one; selection calls `handleMove`. After success bump `pushGenerationAtom` + `refetch()`. Add the same to `thread-view.tsx` toolbar (current mailbox = the message's mailbox membership; for v1 use the selected mailbox id available in the view, else the first non-system membership).

- [ ] **Step 4: Run → PASS.** `tsc` clean; full suite green.

- [ ] **Step 5: Commit.** `git commit -am "feat(mail): Move to… folder picker (reuses mail.modify) + refresh"`

---

### Task 8: Documentation (human + generated agent docs)

**Files:** Create `docs/folders.md`; Modify the docs index/quickstart link (`grep -rn "keyboard.md" docs README.md` to find the index); confirm generated `docs/`/`llms.txt`/OpenAPI from Task 1 codegen are committed.

- [ ] **Step 1: Write `docs/folders.md`** — create/rename/delete/move steps; the safe-delete behavior (contents → Trash, then folder destroyed); and a "What the refusals mean" subsection listing each message verbatim from the spec so docs == in-UI text. No keyboard section (note folder ops are menu-driven; keyboard bindings intentionally deferred).

- [ ] **Step 2: Link it** from the docs index/quickstart next to the other capability docs.

- [ ] **Step 3: Verify generated agent docs** are present + accurate: `grep -l mailbox.delete tools/codegen/dist/docs/ tools/codegen/dist/llms.txt` shows the safe-delete + refusal codes (already content-tested in Task 1). 

- [ ] **Step 4: Commit.** `git commit -am "docs(mailbox): docs/folders.md + index link (human); agent docs generated from contracts"`

---

### Task 9: Integration verification + PR

- [ ] **Step 1:** `pnpm exec tsc -b --noEmit` → clean.
- [ ] **Step 2:** `pnpm exec vitest run` → all green (new mailbox-set, delete, menu-button, tree-actions, move-to, codegen-doc tests included).
- [ ] **Step 3:** `pnpm build` → succeeds.
- [ ] **Step 4:** Manual smoke against the dev server if available (create nested folder, rename, move a message in, delete → contents land in Trash, refusal on a folder with a child shows the exact message).
- [ ] **Step 5:** Open the PR (base `main`): summarize capabilities + MCP parity + refusal taxonomy + docs; link the spec.

---

## Self-review notes

- **Spec coverage:** create/rename/delete/move (Tasks 2–4,7); refusal taxonomy with verbatim messages (Task 4 guard + Task 2/3 parse for name conflict); `mail:mailbox` scope (Task 1); persistent menu + right-click + "+ New" (Tasks 5–6, P1.4); move reuses `mail.modify` (Task 7); `pushGenerationAtom` refresh incl. P2.5 (Tasks 6–7); MCP parity (Task 1 contracts); agent + human docs (Tasks 1 + 8). All present.
- **Refusal message strings** are copied from the spec; keep them identical in the guard, the parse mappers, and `docs/folders.md`.
- **Type consistency:** `MailboxCreateInput/Result`, `MailboxUpdateInput/Result`, `MailboxDeleteInput/Result/Preview`, `MenuButton`/`MenuItem` names are used identically across tasks.
- **Known follow-ups (out of scope, do not implement):** drag-to-move, reparent UI, recursive delete, keyboard bindings for folders.
