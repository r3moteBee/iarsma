/**
 * @vitest-environment jsdom
 *
 * Tests for DeleteToast (U-4) — the act-then-undo "Moved to Trash"
 * toast. Mirrors send-toast.test.tsx but the model is different: the
 * delete already happened, so the toast surfaces the registered undo
 * (by action-log seq) and auto-dismisses after a window.
 */

import { cleanup, fireEvent, render, screen, act } from '@testing-library/react';
import { Provider as JotaiProvider, useSetAtom } from 'jotai';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { pendingDeleteUndoAtom, type PendingDeleteUndo } from '../../mail-state.js';
import { DeleteToast, DELETE_UNDO_MS } from '../delete-toast.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function WithPending({ value }: { value: PendingDeleteUndo | null }) {
  const set = useSetAtom(pendingDeleteUndoAtom);
  useEffect(() => {
    set(value);
  }, [set, value]);
  return null;
}

function renderToast(value: PendingDeleteUndo | null, onUndo = vi.fn()) {
  render(
    <JotaiProvider>
      <WithPending value={value} />
      <DeleteToast onUndo={onUndo} />
    </JotaiProvider>,
  );
  return { onUndo };
}

describe('DeleteToast', () => {
  it('renders nothing when there is no pending delete', () => {
    renderToast(null);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows a singular message + Undo when one message was deleted', () => {
    renderToast({ seq: 7, count: 1, createdAtMs: 0 });
    expect(screen.getByText(/message moved to trash/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /undo/i })).toBeInTheDocument();
  });

  it('pluralizes the label when several messages were deleted', () => {
    renderToast({ seq: 7, count: 3, createdAtMs: 0 });
    expect(screen.getByText(/3 messages moved to trash/i)).toBeInTheDocument();
  });

  it('calls onUndo with the seq and dismisses when Undo is clicked', () => {
    const { onUndo } = renderToast({ seq: 42, count: 1, createdAtMs: 0 });
    fireEvent.click(screen.getByRole('button', { name: /undo/i }));
    expect(onUndo).toHaveBeenCalledWith(42);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('auto-dismisses after DELETE_UNDO_MS without calling onUndo', () => {
    vi.useFakeTimers();
    const onUndo = vi.fn();
    render(
      <JotaiProvider>
        <WithPending value={{ seq: 1, count: 1, createdAtMs: 0 }} />
        <DeleteToast onUndo={onUndo} />
      </JotaiProvider>,
    );
    expect(screen.getByRole('status')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(DELETE_UNDO_MS + 10);
    });
    expect(screen.queryByRole('status')).toBeNull();
    expect(onUndo).not.toHaveBeenCalled();
  });
});
