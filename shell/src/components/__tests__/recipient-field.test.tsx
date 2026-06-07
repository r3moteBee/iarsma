/**
 * @vitest-environment jsdom
 *
 * Tests for RecipientField (PR 47 / CoWork #3). Focuses on the pure
 * helpers — currentTerm, applySuggestion, scoreSuggestion — and the
 * UI behavior of the dropdown.
 */

import { describe, expect, it, vi } from 'vitest';

// Recipient-field imports useContactList which transitively pulls
// in @iarsma/wasm-bindings/* — the file:// scheme load doesn't work
// under jsdom. Same shim used elsewhere in the suite.
vi.mock('@iarsma/wasm-bindings/jmap-client', () => ({
  mailbox: {},
  email: {},
  identity: {},
  session: {},
  contact: {},
  calendar: {},
}));
vi.mock('@iarsma/wasm-bindings/action-log', () => ({
  chain: { canonicalize: () => new Uint8Array(0), verifyLinks: () => undefined },
}));

import {
  applySuggestion,
  currentTerm,
  scoreSuggestion,
} from '../recipient-field.js';

describe('currentTerm', () => {
  it('returns the substring after the last comma before the cursor', () => {
    expect(currentTerm('alice@x.com, bo', 15)).toBe('bo');
  });

  it('treats the whole prefix as the term when there are no commas', () => {
    expect(currentTerm('alic', 4)).toBe('alic');
  });

  it('strips leading whitespace after the comma', () => {
    expect(currentTerm('alice, bob', 10)).toBe('bob');
    expect(currentTerm('alice,   bob', 12)).toBe('bob');
  });

  it('returns empty when the cursor is on a comma boundary', () => {
    expect(currentTerm('alice,', 6)).toBe('');
  });
});

describe('applySuggestion', () => {
  it('replaces the typed term with `Name <email>, ` and cursor at the end', () => {
    const r = applySuggestion('alice@x.com, bo', 15, {
      displayName: 'Bob',
      email: 'bob@x.com',
    });
    expect(r.value).toBe('alice@x.com, Bob <bob@x.com>, ');
    expect(r.cursor).toBe(r.value.length);
  });

  it('omits the angle-brackets when the suggestion has no display name', () => {
    const r = applySuggestion('bo', 2, { displayName: '', email: 'bob@x.com' });
    expect(r.value).toBe('bob@x.com, ');
  });

  it('preserves anything after the cursor (mid-string completion)', () => {
    const r = applySuggestion('al, charlie@x.com', 2, {
      displayName: 'Alice',
      email: 'alice@x.com',
    });
    // The "al" segment before the cursor was replaced; everything
    // after the cursor (`, charlie@x.com`) stays put.
    expect(r.value).toMatch(/^Alice <alice@x\.com>, /);
    expect(r.value).toContain('charlie@x.com');
  });

  it('normalizes whitespace before the chip', () => {
    const r = applySuggestion('alice,    bo', 12, {
      displayName: 'Bob',
      email: 'bob@x.com',
    });
    expect(r.value).toBe('alice, Bob <bob@x.com>, ');
  });
});

describe('scoreSuggestion', () => {
  const alice = { displayName: 'Alice Anderson', email: 'alice@example.net' };

  it('returns -1 when the term is empty', () => {
    expect(scoreSuggestion(alice, '')).toBe(-1);
  });

  it('exact email match scores 100', () => {
    expect(scoreSuggestion(alice, 'alice@example.net')).toBe(100);
  });

  it('email startsWith scores 80', () => {
    expect(scoreSuggestion(alice, 'alice')).toBe(80);
  });

  it('name startsWith scores 70', () => {
    expect(scoreSuggestion(alice, 'Alice A')).toBe(70);
  });

  it('email contains scores 40', () => {
    expect(scoreSuggestion(alice, 'example')).toBe(40);
  });

  it('name contains scores 30', () => {
    expect(scoreSuggestion(alice, 'Anderson')).toBe(30);
  });

  it('no match returns -1', () => {
    expect(scoreSuggestion(alice, 'zzz')).toBe(-1);
  });

  it('matching is case-insensitive', () => {
    expect(scoreSuggestion(alice, 'ALICE')).toBe(80);
    expect(scoreSuggestion(alice, 'EXAMPLE')).toBe(40);
  });
});
