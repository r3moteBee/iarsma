/**
 * Appearance preferences — accent color + density.
 *
 * Theme lives in theme.ts and stays where it is. This module owns the
 * two new prefs the UI redesign introduced (§5.2 / §5.3):
 *
 *   • accent — pick of a curated palette ("Ember" / "Amber" / "Sky" /
 *     "Violet" / "Teal" / "Rose"). The picker writes the preset key;
 *     the corresponding `--accent-h/s/l` values are applied to
 *     document.documentElement so the live token chain flows from
 *     them (see styles/tokens.css).
 *
 *   • density — Dense (0.85) / Normal (1) / Spacious (1.25). Maps
 *     to the `--density` multiplier that feeds the 4px spacing grid
 *     and `--row-mail`. Touch-target minimums are NOT scaled
 *     (Button/Input keep their @media pointer:coarse 44px floors).
 *
 * Both prefs persist to localStorage under `iarsma-appearance`. Atoms
 * read the saved value at module load so the very first render is
 * already correct (no flash to default tokens).
 */

import { atom } from 'jotai';

export type AccentPreset = 'ember' | 'amber' | 'sky' | 'violet' | 'teal' | 'rose';

export type AccentDef = {
  readonly id: AccentPreset;
  readonly name: string;
  readonly h: number;
  readonly s: number;
  readonly l: number;
};

export const ACCENT_PRESETS: readonly AccentDef[] = [
  { id: 'ember', name: 'Ember', h: 18, s: 100, l: 60 },
  { id: 'amber', name: 'Amber', h: 38, s: 95, l: 55 },
  { id: 'sky', name: 'Sky', h: 205, s: 90, l: 52 },
  { id: 'violet', name: 'Violet', h: 265, s: 75, l: 62 },
  { id: 'teal', name: 'Teal', h: 175, s: 65, l: 42 },
  { id: 'rose', name: 'Rose', h: 345, s: 80, l: 60 },
];

export const DEFAULT_ACCENT: AccentPreset = 'ember';

export type Density = 'dense' | 'normal' | 'spacious';

export const DENSITY_VALUES: Readonly<Record<Density, number>> = {
  dense: 0.85,
  normal: 1,
  spacious: 1.25,
};

export const DEFAULT_DENSITY: Density = 'normal';

const STORAGE_KEY = 'iarsma-appearance';

type StoredAppearance = {
  readonly accent?: string;
  readonly density?: string;
};

function loadStored(): StoredAppearance {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== 'object') return {};
    return parsed as StoredAppearance;
  } catch {
    return {};
  }
}

function isAccentPreset(v: unknown): v is AccentPreset {
  return typeof v === 'string' && ACCENT_PRESETS.some((p) => p.id === v);
}

function isDensity(v: unknown): v is Density {
  return v === 'dense' || v === 'normal' || v === 'spacious';
}

function persist(accent: AccentPreset, density: Density): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ accent, density }));
  } catch {
    // Quota / private mode — non-fatal.
  }
}

const initial = loadStored();
const initialAccent: AccentPreset = isAccentPreset(initial.accent)
  ? initial.accent
  : DEFAULT_ACCENT;
const initialDensity: Density = isDensity(initial.density)
  ? initial.density
  : DEFAULT_DENSITY;

// Base atoms hold the raw preset values.
const accentBaseAtom = atom<AccentPreset>(initialAccent);
const densityBaseAtom = atom<Density>(initialDensity);

// Public derived atoms — set the value and persist the new pair to
// localStorage. Atoms stay aligned by reading both base atoms on set.
export const accentAtom = atom(
  (get) => get(accentBaseAtom),
  (get, set, next: AccentPreset) => {
    set(accentBaseAtom, next);
    persist(next, get(densityBaseAtom));
  },
);

export const densityAtom = atom(
  (get) => get(densityBaseAtom),
  (get, set, next: Density) => {
    set(densityBaseAtom, next);
    persist(get(accentBaseAtom), next);
  },
);

/**
 * Resolve an accent preset id to its hsl definition. Falls back to
 * Ember if the id doesn't match any preset (defensive — atoms are
 * typed to AccentPreset so this branch is only hit by bad
 * localStorage data).
 */
export function accentDef(id: AccentPreset): AccentDef {
  return ACCENT_PRESETS.find((p) => p.id === id) ?? ACCENT_PRESETS[0]!;
}

/**
 * Apply the current accent + density to a DOM element (typically
 * document.documentElement). Called by the runtime hook that watches
 * the atoms and the live tokens cascade through to every CSS
 * `var(--accent-...)` / `var(--density)` reference.
 */
export function applyAppearance(
  el: HTMLElement,
  accent: AccentPreset,
  density: Density,
): void {
  const def = accentDef(accent);
  el.style.setProperty('--accent-h', String(def.h));
  el.style.setProperty('--accent-s', `${def.s}%`);
  el.style.setProperty('--accent-l', `${def.l}%`);
  el.style.setProperty('--density', String(DENSITY_VALUES[density]));
}
