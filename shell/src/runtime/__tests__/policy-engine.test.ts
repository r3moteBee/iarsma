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
  PolicyRule,
} from '../policy-engine.js';
import {
  allowAllPolicyEngine,
  configurablePolicyEngine,
  DEFAULT_POLICY_RULES,
} from '../policy-engine.js';

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

/** Helper to create a PolicyEvaluationContext with a callerClass field. */
function makeCtx(
  toolName: string,
  callerClass: 'agent' | 'ui',
): PolicyEvaluationContext {
  return {
    toolName,
    callerIdentity: {
      id: `${callerClass}-1`,
      name: `Test ${callerClass}`,
      scopes: ['mail.read', 'mail.write'],
      callerClass,
    } as PolicyEvaluationContext['callerIdentity'] & { callerClass: string },
    dryRunPreview: {
      output: null,
      effects: [],
      policy: { kind: 'allow' },
    },
  };
}

describe('configurablePolicyEngine', () => {
  it('returns require_approval for mail.send from agent', async () => {
    const rules: PolicyRule[] = [
      { toolPattern: 'mail.send', callerClass: 'agent', decision: 'require_approval', reason: 'Sending mail requires human approval.' },
      { toolPattern: '*', callerClass: '*', decision: 'allow' },
    ];
    const engine = configurablePolicyEngine(rules);
    const result = await engine.evaluate(makeCtx('mail.send', 'agent'));
    expect(result).toEqual({
      decision: 'require_approval',
      reason: 'Sending mail requires human approval.',
    });
  });

  it('returns allow for mail.send from UI (callerClass mismatch)', async () => {
    const rules: PolicyRule[] = [
      { toolPattern: 'mail.send', callerClass: 'agent', decision: 'require_approval', reason: 'Sending mail requires human approval.' },
      { toolPattern: '*', callerClass: '*', decision: 'allow' },
    ];
    const engine = configurablePolicyEngine(rules);
    const result = await engine.evaluate(makeCtx('mail.send', 'ui'));
    expect(result).toEqual({ decision: 'allow' });
  });

  it('falls through to default allow when no specific rule matches', async () => {
    const rules: PolicyRule[] = [
      { toolPattern: 'mail.send', callerClass: 'agent', decision: 'require_approval', reason: 'Needs approval.' },
      { toolPattern: '*', callerClass: '*', decision: 'allow' },
    ];
    const engine = configurablePolicyEngine(rules);
    const result = await engine.evaluate(makeCtx('session.get', 'agent'));
    expect(result).toEqual({ decision: 'allow' });
  });

  it('returns deny when rule says deny', async () => {
    const rules: PolicyRule[] = [
      { toolPattern: 'mail.delete', callerClass: 'agent', decision: 'deny', reason: 'Deleting is forbidden for agents.' },
      { toolPattern: '*', callerClass: '*', decision: 'allow' },
    ];
    const engine = configurablePolicyEngine(rules);
    const result = await engine.evaluate(makeCtx('mail.delete', 'agent'));
    expect(result).toEqual({
      decision: 'deny',
      reason: 'Deleting is forbidden for agents.',
    });
  });

  it('returns allow by default when no rules match and no catch-all exists', async () => {
    const rules: PolicyRule[] = [
      { toolPattern: 'mail.send', callerClass: 'agent', decision: 'deny', reason: 'No.' },
    ];
    const engine = configurablePolicyEngine(rules);
    const result = await engine.evaluate(makeCtx('session.get', 'agent'));
    expect(result).toEqual({ decision: 'allow' });
  });

  it('uses default reason when rule has no explicit reason', async () => {
    const rules: PolicyRule[] = [
      { toolPattern: 'mail.send', callerClass: 'agent', decision: 'require_approval' },
    ];
    const engine = configurablePolicyEngine(rules);
    const result = await engine.evaluate(makeCtx('mail.send', 'agent'));
    expect(result).toEqual({
      decision: 'require_approval',
      reason: 'Requires human approval.',
    });
  });
});

describe('DEFAULT_POLICY_RULES', () => {
  it('requires approval for mail.send from agents', async () => {
    const engine = configurablePolicyEngine(DEFAULT_POLICY_RULES);
    const result = await engine.evaluate(makeCtx('mail.send', 'agent'));
    expect(result).toEqual({
      decision: 'require_approval',
      reason: 'Sending mail requires human approval.',
    });
  });

  it('requires approval for mail.delete from agents', async () => {
    const engine = configurablePolicyEngine(DEFAULT_POLICY_RULES);
    const result = await engine.evaluate(makeCtx('mail.delete', 'agent'));
    expect(result).toEqual({
      decision: 'require_approval',
      reason: 'Deleting mail requires human approval.',
    });
  });

  it('allows mail.send from UI callers', async () => {
    const engine = configurablePolicyEngine(DEFAULT_POLICY_RULES);
    const result = await engine.evaluate(makeCtx('mail.send', 'ui'));
    expect(result).toEqual({ decision: 'allow' });
  });

  it('allows non-destructive tools from agents', async () => {
    const engine = configurablePolicyEngine(DEFAULT_POLICY_RULES);
    const result = await engine.evaluate(makeCtx('session.get', 'agent'));
    expect(result).toEqual({ decision: 'allow' });
  });
});
