/**
 * PR 44 — `onUnauthorized` callback on loggingInvoker. The wrapper
 * detects errors carrying `code === 'unauthorized'` (the shape both
 * `jmap-client.ts` and `invoker.ts` produce on 401s), invokes the
 * configured callback, and still re-throws so callers see the error
 * normally. App.tsx uses the callback to clear stored tokens and
 * flip the UI to SignedOutView instead of leaving a stale Bearer
 * in flight that keeps 401-ing.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  createActionLog,
  inMemoryActionLogStore,
  type ActionLog,
  type Sha384,
} from '../action-log.js';
import { loggingInvoker } from '../logging-invoker.js';
import type { Invoker } from '../invoker.js';

function fakeSha384(): Sha384 {
  return async (bytes) => `fake:${bytes.length}`;
}

function newLog(): { log: ActionLog } {
  return {
    log: createActionLog({
      store: inMemoryActionLogStore(),
      sha384: fakeSha384(),
      now: () => 1700000000000,
    }),
  };
}

function throwingInner(err: unknown): Invoker {
  return {
    async invoke() {
      throw err;
    },
  };
}

function unauthorizedError(): Error & { code: string } {
  const e = new Error('JMAP returned 401') as Error & { code: string };
  e.code = 'unauthorized';
  return e;
}

describe('loggingInvoker — onUnauthorized', () => {
  it('fires onUnauthorized when the inner throws code=unauthorized', async () => {
    const onUnauthorized = vi.fn();
    const { log } = newLog();
    const inv = loggingInvoker({
      inner: throwingInner(unauthorizedError()),
      log,
      getIdentity: () => ({ id: 'alice@example.net' }),
      onUnauthorized,
    });
    await expect(inv.invoke('thread.list', {})).rejects.toMatchObject({
      code: 'unauthorized',
    });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('still re-throws the error so callers see it', async () => {
    const onUnauthorized = vi.fn();
    const { log } = newLog();
    const inv = loggingInvoker({
      inner: throwingInner(unauthorizedError()),
      log,
      getIdentity: () => ({ id: 'alice@example.net' }),
      onUnauthorized,
    });
    await expect(inv.invoke('thread.list', {})).rejects.toThrow(/401/);
  });

  it('does NOT fire onUnauthorized for unrelated errors', async () => {
    const onUnauthorized = vi.fn();
    const { log } = newLog();
    const inv = loggingInvoker({
      inner: throwingInner(Object.assign(new Error('boom'), { code: 'jmap_http_error' })),
      log,
      getIdentity: () => ({ id: 'alice@example.net' }),
      onUnauthorized,
    });
    await expect(inv.invoke('thread.list', {})).rejects.toThrow(/boom/);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('does NOT fire when no callback is wired (back-compat)', async () => {
    const { log } = newLog();
    const inv = loggingInvoker({
      inner: throwingInner(unauthorizedError()),
      log,
      getIdentity: () => ({ id: 'alice@example.net' }),
    });
    // No throw inside the wrapper itself — just the underlying error.
    await expect(inv.invoke('thread.list', {})).rejects.toMatchObject({
      code: 'unauthorized',
    });
  });

  it('swallows callback exceptions so the underlying error still surfaces', async () => {
    const onUnauthorized = vi.fn(() => {
      throw new Error('callback boom');
    });
    const { log } = newLog();
    const inv = loggingInvoker({
      inner: throwingInner(unauthorizedError()),
      log,
      getIdentity: () => ({ id: 'alice@example.net' }),
      onUnauthorized,
    });
    await expect(inv.invoke('thread.list', {})).rejects.toMatchObject({
      code: 'unauthorized',
    });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });
});
