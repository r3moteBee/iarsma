/**
 * Tests for PolicyEngine interface + allowAllPolicyEngine (v1).
 *
 * Verifies:
 * - allowAllPolicyEngine returns allow for any tool call
 * - allowAllPolicyEngine returns allow even for destructive tools
 * - Interface shape compiles correctly under strict TypeScript
 */

import { describe, expect, it } from 'vitest';
import type {
  PolicyEngine,
  PolicyEvaluationContext,
  PolicyDecisionResult,
} from '../policy-engine.js';
import { allowAllPolicyEngine } from '../policy-engine.js';

const caller = {
  id: 'user-1',
  name: 'Test User',
  scopes: ['mail.read', 'mail.write'] as const,
} as const;

describe('allowAllPolicyEngine', () => {
  it('returns allow for any tool call', async () => {
    const engine = allowAllPolicyEngine();
    const result = await engine.evaluate({
      toolName: 'mailbox.list',
      callerIdentity: caller,
      dryRunPreview: {
        output: { mailboxes: [] },
        effects: ['Mailbox/get'],
        policy: { kind: 'allow' },
      },
    });
    expect(result).toEqual({ decision: 'allow' });
  });

  it('returns allow even for destructive tools', async () => {
    const engine = allowAllPolicyEngine();
    const result = await engine.evaluate({
      toolName: 'mail.send',
      callerIdentity: caller,
      dryRunPreview: {
        output: { emailId: 'E-1', submissionId: 'S-1' },
        effects: ['Email/set', 'EmailSubmission/set'],
        policy: { kind: 'allow' },
      },
    });
    expect(result).toEqual({ decision: 'allow' });
  });

  it('returns allow with minimal caller identity (no name)', async () => {
    const engine = allowAllPolicyEngine();
    const result = await engine.evaluate({
      toolName: 'thread.search',
      callerIdentity: { id: 'anon', scopes: [] },
      dryRunPreview: {
        output: null,
        effects: [],
        policy: { kind: 'allow' },
      },
    });
    expect(result).toEqual({ decision: 'allow' });
  });
});

describe('PolicyEngine interface shape', () => {
  it('accepts a conforming implementation', () => {
    // This test verifies the interface compiles; runtime assertion is secondary.
    const engine: PolicyEngine = {
      async evaluate(
        _ctx: PolicyEvaluationContext,
      ): Promise<PolicyDecisionResult> {
        return { decision: 'deny', reason: 'test' };
      },
    };
    expect(engine.evaluate).toBeDefined();
  });

  it('PolicyDecisionResult union covers all three variants', async () => {
    const results: PolicyDecisionResult[] = [
      { decision: 'allow' },
      { decision: 'deny', reason: 'blocked' },
      { decision: 'require_approval', reason: 'needs review' },
    ];
    expect(results).toHaveLength(3);
  });
});
