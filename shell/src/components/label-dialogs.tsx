import { useEffect, useState } from 'react';
import { Dialog } from './dialog.js';
import { Input } from './input.js';
import { DEFAULT_LABEL_COLOR, LABEL_PALETTE } from '../runtime/label-registry.js';

// ── Color swatch palette ─────────────────────────────────────────────

function ColorPalette({
  color,
  onColorChange,
}: {
  readonly color: string;
  readonly onColorChange: (c: string) => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 'var(--space-xs)',
        flexWrap: 'wrap',
        margin: 'var(--space-sm) 0 0',
      }}
    >
      {LABEL_PALETTE.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`Color ${c}`}
          aria-pressed={color === c}
          onClick={() => onColorChange(c)}
          style={{
            width: '24px',
            height: '24px',
            borderRadius: '50%',
            background: c,
            border: color === c ? '3px solid var(--text-1)' : '2px solid transparent',
            cursor: 'pointer',
            padding: 0,
          }}
        />
      ))}
    </div>
  );
}

// ── CreateLabelDialog ────────────────────────────────────────────────

export type CreateLabelDialogProps = {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onSubmit: (name: string, color: string) => void;
  readonly error?: string;
};

export function CreateLabelDialog({
  open,
  onClose,
  onSubmit,
  error,
}: CreateLabelDialogProps) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(DEFAULT_LABEL_COLOR);

  // Reset name and color each time the dialog opens.
  useEffect(() => {
    if (open) {
      setName('');
      setColor(DEFAULT_LABEL_COLOR);
    }
  }, [open]);

  function handleSubmit() {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    onSubmit(trimmed, color);
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New label"
      footer={
        <>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={name.trim().length === 0}
          >
            Create
          </button>
        </>
      }
    >
      <Input
        label="Label name"
        value={name}
        onChange={setName}
        placeholder="e.g. Work"
      />
      <ColorPalette color={color} onColorChange={setColor} />
      {error !== undefined && (
        <p
          role="alert"
          style={{
            color: 'var(--color-error, #c0392b)',
            margin: 'var(--space-sm) 0 0',
          }}
        >
          {error}
        </p>
      )}
    </Dialog>
  );
}

// ── RenameLabelDialog ────────────────────────────────────────────────

export type RenameLabelDialogProps = {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onSubmit: (newName: string) => void;
  readonly currentName: string;
  readonly error?: string;
};

export function RenameLabelDialog({
  open,
  onClose,
  onSubmit,
  currentName,
  error,
}: RenameLabelDialogProps) {
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
      title="Rename label"
      footer={
        <>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={name.trim().length === 0}
          >
            Rename
          </button>
        </>
      }
    >
      <Input
        label="New name"
        value={name}
        onChange={setName}
        placeholder="Label name"
      />
      {error !== undefined && (
        <p
          role="alert"
          style={{
            color: 'var(--color-error, #c0392b)',
            margin: 'var(--space-sm) 0 0',
          }}
        >
          {error}
        </p>
      )}
    </Dialog>
  );
}

// ── RecolorLabelDialog ────────────────────────────────────────────────

export type RecolorLabelDialogProps = {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onSubmit: (color: string) => void;
  readonly currentColor: string;
  readonly error?: string;
};

export function RecolorLabelDialog({
  open,
  onClose,
  onSubmit,
  currentColor,
  error,
}: RecolorLabelDialogProps) {
  const [color, setColor] = useState(currentColor);

  // Sync color when dialog opens or currentColor changes.
  useEffect(() => {
    if (open) setColor(currentColor);
  }, [open, currentColor]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Change label color"
      footer={
        <>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" onClick={() => onSubmit(color)}>
            Save
          </button>
        </>
      }
    >
      <ColorPalette color={color} onColorChange={setColor} />
      {error !== undefined && (
        <p
          role="alert"
          style={{
            color: 'var(--color-error, #c0392b)',
            margin: 'var(--space-sm) 0 0',
          }}
        >
          {error}
        </p>
      )}
    </Dialog>
  );
}

// ── DeleteLabelDialog ────────────────────────────────────────────────

export type DeleteLabelDialogProps = {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
  readonly affectedCount: number;
  readonly error?: string;
};

export function DeleteLabelDialog({
  open,
  onClose,
  onConfirm,
  affectedCount,
  error,
}: DeleteLabelDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Delete label"
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
        {`This will remove the label from ${affectedCount} message(s).`}
      </p>
      {error !== undefined && (
        <p
          role="alert"
          style={{
            color: 'var(--color-error, #c0392b)',
            margin: 'var(--space-sm) 0 0',
          }}
        >
          {error}
        </p>
      )}
    </Dialog>
  );
}
