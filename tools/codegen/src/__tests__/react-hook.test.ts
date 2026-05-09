/**
 * React hook generator tests. Snapshot-style assertions on generated output
 * for read-style and write-style capabilities.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { capability } from '../contract.js';
import { pascalCase, reactHookForCapability } from '../generators/react-hook.js';

describe('pascalCase', () => {
  it('PascalCases dotted names', () => {
    expect(pascalCase('session.get')).toBe('SessionGet');
    expect(pascalCase('mail.send')).toBe('MailSend');
    expect(pascalCase('mail.draft.create')).toBe('MailDraftCreate');
  });

  it('handles single-segment names', () => {
    expect(pascalCase('plain')).toBe('Plain');
  });

  it('handles dashed/underscored segments', () => {
    expect(pascalCase('mail.send-bulk')).toBe('MailSendBulk');
    expect(pascalCase('mail.send_bulk')).toBe('MailSendBulk');
  });
});

describe('reactHookForCapability — read-style (non-destructive)', () => {
  const sessionGet = capability({
    name: 'session.get',
    version: '0.0.1',
    scopes: ['session:read'],
    description: 'Get the current session.',
    input: z.object({}),
    output: z.object({
      username: z.string().describe('Account email.'),
      apiUrl: z.string(),
    }),
    examples: [],
  });

  const generated = reactHookForCapability(sessionGet.ast);

  it('imports useReadHook (not useWriteHook)', () => {
    expect(generated).toContain('useReadHook');
    expect(generated).not.toContain('useWriteHook');
  });

  it('emits typed Input and Output aliases', () => {
    expect(generated).toContain('export type SessionGetInput =');
    expect(generated).toContain('export type SessionGetOutput =');
  });

  it('preserves field descriptions as JSDoc', () => {
    expect(generated).toContain('/** Account email. */');
  });

  it('exports a hook named useSessionGet', () => {
    expect(generated).toMatch(/export function useSessionGet\(/);
  });

  it('hard-codes the capability name string', () => {
    expect(generated).toContain("name: 'session.get'");
  });

  it('emits scopes as a const array', () => {
    expect(generated).toContain("scopes: ['session:read'] as const");
  });

  it('defaults input to {} when input shape is empty record', () => {
    expect(generated).toContain('= {}');
  });

  it('does not default input when input has required fields', () => {
    const required = capability({
      name: 'mail.list',
      version: '0.0.1',
      scopes: ['mail:read'],
      description: 'List mail.',
      input: z.object({ mailboxId: z.string() }),
      output: z.array(z.string()),
      examples: [],
    });
    const out = reactHookForCapability(required.ast);
    expect(out).toMatch(/input: MailListInput\)/);
    expect(out).not.toContain('= {}');
  });

  it('header includes the contract name and a do-not-edit warning', () => {
    expect(generated).toContain('Generated from contract: session.get');
    expect(generated).toContain('Do not edit by hand');
  });

  it('output ends with a single trailing newline', () => {
    expect(generated.endsWith('\n')).toBe(true);
    expect(generated.endsWith('\n\n')).toBe(false);
  });
});

describe('reactHookForCapability — write-style (destructive)', () => {
  const mailSend = capability({
    name: 'mail.send',
    version: '0.0.1',
    scopes: ['mail:send'],
    description: 'Send an email.',
    isDestructive: true,
    dryRun: { preview: z.object({}) },
    input: z.object({
      to: z.array(z.string()),
      body: z.string(),
    }),
    output: z.object({
      messageId: z.string(),
    }),
    examples: [],
  });

  const generated = reactHookForCapability(mailSend.ast);

  it('imports useWriteHook (not useReadHook)', () => {
    expect(generated).toContain('useWriteHook');
    expect(generated).not.toContain('useReadHook');
  });

  it('exports useMailSend with no input parameter', () => {
    expect(generated).toMatch(/export function useMailSend\(\)/);
  });

  it('passes only name and scopes to useWriteHook (no input)', () => {
    // Write hooks receive input at call time via preview/commit, not at hook construction.
    expect(generated).toContain("name: 'mail.send'");
    expect(generated).toContain("scopes: ['mail:send'] as const");
    expect(generated).not.toMatch(/input:/);
  });

  it('comments mention preview and commit', () => {
    expect(generated).toContain('preview');
    expect(generated).toContain('commit');
  });

  it('flags the capability as destructive in the comment', () => {
    expect(generated).toContain('destructive');
  });
});

describe('reactHookForCapability — determinism', () => {
  const cap = capability({
    name: 't.echo',
    version: '0.0.1',
    scopes: ['t:echo'],
    description: 'Echo.',
    input: z.object({ message: z.string() }),
    output: z.object({ message: z.string() }),
    examples: [],
  });

  it('produces byte-identical output across runs', () => {
    const a = reactHookForCapability(cap.ast);
    const b = reactHookForCapability(cap.ast);
    expect(a).toBe(b);
  });
});
