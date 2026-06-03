/**
 * Notice — shared banner-shaped notification (§8.8).
 *
 * One component for the error / warning / success / info banners
 * that the views were re-implementing inline. The error variant
 * carries `role="alert"` so screen readers announce it immediately;
 * other variants use `role="status"` for a non-interruptive
 * announcement.
 *
 * Field-level inline errors (compose's `fieldError`, Input's `error`
 * prop) are intentionally NOT migrated — those are field-validation
 * messages tied to a specific input, not standalone banners.
 */

import type { ReactNode } from 'react';
import styles from './notice.module.css';

export type NoticeVariant = 'info' | 'error' | 'warning' | 'success';

export type NoticeProps = {
  readonly variant?: NoticeVariant;
  readonly children: ReactNode;
  /** When provided, renders a `×` close button on the right. Caller
   *  owns the visibility state — Notice doesn't disappear by itself. */
  readonly onDismiss?: () => void;
  /** Optional aria-label override. Defaults to the variant name so
   *  the close button still has an accessible name when used. */
  readonly ariaLabel?: string;
  readonly className?: string;
};

export function Notice({
  variant = 'info',
  children,
  onDismiss,
  ariaLabel,
  className,
}: NoticeProps) {
  const classes = [styles['notice'], styles[variant], className]
    .filter(Boolean)
    .join(' ');
  // Errors interrupt; everything else is a status update. Either way,
  // screen readers get an aria-live announcement.
  const role = variant === 'error' ? 'alert' : 'status';
  return (
    <div className={classes} role={role}>
      <div className={styles['body']}>{children}</div>
      {onDismiss !== undefined ? (
        <button
          type="button"
          className={styles['dismiss']}
          onClick={onDismiss}
          aria-label={ariaLabel ?? `Dismiss ${variant}`}
        >
          {'×'}
        </button>
      ) : null}
    </div>
  );
}
