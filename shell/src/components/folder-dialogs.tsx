import { useEffect, useState } from 'react';
import { Dialog } from './dialog.js';
import { Input } from './input.js';

// ── CreateFolderDialog ────────────────────────────────────────────────────────

export type CreateFolderDialogProps = {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onSubmit: (name: string, parentId?: string) => void;
  readonly parentId?: string;
  readonly parentName?: string;
  readonly error?: string;
};

export function CreateFolderDialog({
  open,
  onClose,
  onSubmit,
  parentId,
  parentName,
  error,
}: CreateFolderDialogProps) {
  const [name, setName] = useState('');

  // Reset name each time the dialog opens.
  useEffect(() => {
    if (open) setName('');
  }, [open]);

  function handleSubmit() {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    onSubmit(trimmed, parentId);
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New folder"
      footer={
        <>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" onClick={handleSubmit} disabled={name.trim().length === 0}>
            Create
          </button>
        </>
      }
    >
      {parentName !== undefined && (
        <p style={{ margin: '0 0 var(--space-sm)' }}>
          Under: <strong>{parentName}</strong>
        </p>
      )}
      <Input
        label="Folder name"
        value={name}
        onChange={setName}
        placeholder="e.g. Projects"
      />
      {error !== undefined && (
        <p role="alert" style={{ color: 'var(--color-error, #c0392b)', margin: 'var(--space-sm) 0 0' }}>
          {error}
        </p>
      )}
    </Dialog>
  );
}

// ── RenameFolderDialog ────────────────────────────────────────────────────────

export type RenameFolderDialogProps = {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onSubmit: (newName: string) => void;
  readonly currentName: string;
  readonly error?: string;
};

export function RenameFolderDialog({
  open,
  onClose,
  onSubmit,
  currentName,
  error,
}: RenameFolderDialogProps) {
  const [name, setName] = useState(currentName);

  // Prefill whenever dialog opens or currentName changes.
  useEffect(() => {
    if (open) setName(currentName);
  }, [open, currentName]);

  function handleSubmit() {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    onSubmit(trimmed);
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Rename folder"
      footer={
        <>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" onClick={handleSubmit} disabled={name.trim().length === 0}>
            Rename
          </button>
        </>
      }
    >
      <Input
        label="New name"
        value={name}
        onChange={setName}
        placeholder="Folder name"
      />
      {error !== undefined && (
        <p role="alert" style={{ color: 'var(--color-error, #c0392b)', margin: 'var(--space-sm) 0 0' }}>
          {error}
        </p>
      )}
    </Dialog>
  );
}

// ── DeleteFolderDialog ────────────────────────────────────────────────────────

export type DeleteFolderDialogProps = {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
  readonly affectedCount: number;
  readonly error?: string;
};

export function DeleteFolderDialog({
  open,
  onClose,
  onConfirm,
  affectedCount,
  error,
}: DeleteFolderDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Delete folder"
      footer={
        <>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm}>
            Delete
          </button>
        </>
      }
    >
      <p style={{ margin: '0 0 var(--space-sm)' }}>
        {`This will move ${affectedCount} message(s) to Trash, then delete the folder.`}
      </p>
      {error !== undefined && (
        <p role="alert" style={{ color: 'var(--color-error, #c0392b)', margin: 'var(--space-sm) 0 0' }}>
          {error}
        </p>
      )}
    </Dialog>
  );
}
