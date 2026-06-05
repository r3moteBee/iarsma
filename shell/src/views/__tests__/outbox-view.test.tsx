/**
 * @vitest-environment jsdom
 *
 * Tests for OutboxView (PR 27).
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OutboxView } from '../outbox-view.js';
import type { SendHold } from '../../runtime/send-buffer.js';

afterEach(cleanup);

const HOLD: SendHold = {
  id: 'hold-1',
  params: {
    identityId: 'I-1',
    sentMailboxId: 'Mb-sent',
    from: { email: 'me@x.test' },
    to: [{ name: 'Alice', email: 'alice@x.test' }],
    subject: 'project plan',
    bodyText: 'Schedule attached.',
  },
  enqueuedAtMs: 1000,
  fireAtMs: 11000,
  remainingMs: 7000,
};

describe('OutboxView', () => {
  it('renders the empty state when there are no holds', () => {
    render(<OutboxView holds={[]} onCancel={() => {}} />);
    expect(
      screen.getByText(/nothing pending/i),
    ).toBeInTheDocument();
  });

  it('renders subject + recipient + countdown for each hold', () => {
    render(<OutboxView holds={[HOLD]} onCancel={() => {}} />);
    expect(screen.getByText('project plan')).toBeInTheDocument();
    expect(screen.getByText(/Alice/)).toBeInTheDocument();
    // Math.ceil(7000 / 1000) = 7
    expect(screen.getByText(/sending in 7s/i)).toBeInTheDocument();
  });

  it('shows the recipient count when multiple recipients', () => {
    const many: SendHold = {
      ...HOLD,
      params: {
        ...HOLD.params,
        to: [
          { email: 'a@x.test' },
          { email: 'b@x.test' },
          { email: 'c@x.test' },
        ],
      },
    };
    render(<OutboxView holds={[many]} onCancel={() => {}} />);
    expect(screen.getByText(/a@x.test and 2 more/i)).toBeInTheDocument();
  });

  it('clicking Undo calls onCancel with the hold id', () => {
    const onCancel = vi.fn();
    render(<OutboxView holds={[HOLD]} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: /undo/i }));
    expect(onCancel).toHaveBeenCalledWith('hold-1');
  });

  it('falls back to "(no subject)" when the params have none', () => {
    const noSubject: SendHold = {
      ...HOLD,
      params: { ...HOLD.params, subject: undefined as unknown as string },
    };
    render(<OutboxView holds={[noSubject]} onCancel={() => {}} />);
    expect(screen.getByText(/\(no subject\)/i)).toBeInTheDocument();
  });
});
