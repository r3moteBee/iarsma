import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import styles from './dialog.module.css';

type DialogProps = {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
};

export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  // Tie the <dialog> to its visible heading so screen readers announce
  // the title as the dialog's accessible name (and tests can query
  // `getByRole('dialog', { name: ... })`).
  const titleId = useId();

  useEffect(() => {
    const el = dialogRef.current;
    if (el === null) return;

    if (open && !el.open) {
      el.showModal();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className={styles['dialog']}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className={styles['header']}>
        <h2 id={titleId} className={styles['title']}>{title}</h2>
        <button
          type="button"
          className={styles['closeButton']}
          onClick={onClose}
          aria-label="Close"
        >
          {'×'}
        </button>
      </div>
      <div className={styles['body']}>{children}</div>
      {footer !== undefined && (
        <div className={styles['footer']}>{footer}</div>
      )}
    </dialog>
  );
}
