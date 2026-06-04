/**
 * Tests for the in-memory UndoRegistry (PR 20).
 *
 * The IDB-backed variant has its own integration test in
 * undo-registry-store.test.ts.
 */

import { describe, expect, it } from 'vitest';
import { buildInverse, inMemoryUndoRegistry } from '../undo-registry.js';

describe('UndoRegistry (in-memory)', () => {
  it('round-trips a registered entry under its forEntrySeq', async () => {
    const reg = inMemoryUndoRegistry();
    await reg.register({
      forEntrySeq: 7,
      inverseAction: 'mail.modify',
      inverseParams: {
        emailIds: ['em-1'],
        patch: { mailboxIds: { 'Mb-inbox': true, 'Mb-trash': false } },
      },
    });
    const got = await reg.forEntry(7);
    expect(got?.inverseAction).toBe('mail.modify');
    expect(got?.consumed).toBe(false);
    expect(got?.inverseParams).toEqual({
      emailIds: ['em-1'],
      patch: { mailboxIds: { 'Mb-inbox': true, 'Mb-trash': false } },
    });
  });

  it('returns null for unregistered seqs', async () => {
    const reg = inMemoryUndoRegistry();
    expect(await reg.forEntry(42)).toBeNull();
  });

  it('consume() flips consumed and stamps consumedAtMs', async () => {
    const reg = inMemoryUndoRegistry({ now: () => 5000 });
    await reg.register({ forEntrySeq: 1, inverseAction: 'mail.modify', inverseParams: {} });
    await reg.consume(1);
    const got = await reg.forEntry(1);
    expect(got?.consumed).toBe(true);
    expect(got?.consumedAtMs).toBe(5000);
  });

  it('consume() on an absent seq is a no-op', async () => {
    const reg = inMemoryUndoRegistry();
    await expect(reg.consume(999)).resolves.toBeUndefined();
  });

  it('consume() on an already-consumed entry is idempotent', async () => {
    const reg = inMemoryUndoRegistry({ now: () => 1000 });
    await reg.register({ forEntrySeq: 1, inverseAction: 'a', inverseParams: {} });
    await reg.consume(1);
    await reg.consume(1);
    expect((await reg.forEntry(1))?.consumed).toBe(true);
  });

  it('list({activeOnly}) excludes consumed and expired', async () => {
    const reg = inMemoryUndoRegistry({ now: () => 1000 });
    await reg.register({ forEntrySeq: 1, inverseAction: 'a', inverseParams: {} });
    await reg.register({ forEntrySeq: 2, inverseAction: 'a', inverseParams: {}, expiresAtMs: 500 });
    await reg.register({ forEntrySeq: 3, inverseAction: 'a', inverseParams: {} });
    await reg.consume(3);
    const active = await reg.list({ activeOnly: true });
    expect(active.map((e) => e.forEntrySeq).sort()).toEqual([1]);
  });

  it('list() with no opts returns every entry, consumed or not', async () => {
    const reg = inMemoryUndoRegistry();
    await reg.register({ forEntrySeq: 1, inverseAction: 'a', inverseParams: {} });
    await reg.register({ forEntrySeq: 2, inverseAction: 'a', inverseParams: {} });
    await reg.consume(2);
    expect((await reg.list()).length).toBe(2);
  });

  it('cleanup() removes expired-and-unconsumed; keeps active and consumed', async () => {
    const reg = inMemoryUndoRegistry({ now: () => 1000 });
    await reg.register({ forEntrySeq: 1, inverseAction: 'a', inverseParams: {}, expiresAtMs: 500 });
    await reg.register({ forEntrySeq: 2, inverseAction: 'a', inverseParams: {} });
    await reg.register({ forEntrySeq: 3, inverseAction: 'a', inverseParams: {}, expiresAtMs: 500 });
    await reg.consume(3);
    await reg.cleanup();
    // seq 1: expired + unconsumed → removed.
    expect(await reg.forEntry(1)).toBeNull();
    // seq 2: no expiry → kept.
    expect(await reg.forEntry(2)).not.toBeNull();
    // seq 3: expired but consumed → kept (consumed entries are
    // historical record, not garbage).
    expect(await reg.forEntry(3)).not.toBeNull();
  });
});

describe('buildInverse', () => {
  it('flips boolean values in a mail.modify mailboxIds patch', () => {
    const inv = buildInverse('mail.modify', {
      emailIds: ['em-1', 'em-2'],
      patch: { mailboxIds: { 'Mb-inbox': false, 'Mb-archive': true } },
    });
    expect(inv).toEqual({
      inverseAction: 'mail.modify',
      inverseParams: {
        emailIds: ['em-1', 'em-2'],
        patch: { mailboxIds: { 'Mb-inbox': true, 'Mb-archive': false } },
      },
    });
  });

  it('flips boolean values in a mail.modify keywords patch', () => {
    const inv = buildInverse('mail.modify', {
      emailIds: ['em-1'],
      patch: { keywords: { '$seen': true, '$flagged': false } },
    });
    expect(inv?.inverseParams).toEqual({
      emailIds: ['em-1'],
      patch: { keywords: { '$seen': false, '$flagged': true } },
    });
  });

  it('handles both mailboxIds and keywords in the same patch', () => {
    const inv = buildInverse('mail.modify', {
      emailIds: ['em-1'],
      patch: {
        mailboxIds: { 'Mb-inbox': false },
        keywords: { '$seen': true },
      },
    });
    expect(inv?.inverseParams).toEqual({
      emailIds: ['em-1'],
      patch: {
        mailboxIds: { 'Mb-inbox': true },
        keywords: { '$seen': false },
      },
    });
  });

  it('returns null for tools without a known inverse', () => {
    expect(buildInverse('mail.send', { to: ['a@x'] })).toBeNull();
    expect(buildInverse('mail.purge', { emailIds: ['em-1'] })).toBeNull();
    expect(buildInverse('thread.list', { mailboxId: 'in' })).toBeNull();
  });

  describe('mail.delete (PR 22)', () => {
    it('builds the restore-mailboxes inverse from previousMailboxesByEmail', () => {
      const inv = buildInverse(
        'mail.delete',
        { emailIds: ['em-1', 'em-2'] },
        {
          modifiedCount: 2,
          previousMailboxesByEmail: {
            'em-1': ['Mb-inbox'],
            'em-2': ['Mb-inbox', 'Mb-starred'],
          },
          trashMailboxId: 'Mb-trash',
        },
      );
      expect(inv?.inverseAction).toBe('mail.modify');
      expect(inv?.inverseParams).toEqual({
        emailIds: ['em-1', 'em-2'],
        patch: {
          mailboxIds: {
            'Mb-inbox': true,
            'Mb-starred': true,
            'Mb-trash': false,
          },
        },
      });
    });

    it('returns null when previousMailboxesByEmail is absent', () => {
      // The MCP server's mail.delete handler doesn't return the
      // soft-delete metadata (a future PR can fix that). For now,
      // no metadata = no undo registration.
      expect(buildInverse('mail.delete', { emailIds: ['em-1'] }, { modifiedCount: 1 })).toBeNull();
    });

    it('omits Trash-off when trashMailboxId is absent (degraded)', () => {
      const inv = buildInverse(
        'mail.delete',
        { emailIds: ['em-1'] },
        {
          modifiedCount: 1,
          previousMailboxesByEmail: { 'em-1': ['Mb-inbox'] },
        },
      );
      expect(inv?.inverseParams).toEqual({
        emailIds: ['em-1'],
        patch: { mailboxIds: { 'Mb-inbox': true } },
      });
    });
  });
});
