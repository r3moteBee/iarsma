/**
 * Tests for the avatar color rule (§7.3.1).
 */

import { describe, expect, it } from 'vitest';
import {
  classifySender,
  colorFor,
  hashHue,
  initialsFor,
  kindLabel,
} from '../sender-color.js';

describe('colorFor', () => {
  it('returns var(--accent) for agents (tracks the live theme)', () => {
    expect(colorFor('Triage Agent', 'agent')).toBe('var(--accent)');
  });

  it('returns var(--badge-system) for automated/system mail', () => {
    expect(colorFor('GitHub', 'system')).toBe('var(--badge-system)');
  });

  it('returns a deterministic hsl() for humans', () => {
    expect(colorFor('alice@example.net', 'human')).toMatch(
      /^hsl\(\d{1,3} 46% 50%\)$/,
    );
  });

  it('gives the same human the same color every time', () => {
    expect(colorFor('alice@example.net', 'human')).toBe(
      colorFor('alice@example.net', 'human'),
    );
  });

  it('gives different humans different colors', () => {
    // Not strictly guaranteed by hash, but extremely likely for these
    // two pre-checked addresses — if this flakes someday, the test
    // setup needs new sentinel addresses.
    expect(colorFor('alice@example.net', 'human')).not.toBe(
      colorFor('bob@example.net', 'human'),
    );
  });
});

describe('hashHue', () => {
  it('stays in [0, 359]', () => {
    for (const s of ['', 'a', 'alice', 'a longer string with spaces 漢字']) {
      const h = hashHue(s);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
    }
  });
});

describe('classifySender', () => {
  it('flags no-reply addresses as system', () => {
    expect(classifySender('noreply@github.com')).toBe('system');
    expect(classifySender('no-reply@example.com')).toBe('system');
    expect(classifySender('do-not-reply@example.com')).toBe('system');
    expect(classifySender('donotreply@example.com')).toBe('system');
    expect(classifySender('mailer-daemon@example.com')).toBe('system');
    expect(classifySender('postmaster@example.com')).toBe('system');
    expect(classifySender('notifications@example.com')).toBe('system');
  });

  it('flags display names that announce themselves as services', () => {
    expect(classifySender('updates@example.com', 'GitHub Notifications')).toBe('system');
    expect(classifySender('build@example.com', 'CI Bot')).toBe('system');
    expect(classifySender('hello@example.com', 'GitHub')).toBe('system');
  });

  it("treats unmatched addresses as human (false-positive 'human' is preferred)", () => {
    expect(classifySender('alice@example.net', 'Alice Robotnik')).toBe('human');
    expect(classifySender('brent@r3motely.net')).toBe('human');
  });
});

describe('initialsFor', () => {
  it("returns two letters when the name has two parts", () => {
    expect(initialsFor('Alice Robotnik', 'a@b.c')).toBe('AR');
    expect(initialsFor('Brent Ellis', 'b@e.c')).toBe('BE');
  });

  it('returns one letter for a single-part name', () => {
    expect(initialsFor('Alice', 'a@b.c')).toBe('A');
  });

  it('falls back to the local part of the email when the name is missing', () => {
    expect(initialsFor(undefined, 'brent@r3motely.net')).toBe('B');
    expect(initialsFor('', 'brent@r3motely.net')).toBe('B');
  });

  it('uses the first + last segment for three-part names', () => {
    expect(initialsFor('Alice B. Robotnik', 'a@b.c')).toBe('AR');
  });

  it('returns ? when nothing is identifiable', () => {
    expect(initialsFor(undefined, '@b.c')).toBe('?');
  });
});

describe('kindLabel', () => {
  it('returns the human-readable label for screen readers', () => {
    expect(kindLabel('human')).toBe('Contact');
    expect(kindLabel('agent')).toBe('Agent');
    expect(kindLabel('system')).toBe('Automated');
  });
});
