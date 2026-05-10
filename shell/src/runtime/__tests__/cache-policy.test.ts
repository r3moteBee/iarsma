/**
 * Cache-policy mapping tests (D-051).
 *
 * The map is short but the tests double as a schema lock — adding a
 * new cacheable capability should require an explicit test update.
 */

import { describe, expect, it } from 'vitest';
import { CACHEABLE_TOOLS, purposeFor } from '../cache-policy.js';

describe('cache-policy', () => {
  it('maps the Phase 1 read capabilities to their cache purposes', () => {
    expect(CACHEABLE_TOOLS).toEqual({
      'mailbox.list': 'mailboxes',
      'thread.list': 'threads',
      'thread.get': 'threadBodies',
    });
  });

  it('returns the purpose for a registered tool', () => {
    expect(purposeFor('mailbox.list')).toBe('mailboxes');
    expect(purposeFor('thread.get')).toBe('threadBodies');
  });

  it('returns null for unregistered tools (pass-through default)', () => {
    expect(purposeFor('session.get')).toBeNull();
    expect(purposeFor('mail.send')).toBeNull();
    expect(purposeFor('whatever')).toBeNull();
  });
});
