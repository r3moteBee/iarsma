import styles from './skeleton.module.css';

type SkeletonProps = {
  readonly width?: string;
  readonly height?: string;
  readonly variant?: 'text' | 'circle' | 'rect';
};

export function Skeleton({
  width,
  height,
  variant = 'text',
}: SkeletonProps) {
  const classes = [styles['root'], styles[variant]].join(' ');

  return (
    <div
      className={classes}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}
