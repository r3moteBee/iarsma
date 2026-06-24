import { DEFAULT_LABEL_COLOR, LABEL_PALETTE } from '../runtime/label-registry.js';

export { DEFAULT_LABEL_COLOR, LABEL_PALETTE };

export function ColorPalette({
  color,
  onColorChange,
  palette = LABEL_PALETTE,
}: {
  readonly color: string;
  readonly onColorChange: (c: string) => void;
  readonly palette?: readonly string[];
}) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 'var(--space-xs)',
        flexWrap: 'wrap',
        margin: 'var(--space-sm) 0 0',
      }}
    >
      {palette.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`Color ${c}`}
          aria-pressed={color === c}
          onClick={() => onColorChange(c)}
          style={{
            width: '24px',
            height: '24px',
            borderRadius: '50%',
            background: c,
            border: color === c ? '3px solid var(--text-1)' : '2px solid transparent',
            cursor: 'pointer',
            padding: 0,
          }}
        />
      ))}
    </div>
  );
}
