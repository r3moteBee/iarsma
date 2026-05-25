import type { ReactNode } from 'react';
import styles from './card.module.css';

type CardProps = {
  readonly children: ReactNode;
  readonly className?: string;
  readonly onClick?: () => void;
  readonly role?: string;
};

export function Card({
  children,
  className,
  onClick,
  role,
}: CardProps) {
  const isClickable = onClick !== undefined;
  const classes = [
    styles['root'],
    isClickable ? styles['clickable'] : undefined,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={classes}
      onClick={onClick}
      onKeyDown={
        isClickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      role={role ?? (isClickable ? 'button' : undefined)}
      tabIndex={isClickable ? 0 : undefined}
    >
      {children}
    </div>
  );
}
