import styles from './avatar.module.css';

type AvatarProps = {
  readonly name: string;
  readonly size?: 'sm' | 'md' | 'lg';
  readonly className?: string;
};

/**
 * Deterministic hash of a string to a hue angle (0-359).
 * Produces a consistent avatar color per name.
 */
function nameToHue(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    // eslint-disable-next-line no-bitwise
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || parts[0] === '') return '?';
  if (parts.length === 1) return (parts[0]?.[0] ?? '?').toUpperCase();
  return `${(parts[0]?.[0] ?? '').toUpperCase()}${(parts[parts.length - 1]?.[0] ?? '').toUpperCase()}`;
}

export function Avatar({
  name,
  size = 'md',
  className,
}: AvatarProps) {
  const hue = nameToHue(name);
  const classes = [styles['root'], styles[size], className]
    .filter(Boolean)
    .join(' ');

  return (
    <span
      className={classes}
      style={{ backgroundColor: `hsl(${String(hue)} 55% 45%)` }}
      aria-label={name}
      role="img"
    >
      {getInitials(name)}
    </span>
  );
}
