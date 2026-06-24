import { useEffect, useState } from 'react';
import { Dialog } from './dialog.js';
import { Input } from './input.js';
import { ColorPalette, DEFAULT_LABEL_COLOR } from './color-palette.js';

// ── DeleteCalendarDialog ─────────────────────────────────────────────

export type DeleteCalendarDialogProps = {
  readonly open: boolean;
  readonly calendarName: string;
  readonly mode: 'light' | 'typed';
  readonly onClose: () => void;
  readonly onConfirm: () => void;
  readonly error?: string;
};

export function DeleteCalendarDialog({
  open,
  calendarName,
  mode,
  onClose,
  onConfirm,
  error,
}: DeleteCalendarDialogProps) {
  const [typed, setTyped] = useState('');

  // Reset typed field each time the dialog opens.
  useEffect(() => {
    if (open) {
      setTyped('');
    }
  }, [open]);

  const confirmDisabled = mode === 'typed' && typed !== 'DELETE';

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Delete calendar"
      footer={
        <>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirmDisabled}
          >
            Delete
          </button>
        </>
      }
    >
      {mode === 'light' ? (
        <p style={{ margin: '0 0 var(--space-sm)' }}>
          {`Delete "${calendarName}"?`}
        </p>
      ) : (
        <>
          <p style={{ margin: '0 0 var(--space-sm)' }}>
            All events in <strong>{calendarName}</strong> will be permanently
            removed. Type <strong>DELETE</strong> to confirm.
          </p>
          <Input
            label="Type DELETE to confirm"
            value={typed}
            onChange={setTyped}
            placeholder="DELETE"
          />
        </>
      )}
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

// ── CalendarDialog ───────────────────────────────────────────────────

export type CalendarDialogProps = {
  readonly open: boolean;
  readonly mode: 'create' | 'edit';
  readonly initialName?: string;
  readonly initialColor?: string;
  readonly onClose: () => void;
  readonly onSubmit: (name: string, color: string) => void;
  readonly error?: string;
};

export function CalendarDialog({
  open,
  mode,
  initialName,
  initialColor,
  onClose,
  onSubmit,
  error,
}: CalendarDialogProps) {
  const [name, setName] = useState(initialName ?? '');
  const [color, setColor] = useState(initialColor ?? DEFAULT_LABEL_COLOR);

  // Reset state from initialName/initialColor each time the dialog opens.
  useEffect(() => {
    if (open) {
      setName(initialName ?? '');
      setColor(initialColor ?? DEFAULT_LABEL_COLOR);
    }
  }, [open, initialName, initialColor]);

  function handleSubmit() {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    onSubmit(trimmed, color);
  }

  const title = mode === 'create' ? 'New calendar' : 'Edit calendar';
  const submitLabel = mode === 'create' ? 'Create' : 'Save';

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
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
            {submitLabel}
          </button>
        </>
      }
    >
      <Input
        label="Calendar name"
        value={name}
        onChange={setName}
        placeholder="e.g. Personal"
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
