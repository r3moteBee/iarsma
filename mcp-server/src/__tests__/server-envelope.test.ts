/**
 * Tests for `normalizeEnvelope` — the input-shape adapter introduced
 * in PR 42 so agents following the documented `{mode, params}`
 * envelope reach the handler with the right input shape.
 */

import { describe, expect, it } from 'vitest';
import { normalizeEnvelope } from '../server.js';

describe('normalizeEnvelope', () => {
  it('unwraps a preview envelope and reports envelopeDryRun=true', () => {
    const result = normalizeEnvelope({
      mode: 'preview',
      params: {
        mailboxId: 'd',
        subject: 'hi',
      },
    });
    expect(result.args).toEqual({ mailboxId: 'd', subject: 'hi' });
    expect(result.envelopeDryRun).toBe(true);
  });

  it('unwraps a commit envelope and reports envelopeDryRun=false', () => {
    const result = normalizeEnvelope({
      mode: 'commit',
      params: {
        mailboxId: 'd',
        subject: 'hi',
      },
    });
    expect(result.args).toEqual({ mailboxId: 'd', subject: 'hi' });
    expect(result.envelopeDryRun).toBe(false);
  });

  it('passes flat input through untouched (shell back-compat)', () => {
    const result = normalizeEnvelope({
      mailboxId: 'd',
      subject: 'hi',
      _iarsmaDryRun: true,
    });
    expect(result.args).toEqual({
      mailboxId: 'd',
      subject: 'hi',
      _iarsmaDryRun: true,
    });
    expect(result.envelopeDryRun).toBeUndefined();
  });

  it('treats {mode, params} with an unrecognized mode as flat input', () => {
    const result = normalizeEnvelope({
      mode: 'rude',
      params: { mailboxId: 'd' },
    });
    // Non-enum mode → not an envelope; the raw object is returned.
    expect(result.envelopeDryRun).toBeUndefined();
    expect(result.args).toEqual({ mode: 'rude', params: { mailboxId: 'd' } });
  });

  it('treats {mode, params} where params is not an object as flat input', () => {
    const result = normalizeEnvelope({ mode: 'commit', params: 'oops' });
    expect(result.envelopeDryRun).toBeUndefined();
    expect(result.args).toEqual({ mode: 'commit', params: 'oops' });
  });

  it('passes through `_iarsma*` back-channel keys set alongside an envelope', () => {
    // Defensive: no current caller does this but the strip path below
    // would otherwise lose them silently.
    const result = normalizeEnvelope({
      mode: 'preview',
      params: { mailboxId: 'd' },
      _iarsmaScopes: ['mail:draft'],
    });
    expect(result.envelopeDryRun).toBe(true);
    expect(result.args).toEqual({
      mailboxId: 'd',
      _iarsmaScopes: ['mail:draft'],
    });
  });
});
