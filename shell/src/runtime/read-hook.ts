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

import { useAtom, type PrimitiveAtom } from 'jotai';
import { useCallback, useEffect, useRef } from 'react';
import { makeResultAtomFamily } from './atoms.js';
import { useInvoker } from './invoker.js';
import { canonicalize } from './canonical.js';
import { toToolError, type AsyncResult, type ToolConfig, type ToolError } from './types.js';

/**
 * Per-capability atom family registry. We store families type-erased
 * (input/output as `unknown`) and cast at the boundary — TypeScript can't
 * carry generics through a `Map`, so the cast at register/lookup time is
 * the right escape hatch.
 */
type ErasedFamily = (input: unknown) => PrimitiveAtom<AsyncResult<unknown>>;
const FAMILIES = new Map<string, ErasedFamily>();

function familyFor<I, O>(name: string): (input: I) => PrimitiveAtom<AsyncResult<O>> {
  let fam = FAMILIES.get(name);
  if (fam === undefined) {
    fam = makeResultAtomFamily<I, O>() as unknown as ErasedFamily;
    FAMILIES.set(name, fam);
  }
  return fam as unknown as (input: I) => PrimitiveAtom<AsyncResult<O>>;
}

export type UseReadHookOptions<I> = ToolConfig & {
  /** Input parameters for this call. */
  readonly input: I;
  /** If false, don't fetch. Defaults to true. */
  readonly enabled?: boolean;
};

export type UseReadHookResult<O> = {
  readonly data: O | undefined;
  readonly error: ToolError | undefined;
  readonly isLoading: boolean;
  readonly isIdle: boolean;
  readonly refetch: () => Promise<void>;
};

export function useReadHook<I, O>(opts: UseReadHookOptions<I>): UseReadHookResult<O> {
  const invoker = useInvoker();
  const family = familyFor<I, O>(opts.name);
  const [state, setState] = useAtom(family(opts.input));
  const enabled = opts.enabled ?? true;
  const inputKey = canonicalize(opts.input);
  const lastKeyRef = useRef<string | null>(null);

  const fetchOnce = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const result = await invoker.invoke<I, O>(opts.name, opts.input);
      setState({ status: 'success', data: result as O });
    } catch (e) {
      setState({ status: 'error', error: toToolError(e) });
    }
  }, [invoker, opts.name, inputKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!enabled) return;
    if (lastKeyRef.current === inputKey) return;
    lastKeyRef.current = inputKey;
    void fetchOnce();
  }, [enabled, inputKey, fetchOnce]);

  return {
    data: state.status === 'success' ? state.data : undefined,
    error: state.status === 'error' ? state.error : undefined,
    isLoading: state.status === 'loading',
    isIdle: state.status === 'idle',
    refetch: fetchOnce,
  };
}
