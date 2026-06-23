/**
 * @vitest-environment jsdom
 *
 * Tests for CreateLabelDialog, RenameLabelDialog, RecolorLabelDialog,
 * and DeleteLabelDialog (Task 11).
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CreateLabelDialog,
  DeleteLabelDialog,
  RecolorLabelDialog,
  RenameLabelDialog,
} from '../label-dialogs.js';

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

// ── CreateLabelDialog ────────────────────────────────────────────────

describe('CreateLabelDialog', () => {
  it('calls onSubmit with name and default color when submitted', () => {
    const onSubmit = vi.fn();
    render(<CreateLabelDialog open onClose={() => {}} onSubmit={onSubmit} />);
    const input = screen.getByLabelText(/label name/i);
    fireEvent.change(input, { target: { value: 'Work' } });
    fireEvent.click(screen.getByRole('button', { name: /create/i }));
    expect(onSubmit).toHaveBeenCalledOnce();
    // Default color is #ff6b35 (orange)
    expect(onSubmit).toHaveBeenCalledWith('Work', '#ff6b35');
  });

  it('calls onSubmit with chosen color when a palette swatch is selected', () => {
    const onSubmit = vi.fn();
    render(<CreateLabelDialog open onClose={() => {}} onSubmit={onSubmit} />);
    const input = screen.getByLabelText(/label name/i);
    fireEvent.change(input, { target: { value: 'Personal' } });
    // Click the blue swatch
    fireEvent.click(screen.getByRole('button', { name: /color #3b82f6/i }));
    fireEvent.click(screen.getByRole('button', { name: /create/i }));
    expect(onSubmit).toHaveBeenCalledWith('Personal', '#3b82f6');
  });

  it('Submit button is disabled when name is empty', () => {
    render(<CreateLabelDialog open onClose={() => {}} onSubmit={vi.fn()} />);
    expect(screen.getByRole('button', { name: /create/i })).toBeDisabled();
  });

  it('renders an error message inline when error prop is provided', () => {
    render(
      <CreateLabelDialog
        open
        onClose={() => {}}
        onSubmit={vi.fn()}
        error="A label named 'Work' already exists."
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent("A label named 'Work' already exists.");
  });

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn();
    render(<CreateLabelDialog open onClose={onClose} onSubmit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('resets name to empty when dialog reopens', () => {
    const { rerender } = render(
      <CreateLabelDialog open onClose={() => {}} onSubmit={vi.fn()} />,
    );
    const input = screen.getByLabelText(/label name/i);
    fireEvent.change(input, { target: { value: 'Test' } });
    // Close and reopen
    rerender(<CreateLabelDialog open={false} onClose={() => {}} onSubmit={vi.fn()} />);
    rerender(<CreateLabelDialog open onClose={() => {}} onSubmit={vi.fn()} />);
    expect(screen.getByLabelText(/label name/i)).toHaveValue('');
  });
});

// ── RenameLabelDialog ────────────────────────────────────────────────

describe('RenameLabelDialog', () => {
  it('prefills the input with the current name', () => {
    render(
      <RenameLabelDialog
        open
        onClose={() => {}}
        onSubmit={vi.fn()}
        currentName="Work"
      />,
    );
    expect(screen.getByLabelText(/new name/i)).toHaveValue('Work');
  });

  it('calls onSubmit with the new name', () => {
    const onSubmit = vi.fn();
    render(
      <RenameLabelDialog
        open
        onClose={() => {}}
        onSubmit={onSubmit}
        currentName="Work"
      />,
    );
    const input = screen.getByLabelText(/new name/i);
    fireEvent.change(input, { target: { value: 'Work 2025' } });
    fireEvent.click(screen.getByRole('button', { name: /rename/i }));
    expect(onSubmit).toHaveBeenCalledWith('Work 2025');
  });

  it('renders an error message inline when error prop is provided', () => {
    render(
      <RenameLabelDialog
        open
        onClose={() => {}}
        onSubmit={vi.fn()}
        currentName="Work"
        error="Name already taken."
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Name already taken.');
  });

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn();
    render(
      <RenameLabelDialog
        open
        onClose={onClose}
        onSubmit={vi.fn()}
        currentName="Work"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

// ── RecolorLabelDialog ────────────────────────────────────────────────

describe('RecolorLabelDialog', () => {
  it('calls onSubmit with the selected color', () => {
    const onSubmit = vi.fn();
    render(
      <RecolorLabelDialog
        open
        onClose={() => {}}
        onSubmit={onSubmit}
        currentColor="#ff6b35"
      />,
    );
    // Select blue
    fireEvent.click(screen.getByRole('button', { name: /color #3b82f6/i }));
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(onSubmit).toHaveBeenCalledWith('#3b82f6');
  });

  it('preselects the currentColor swatch (aria-pressed=true)', () => {
    render(
      <RecolorLabelDialog
        open
        onClose={() => {}}
        onSubmit={vi.fn()}
        currentColor="#3b82f6"
      />,
    );
    const blueBtn = screen.getByRole('button', { name: /color #3b82f6/i });
    expect(blueBtn).toHaveAttribute('aria-pressed', 'true');
  });

  it('renders an error message inline when error prop is provided', () => {
    render(
      <RecolorLabelDialog
        open
        onClose={() => {}}
        onSubmit={vi.fn()}
        currentColor="#ff6b35"
        error="Failed to update color."
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to update color.');
  });

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn();
    render(
      <RecolorLabelDialog
        open
        onClose={onClose}
        onSubmit={vi.fn()}
        currentColor="#ff6b35"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

// ── DeleteLabelDialog ────────────────────────────────────────────────

describe('DeleteLabelDialog', () => {
  it('shows the affected message count in the confirmation text', () => {
    render(
      <DeleteLabelDialog
        open
        onClose={() => {}}
        onConfirm={vi.fn()}
        affectedCount={5}
      />,
    );
    expect(
      screen.getByText(/this will remove the label from 5 message\(s\)\./i),
    ).toBeInTheDocument();
  });

  it('shows "0 message(s)" when there are no affected messages', () => {
    render(
      <DeleteLabelDialog
        open
        onClose={() => {}}
        onConfirm={vi.fn()}
        affectedCount={0}
      />,
    );
    expect(
      screen.getByText(/this will remove the label from 0 message\(s\)\./i),
    ).toBeInTheDocument();
  });

  it('calls onConfirm when Delete button is clicked', () => {
    const onConfirm = vi.fn();
    render(
      <DeleteLabelDialog
        open
        onClose={() => {}}
        onConfirm={onConfirm}
        affectedCount={3}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn();
    render(
      <DeleteLabelDialog
        open
        onClose={onClose}
        onConfirm={vi.fn()}
        affectedCount={0}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders an error message inline when error prop is provided', () => {
    render(
      <DeleteLabelDialog
        open
        onClose={() => {}}
        onConfirm={vi.fn()}
        affectedCount={0}
        error="Cannot delete: label is in use."
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Cannot delete: label is in use.');
  });
});
