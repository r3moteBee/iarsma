/**
 * LabelChip — a small colored pill that represents a single label.
 *
 * Renders a color dot + the label name. The color is applied via
 * inline style because it is dynamic (stored per-label, not a CSS
 * design-token). Follows the same token/pattern conventions as
 * badge.tsx and the other small component utilities.
 */

import type { LabelDef } from '../runtime/label-registry.js';
import styles from './label-chip.module.css';

type LabelChipProps = {
  readonly label: LabelDef;
};

export function LabelChip({ label }: LabelChipProps) {
  return (
    <span
      className={styles['chip']}
      style={{ borderColor: label.color, color: label.color }}
      aria-label={label.name}
    >
      <span
        className={styles['dot']}
        style={{ background: label.color }}
        aria-hidden="true"
      />
      <span className={styles['name']}>{label.name}</span>
    </span>
  );
}
