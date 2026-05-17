/**
 * Tests for previewHashHex (D-047, Phase 2 item 12).
 *
 * The function hashes the canonical-form preview value so the
 * action-log entry binds to "the preview the user approved" even
 * if the same preview object is produced with different key
 * orderings or whitespace.
 */

import { describe, expect, it } from 'vitest';
import { previewHashHex } from '../preview-hash.js';

describe('previewHashHex', () => {
  it('returns a 96-hex-char SHA-384 string', async () => {
    const hash = await previewHashHex({ subject: 'hello', count: 3 });
    expect(hash).toMatch(/^[0-9a-f]{96}$/);
  });

  it('is canonical-form stable — key order does not change the hash', async () => {
    const a = await previewHashHex({ subject: 's', count: 1, ok: true });
    const b = await previewHashHex({ ok: true, count: 1, subject: 's' });
    expect(a).toBe(b);
  });

  it('changes when any field changes', async () => {
    const a = await previewHashHex({ subject: 's', count: 1 });
    const b = await previewHashHex({ subject: 's', count: 2 });
    expect(a).not.toBe(b);
  });

  it('hashes the same value identically across calls (deterministic)', async () => {
    const a = await previewHashHex({ x: 1 });
    const b = await previewHashHex({ x: 1 });
    expect(a).toBe(b);
  });
});
