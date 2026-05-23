/**
 * PolicyEngine interface and v1 allow-all implementation.
 *
 * The PolicyEngine evaluates whether a tool invocation should proceed,
 * be denied, or require explicit approval. The v1 engine
 * (`allowAllPolicyEngine`) is a pass-through that always allows.
 */

import type { DryRunPreview } from './types.js';

/** Context provided to the policy engine for each evaluation. */
export type PolicyEvaluationContext = {
  readonly toolName: string;
  readonly callerIdentity: {
    readonly id: string;
    readonly name?: string;
    readonly scopes: readonly string[];
  };
  readonly dryRunPreview: DryRunPreview<unknown>;
};

/**
 * Result of a policy evaluation — the engine's output.
 *
 * Intentionally separate from the `PolicyDecision` type embedded in
 * `DryRunPreview`; this is the engine's verdict, not the preview's field.
 */
export type PolicyDecisionResult =
  | { decision: 'allow' }
  | { decision: 'deny'; reason: string }
  | { decision: 'require_approval'; reason: string };

/** Evaluates policy for a tool invocation. */
export interface PolicyEngine {
  evaluate(ctx: PolicyEvaluationContext): Promise<PolicyDecisionResult>;
}

/**
 * v1 policy engine: allows every invocation unconditionally.
 *
 * Useful as a default / development-mode engine before richer policy
 * rules are wired in.
 */
export function allowAllPolicyEngine(): PolicyEngine {
  return {
    evaluate: () => Promise.resolve({ decision: 'allow' as const }),
  };
}
