/**
 * DensitySelector — 3-way segmented control (§5.3).
 *
 * Dense / Normal / Spacious. Writes the chosen value to densityAtom;
 * the runtime layer (`runtime/appearance.ts`) applies the
 * corresponding `--density` multiplier to document.documentElement.
 *
 * Uses `aria-pressed` (toolbar-button pattern) rather than
 * `role="radio"` because the three options act like a toolbar of
 * pressable buttons — exactly one is active at a time, but each is
 * also independently focusable via Tab. Either pattern is acceptable
 * per WAI-ARIA APG; aria-pressed reads more cleanly with screen
 * readers that don't synthesize roving tabindex.
 */

import { useAtom } from 'jotai';
import { densityAtom, type Density } from '../runtime/appearance.js';
import styles from './density-selector.module.css';

const OPTIONS: ReadonlyArray<{ readonly value: Density; readonly label: string }> = [
  { value: 'dense', label: 'Dense' },
  { value: 'normal', label: 'Normal' },
  { value: 'spacious', label: 'Spacious' },
];

export function DensitySelector() {
  const [current, setCurrent] = useAtom(densityAtom);
  return (
    <div role="group" aria-label="Density" className={styles['group']}>
      {OPTIONS.map((opt) => {
        const isCurrent = opt.value === current;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={isCurrent}
            onClick={() => setCurrent(opt.value)}
            className={styles['option']}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
