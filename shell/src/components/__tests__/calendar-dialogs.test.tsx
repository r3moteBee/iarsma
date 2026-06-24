/**
 * @vitest-environment jsdom
 *
 * Tests for CalendarDialog (create/edit modes) — Task 7.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CalendarDialog } from '../calendar-dialogs.js';

// jsdom does not implement HTMLDialogElement.showModal() natively.
beforeEach(() => {
  HTMLDialogElement.prototype.showModal ??= vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close ??= vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

afterEach(cleanup);

// ── create mode ──────────────────────────────────────────────────────

describe('CalendarDialog — create mode', () => {
  it('renders "New calendar" title and "Create" button', () => {
    render(
      <CalendarDialog open mode="create" onClose={() => {}} onSubmit={vi.fn()} />,
    );
    expect(screen.getByText('New calendar')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create/i })).toBeInTheDocument();
  });

  it('renders with empty name input', () => {
    render(
      <CalendarDialog open mode="create" onClose={() => {}} onSubmit={vi.fn()} />,
    );
    expect(screen.getByLabelText(/calendar name/i)).toHaveValue('');
  });

  it('renders a ColorPalette (color swatches present)', () => {
    render(
      <CalendarDialog open mode="create" onClose={() => {}} onSubmit={vi.fn()} />,
    );
    // At least one color swatch button should be present
    const swatches = screen.getAllByRole('button', { name: /color #/i });
    expect(swatches.length).toBeGreaterThan(0);
  });

  it('submit button is disabled when name is empty', () => {
    render(
      <CalendarDialog open mode="create" onClose={() => {}} onSubmit={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: /create/i })).toBeDisabled();
  });

  it('calls onSubmit with name and default color when submitted', () => {
    const onSubmit = vi.fn();
    render(
      <CalendarDialog open mode="create" onClose={() => {}} onSubmit={onSubmit} />,
    );
    fireEvent.change(screen.getByLabelText(/calendar name/i), {
      target: { value: 'Work' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create/i }));
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledWith('Work', '#ff6b35');
  });

  it('calls onSubmit with chosen color when a palette swatch is selected', () => {
    const onSubmit = vi.fn();
    render(
      <CalendarDialog open mode="create" onClose={() => {}} onSubmit={onSubmit} />,
    );
    fireEvent.change(screen.getByLabelText(/calendar name/i), {
      target: { value: 'Personal' },
    });
    fireEvent.click(screen.getByRole('button', { name: /color #3b82f6/i }));
    fireEvent.click(screen.getByRole('button', { name: /create/i }));
    expect(onSubmit).toHaveBeenCalledWith('Personal', '#3b82f6');
  });

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn();
    render(
      <CalendarDialog open mode="create" onClose={onClose} onSubmit={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders an error message inline when error prop is provided', () => {
    render(
      <CalendarDialog
        open
        mode="create"
        onClose={() => {}}
        onSubmit={vi.fn()}
        error="A calendar named 'Work' already exists."
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      "A calendar named 'Work' already exists.",
    );
  });

  it('resets name to empty when dialog reopens', () => {
    const { rerender } = render(
      <CalendarDialog open mode="create" onClose={() => {}} onSubmit={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText(/calendar name/i), {
      target: { value: 'Test' },
    });
    rerender(
      <CalendarDialog open={false} mode="create" onClose={() => {}} onSubmit={vi.fn()} />,
    );
    rerender(
      <CalendarDialog open mode="create" onClose={() => {}} onSubmit={vi.fn()} />,
    );
    expect(screen.getByLabelText(/calendar name/i)).toHaveValue('');
  });
});

// ── edit mode ────────────────────────────────────────────────────────

describe('CalendarDialog — edit mode', () => {
  it('renders "Edit calendar" title and "Save" button', () => {
    render(
      <CalendarDialog
        open
        mode="edit"
        initialName="Work"
        initialColor="#3b82f6"
        onClose={() => {}}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByText('Edit calendar')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
  });

  it('prefills initialName in the input', () => {
    render(
      <CalendarDialog
        open
        mode="edit"
        initialName="Work"
        initialColor="#3b82f6"
        onClose={() => {}}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/calendar name/i)).toHaveValue('Work');
  });

  it('preselects initialColor swatch (aria-pressed=true)', () => {
    render(
      <CalendarDialog
        open
        mode="edit"
        initialName="Work"
        initialColor="#3b82f6"
        onClose={() => {}}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /color #3b82f6/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('calls onSubmit with updated name and color', () => {
    const onSubmit = vi.fn();
    render(
      <CalendarDialog
        open
        mode="edit"
        initialName="Work"
        initialColor="#3b82f6"
        onClose={() => {}}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.change(screen.getByLabelText(/calendar name/i), {
      target: { value: 'Work 2025' },
    });
    fireEvent.click(screen.getByRole('button', { name: /color #ec4899/i }));
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(onSubmit).toHaveBeenCalledWith('Work 2025', '#ec4899');
  });

  it('resets to initialName/initialColor when reopened', () => {
    const { rerender } = render(
      <CalendarDialog
        open
        mode="edit"
        initialName="Work"
        initialColor="#3b82f6"
        onClose={() => {}}
        onSubmit={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText(/calendar name/i), {
      target: { value: 'Changed' },
    });
    rerender(
      <CalendarDialog
        open={false}
        mode="edit"
        initialName="Work"
        initialColor="#3b82f6"
        onClose={() => {}}
        onSubmit={vi.fn()}
      />,
    );
    rerender(
      <CalendarDialog
        open
        mode="edit"
        initialName="Work"
        initialColor="#3b82f6"
        onClose={() => {}}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/calendar name/i)).toHaveValue('Work');
  });
});
