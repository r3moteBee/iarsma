/**
 * @vitest-environment jsdom
 *
 * Tests for SendToast (PR 24, §8.5).
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSendBuffer, type SendBuffer } from '../../runtime/send-buffer.js';
import { SendBufferProvider } from '../../runtime/send-buffer-context.js';
import { SendToast } from '../send-toast.js';
import type { MailSendInput, MailSendResult } from '../../runtime/jmap-client.js';

const PARAMS: MailSendInput = {
  identityId: 'I-1',
  sentMailboxId: 'Mb-sent',
  from: { email: 'me@x.test' },
  to: [{ email: 'you@x.test' }],
  subject: 'hi',
  bodyText: 'body',
};

const SEND_OK: MailSendResult = {
  emailId: 'E-1',
  blobId: 'B-1',
  threadId: 'T-1',
  size: 100,
  submissionId: 'S-1',
};

afterEach(cleanup);

describe('SendToast', () => {
  let buffer: SendBuffer;
  let fire: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fire = vi.fn<(p: MailSendInput) => Promise<MailSendResult>>(
      async () => SEND_OK,
    );
    buffer = createSendBuffer({ onFire: fire });
  });
  afterEach(() => vi.useRealTimers());

  function mount() {
    return render(
      <SendBufferProvider value={buffer}>
        <SendToast />
      </SendBufferProvider>,
    );
  }

  it('renders nothing when no holds are active', () => {
    mount();
    expect(screen.queryByRole('region', { name: /pending sends/i })).not.toBeInTheDocument();
  });

  it('renders one toast per active hold', () => {
    buffer.enqueue(PARAMS, 10000);
    mount();
    // Initial poll runs on mount.
    expect(screen.getByRole('region', { name: /pending sends/i })).toBeInTheDocument();
    expect(screen.getByText(/sending in \d+s/i)).toBeInTheDocument();
  });

  it('clicking Undo cancels the hold so the fire never runs', async () => {
    buffer.enqueue(PARAMS, 10000);
    mount();
    fireEvent.click(screen.getByRole('button', { name: /undo/i }));
    // Advance past the original delay; fire must NOT have been called.
    await vi.advanceTimersByTimeAsync(11000);
    expect(fire).not.toHaveBeenCalled();
  });
});
