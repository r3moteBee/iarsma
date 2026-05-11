/**
 * Tests for the recipient-list parser (Phase 2 work item 4).
 */

import { describe, expect, it } from 'vitest';
import { formatRecipients, parseRecipients } from '../recipient-parser.js';

describe('parseRecipients', () => {
  it('returns no recipients and no errors for an empty string', () => {
    expect(parseRecipients('')).toEqual({ recipients: [], errors: [] });
    expect(parseRecipients('   ')).toEqual({ recipients: [], errors: [] });
  });

  it('parses a single bare email', () => {
    expect(parseRecipients('alice@example.net')).toEqual({
      recipients: [{ email: 'alice@example.net' }],
      errors: [],
    });
  });

  it('parses Name <email> form into name + email', () => {
    expect(parseRecipients('Alice <alice@example.net>')).toEqual({
      recipients: [{ name: 'Alice', email: 'alice@example.net' }],
      errors: [],
    });
  });

  it('parses a comma-separated mix of both shapes', () => {
    const r = parseRecipients(
      'alice@example.net, Bob <bob@example.net>, charlie@example.net',
    );
    expect(r.errors).toEqual([]);
    expect(r.recipients).toEqual([
      { email: 'alice@example.net' },
      { name: 'Bob', email: 'bob@example.net' },
      { email: 'charlie@example.net' },
    ]);
  });

  it('drops empty entries between commas', () => {
    const r = parseRecipients('alice@example.net, , bob@example.net,');
    expect(r.recipients.map((x) => x.email)).toEqual([
      'alice@example.net',
      'bob@example.net',
    ]);
  });

  it('collects bad entries in errors[] instead of throwing', () => {
    const r = parseRecipients('not-an-email, also bad, alice@example.net');
    expect(r.recipients).toEqual([{ email: 'alice@example.net' }]);
    expect(r.errors).toContain('not-an-email');
    expect(r.errors).toContain('also bad');
  });

  it('rejects an email containing whitespace as malformed', () => {
    const r = parseRecipients('alice @example.net');
    expect(r.errors).toContain('alice @example.net');
  });

  it('rejects an email with empty local-part or domain', () => {
    expect(parseRecipients('@example.net').errors).toContain('@example.net');
    expect(parseRecipients('alice@').errors).toContain('alice@');
  });
});

describe('formatRecipients', () => {
  it('returns empty string for undefined / empty input', () => {
    expect(formatRecipients(undefined)).toBe('');
    expect(formatRecipients([])).toBe('');
  });

  it('formats Name <email> when name is present, else bare email', () => {
    expect(
      formatRecipients([
        { name: 'Alice', email: 'alice@example.net' },
        { email: 'bob@example.net' },
      ]),
    ).toBe('Alice <alice@example.net>, bob@example.net');
  });

  it('round-trips via parseRecipients for both shapes', () => {
    const original = [
      { name: 'Alice', email: 'alice@example.net' },
      { email: 'bob@example.net' },
    ];
    const round = parseRecipients(formatRecipients(original));
    expect(round.recipients).toEqual(original);
    expect(round.errors).toEqual([]);
  });
});
