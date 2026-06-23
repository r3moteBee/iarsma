/**
 * @vitest-environment jsdom
 *
 * Tests for CreateFolderDialog, RenameFolderDialog, and DeleteFolderDialog
 * (Task 6).
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CreateFolderDialog,
  DeleteFolderDialog,
  RenameFolderDialog,
} from '../folder-dialogs.js';

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

// ── CreateFolderDialog ───────────────────────────────────────────────

describe('CreateFolderDialog', () => {
  it('calls onSubmit with the entered name', () => {
    const onSubmit = vi.fn();
    render(
      <CreateFolderDialog open onClose={() => {}} onSubmit={onSubmit} />,
    );
    const input = screen.getByLabelText(/folder name/i);
    fireEvent.change(input, { target: { value: 'My Folder' } });
    fireEvent.click(screen.getByRole('button', { name: /create/i }));
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledWith('My Folder', undefined);
  });

  it('calls onSubmit with parentId when provided', () => {
    const onSubmit = vi.fn();
    render(
      <CreateFolderDialog
        open
        onClose={() => {}}
        onSubmit={onSubmit}
        parentId="mbox-123"
        parentName="Inbox"
      />,
    );
    fireEvent.change(screen.getByLabelText(/folder name/i), { target: { value: 'Sub' } });
    fireEvent.click(screen.getByRole('button', { name: /create/i }));
    expect(onSubmit).toHaveBeenCalledWith('Sub', 'mbox-123');
  });

  it('shows the parent name when provided', () => {
    render(
      <CreateFolderDialog
        open
        onClose={() => {}}
        onSubmit={vi.fn()}
        parentName="Inbox"
      />,
    );
    expect(screen.getByText(/inbox/i)).toBeInTheDocument();
  });

  it('does not call onSubmit when name is empty', () => {
    const onSubmit = vi.fn();
    render(
      <CreateFolderDialog open onClose={() => {}} onSubmit={onSubmit} />,
    );
    // Create button should be disabled when input is empty
    const createBtn = screen.getByRole('button', { name: /create/i });
    expect(createBtn).toBeDisabled();
    fireEvent.click(createBtn);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('renders an error message inline when error prop is provided', () => {
    render(
      <CreateFolderDialog
        open
        onClose={() => {}}
        onSubmit={vi.fn()}
        error="A folder named 'My Folder' already exists."
      />,
    );
    expect(
      screen.getByRole('alert'),
    ).toHaveTextContent("A folder named 'My Folder' already exists.");
  });

  it('stays open when error prop is present', () => {
    render(
      <CreateFolderDialog
        open
        onClose={() => {}}
        onSubmit={vi.fn()}
        error="Server error"
      />,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn();
    render(
      <CreateFolderDialog open onClose={onClose} onSubmit={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

// ── RenameFolderDialog ───────────────────────────────────────────────

describe('RenameFolderDialog', () => {
  it('prefills the input with the current name', () => {
    render(
      <RenameFolderDialog
        open
        onClose={() => {}}
        onSubmit={vi.fn()}
        currentName="Projects"
      />,
    );
    const input = screen.getByLabelText(/new name/i);
    expect(input).toHaveValue('Projects');
  });

  it('calls onSubmit with the new name', () => {
    const onSubmit = vi.fn();
    render(
      <RenameFolderDialog
        open
        onClose={() => {}}
        onSubmit={onSubmit}
        currentName="Old Name"
      />,
    );
    const input = screen.getByLabelText(/new name/i);
    fireEvent.change(input, { target: { value: 'New Name' } });
    fireEvent.click(screen.getByRole('button', { name: /rename/i }));
    expect(onSubmit).toHaveBeenCalledWith('New Name');
  });

  it('renders an error message inline when error prop is provided', () => {
    render(
      <RenameFolderDialog
        open
        onClose={() => {}}
        onSubmit={vi.fn()}
        currentName="Projects"
        error="Name already taken."
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Name already taken.');
  });

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn();
    render(
      <RenameFolderDialog
        open
        onClose={onClose}
        onSubmit={vi.fn()}
        currentName="Projects"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

// ── DeleteFolderDialog ───────────────────────────────────────────────

describe('DeleteFolderDialog', () => {
  it('shows the affected message count in the confirmation text', () => {
    render(
      <DeleteFolderDialog
        open
        onClose={() => {}}
        onConfirm={vi.fn()}
        affectedCount={7}
      />,
    );
    expect(screen.getByText(/this will move 7 message\(s\) to trash, then delete the folder/i)).toBeInTheDocument();
  });

  it('shows "0 message(s)" when there are no affected messages', () => {
    render(
      <DeleteFolderDialog
        open
        onClose={() => {}}
        onConfirm={vi.fn()}
        affectedCount={0}
      />,
    );
    expect(screen.getByText(/this will move 0 message\(s\) to trash/i)).toBeInTheDocument();
  });

  it('calls onConfirm when Delete button is clicked', () => {
    const onConfirm = vi.fn();
    render(
      <DeleteFolderDialog
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
      <DeleteFolderDialog
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
      <DeleteFolderDialog
        open
        onClose={() => {}}
        onConfirm={vi.fn()}
        affectedCount={0}
        error="Cannot delete: folder has subfolders."
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Cannot delete: folder has subfolders.');
  });
});
