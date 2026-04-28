/**
 * Iarsma shell runtime — shared types.
 *
 * The runtime sits between the codegen-emitted hooks and whatever transport
 * actually invokes capabilities (MCP, direct JMAP, mock for testing). Types
 * here are the shared vocabulary.
 */

/** Status of an in-flight or completed read-hook request. */
export type AsyncResult<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: ToolError };

/**
 * Structured error from a capability invocation. Tools should produce these
 * directly when possible; the runtime wraps unknown errors here as a
 * fallback.
 */
export type ToolError = {
  /** Stable, machine-readable code (e.g., 'unauthorized', 'invalid_input'). */
  code: string;
  /** Human-readable description. */
  message: string;
  /** Optional structured payload for tool-specific error data. */
  payload?: unknown;
};

/** Configuration shared by both read- and write-hooks. */
export type ToolConfig = {
  /** Dotted-path tool name, e.g. 'session.get'. */
  readonly name: string;
  /** Scopes required by this tool (informational; server enforces). */
  readonly scopes: readonly string[];
};

/** Reason for a deny / require-approval response from the policy seam. */
export type PolicyDecision =
  | { kind: 'allow' }
  | { kind: 'deny'; reason: string }
  | { kind: 'require_approval'; approvalId: string };

/** Result of a dry-run preview. */
export type DryRunPreview<O = unknown> = {
  /** Hypothetical successful output, if the action committed now. */
  output: O;
  /** Side effects the action would produce (JMAP methods invoked, etc.). */
  effects: readonly string[];
  /** Policy engine's verdict on this preview, if a policy engine is active. */
  policy: PolicyDecision;
};

/** Wraps an unknown thrown value into a ToolError. */
export function toToolError(e: unknown): ToolError {
  if (e !== null && typeof e === 'object' && 'code' in e && 'message' in e) {
    const o = e as { code: unknown; message: unknown };
    if (typeof o.code === 'string' && typeof o.message === 'string') {
      return e as ToolError;
    }
  }
  if (e instanceof Error) {
    return { code: 'unknown_error', message: e.message };
  }
  return { code: 'unknown_error', message: String(e) };
}
