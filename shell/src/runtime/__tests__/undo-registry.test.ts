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
  it('flips a single-email mailboxIds patch when no memberships were captured', () => {
    // Degraded path (inner invoker didn't enrich the result): a lone
    // email's flip is the best available inverse.
    const inv = buildInverse('mail.modify', {
      emailIds: ['em-1'],
      patch: { mailboxIds: { 'Mb-inbox': false, 'Mb-archive': true } },
    });
    expect(inv).toEqual({
      inverseAction: 'mail.modify',
      inverseParams: {
        emailIds: ['em-1'],
        patch: { mailboxIds: { 'Mb-inbox': true, 'Mb-archive': false } },
      },
    });
  });

  it('inverts a single-email keywords patch using the true/null dialect', () => {
    // JMAP keyword patches: true adds, null removes. RFC 8621 forbids
    // false — the inverse of "add" must be "remove" (null), not false.
    const inv = buildInverse('mail.modify', {
      emailIds: ['em-1'],
      patch: { keywords: { '$seen': true, '$flagged': null } },
    });
    expect(inv?.inverseParams).toEqual({
      emailIds: ['em-1'],
      patch: { keywords: { '$seen': null, '$flagged': true } },
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
        keywords: { '$seen': null },
      },
    });
  });

  it('returns null for keyword patches spanning more than one email', () => {
    // A uniform inverse can't restore mixed per-email flag states —
    // undoing a bulk Unflag would flag emails that were never flagged.
    // No undo is better than a corrupting one.
    const inv = buildInverse('mail.modify', {
      emailIds: ['em-1', 'em-2'],
      patch: { keywords: { '$flagged': true } },
    });
    expect(inv).toBeNull();
  });

  it('returns null for a bulk move without captured memberships', () => {
    // The selected emails need not share a source mailbox (a thread
    // spans Inbox + Sent); a uniform flip would file every email into
    // every source. No undo beats a corrupting one.
    const inv = buildInverse('mail.modify', {
      emailIds: ['em-1', 'em-2'],
      patch: { mailboxIds: { 'Mb-inbox': false, 'Mb-archive': true } },
    });
    expect(inv).toBeNull();
  });

  it('builds a single mail.modify for a bulk move from one shared source', () => {
    const inv = buildInverse(
      'mail.modify',
      {
        emailIds: ['em-1', 'em-2'],
        patch: { mailboxIds: { 'Mb-inbox': false, 'Mb-archive': true } },
      },
      {
        modifiedCount: 2,
        previousMailboxesByEmail: { 'em-1': ['Mb-inbox'], 'em-2': ['Mb-inbox'] },
      },
    );
    expect(inv).toEqual({
      inverseAction: 'mail.modify',
      inverseParams: {
        emailIds: ['em-1', 'em-2'],
        patch: { mailboxIds: { 'Mb-inbox': true, 'Mb-archive': false } },
      },
    });
  });

  it("restores each email's own mailboxes when a mixed Inbox+Sent thread is moved", () => {
    // Bulk Inbox→Archive of a thread: em-in is an Inbox message,
    // em-sent the user's reply (Sent only). The forward patch adds
    // Archive to both; Inbox-off is a no-op for em-sent. Undo must
    // NOT drop the Sent reply into Inbox.
    const inv = buildInverse(
      'mail.modify',
      {
        emailIds: ['em-in', 'em-sent'],
        patch: { mailboxIds: { 'Mb-inbox': false, 'Mb-archive': true } },
      },
      {
        modifiedCount: 2,
        previousMailboxesByEmail: { 'em-in': ['Mb-inbox'], 'em-sent': ['Mb-sent'] },
      },
    );
    expect(inv).toEqual({
      inverseAction: 'mail.restore-mailboxes',
      inverseParams: {
        groups: [
          { emailIds: ['em-in'], mailboxIds: { 'Mb-inbox': true, 'Mb-archive': false } },
          { emailIds: ['em-sent'], mailboxIds: { 'Mb-archive': false } },
        ],
      },
    });
  });

  it('leaves untouched a membership the email already had before the move', () => {
    // em-1 was already in Archive as well as Inbox: undo restores
    // Inbox but must not take Archive away.
    const inv = buildInverse(
      'mail.modify',
      {
        emailIds: ['em-1'],
        patch: { mailboxIds: { 'Mb-inbox': false, 'Mb-archive': true } },
      },
      { modifiedCount: 1, previousMailboxesByEmail: { 'em-1': ['Mb-inbox', 'Mb-archive'] } },
    );
    expect(inv?.inverseParams).toEqual({
      emailIds: ['em-1'],
      patch: { mailboxIds: { 'Mb-inbox': true } },
    });
  });

  it('keeps the keyword inverse alongside a per-email mailbox inverse', () => {
    const inv = buildInverse(
      'mail.modify',
      {
        emailIds: ['em-1'],
        patch: { mailboxIds: { 'Mb-trash': false, 'Mb-inbox': true }, keywords: { '$seen': true } },
      },
      { modifiedCount: 1, previousMailboxesByEmail: { 'em-1': ['Mb-trash'] } },
    );
    expect(inv?.inverseParams).toEqual({
      emailIds: ['em-1'],
      patch: { mailboxIds: { 'Mb-trash': true, 'Mb-inbox': false }, keywords: { '$seen': null } },
    });
  });

  it('returns null when the move changed no email\'s memberships', () => {
    const inv = buildInverse(
      'mail.modify',
      {
        emailIds: ['em-1'],
        patch: { mailboxIds: { 'Mb-inbox': false, 'Mb-archive': true } },
      },
      { modifiedCount: 1, previousMailboxesByEmail: { 'em-1': ['Mb-archive'] } },
    );
    expect(inv).toBeNull();
  });

  it('skips emails absent from the captured memberships', () => {
    const inv = buildInverse(
      'mail.modify',
      {
        emailIds: ['em-1', 'em-gone'],
        patch: { mailboxIds: { 'Mb-inbox': false, 'Mb-archive': true } },
      },
      { modifiedCount: 1, previousMailboxesByEmail: { 'em-1': ['Mb-inbox'] } },
    );
    expect(inv?.inverseParams).toEqual({
      emailIds: ['em-1'],
      patch: { mailboxIds: { 'Mb-inbox': true, 'Mb-archive': false } },
    });
  });

  it('ignores repeated email ids and non-own / malformed membership entries', () => {
    const inv = buildInverse(
      'mail.modify',
      {
        emailIds: ['em-in', 'em-sent', 'em-in', 'constructor', 'em-bad'],
        patch: { mailboxIds: { 'Mb-inbox': false, 'Mb-archive': true } },
      },
      {
        modifiedCount: 2,
        previousMailboxesByEmail: { 'em-in': ['Mb-inbox'], 'em-sent': ['Mb-sent'], 'em-bad': 'Mb-inbox' },
      },
    );
    expect(inv?.inverseParams).toEqual({
      groups: [
        { emailIds: ['em-in'], mailboxIds: { 'Mb-inbox': true, 'Mb-archive': false } },
        { emailIds: ['em-sent'], mailboxIds: { 'Mb-archive': false } },
      ],
    });
  });

  it('inverts mail.restore-mailboxes per email (redo from the Activity log)', () => {
    const inv = buildInverse(
      'mail.restore-mailboxes',
      {
        groups: [
          { emailIds: ['em-in'], mailboxIds: { 'Mb-inbox': true, 'Mb-archive': false } },
          { emailIds: ['em-sent'], mailboxIds: { 'Mb-archive': false } },
        ],
      },
      {
        modifiedCount: 2,
        previousMailboxesByEmail: { 'em-in': ['Mb-archive'], 'em-sent': ['Mb-sent', 'Mb-archive'] },
      },
    );
    expect(inv).toEqual({
      inverseAction: 'mail.restore-mailboxes',
      inverseParams: {
        groups: [
          { emailIds: ['em-in'], mailboxIds: { 'Mb-inbox': false, 'Mb-archive': true } },
          { emailIds: ['em-sent'], mailboxIds: { 'Mb-archive': true } },
        ],
      },
    });
    expect(buildInverse('mail.restore-mailboxes', { groups: [] }, { modifiedCount: 0 })).toBeNull();
  });

  it('returns null for tools without a known inverse', () => {
    expect(buildInverse('mail.send', { to: ['a@x'] })).toBeNull();
    expect(buildInverse('mail.purge', { emailIds: ['em-1'] })).toBeNull();
    expect(buildInverse('thread.list', { mailboxId: 'in' })).toBeNull();
  });

  describe('mail.delete (PR 22)', () => {
    it('builds a single mail.modify when every email shares its memberships', () => {
      const inv = buildInverse(
        'mail.delete',
        { emailIds: ['em-1', 'em-2'] },
        {
          modifiedCount: 2,
          previousMailboxesByEmail: { 'em-1': ['Mb-inbox'], 'em-2': ['Mb-inbox'] },
          trashMailboxId: 'Mb-trash',
        },
      );
      expect(inv).toEqual({
        inverseAction: 'mail.modify',
        inverseParams: {
          emailIds: ['em-1', 'em-2'],
          patch: { mailboxIds: { 'Mb-inbox': true, 'Mb-trash': false } },
        },
      });
    });

    it("restores each email's own mailboxes when a mixed Inbox+Sent thread is deleted", () => {
      // Deleting a thread trashes every message in it. Undo must put
      // the Inbox message back in Inbox only and the Sent reply back
      // in Sent only — not the union into both.
      const inv = buildInverse(
        'mail.delete',
        { emailIds: ['em-in', 'em-sent', 'em-both'] },
        {
          modifiedCount: 3,
          previousMailboxesByEmail: {
            'em-in': ['Mb-inbox'],
            'em-sent': ['Mb-sent'],
            'em-both': ['Mb-inbox', 'Mb-starred'],
          },
          trashMailboxId: 'Mb-trash',
        },
      );
      expect(inv).toEqual({
        inverseAction: 'mail.restore-mailboxes',
        inverseParams: {
          groups: [
            { emailIds: ['em-in'], mailboxIds: { 'Mb-inbox': true, 'Mb-trash': false } },
            { emailIds: ['em-sent'], mailboxIds: { 'Mb-sent': true, 'Mb-trash': false } },
            {
              emailIds: ['em-both'],
              mailboxIds: { 'Mb-inbox': true, 'Mb-starred': true, 'Mb-trash': false },
            },
          ],
        },
      });
    });

    it('keeps Trash on for an email that was already in Trash', () => {
      const inv = buildInverse(
        'mail.delete',
        { emailIds: ['em-1'] },
        {
          modifiedCount: 1,
          previousMailboxesByEmail: { 'em-1': ['Mb-trash', 'Mb-inbox'] },
          trashMailboxId: 'Mb-trash',
        },
      );
      expect(inv?.inverseParams).toEqual({
        emailIds: ['em-1'],
        patch: { mailboxIds: { 'Mb-inbox': true } },
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
