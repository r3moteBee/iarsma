/**
 * Pure-helper tests for the calendar attendees / iTIP flow
 * (PR 54 / CoWork #7).
 *
 * These helpers are exported from `calendar-view.tsx` because they're
 * tightly bound to its data shapes, but they're side-effect-free —
 * tests don't need jsdom.
 */

import { describe, expect, it } from 'vitest';

import {
  buildEventParticipants,
  isPlausibleEmail,
  partstatLabel,
  seedAttendees,
} from '../calendar-view.js';

describe('isPlausibleEmail', () => {
  it.each([
    ['alice@example.invalid', true],
    ['a.b+tag@sub.example.com', true],
    ['not-an-email', false],
    ['', false],
    ['foo@bar', false], // no TLD
    ['foo @bar.com', false],
    ['  alice@example.invalid  ', true], // trimmed
  ])('%j → %s', (s, ok) => {
    expect(isPlausibleEmail(s)).toBe(ok);
  });
});

describe('seedAttendees', () => {
  it('returns an empty list when participants are undefined', () => {
    expect(seedAttendees(undefined)).toEqual([]);
  });

  it('drops the organizer (roles.owner=true) from the seeded list', () => {
    const out = seedAttendees([
      { email: 'me@example.invalid', roles: { owner: true, chair: true } },
      { email: 'alice@example.invalid', roles: { attendee: true } },
    ]);
    expect(out).toEqual([{ email: 'alice@example.invalid' }]);
  });

  it('preserves name + optional flag for non-organizer entries', () => {
    const out = seedAttendees([
      {
        email: 'bob@example.invalid',
        name: 'Bob',
        roles: { attendee: true, optional: true },
      },
    ]);
    expect(out).toEqual([
      { email: 'bob@example.invalid', name: 'Bob', optional: true },
    ]);
  });
});

describe('buildEventParticipants', () => {
  it('returns undefined when there are no attendees and no organizer', () => {
    expect(buildEventParticipants(undefined, undefined)).toBeUndefined();
    expect(buildEventParticipants([], undefined)).toBeUndefined();
  });

  it('returns an empty array — not undefined — when attendees go from N to 0 on edit', () => {
    // Empty array is the "clear participants" sentinel: jmap-client
    // turns it into `participants: null` on the update patch so the
    // server drops them. Returning undefined here would suppress the
    // field entirely and the prior attendees would stick around.
    expect(
      buildEventParticipants([], { email: 'me@example.invalid' }),
    ).toEqual([]);
  });

  it('emits organizer + attendees with default roles + PARTSTAT', () => {
    const out = buildEventParticipants(
      [
        { email: 'alice@example.invalid' },
        { email: 'bob@example.invalid', optional: true, name: 'Bob' },
      ],
      { email: 'me@example.invalid', name: 'Me' },
    );
    expect(out).toEqual([
      {
        email: 'me@example.invalid',
        name: 'Me',
        roles: { owner: true, chair: true },
        participationStatus: 'accepted',
        expectReply: false,
      },
      {
        email: 'alice@example.invalid',
        roles: { attendee: true },
        participationStatus: 'needs-action',
        expectReply: true,
      },
      {
        email: 'bob@example.invalid',
        name: 'Bob',
        roles: { attendee: true, optional: true },
        participationStatus: 'needs-action',
        expectReply: true,
      },
    ]);
  });

  it('emits attendees without an organizer entry when organizer is undefined', () => {
    const out = buildEventParticipants(
      [{ email: 'alice@example.invalid' }],
      undefined,
    );
    expect(out).toHaveLength(1);
    expect(out![0]!.email).toBe('alice@example.invalid');
  });
});

describe('partstatLabel', () => {
  it.each([
    ['accepted', 'Accepted', 'accepted'],
    ['declined', 'Declined', 'declined'],
    ['tentative', 'Tentative', 'tentative'],
    ['delegated', 'Delegated', 'pending'],
    ['needs-action', 'Awaiting reply', 'pending'],
    ['unknown-future-status', 'Awaiting reply', 'pending'],
  ])('%j → label=%j tone=%j', (status, label, tone) => {
    const out = partstatLabel(status);
    expect(out.label).toBe(label);
    expect(out.tone).toBe(tone);
  });
});
