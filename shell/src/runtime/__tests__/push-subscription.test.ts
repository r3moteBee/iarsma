/**
 * Tests for JMAP Push Subscription (EventSource) — Phase 3c.
 *
 * The `usePushSubscription` hook requires a browser environment (real
 * EventSource, document visibility API) and is covered by integration
 * tests. Unit tests here focus on the pure mapping function
 * `mapStateChangeToCacheInvalidations` which translates JMAP state-
 * change type names into `CachePurposeKey` entries for cache eviction.
 */

import { describe, expect, it } from 'vitest';
import {
  buildPushUrl,
  mapStateChangeToCacheInvalidations,
  type StateChange,
} from '../push-subscription.js';

describe('mapStateChangeToCacheInvalidations', () => {
  it('maps Email change to threads, threadBodies, and searchResults', () => {
    const change: StateChange = {
      changed: { Email: 'state-42' },
    };
    const keys = mapStateChangeToCacheInvalidations(change);
    expect(keys).toContain('threads');
    expect(keys).toContain('threadBodies');
    expect(keys).toContain('searchResults');
    expect(keys).toHaveLength(3);
  });

  it('maps Mailbox change to mailboxes', () => {
    const change: StateChange = {
      changed: { Mailbox: 'state-7' },
    };
    const keys = mapStateChangeToCacheInvalidations(change);
    expect(keys).toEqual(['mailboxes']);
  });

  it('maps Identity change to identities', () => {
    const change: StateChange = {
      changed: { Identity: 'state-1' },
    };
    const keys = mapStateChangeToCacheInvalidations(change);
    expect(keys).toEqual(['identities']);
  });

  it('returns empty array for unknown types', () => {
    const change: StateChange = {
      changed: { Thread: 'state-9', CalendarEvent: 'state-3' },
    };
    const keys = mapStateChangeToCacheInvalidations(change);
    expect(keys).toEqual([]);
  });

  it('produces combined invalidations for multiple changes in one event', () => {
    const change: StateChange = {
      changed: {
        Email: 'state-10',
        Mailbox: 'state-11',
        Identity: 'state-12',
      },
    };
    const keys = mapStateChangeToCacheInvalidations(change);
    expect(keys).toContain('threads');
    expect(keys).toContain('threadBodies');
    expect(keys).toContain('searchResults');
    expect(keys).toContain('mailboxes');
    expect(keys).toContain('identities');
    expect(keys).toHaveLength(5);
  });

  it('handles mixed known and unknown types', () => {
    const change: StateChange = {
      changed: {
        Email: 'state-1',
        Thread: 'state-2',
        VacationResponse: 'state-3',
      },
    };
    const keys = mapStateChangeToCacheInvalidations(change);
    expect(keys).toContain('threads');
    expect(keys).toContain('threadBodies');
    expect(keys).toContain('searchResults');
    expect(keys).toHaveLength(3);
  });

  it('handles empty changed map', () => {
    const change: StateChange = { changed: {} };
    const keys = mapStateChangeToCacheInvalidations(change);
    expect(keys).toEqual([]);
  });
});

/* ------------------------------------------------------------------
 * Integration tests for the fetch-based SSE reader (PR 29).
 *
 * Renders the hook in jsdom, mocks `fetch` to return a streaming
 * Response, and verifies the parser dispatches `state` events into
 * onStateChange with the flattened changed map.
 * ------------------------------------------------------------------ */

// Stream-parsing integration tests live in push-subscription-stream.test.tsx
// (they need jsdom and a streaming fetch mock).

/* ------------------------------------------------------------------
 * PR 56 / CoWork follow-up — RFC 6570 URI template expansion.
 *
 * Stalwart publishes its eventSourceUrl as a template:
 *   `/jmap/eventsource/?types={types}&closeafter={closeafter}&ping={ping}`
 *
 * The earlier implementation appended `?types=*&...` after the literal
 * template, leaving `{types}` etc. in the URL. Stalwart logged
 * "Bad resource parameters" and returned 400 on every request — a
 * tight reconnect loop that flickered the UI ~twice per second.
 * ------------------------------------------------------------------ */

describe('buildPushUrl — RFC 6570 expansion', () => {
  it('expands {types} / {closeafter} / {ping} in a Stalwart-style template', () => {
    const out = buildPushUrl(
      'https://srv/jmap/eventsource/?types={types}&closeafter={closeafter}&ping={ping}',
    );
    expect(out).not.toContain('{');
    expect(out).toBe(
      'https://srv/jmap/eventsource/?types=*&closeafter=state&ping=30',
    );
  });

  it('appends params when the URL has no template placeholders', () => {
    const out = buildPushUrl('https://srv/jmap/eventsource/');
    expect(out).toBe(
      'https://srv/jmap/eventsource/?types=*&closeafter=state&ping=30',
    );
  });

  it('uses `&` separator when a legacy URL already has a query', () => {
    const out = buildPushUrl('https://srv/jmap/eventsource/?token=abc');
    expect(out).toBe(
      'https://srv/jmap/eventsource/?token=abc&types=*&closeafter=state&ping=30',
    );
  });

  it('never produces duplicate `types=` params from a templated URL', () => {
    const out = buildPushUrl(
      '/jmap/eventsource/?types={types}&closeafter={closeafter}&ping={ping}',
    );
    expect(out.match(/types=/g)?.length).toBe(1);
    expect(out.match(/closeafter=/g)?.length).toBe(1);
    expect(out.match(/ping=/g)?.length).toBe(1);
  });
});
