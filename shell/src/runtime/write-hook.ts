/**
 * useWriteHook — the runtime function that powers generated write-style
 * hooks for destructive capabilities (those with `isDestructive: true`).
 *
 * Returns `{ preview, commit, isLoading, error }`:
 *   - `preview(input)` does a dry-run — invoker is called with
 *     `{ dryRun: true }`. Returns a DryRunPreview<O> that the UI can render
 *     for confirmation.
 *   - `commit(input)` performs the action. Returns the committed output.
 *
 * State is component-local (useReducer). Writes don't have stable cache keys,
 * so atom-family caching doesn't apply.
 */

import { useCallback, useReducer } from 'react';
import { useInvoker } from './invoker.js';
import {
  toToolError,
  type DryRunPreview,
  type ToolConfig,
  type ToolError,
} from './types.js';

type WriteState = {
  readonly isLoading: boolean;
  readonly error: ToolError | undefined;
};

type WriteAction =
  | { type: 'start' }
  | { type: 'success' }
  | { type: 'error'; error: ToolError };

const INITIAL_STATE: WriteState = { isLoading: false, error: undefined };

function reducer(_state: WriteState, action: WriteAction): WriteState {
  switch (action.type) {
    case 'start':
      return { isLoading: true, error: undefined };
    case 'success':
      return { isLoading: false, error: undefined };
    case 'error':
      return { isLoading: false, error: action.error };
  }
}

export type UseWriteHookOptions = ToolConfig;

export type CommitOptions = {
  /** Hex SHA-384 of the canonical-form preview the user approved
   *  (D-047). Forwarded to the action-log via InvocationOptions so
   *  the entry binds to exactly the preview that was shown. */
  readonly previewHashHex?: string;
};

export type UseWriteHookResult<I, O> = {
  /** Run the capability as a dry-run; returns a structured preview. */
  readonly preview: (input: I) => Promise<DryRunPreview<O>>;
  /** Commit the capability for real. Returns the committed output.
   *  Optional `previewHashHex` binds the action-log entry to the
   *  preview the user approved (D-047). */
  readonly commit: (input: I, options?: CommitOptions) => Promise<O>;
  readonly isLoading: boolean;
  readonly error: ToolError | undefined;
  /** Reset the in-flight state (typically after the user dismisses an error). */
  readonly reset: () => void;
};

export function useWriteHook<I, O>(opts: UseWriteHookOptions): UseWriteHookResult<I, O> {
  const invoker = useInvoker();
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);

  const run = useCallback(
    async <R>(input: I, dryRun: boolean, commitOpts: CommitOptions = {}): Promise<R> => {
      dispatch({ type: 'start' });
      try {
        const invocationOpts: { dryRun: boolean; previewHashHex?: string } = {
          dryRun,
        };
        if (commitOpts.previewHashHex !== undefined) {
          invocationOpts.previewHashHex = commitOpts.previewHashHex;
        }
        const result = await invoker.invoke<I, R>(
          opts.name,
          input,
          invocationOpts,
        );
        dispatch({ type: 'success' });
        return result as R;
      } catch (e) {
        const err = toToolError(e);
        dispatch({ type: 'error', error: err });
        throw err;
      }
    },
    [invoker, opts.name],
  );

  const preview = useCallback((input: I) => run<DryRunPreview<O>>(input, true), [run]);
  const commit = useCallback(
    (input: I, commitOpts: CommitOptions = {}) =>
      run<O>(input, false, commitOpts),
    [run],
  );
  const reset = useCallback(() => dispatch({ type: 'success' }), []);

  return {
    preview,
    commit,
    isLoading: state.isLoading,
    error: state.error,
    reset,
  };
}
