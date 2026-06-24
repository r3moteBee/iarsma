/**
 * Cache-policy mapping tests (D-051).
 *
 * The map is short but the tests double as a schema lock — adding a
 * new cacheable capability should require an explicit test update.
 */

import { describe, expect, it } from 'vitest';
import {
  CACHEABLE_TOOLS,
  cacheInvalidationsFor,
  purposeFor,
} from '../cache-policy.js';

describe('cache-policy', () => {
  it('maps the cacheable read capabilities to their cache purposes', () => {
    expect(CACHEABLE_TOOLS).toEqual({
      'mailbox.list': 'mailboxes',
      'thread.list': 'threads',
      'thread.get': 'threadBodies',
      // Phase 2 item 6 — identities cached for compose-modal openness.
      'identity.list': 'identities',
      // Phase 2 item 9 — search results cached SWR per (query, mailbox).
      'thread.search': 'searchResults',
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

describe('cacheInvalidationsFor (v0.13.1 write-invalidation)', () => {
  it('a move (mail.modify with a mailboxIds patch) invalidates the mailbox-list views + counts', () => {
    expect(
      cacheInvalidationsFor('mail.modify', {
        emailIds: ['e1'],
        patch: { mailboxIds: { src: false, dest: true } },
      }),
    ).toEqual(['threads', 'searchResults', 'mailboxes']);
  });

  it('a keyword-only mail.modify (flag / mark-read) invalidates nothing', () => {
    expect(
      cacheInvalidationsFor('mail.modify', {
        emailIds: ['e1'],
        patch: { keywords: { $seen: true } },
      }),
    ).toEqual([]);
    // No patch at all → also nothing.
    expect(cacheInvalidationsFor('mail.modify', { emailIds: ['e1'] })).toEqual([]);
    // Empty mailboxIds object → not a real membership change.
    expect(
      cacheInvalidationsFor('mail.modify', {
        emailIds: ['e1'],
        patch: { mailboxIds: {} },
      }),
    ).toEqual([]);
  });

  it('deletes/purges drop thread bodies too', () => {
    expect(cacheInvalidationsFor('mail.delete', { emailIds: ['e1'] })).toEqual([
      'threads',
      'threadBodies',
      'searchResults',
      'mailboxes',
    ]);
    expect(cacheInvalidationsFor('mail.purge', { emailIds: ['e1'] })).toEqual([
      'threads',
      'threadBodies',
      'searchResults',
      'mailboxes',
    ]);
  });

  it('label apply/delete invalidate keyword-filtered views but not mailbox counts', () => {
    expect(cacheInvalidationsFor('label.apply', { emailIds: ['e1'], add: ['work'] })).toEqual([
      'threads',
      'searchResults',
    ]);
    expect(cacheInvalidationsFor('label.delete', { key: 'work' })).toEqual([
      'threads',
      'searchResults',
    ]);
  });

  it('unknown / pure-read tools invalidate nothing', () => {
    expect(cacheInvalidationsFor('thread.list', { mailboxId: 'mb1' })).toEqual([]);
    expect(cacheInvalidationsFor('mail.send', {})).toEqual([]);
    expect(cacheInvalidationsFor('whatever', null)).toEqual([]);
  });
});
