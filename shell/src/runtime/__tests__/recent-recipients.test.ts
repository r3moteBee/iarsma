/**
 * Tests for extractRecentRecipients (U-5 send-history source).
 */

import { describe, expect, it } from 'vitest';
import { extractRecentRecipients } from '../recent-recipients.js';
import type { StoredEntry } from '../action-log.js';

function sendEntry(
  seq: number,
  timestampMs: number,
  params: unknown,
): StoredEntry {
  return {
    seq,
    data: {
      version: 1,
      timestampMs,
      identity: 'me@example.net',
      callerClass: 'ui',
      action: 'mail.send',
      paramsJson: JSON.stringify(params),
    },
    prevHashHex: '',
    hashHex: 'h',
  } as unknown as StoredEntry;
}

describe('extractRecentRecipients', () => {
  it('collects to/cc/bcc addresses from mail.send entries, most-recent first', () => {
    const entries = [
      sendEntry(0, 1000, { to: [{ email: 'alice@example.net', name: 'Alice' }] }),
      sendEntry(1, 3000, {
        to: [{ email: 'bob@example.net' }],
        cc: [{ email: 'carol@example.net', name: 'Carol' }],
      }),
    ];
    const out = extractRecentRecipients(entries);
    expect(out.map((r) => r.email)).toEqual([
      'bob@example.net',
      'carol@example.net',
      'alice@example.net',
    ]);
    expect(out.find((r) => r.email === 'alice@example.net')?.name).toBe('Alice');
  });

  it('dedupes by email, keeping the most recent timestamp and a known name', () => {
    const entries = [
      sendEntry(0, 1000, { to: [{ email: 'dave@example.net', name: 'Dave' }] }),
      sendEntry(1, 5000, { to: [{ email: 'DAVE@example.net' }] }),
    ];
    const out = extractRecentRecipients(entries);
    expect(out).toHaveLength(1);
    expect(out[0]!.lastUsedMs).toBe(5000);
    expect(out[0]!.name).toBe('Dave');
  });

  it('ignores non-send entries and malformed params', () => {
    const entries = [
      { ...sendEntry(0, 1000, {}), data: { ...sendEntry(0, 1000, {}).data, action: 'mail.draft' } } as StoredEntry,
      sendEntry(1, 2000, { to: 'not-an-array' }),
      sendEntry(2, 3000, { to: [{ email: 'eve@example.net' }] }),
    ];
    const out = extractRecentRecipients(entries);
    expect(out.map((r) => r.email)).toEqual(['eve@example.net']);
  });
});
