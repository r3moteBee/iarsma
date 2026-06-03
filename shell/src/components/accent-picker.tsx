/**
 * AccentPicker — curated color swatches that drive the live accent
 * tokens (§5.2). Renders as a `role="radiogroup"` of 6 buttons,
 * mirrors the theme-toggle pattern next to it in the sidebar footer.
 *
 * The picker is presentational; the actual token application + atom
 * persistence happens in the runtime layer (`runtime/appearance.ts`).
 */

import { useAtom } from 'jotai';
import {
  ACCENT_PRESETS,
  accentAtom,
  accentDef,
  type AccentPreset,
} from '../runtime/appearance.js';
import styles from './accent-picker.module.css';

export function AccentPicker() {
  const [current, setCurrent] = useAtom(accentAtom);
  return (
    <div role="radiogroup" aria-label="Accent color" className={styles['group']}>
      {ACCENT_PRESETS.map((preset) => {
        const def = accentDef(preset.id);
        const swatchColor = `hsl(${def.h} ${def.s}% ${def.l}%)`;
        const isCurrent = preset.id === current;
        return (
          <button
            key={preset.id}
            type="button"
            role="radio"
            aria-checked={isCurrent}
            aria-label={preset.name}
            title={preset.name}
            data-accent={preset.id}
            onClick={() => setCurrent(preset.id as AccentPreset)}
            className={styles['swatch']}
            style={{ ['--sw' as string]: swatchColor }}
          />
        );
      })}
    </div>
  );
}
