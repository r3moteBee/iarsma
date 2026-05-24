/**
 * Theme preference atom and resolver (Phase 4 responsive layout).
 *
 * The user's preference is stored as `'light' | 'dark' | 'system'`.
 * `resolveTheme` maps the preference to an actual light/dark value by
 * consulting `window.matchMedia('(prefers-color-scheme: dark)')` when
 * the preference is `'system'`.
 *
 * The atom is intentionally in-memory (not persisted) for now.
 * Persistence can be layered with `atomWithStorage` later.
 */

import { atom } from 'jotai';

export type ThemePreference = 'light' | 'dark' | 'system';

export const themePreferenceAtom = atom<ThemePreference>('system');

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
