/**
 * Cache-policy mapping tests (D-051).
 *
 * The map is short but the tests double as a schema lock — adding a
 * new cacheable capability should require an explicit test update.
 */

import { describe, expect, it } from 'vitest';
import { CACHEABLE_TOOLS, purposeFor } from '../cache-policy.js';

describe('cache-policy', () => {
  it('maps the cacheable read capabilities to their cache purposes', () => {
    expect(CACHEABLE_TOOLS).toEqual({
      'mailbox.list': 'mailboxes',
      'thread.list': 'threads',
      'thread.get': 'threadBodies',
      // Phase 2 item 6 — identities cached for compose-modal openness.
      'identity.list': 'identities',
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
