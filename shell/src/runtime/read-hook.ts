/**
 * useReadHook — the runtime function that powers generated read-style hooks.
 *
 * Generated hooks like `useSessionGet` call this with a typed config; the
 * generic params `<I, O>` carry the contract types so consumers see typed
 * data + errors.
 *
 * Behavior:
 *   - On mount (and whenever input changes by canonical-equality), fetches
 *     via the invoker and writes result into the per-capability atom.
 *   - Components reading the same atom (same capability + same input) share
 *     state.
 *   - `refetch()` clears the atom and re-runs the fetch.
 *
 * Cache invalidation by JMAP push events isn't wired here — the runtime
 * exposes the atom families so a push handler can reset specific keys when
 * relevant `state` tokens change. That lands with Phase 0 work item 5.
 */

import { useAtom } from 'jotai';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { makeResultAtomFamily } from './atoms.js';
import { useInvoker } from './invoker.js';
import { canonicalize } from './canonical.js';
import { toToolError, type AsyncResult, type ToolConfig } from './types.js';

/** Per-capability atom family registry. Keyed by capability name. */
const FAMILIES: Map<string, ReturnType<typeof makeResultAtomFamily>> = new Map();

function familyFor<I, O>(name: string): (input: I) => ReturnType<typeof makeResultAtomFamily<I, O>> extends infer T ? T : never;
function familyFor<I, O>(name: string): (input: I) => ReturnType<ReturnType<typeof makeResultAtomFamily<I, O>>> extends infer X ? X : never;
function familyFor<I, O>(name: string) {
  let fam = FAMILIES.get(name);
  if (fam === undefined) {
    fam = makeResultAtomFamily<I, O>();
    FAMILIES.set(name, fam);
  }
  return fam as ReturnType<typeof makeResultAtomFamily<I, O>>;
}

export type UseReadHookOptions<I> = ToolConfig & {
  /** Input parameters for this call. */
  readonly input: I;
  /** If false, don't fetch. Defaults to true. */
  readonly enabled?: boolean;
};

export type UseReadHookResult<O> = {
  readonly data: O | undefined;
  readonly error: AsyncResult<O> extends { status: 'error'; error: infer E } ? E | undefined : never;
  readonly isLoading: boolean;
  readonly isIdle: boolean;
  readonly refetch: () => Promise<void>;
};

export function useReadHook<I, O>(opts: UseReadHookOptions<I>): UseReadHookResult<O> {
  const invoker = useInvoker();
  const family = useMemo(() => familyFor<I, O>(opts.name), [opts.name]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [state, setState] = useAtom(family(opts.input as any) as any);
  const enabled = opts.enabled ?? true;
  const inputKey = canonicalize(opts.input);
  const lastKeyRef = useRef<string | null>(null);

  const fetchOnce = useCallback(async () => {
    setState({ status: 'loading' } as AsyncResult<O>);
    try {
      const result = await invoker.invoke<I, O>(opts.name, opts.input);
      setState({ status: 'success', data: result as O } as AsyncResult<O>);
    } catch (e) {
      setState({ status: 'error', error: toToolError(e) } as AsyncResult<O>);
    }
  }, [invoker, opts.name, inputKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!enabled) return;
    if (lastKeyRef.current === inputKey) return;
    lastKeyRef.current = inputKey;
    void fetchOnce();
  }, [enabled, inputKey, fetchOnce]);

  const typed = state as AsyncResult<O>;
  return {
    data: typed.status === 'success' ? typed.data : undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    error: (typed.status === 'error' ? typed.error : undefined) as any,
    isLoading: typed.status === 'loading',
    isIdle: typed.status === 'idle',
    refetch: fetchOnce,
  };
}
