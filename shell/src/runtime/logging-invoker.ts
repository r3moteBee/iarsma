/**
 * loggingInvoker — wraps another `Invoker` and writes a tamper-evident
 * action-log entry for every successful invocation (D-052).
 *
 * Plug position: outermost. The shell constructs
 *   loggingInvoker(cachedInvoker(jmapInvoker(...)))
 * so cache hits and network round-trips alike produce log entries.
 *
 * Behavior:
 *   - Calls `inner.invoke(...)` first; on success appends a log entry
 *     with `caller-class` = the configured class (default `'ui'`),
 *     `action` = tool name, `params` = the input.
 *   - For `dryRun` invocations, sets `mode: 'preview'` on the entry
 *     (D-046 + D-047). The `mode: 'commit'` branch is the responsibility
 *     of the destructive-write hook (which constructs commit calls
 *     with provenance baked in) — landing in Phase 2.
 *   - Append errors are caught + warned but NOT propagated. The chain
 *     is integrity-checked separately; a failed append doesn't fail
 *     the user's UI.
 *   - Tools listed in `EXCLUDED_FROM_LOG` pass through without
 *     touching the log.
 *   - When `getIdentity()` returns `null` (no signed-in user — e.g.
 *     during early bootstrap before sign-in completes), the log is
 *     skipped silently. Identity is required on every entry per D-047.
 */

import type { ActionLog, CallerClass, Identity } from './action-log.js';
import type { InvocationOptions, Invoker } from './invoker.js';
import { isLoggable } from './loggable-tools.js';
import type { DryRunPreview } from './types.js';

export type LoggingInvokerOptions = {
  readonly inner: Invoker;
  readonly log: ActionLog;
  /** Resolves the current signed-in identity. Returns `null` to skip
   *  logging (e.g., not signed in). */
  readonly getIdentity: () => Identity | null;
  /** Caller class for entries written by this wrapper. The shell uses
   *  `'ui'`; the MCP server constructs its own logging invoker with
   *  `'mcp'` when those handlers wire up. Defaults to `'ui'`. */
  readonly callerClass?: CallerClass;
  /** Surfaces append failures (tests + diagnostics). Default warns to
   *  console; pass `() => {}` to silence. */
  readonly onAppendError?: (toolName: string, error: unknown) => void;
};

const defaultOnAppendError = (toolName: string, error: unknown): void => {
  // eslint-disable-next-line no-console
  console.warn(
    `[iarsma] action-log append failed for ${toolName}:`,
    error,
  );
};

export function loggingInvoker(opts: LoggingInvokerOptions): Invoker {
  const callerClass = opts.callerClass ?? 'ui';
  const onAppendError = opts.onAppendError ?? defaultOnAppendError;

  return {
    async invoke<I, O>(
      name: string,
      input: I,
      options: InvocationOptions = {},
    ): Promise<O | DryRunPreview<O>> {
      const result = await opts.inner.invoke<I, O>(name, input, options);

      if (!isLoggable(name)) return result;
      const identity = opts.getIdentity();
      if (identity === null) return result;

      try {
        await opts.log.append({
          identity,
          callerClass,
          action: name,
          params: input,
          ...(options.dryRun === true ? { mode: 'preview' as const } : {}),
        });
      } catch (e) {
        onAppendError(name, e);
      }

      return result;
    },
    // Attachment uploads pass through without their own log entry —
    // the eventual mail.draft / mail.send invocation that REFERENCES
    // the blob is what carries the audit value (the blob id appears
    // in the params field of that entry).
    ...(opts.inner.uploadAttachment !== undefined
      ? {
          uploadAttachment: (blob, uploadOpts) =>
            opts.inner.uploadAttachment!(blob, uploadOpts),
        }
      : {}),
  };
}
