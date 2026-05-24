import { Button } from './button.js';
import styles from './empty-state.module.css';

type EmptyStateProps = {
  readonly title: string;
  readonly description?: string;
  readonly action?: { readonly label: string; readonly onClick: () => void };
};

export function EmptyState({
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <div className={styles['root']}>
      <p className={styles['title']}>{title}</p>
      {description !== undefined && (
        <p className={styles['description']}>{description}</p>
      )}
      {action !== undefined && (
        <Button variant="secondary" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
