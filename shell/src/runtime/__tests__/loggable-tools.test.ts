/**
 * Log-policy mapping tests (D-052).
 *
 * Schema lock for the EXCLUDED_FROM_LOG set — adding a tool to the
 * exclusion list should require an explicit test update so the carve-
 * out is intentional rather than accidental.
 */

import { describe, expect, it } from 'vitest';
import { EXCLUDED_FROM_LOG, isLoggable } from '../loggable-tools.js';

describe('loggable-tools', () => {
  it('excludes only session.get today', () => {
    expect([...EXCLUDED_FROM_LOG].sort()).toEqual(['session.get']);
  });

  it('isLoggable returns false for excluded tools', () => {
    expect(isLoggable('session.get')).toBe(false);
  });

  it('isLoggable returns true for cacheable read tools (mailbox/thread)', () => {
    expect(isLoggable('mailbox.list')).toBe(true);
    expect(isLoggable('thread.list')).toBe(true);
    expect(isLoggable('thread.get')).toBe(true);
  });

  it('isLoggable returns true for unrecognized tools (default-on bias)', () => {
    expect(isLoggable('mail.send')).toBe(true);
    expect(isLoggable('whatever')).toBe(true);
  });
});
