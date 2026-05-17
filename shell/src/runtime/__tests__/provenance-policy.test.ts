/**
 * Tests for provenance-policy (D-047, Phase 2 item 12).
 *
 * Schema-lock the DESTRUCTIVE_TOOLS set + per-tool affected-json
 * builders. Adding a destructive capability should require an
 * explicit test update so the audit chain doesn't silently miss
 * the new tool.
 */

import { describe, expect, it } from 'vitest';
import {
  DESTRUCTIVE_TOOLS,
  affectedJsonFor,
  isDestructive,
} from '../provenance-policy.js';

describe('DESTRUCTIVE_TOOLS', () => {
  it('lists exactly the Phase 2 destructive tools', () => {
    expect([...DESTRUCTIVE_TOOLS].sort()).toEqual(['mail.draft', 'mail.send']);
  });

  it('isDestructive recognizes the destructive set', () => {
    expect(isDestructive('mail.draft')).toBe(true);
    expect(isDestructive('mail.send')).toBe(true);
    expect(isDestructive('mailbox.list')).toBe(false);
    expect(isDestructive('thread.search')).toBe(false);
  });
});

describe('affectedJsonFor — mail.draft', () => {
  it('builds a single mail-create artifact from the commit output', () => {
    const result = JSON.parse(
      affectedJsonFor('mail.draft', {
        emailId: 'E-1',
        blobId: 'B-1',
        threadId: 'T-1',
        size: 256,
      })!,
    );
    expect(result).toEqual([{ kind: 'mail', id: 'E-1', op: 'create' }]);
  });

  it('returns an empty array when the output lacks emailId', () => {
    expect(JSON.parse(affectedJsonFor('mail.draft', {})!)).toEqual([]);
    expect(JSON.parse(affectedJsonFor('mail.draft', undefined)!)).toEqual([]);
  });
});

describe('affectedJsonFor — mail.send', () => {
  it('builds mail + mail-submission artifacts from the commit output', () => {
    const result = JSON.parse(
      affectedJsonFor('mail.send', {
        emailId: 'E-1',
        blobId: 'B-1',
        threadId: 'T-1',
        size: 256,
        submissionId: 'S-1',
      })!,
    );
    expect(result).toEqual([
      { kind: 'mail', id: 'E-1', op: 'create' },
      { kind: 'mail-submission', id: 'S-1', op: 'create' },
    ]);
  });

  it('omits the submission artifact when submissionId is absent', () => {
    const result = JSON.parse(
      affectedJsonFor('mail.send', {
        emailId: 'E-1',
        blobId: 'B-1',
        threadId: 'T-1',
        size: 256,
      })!,
    );
    expect(result).toEqual([{ kind: 'mail', id: 'E-1', op: 'create' }]);
  });
});

describe('affectedJsonFor — unknown tool', () => {
  it('returns undefined for tools without a builder', () => {
    expect(affectedJsonFor('thread.list', {})).toBeUndefined();
    expect(affectedJsonFor('whatever', {})).toBeUndefined();
  });
});
