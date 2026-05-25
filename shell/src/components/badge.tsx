import type { ReactNode } from 'react';
import styles from './badge.module.css';

type BadgeProps = {
  readonly variant?: 'count' | 'status' | 'scope';
  readonly color?: 'accent' | 'success' | 'warning' | 'destructive' | 'neutral';
  readonly children: ReactNode;
};

export function Badge({
  variant = 'count',
  color = 'accent',
  children,
}: BadgeProps) {
  const classes = [styles['badge'], styles[variant], styles[color]].join(' ');

  if (variant === 'status') {
    return (
      <span className={classes}>
        <span className={styles['dot']} aria-hidden="true" />
        <span>{children}</span>
      </span>
    );
  }

  return <span className={classes}>{children}</span>;
}
