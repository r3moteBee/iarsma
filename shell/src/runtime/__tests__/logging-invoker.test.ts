/**
 * loggingInvoker tests (D-052).
 *
 * Validates:
 *   - A successful invocation appends an action-log entry.
 *   - The entry carries the configured caller-class, the input as
 *     params, and the resolved identity.
 *   - dryRun invocations record `mode: 'preview'`.
 *   - Tools in EXCLUDED_FROM_LOG don't touch the log.
 *   - Append failures are caught (not propagated) and surfaced via
 *     onAppendError when configured.
 *   - Inner-invoke failures propagate; nothing is logged.
 *   - Multiple successful invocations produce a verifiable hash chain.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  createActionLog,
  inMemoryActionLogStore,
  type ActionLog,
  type Identity,
  type Sha384,
} from '../action-log.js';
import { loggingInvoker } from '../logging-invoker.js';
import type { Invoker } from '../invoker.js';

const ALICE: Identity = { id: 'alice@example.net' };

function fakeSha384(): Sha384 {
  return async (bytes) => {
    let hex = '';
    for (let i = 0; i < bytes.length; i++) {
      hex += bytes[i]!.toString(16).padStart(2, '0');
    }
    return `fake:${hex.length}:${hex.slice(0, 32)}`;
  };
}

function newLog(): { log: ActionLog; store: ReturnType<typeof inMemoryActionLogStore> } {
  const store = inMemoryActionLogStore();
  const log = createActionLog({
    store,
    sha384: fakeSha384(),
    now: () => 1700000000000,
  });
  return { log, store };
}

function inner(handlers: Record<string, () => unknown>): Invoker {
  return {
    async invoke(name) {
      const handler = handlers[name];
      if (handler === undefined) throw new Error(`no handler for ${name}`);
      return handler() as never;
    },
  };
}

describe('loggingInvoker — successful invocations', () => {
  it('appends one entry per successful invocation', async () => {
    const { log, store } = newLog();
    const wrapped = loggingInvoker({
      inner: inner({
        'thread.list': () => ({ threads: [], position: 0, total: 0 }),
      }),
      log,
      getIdentity: () => ALICE,
    });

    await wrapped.invoke('thread.list', { mailboxId: 'mb1' });
    expect(await store.count()).toBe(1);
    const last = await store.last();
    expect(last?.data.identity).toBe(ALICE.id);
    expect(last?.data.callerClass).toBe('ui');
    expect(last?.data.action).toBe('thread.list');
    expect(JSON.parse(last!.data.paramsJson)).toEqual({ mailboxId: 'mb1' });
  });

  it('records the configured caller class', async () => {
    const { log, store } = newLog();
    const wrapped = loggingInvoker({
      inner: inner({
        'thread.list': () => ({ threads: [], position: 0, total: 0 }),
      }),
      log,
      getIdentity: () => ALICE,
      callerClass: 'mcp',
    });
    await wrapped.invoke('thread.list', { mailboxId: 'mb1' });
    const last = await store.last();
    expect(last?.data.callerClass).toBe('mcp');
  });

  it('returns the inner invoker result unchanged', async () => {
    const { log } = newLog();
    const expected = { threads: [{ id: 'T1' }], position: 0, total: 1 };
    const wrapped = loggingInvoker({
      inner: inner({ 'thread.list': () => expected }),
      log,
      getIdentity: () => ALICE,
    });
    const out = await wrapped.invoke('thread.list', { mailboxId: 'mb1' });
    expect(out).toEqual(expected);
  });
});

describe('loggingInvoker — dry-run', () => {
  it('records mode=preview when dryRun is set', async () => {
    const { log, store } = newLog();
    const wrapped = loggingInvoker({
      inner: inner({
        'mail.send': () => ({ mode: 'preview', plan: { willSend: true } }),
      }),
      log,
      getIdentity: () => ALICE,
    });
    await wrapped.invoke('mail.send', { to: 'x@y.z' }, { dryRun: true });
    const last = await store.last();
    expect(last?.data.mode).toBe('preview');
  });

  it('omits mode on non-dryRun calls', async () => {
    const { log, store } = newLog();
    const wrapped = loggingInvoker({
      inner: inner({
        'thread.list': () => ({ threads: [], position: 0, total: 0 }),
      }),
      log,
      getIdentity: () => ALICE,
    });
    await wrapped.invoke('thread.list', { mailboxId: 'mb1' });
    const last = await store.last();
    expect(last?.data.mode).toBeUndefined();
  });
});

describe('loggingInvoker — exclusion + identity', () => {
  it('does not log session.get (EXCLUDED_FROM_LOG)', async () => {
    const { log, store } = newLog();
    const wrapped = loggingInvoker({
      inner: inner({
        'session.get': () => ({ apiUrl: 'https://j', primaryAccountIdMail: 'A' }),
      }),
      log,
      getIdentity: () => ALICE,
    });
    await wrapped.invoke('session.get', {});
    expect(await store.count()).toBe(0);
  });

  it('skips logging when getIdentity returns null (no signed-in user)', async () => {
    const { log, store } = newLog();
    const wrapped = loggingInvoker({
      inner: inner({
        'thread.list': () => ({ threads: [], position: 0, total: 0 }),
      }),
      log,
      getIdentity: () => null,
    });
    await wrapped.invoke('thread.list', { mailboxId: 'mb1' });
    expect(await store.count()).toBe(0);
  });
});

describe('loggingInvoker — error semantics', () => {
  it('propagates inner.invoke errors and writes nothing to the log', async () => {
    const { log, store } = newLog();
    const wrapped = loggingInvoker({
      inner: inner({
        'thread.list': () => {
          throw new Error('upstream blew up');
        },
      }),
      log,
      getIdentity: () => ALICE,
    });
    await expect(
      wrapped.invoke('thread.list', { mailboxId: 'mb1' }),
    ).rejects.toThrow('upstream blew up');
    expect(await store.count()).toBe(0);
  });

  it('catches log-append failures so the user-facing call still resolves', async () => {
    const onAppendError = vi.fn();
    // Build a log whose append() always throws by injecting a broken store.
    const brokenLog: ActionLog = {
      append: async () => {
        throw new Error('storage gone');
      },
      verify: async () => null,
    };
    const wrapped = loggingInvoker({
      inner: inner({
        'thread.list': () => ({ threads: [], position: 0, total: 0 }),
      }),
      log: brokenLog,
      getIdentity: () => ALICE,
      onAppendError,
    });
    const out = await wrapped.invoke('thread.list', { mailboxId: 'mb1' });
    expect(out).toEqual({ threads: [], position: 0, total: 0 });
    expect(onAppendError).toHaveBeenCalledTimes(1);
    expect(onAppendError.mock.calls[0]?.[0]).toBe('thread.list');
  });
});

describe('loggingInvoker — mode + provenance (D-047)', () => {
  it('records mode=commit for destructive tools', async () => {
    const { log, store } = newLog();
    const wrapped = loggingInvoker({
      inner: inner({
        'mail.draft': () => ({
          emailId: 'E-1',
          blobId: 'B-1',
          threadId: 'T-1',
          size: 256,
        }),
      }),
      log,
      getIdentity: () => ALICE,
    });
    await wrapped.invoke('mail.draft', { mailboxId: 'Mb-drafts' });
    const last = await store.last();
    expect(last?.data.mode).toBe('commit');
  });

  it('builds provenance.affectedJson from the commit output (mail.draft)', async () => {
    const { log, store } = newLog();
    const wrapped = loggingInvoker({
      inner: inner({
        'mail.draft': () => ({
          emailId: 'E-1',
          blobId: 'B-1',
          threadId: 'T-1',
          size: 256,
        }),
      }),
      log,
      getIdentity: () => ALICE,
    });
    await wrapped.invoke('mail.draft', { mailboxId: 'Mb-drafts' });
    const last = await store.last();
    expect(last?.data.provenance).toBeDefined();
    expect(JSON.parse(last!.data.provenance!.affectedJson)).toEqual([
      { kind: 'mail', id: 'E-1', op: 'create' },
    ]);
  });

  it('threads previewHashHex through to provenance.previewHashHex on commit', async () => {
    const { log, store } = newLog();
    const wrapped = loggingInvoker({
      inner: inner({
        'mail.send': () => ({
          emailId: 'E-1',
          blobId: 'B-1',
          threadId: 'T-1',
          size: 256,
          submissionId: 'S-1',
        }),
      }),
      log,
      getIdentity: () => ALICE,
    });
    await wrapped.invoke(
      'mail.send',
      { sentMailboxId: 'Mb-sent' },
      { previewHashHex: 'abc123hash' },
    );
    const last = await store.last();
    expect(last?.data.provenance?.previewHashHex).toBe('abc123hash');
    // Both artifacts surface (email + submission).
    expect(JSON.parse(last!.data.provenance!.affectedJson)).toEqual([
      { kind: 'mail', id: 'E-1', op: 'create' },
      { kind: 'mail-submission', id: 'S-1', op: 'create' },
    ]);
  });

  it('defaults previewHashHex to empty string when caller omits it', async () => {
    const { log, store } = newLog();
    const wrapped = loggingInvoker({
      inner: inner({
        'mail.draft': () => ({
          emailId: 'E-1',
          blobId: 'B-1',
          threadId: 'T-1',
          size: 256,
        }),
      }),
      log,
      getIdentity: () => ALICE,
    });
    await wrapped.invoke('mail.draft', { mailboxId: 'Mb-drafts' });
    const last = await store.last();
    expect(last?.data.provenance?.previewHashHex).toBe('');
  });

  it('records mode=preview without provenance on a dry-run', async () => {
    const { log, store } = newLog();
    const wrapped = loggingInvoker({
      inner: inner({
        'mail.draft': () => ({ proposedEmail: {}, estimatedSize: 1 }),
      }),
      log,
      getIdentity: () => ALICE,
    });
    await wrapped.invoke('mail.draft', {}, { dryRun: true });
    const last = await store.last();
    expect(last?.data.mode).toBe('preview');
    expect(last?.data.provenance).toBeUndefined();
  });

  it('does NOT set mode or provenance on non-destructive commits', async () => {
    const { log, store } = newLog();
    const wrapped = loggingInvoker({
      inner: inner({
        'thread.list': () => ({ threads: [], position: 0, total: 0 }),
      }),
      log,
      getIdentity: () => ALICE,
    });
    await wrapped.invoke('thread.list', { mailboxId: 'Mb1' });
    const last = await store.last();
    expect(last?.data.mode).toBeUndefined();
    expect(last?.data.provenance).toBeUndefined();
  });
});

describe('loggingInvoker — chain integrity', () => {
  it('multiple invocations produce a verifiable chain', async () => {
    const { log, store } = newLog();
    const wrapped = loggingInvoker({
      inner: inner({
        'mailbox.list': () => ({ mailboxes: [] }),
        'thread.list': () => ({ threads: [], position: 0, total: 0 }),
        'thread.get': () => ({ thread: { id: 'T1', emailIds: [] }, emails: [] }),
      }),
      log,
      getIdentity: () => ALICE,
    });
    await wrapped.invoke('mailbox.list', {});
    await wrapped.invoke('thread.list', { mailboxId: 'mb1' });
    await wrapped.invoke('thread.get', { threadId: 'T1' });
    expect(await store.count()).toBe(3);
    const all = await store.all();
    expect(all[0]!.prevHashHex).toBe('');
    expect(all[1]!.prevHashHex).toBe(all[0]!.hashHex);
    expect(all[2]!.prevHashHex).toBe(all[1]!.hashHex);
    expect(all.map((e) => e.data.action)).toEqual([
      'mailbox.list',
      'thread.list',
      'thread.get',
    ]);
    // Full verify: link integrity + hash recomputation across the chain.
    expect(await log.verify()).toBeNull();
  });
});
