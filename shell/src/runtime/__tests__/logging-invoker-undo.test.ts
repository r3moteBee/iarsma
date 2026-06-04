/**
 * Tests for the UndoRegistry integration in loggingInvoker (PR 21).
 *
 * The loggingInvoker is the natural integration point because it
 * already gets the action-log entry post-commit. After append, it
 * calls buildInverse(action, params) for known reversible tools and
 * registers the inverse under the entry's seq.
 */

import { describe, expect, it } from 'vitest';
import { createActionLog, inMemoryActionLogStore } from '../action-log.js';
import { loggingInvoker } from '../logging-invoker.js';
import { inMemoryUndoRegistry } from '../undo-registry.js';
import type { Invoker } from '../invoker.js';

const ALICE = { id: 'alice@example.net' };

function fakeInner(result: unknown): Invoker {
  return {
    async invoke() {
      return result as never;
    },
  };
}

describe('loggingInvoker × UndoRegistry (PR 21)', () => {
  it('registers an inverse for mail.modify commits', async () => {
    const log = createActionLog({
      store: inMemoryActionLogStore(),
      sha384: async () => 'h',
      now: () => 1000,
    });
    const undoRegistry = inMemoryUndoRegistry();
    const inv = loggingInvoker({
      inner: fakeInner({ modifiedCount: 1 }),
      log,
      undoRegistry,
      getIdentity: () => ALICE,
    });

    await inv.invoke('mail.modify', {
      emailIds: ['em-1'],
      patch: { mailboxIds: { 'Mb-inbox': false, 'Mb-archive': true } },
    });

    // The append wrote at seq 0 (the genesis entry for this fresh log).
    const u = await undoRegistry.forEntry(0);
    expect(u).not.toBeNull();
    expect(u?.inverseAction).toBe('mail.modify');
    expect(u?.inverseParams).toEqual({
      emailIds: ['em-1'],
      patch: { mailboxIds: { 'Mb-inbox': true, 'Mb-archive': false } },
    });
    expect(u?.consumed).toBe(false);
  });

  it('skips registration for tools without a known inverse', async () => {
    const log = createActionLog({
      store: inMemoryActionLogStore(),
      sha384: async () => 'h',
    });
    const undoRegistry = inMemoryUndoRegistry();
    const inv = loggingInvoker({
      inner: fakeInner({ id: 'em-new' }),
      log,
      undoRegistry,
      getIdentity: () => ALICE,
    });

    await inv.invoke('mail.draft', { to: [{ email: 'a@b.c' }], subject: 'hi' });

    // mail.draft has no inverse — and we don't want to register one
    // that's silently wrong.
    const u = await undoRegistry.forEntry(0);
    expect(u).toBeNull();
  });

  it('skips registration for dry-run previews', async () => {
    const log = createActionLog({
      store: inMemoryActionLogStore(),
      sha384: async () => 'h',
    });
    const undoRegistry = inMemoryUndoRegistry();
    const inv = loggingInvoker({
      inner: fakeInner({ affectedCount: 1 }),
      log,
      undoRegistry,
      getIdentity: () => ALICE,
    });

    // Even though mail.modify is "reversible", a preview is not a
    // commit and there's nothing to undo.
    await inv.invoke(
      'mail.modify',
      { emailIds: ['em-1'], patch: { mailboxIds: { 'Mb-inbox': false } } },
      { dryRun: true },
    );

    expect(await undoRegistry.forEntry(0)).toBeNull();
  });

  it('register failure is best-effort — does not fail the user call', async () => {
    const log = createActionLog({
      store: inMemoryActionLogStore(),
      sha384: async () => 'h',
    });
    const brokenRegistry = {
      register: async () => {
        throw new Error('idb gone');
      },
      forEntry: async () => null,
      list: async () => [],
      consume: async () => {},
      cleanup: async () => {},
    };
    const inv = loggingInvoker({
      inner: fakeInner({ modifiedCount: 1 }),
      log,
      undoRegistry: brokenRegistry,
      getIdentity: () => ALICE,
    });

    // No throw — the modify "succeeded" from the user's perspective.
    await expect(
      inv.invoke('mail.modify', {
        emailIds: ['em-1'],
        patch: { mailboxIds: { 'Mb-inbox': false } },
      }),
    ).resolves.toEqual({ modifiedCount: 1 });
  });

  it('omitting undoRegistry skips all registration logic (back-compat)', async () => {
    const log = createActionLog({
      store: inMemoryActionLogStore(),
      sha384: async () => 'h',
    });
    const inv = loggingInvoker({
      inner: fakeInner({ modifiedCount: 1 }),
      log,
      getIdentity: () => ALICE,
    });
    // The base test asserts no throw — the appended entry is still
    // there, just without an undo registration.
    await expect(
      inv.invoke('mail.modify', {
        emailIds: ['em-1'],
        patch: { mailboxIds: { 'Mb-inbox': false } },
      }),
    ).resolves.toEqual({ modifiedCount: 1 });
  });
});
