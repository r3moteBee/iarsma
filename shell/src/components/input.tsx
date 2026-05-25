import { useId } from 'react';
import styles from './input.module.css';

type InputProps = {
  readonly label?: string;
  readonly error?: string;
  readonly type?: 'text' | 'search' | 'email' | 'password';
  readonly placeholder?: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly id?: string;
  readonly className?: string;
};

export function Input({
  label,
  error,
  type = 'text',
  placeholder,
  value,
  onChange,
  id: externalId,
  className,
}: InputProps) {
  const generatedId = useId();
  const inputId = externalId ?? generatedId;
  const errorId = `${inputId}-error`;

  const wrapperClasses = [styles['wrapper'], className]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={wrapperClasses}>
      {label !== undefined && (
        <label className={styles['label']} htmlFor={inputId}>
          {label}
        </label>
      )}
      <input
        id={inputId}
        type={type}
        className={styles['input']}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error !== undefined ? 'true' : undefined}
        aria-describedby={error !== undefined ? errorId : undefined}
      />
      {error !== undefined && (
        <span id={errorId} className={styles['error']} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
