import { describe, it, expect } from 'vitest';
import { resolveMoveUndo } from '../move-undo.js';

const name = (id: string) => (id === 'mb-archive' ? 'Archive' : id);

describe('resolveMoveUndo', () => {
  it('builds a move-undo record for a UI move', () => {
    const r = resolveMoveUndo(
      { tool: 'mail.modify', callerClass: 'ui', seq: 7,
        params: { emailIds: ['E1', 'E2'], patch: { mailboxIds: { 'mb-inbox': false, 'mb-archive': true } } } },
      name,
    );
    expect(r).toEqual({ seq: 7, count: 2, message: '2 messages moved to Archive' });
  });

  it('uses singular copy for one message', () => {
    const r = resolveMoveUndo(
      { tool: 'mail.modify', callerClass: 'ui', seq: 9,
        params: { emailIds: ['E1'], patch: { mailboxIds: { 'mb-inbox': false, 'mb-archive': true } } } },
      name,
    );
    expect(r?.message).toBe('Moved to Archive');
  });

  it('returns null for a keyword-only modify (flag/read)', () => {
    expect(resolveMoveUndo(
      { tool: 'mail.modify', callerClass: 'ui', seq: 1, params: { emailIds: ['E1'], patch: { keywords: { $flagged: true } } } },
      name,
    )).toBeNull();
  });

  it('returns null for non-ui callers and non-modify tools', () => {
    expect(resolveMoveUndo({ tool: 'mail.modify', callerClass: 'agent', seq: 1, params: { emailIds: ['E1'], patch: { mailboxIds: { 'mb-archive': true } } } }, name)).toBeNull();
    expect(resolveMoveUndo({ tool: 'mail.delete', callerClass: 'ui', seq: 1, params: { emailIds: ['E1'] } }, name)).toBeNull();
  });
});
