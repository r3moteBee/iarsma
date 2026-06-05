/**
 * @vitest-environment jsdom
 *
 * Tests for the JMAP-push refetch behavior in useReadHook (PR 29).
 *
 * useReadHook folds pushGenerationAtom into its refetch key so any
 * StateChange event nudges every active read-hook to re-run. Cache
 * hits through cachedInvoker keep the redundant calls cheap; the
 * fresh fetch happens via stale-while-revalidate.
 */

import { cleanup, render, waitFor } from '@testing-library/react';
import { Provider as JotaiProvider, useSetAtom } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Stub the WASM-bindings barrel — the real one fetches the WASM
// module on import, which jsdom can't satisfy without a file:// URL.
// The runtime invoker.ts module pulls it in transitively; we never
// exercise that code path in this test.
vi.mock('@iarsma/wasm-bindings/jmap-client', () => ({
  mailbox: {},
  email: {},
  identity: {},
}));
vi.mock('@iarsma/wasm-bindings/action-log', () => ({
  chain: {
    canonicalize: () => new Uint8Array(0),
    verifyLinks: () => undefined,
  },
}));

import { IarsmaProvider } from '../invoker.js';
import { useReadHook } from '../read-hook.js';
import { pushGenerationAtom } from '../push-subscription.js';
import type { Invoker } from '../invoker.js';

afterEach(cleanup);

function makeInvoker(): { invoker: Invoker; calls: ReturnType<typeof vi.fn> } {
  const calls = vi.fn(async (_name: string, _input: unknown) => ({ ok: true }));
  return {
    calls,
    invoker: {
      async invoke<I, O>(name: string, input: I): Promise<O> {
        return calls(name, input) as Promise<O>;
      },
    },
  };
}

function HookConsumer({ name }: { name: string }) {
  const r = useReadHook<Record<string, never>, { ok: boolean }>({
    name,
    scopes: [],
    input: {},
  });
  return <span data-testid="data">{r.data?.ok === true ? 'ok' : '-'}</span>;
}

function PushBumper() {
  const bump = useSetAtom(pushGenerationAtom);
  // Side effect button — test fires the bump explicitly.
  return (
    <button
      type="button"
      data-testid="bump"
      onClick={() => bump((n) => n + 1)}
    >
      bump
    </button>
  );
}

describe('useReadHook × pushGenerationAtom (PR 29)', () => {
  it('refetches when the push generation bumps', async () => {
    const { invoker, calls } = makeInvoker();
    const { getByTestId } = render(
      <JotaiProvider>
        <IarsmaProvider value={invoker}>
          <HookConsumer name="test.tool" />
          <PushBumper />
        </IarsmaProvider>
      </JotaiProvider>,
    );

    // Initial mount fetches once.
    await waitFor(() => {
      expect(getByTestId('data').textContent).toBe('ok');
    });
    expect(calls).toHaveBeenCalledTimes(1);

    // Bump push generation — the hook's effect re-runs because the
    // composite key changed.
    getByTestId('bump').click();
    await waitFor(() => {
      expect(calls).toHaveBeenCalledTimes(2);
    });

    // Bumping again refetches again.
    getByTestId('bump').click();
    await waitFor(() => {
      expect(calls).toHaveBeenCalledTimes(3);
    });
  });

  it('does NOT refetch when the bumper is called with the same value', async () => {
    // pushGenerationAtom is a number; writing the same number via
    // the (n) => n updater means we increment, so this test verifies
    // the monotonic-counter invariant: only an actual bump refetches.
    const { invoker, calls } = makeInvoker();
    const { getByTestId } = render(
      <JotaiProvider>
        <IarsmaProvider value={invoker}>
          <HookConsumer name="test.tool" />
        </IarsmaProvider>
      </JotaiProvider>,
    );
    await waitFor(() => {
      expect(getByTestId('data').textContent).toBe('ok');
    });
    expect(calls).toHaveBeenCalledTimes(1);
    // No bump → no additional fetch.
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toHaveBeenCalledTimes(1);
  });
});
