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

// ─────────────────────────────────────────────────────────────────────────
//  v2: Configurable rule-based policy engine (Phase 3b)
// ─────────────────────────────────────────────────────────────────────────

/** A single policy rule — matched top-to-bottom, first match wins. */
export type PolicyRule = {
  /** Tool name to match, or `'*'` to match any tool. */
  readonly toolPattern: string;
  /** Caller class to match, or `'*'` to match any caller class. */
  readonly callerClass: 'agent' | 'mcp' | '*';
  /** The decision to return when this rule matches. */
  readonly decision: 'allow' | 'deny' | 'require_approval';
  /** Optional human-readable reason (used for deny / require_approval). */
  readonly reason?: string;
};

/**
 * v2 policy engine: evaluates a caller+tool pair against an ordered
 * list of rules. First matching rule wins. If no rule matches, the
 * engine defaults to `allow`.
 */
export function configurablePolicyEngine(rules: readonly PolicyRule[]): PolicyEngine {
  return {
    evaluate: async (ctx) => {
      for (const rule of rules) {
        const toolMatch = rule.toolPattern === '*' || rule.toolPattern === ctx.toolName;
        const callerMatch =
          rule.callerClass === '*' ||
          rule.callerClass === (ctx.callerIdentity as unknown as { callerClass?: string }).callerClass;
        if (toolMatch && callerMatch) {
          if (rule.decision === 'deny') {
            return { decision: 'deny', reason: rule.reason ?? 'Policy denied.' };
          }
          if (rule.decision === 'require_approval') {
            return { decision: 'require_approval', reason: rule.reason ?? 'Requires human approval.' };
          }
          return { decision: 'allow' };
        }
      }
      // Default: allow when no rule matched.
      return { decision: 'allow' };
    },
  };
}

/** Default policy rules for Phase 3b. */
export const DEFAULT_POLICY_RULES: readonly PolicyRule[] = [
  // Destructive tools from agents require approval
  { toolPattern: 'mail.send', callerClass: 'agent', decision: 'require_approval', reason: 'Sending mail requires human approval.' },
  { toolPattern: 'mail.delete', callerClass: 'agent', decision: 'require_approval', reason: 'Deleting mail requires human approval.' },
  // Everything else: allow
  { toolPattern: '*', callerClass: '*', decision: 'allow' },
];
