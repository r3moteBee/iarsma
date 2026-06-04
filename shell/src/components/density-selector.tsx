/**
 * DensitySelector — 3-way segmented control (§5.3).
 *
 * Dense / Normal / Spacious. Writes the chosen value to densityAtom;
 * the runtime layer (`runtime/appearance.ts`) applies the corresponding
 * `--density` multiplier to document.documentElement.
 *
 * Visuals + a11y are owned by the shared SegmentedControl (§12); this
 * component is now just a thin atom-binding wrapper.
 */

import { useAtom } from 'jotai';
import { densityAtom, type Density } from '../runtime/appearance.js';
import { SegmentedControl, type SegmentedOption } from './segmented-control.js';

const OPTIONS: ReadonlyArray<SegmentedOption<Density>> = [
  { value: 'dense', label: 'Dense' },
  { value: 'normal', label: 'Normal' },
  { value: 'spacious', label: 'Spacious' },
];

export function DensitySelector() {
  const [current, setCurrent] = useAtom(densityAtom);
  return (
    <SegmentedControl
      label="Density"
      options={OPTIONS}
      value={current}
      onChange={setCurrent}
      size="sm"
    />
  );
}
