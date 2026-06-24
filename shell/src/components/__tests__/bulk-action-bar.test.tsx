/** @vitest-environment jsdom */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
afterEach(cleanup);
import { BulkActionBar } from '../bulk-action-bar.js';

function setup(overrides: Partial<Parameters<typeof BulkActionBar>[0]> = {}) {
  const props = {
    count: 3,
    moveTargets: [{ id: 'mb-archive', label: 'Archive' }],
    labels: [{ key: 'work', name: 'Work' }],
    onMarkRead: vi.fn(),
    onMarkUnread: vi.fn(),
    onMove: vi.fn(),
    onLabelToggle: vi.fn(),
    onDelete: vi.fn(),
    onClear: vi.fn(),
    ...overrides,
  };
  render(<BulkActionBar {...props} />);
  return props;
}

describe('BulkActionBar', () => {
  it('shows the selected count', () => {
    setup({ count: 5 });
    expect(screen.getByText(/5 selected/i)).toBeInTheDocument();
  });

  it('fires onMarkRead / onMarkUnread / onDelete', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: /mark read/i }));
    fireEvent.click(screen.getByRole('button', { name: /mark unread/i }));
    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    expect(props.onMarkRead).toHaveBeenCalledTimes(1);
    expect(props.onMarkUnread).toHaveBeenCalledTimes(1);
    expect(props.onDelete).toHaveBeenCalledTimes(1);
  });

  it('fires onClear from the clear control', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: /clear selection/i }));
    expect(props.onClear).toHaveBeenCalledTimes(1);
  });
});
