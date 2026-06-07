/**
 * Tests for the pure-functions half of the URL router (PR 46).
 */

import { describe, expect, it } from 'vitest';
import {
  parseRoute,
  routeFor,
  serializeRoute,
  stripBase,
  viewAndSelectionFor,
  withBase,
} from '../router.js';

describe('stripBase / withBase', () => {
  it('strips a multi-segment base', () => {
    expect(stripBase('/webmail/mail/inbox', '/webmail/')).toBe('mail/inbox');
    expect(stripBase('/webmail/', '/webmail/')).toBe('');
    expect(stripBase('/webmail', '/webmail/')).toBe('');
  });

  it('treats out-of-base paths as root', () => {
    expect(stripBase('/other/thing', '/webmail/')).toBe('');
  });

  it('handles a root base', () => {
    expect(stripBase('/mail/inbox', '/')).toBe('mail/inbox');
    expect(stripBase('/', '/')).toBe('');
  });

  it('roundtrips with withBase', () => {
    const original = 'mail/inbox/T1';
    expect(stripBase(withBase(original, '/webmail/'), '/webmail/')).toBe(original);
  });
});

describe('parseRoute — simple views', () => {
  it('parses each non-mail view from its kind segment', () => {
    for (const k of [
      'outbox',
      'calendar',
      'contacts',
      'files',
      'approvals',
      'activity',
      'agents',
      'settings',
    ] as const) {
      expect(parseRoute(k, '')).toEqual({ kind: k });
    }
  });

  it('falls back to mail on the empty path', () => {
    expect(parseRoute('', '')).toEqual({ kind: 'mail' });
  });

  it('preserves the OAuth callback as-is', () => {
    expect(parseRoute('auth/callback', '?code=abc&state=xyz')).toEqual({
      kind: 'callback',
      raw: 'auth/callback',
    });
  });

  it('captures unknown paths instead of silently rewriting', () => {
    expect(parseRoute('something-weird', '')).toEqual({
      kind: 'unknown',
      raw: 'something-weird',
    });
  });
});

describe('parseRoute — mail subroutes', () => {
  it('parses /mail with no selection', () => {
    expect(parseRoute('mail', '')).toEqual({ kind: 'mail' });
  });

  it('parses /mail/<mailbox>', () => {
    expect(parseRoute('mail/Mb-inbox', '')).toEqual({
      kind: 'mail',
      mailboxId: 'Mb-inbox',
    });
  });

  it('parses /mail/<mailbox>/<thread>', () => {
    expect(parseRoute('mail/Mb-inbox/T-001', '')).toEqual({
      kind: 'mail',
      mailboxId: 'Mb-inbox',
      threadId: 'T-001',
    });
  });

  it('decodes percent-encoded ids', () => {
    expect(parseRoute('mail/Mb%2Finbox', '')).toEqual({
      kind: 'mail',
      mailboxId: 'Mb/inbox',
    });
  });

  it('captures ?q=… as a query', () => {
    expect(parseRoute('mail', '?q=hello%20world')).toEqual({
      kind: 'mail',
      query: 'hello world',
    });
  });

  it('drops empty q params', () => {
    expect(parseRoute('mail', '?q=')).toEqual({ kind: 'mail' });
  });
});

describe('serializeRoute', () => {
  it('serializes each simple view to its kind segment', () => {
    expect(serializeRoute({ kind: 'calendar' })).toBe('calendar');
    expect(serializeRoute({ kind: 'agents' })).toBe('agents');
  });

  it('serializes mail levels of selection', () => {
    expect(serializeRoute({ kind: 'mail' })).toBe('mail');
    expect(serializeRoute({ kind: 'mail', mailboxId: 'Mb-inbox' })).toBe(
      'mail/Mb-inbox',
    );
    expect(
      serializeRoute({ kind: 'mail', mailboxId: 'Mb-inbox', threadId: 'T-001' }),
    ).toBe('mail/Mb-inbox/T-001');
  });

  it('attaches ?q=… when present', () => {
    expect(serializeRoute({ kind: 'mail', query: 'hello world' })).toBe(
      'mail?q=hello%20world',
    );
  });

  it('preserves the callback raw path', () => {
    expect(serializeRoute({ kind: 'callback', raw: 'auth/callback' })).toBe(
      'auth/callback',
    );
  });

  it('roundtrips parse → serialize → parse', () => {
    const inputs = [
      'mail',
      'mail/Mb-inbox',
      'mail/Mb-inbox/T-001',
      'calendar',
      'agents',
      'settings',
    ];
    for (const path of inputs) {
      expect(serializeRoute(parseRoute(path, ''))).toBe(path);
    }
  });
});

describe('routeFor / viewAndSelectionFor', () => {
  it('rolls activeView + selection into a Route', () => {
    expect(
      routeFor('mail', { mailboxId: 'Mb-inbox', threadId: 'T1', searchQuery: '' }),
    ).toEqual({ kind: 'mail', mailboxId: 'Mb-inbox', threadId: 'T1' });
  });

  it('omits the threadId when no mailbox is selected', () => {
    expect(
      routeFor('mail', { mailboxId: null, threadId: 'T1', searchQuery: '' }),
    ).toEqual({ kind: 'mail' });
  });

  it('lifts a search query into the mail route', () => {
    expect(
      routeFor('mail', { mailboxId: null, threadId: null, searchQuery: 'invoice' }),
    ).toEqual({ kind: 'mail', query: 'invoice' });
  });

  it('maps each non-mail ActiveView to its Route kind', () => {
    for (const v of [
      'calendar',
      'contacts',
      'files',
      'approvals',
      'activity',
      'agents',
      'outbox',
      'settings',
    ] as const) {
      expect(
        routeFor(v, { mailboxId: null, threadId: null, searchQuery: '' }),
      ).toEqual({ kind: v });
    }
  });

  it('round-trips activeView + selection via Route', () => {
    const r = routeFor('mail', {
      mailboxId: 'Mb-inbox',
      threadId: 'T-1',
      searchQuery: '',
    });
    expect(viewAndSelectionFor(r)).toEqual({
      activeView: 'mail',
      mailboxId: 'Mb-inbox',
      threadId: 'T-1',
      searchQuery: '',
    });
  });

  it('emits activeView=null for callback / unknown routes', () => {
    expect(viewAndSelectionFor({ kind: 'callback', raw: 'auth/callback' })).toEqual({
      activeView: null,
      mailboxId: undefined,
      threadId: undefined,
      searchQuery: undefined,
    });
    expect(viewAndSelectionFor({ kind: 'unknown', raw: 'lol' })).toMatchObject({
      activeView: null,
    });
  });
});
