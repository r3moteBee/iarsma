/**
 * Tests for the `event.update` switch case in `jmapInvoker` (Task 3).
 *
 * Covers:
 *   event.update with only { eventId }  → rejects with code 'nothing_to_update'
 *   event.update dry-run with calendarId → echoes calendarId in the preview
 *
 * Mirror of invoker-calendar.test.ts setup — `jmapInvoker` wired with a
 * minimal fetch stub; the dry-run path needs no network.
 */

import { describe, it, expect, vi } from 'vitest';
import { jmapInvoker } from '../invoker.js';

// ─── Fetch mock factory ───────────────────────────────────────────────────────

/**
 * Minimal fetch stub. The dry-run path never hits the network, so this
 * factory just provides a mock that throws if unexpectedly called.
 */
function makeNoNetworkFetch(): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn<typeof fetch>(async (input) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    throw new Error(`fetch mock: unexpected network call to "${url}" — not expected in dry-run`);
  });
}

function makeInvoker() {
  return jmapInvoker({
    baseUrl: 'https://sw-mail.example.net',
    getAuthToken: () => 'tok',
    fetch: makeNoNetworkFetch() as typeof globalThis.fetch,
  });
}

// ─── event.update ─────────────────────────────────────────────────────────────

describe('jmapInvoker — event.update', () => {
  it('rejects an update with no mutable fields', async () => {
    const inv = makeInvoker();
    await expect(
      inv.invoke('event.update', { eventId: 'ev1' }, { dryRun: true }),
    ).rejects.toMatchObject({ code: 'nothing_to_update' });
  });

  it('dry-run echoes calendarId when provided', async () => {
    const inv = makeInvoker();
    const preview = await inv.invoke(
      'event.update',
      { eventId: 'ev1', calendarId: 'cal2' },
      { dryRun: true },
    );
    expect(preview).toMatchObject({ eventId: 'ev1', calendarId: 'cal2' });
  });
});
