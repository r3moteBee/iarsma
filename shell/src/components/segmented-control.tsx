/**
 * SegmentedControl — shared 2-N-way pressable-button group (§12).
 *
 * Replaces the hand-rolled radiogroups: density (Dense/Normal/Spacious),
 * mail layout (Side/Stacked), calendar view (Month/Week/Day), approval
 * tabs, and others as they migrate.
 *
 * Pattern: WAI-ARIA's "toolbar with buttons + aria-pressed" rather than
 * `role="radio"`, because each option is independently focusable via
 * Tab and the screen-reader announcement reads more cleanly without a
 * roving-tabindex implementation. The component owns the visual styling
 * (segmented pill bar) and the keyboard activation contract (Enter /
 * Space) — consumers only supply the option list and the active value.
 *
 * Generic over the option-value type so the same component carries
 * any closed union (e.g. `'dense' | 'normal' | 'spacious'`).
 */

import type { ReactNode } from 'react';
import styles from './segmented-control.module.css';

export type SegmentedOption<T extends string> = {
  readonly value: T;
  readonly label: string;
  /** Optional rich body (e.g. an SVG icon) rendered in place of the
   *  text label. `label` stays the accessible name. */
  readonly icon?: ReactNode;
  /** Optional richer accessible name (defaults to label). */
  readonly ariaLabel?: string;
  /** Disable a specific option (e.g. when unavailable in the current
   *  context). The control as a whole has no disabled mode — that's
   *  the consumer's responsibility. */
  readonly disabled?: boolean;
};

type SegmentedControlProps<T extends string> = {
  readonly options: ReadonlyArray<SegmentedOption<T>>;
  readonly value: T;
  readonly onChange: (next: T) => void;
  /** aria-label for the group as a whole — used by screen readers. */
  readonly label: string;
  /** Size token — default 'md'. 'sm' matches sidebar density. */
  readonly size?: 'sm' | 'md';
  readonly className?: string;
};

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  size = 'md',
  className,
}: SegmentedControlProps<T>) {
  const groupClass = [styles['group'], styles[size], className]
    .filter(Boolean)
    .join(' ');
  return (
    <div role="group" aria-label={label} className={groupClass}>
      {options.map((opt) => {
        const isCurrent = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={isCurrent}
            aria-label={opt.ariaLabel ?? opt.label}
            title={opt.icon !== undefined ? opt.label : undefined}
            disabled={opt.disabled}
            onClick={() => onChange(opt.value)}
            className={styles['option']}
          >
            {opt.icon ?? opt.label}
          </button>
        );
      })}
    </div>
  );
}
