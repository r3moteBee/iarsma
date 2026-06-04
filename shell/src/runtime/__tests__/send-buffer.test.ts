/**
 * Tests for the in-memory SendBuffer (PR 23 of the undo-registry plan).
 *
 * The buffer holds outgoing mail.send params for a configurable delay
 * before firing them through the inner invoker. Undo cancels the
 * timer; no JMAP call is made, and no action-log entry is appended.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSendBuffer, type SendBuffer } from '../send-buffer.js';
import type { MailSendInput, MailSendResult } from '../jmap-client.js';

const PARAMS: MailSendInput = {
  identityId: 'I-1',
  sentMailboxId: 'Mb-sent',
  from: { email: 'me@x.test' },
  to: [{ email: 'you@x.test' }],
  subject: 'hi',
  bodyText: 'body',
};

describe('SendBuffer', () => {
  let buffer: SendBuffer;
  let fire: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fire = vi.fn<(p: MailSendInput) => Promise<MailSendResult>>(async () => ({
      emailId: 'E-1',
      blobId: 'B-1',
      threadId: 'T-1',
      size: 100,
      submissionId: 'S-1',
      sendAt: '2026-06-04T12:00:00Z',
    }));
    buffer = createSendBuffer({ onFire: fire });
  });
  afterEach(() => vi.useRealTimers());

  it('fires after the configured delay', async () => {
    buffer.enqueue(PARAMS, 10000);
    expect(buffer.list()).toHaveLength(1);
    expect(fire).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10000);
    expect(fire).toHaveBeenCalledWith(PARAMS);
    expect(buffer.list()).toHaveLength(0);
  });

  it('cancel before the timer prevents fire', async () => {
    const id = buffer.enqueue(PARAMS, 10000);
    buffer.cancel(id);
    await vi.advanceTimersByTimeAsync(11000);
    expect(fire).not.toHaveBeenCalled();
    expect(buffer.list()).toHaveLength(0);
  });

  it('cancel on an unknown id is a no-op', () => {
    expect(() => buffer.cancel('nope')).not.toThrow();
  });

  it('list returns active holds with computed remainingMs', () => {
    buffer.enqueue(PARAMS, 10000);
    const [hold] = buffer.list();
    expect(hold!.params).toEqual(PARAMS);
    expect(hold!.remainingMs).toBeGreaterThan(0);
    expect(hold!.remainingMs).toBeLessThanOrEqual(10000);
  });

  it('remainingMs decreases as time advances', async () => {
    buffer.enqueue(PARAMS, 10000);
    const before = buffer.list()[0]!.remainingMs;
    await vi.advanceTimersByTimeAsync(3000);
    const after = buffer.list()[0]!.remainingMs;
    expect(after).toBeLessThan(before);
    expect(after).toBeLessThanOrEqual(7000);
  });

  it('multiple holds coexist; firing one leaves the others', async () => {
    const id1 = buffer.enqueue(PARAMS, 5000);
    buffer.enqueue(PARAMS, 10000);
    expect(buffer.list()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(5000);
    expect(buffer.list()).toHaveLength(1);
    // Cancel the remaining one explicitly.
    buffer.cancel(buffer.list()[0]!.id);
    expect(buffer.list()).toHaveLength(0);
    expect(id1).toMatch(/^hold-/);
  });

  it('returned id is unique per enqueue', () => {
    const a = buffer.enqueue(PARAMS, 1000);
    const b = buffer.enqueue(PARAMS, 1000);
    expect(a).not.toBe(b);
  });
});
