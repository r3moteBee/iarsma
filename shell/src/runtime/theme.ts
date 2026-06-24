/**
 * Theme preference atom and resolver (Phase 4 responsive layout).
 *
 * The user's preference is stored as `'light' | 'dark' | 'system'`.
 * `resolveTheme` maps the preference to an actual light/dark value by
 * consulting `window.matchMedia('(prefers-color-scheme: dark)')` when
 * the preference is `'system'`.
 *
 * The preference persists to localStorage under `iarsma-theme-preference`
 * (mirrors the accent/density persistence in appearance.ts). The atom
 * reads the saved value at module load so the first render is already
 * correct, and an inline boot script in index.html paints the right
 * theme before React mounts (no flash-of-unstyled-content).
 */

import { atom } from 'jotai';

export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'iarsma-theme-preference';

const DEFAULT_PREFERENCE: ThemePreference = 'system';

function isThemePreference(v: unknown): v is ThemePreference {
  return v === 'light' || v === 'dark' || v === 'system';
}

/**
 * Read the persisted theme preference from localStorage. Returns
 * `'system'` when the key is absent, the JSON is corrupt, the stored
 * value is not a valid preference, or localStorage is unavailable
 * (non-browser / private mode).
 */
export function loadStored(): ThemePreference {
  if (typeof localStorage === 'undefined') return DEFAULT_PREFERENCE;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_PREFERENCE;
    const parsed = JSON.parse(raw) as unknown;
    return isThemePreference(parsed) ? parsed : DEFAULT_PREFERENCE;
  } catch {
    return DEFAULT_PREFERENCE;
  }
}

/**
 * Persist a theme preference to localStorage as a JSON string.
 * No-op (non-fatal) when localStorage is unavailable.
 */
export function persist(pref: ThemePreference): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pref));
  } catch {
    // Quota / private mode — non-fatal.
  }
}

// Base atom holds the raw preference, initialized from storage.
const preferenceBaseAtom = atom<ThemePreference>(loadStored());

/**
 * Public theme-preference atom. Reads the current preference; writing
 * sets the base atom AND persists the new value so the pick survives a
 * reload. Public shape (writable atom of `ThemePreference`) is
 * unchanged from the prior in-memory atom.
 */
export const themePreferenceAtom = atom(
  (get) => get(preferenceBaseAtom),
  (_get, set, next: ThemePreference) => {
    set(preferenceBaseAtom, next);
    persist(next);
  },
);

/**
 * Resolve a theme preference to a concrete `'light' | 'dark'` value.
 * When `preference` is `'system'`, consults the OS-level dark mode
 * media query. Falls back to `'light'` in non-browser environments.
 */
export function resolveTheme(preference: ThemePreference): 'light' | 'dark' {
  if (preference !== 'system') return preference;
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
