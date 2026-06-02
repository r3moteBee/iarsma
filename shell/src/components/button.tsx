import type { ReactNode } from 'react';
import styles from './button.module.css';

type ButtonProps = {
  readonly variant?: 'primary' | 'secondary' | 'ghost' | 'destructive';
  readonly size?: 'sm' | 'md' | 'lg';
  readonly children: ReactNode;
  readonly disabled?: boolean;
  readonly type?: 'button' | 'submit';
  /** Submit-button form association — lets a submit button trigger a
   *  form that isn't its ancestor (e.g. ComposeView puts the Send
   *  button in the Dialog footer slot while the form lives in the
   *  body). */
  readonly form?: string;
  readonly onClick?: () => void;
  readonly className?: string;
  readonly 'aria-label'?: string;
};

export function Button({
  variant = 'primary',
  size = 'md',
  children,
  disabled,
  type = 'button',
  form,
  onClick,
  className,
  'aria-label': ariaLabel,
}: ButtonProps) {
  const classes = [styles['root'], styles[variant], styles[size], className]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type={type}
      form={form}
      className={classes}
      disabled={disabled}
      onClick={onClick}
      aria-label={ariaLabel}
    >
      {children}
    </button>
  );
}
