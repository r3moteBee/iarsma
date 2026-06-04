/**
 * Calendar visibility — hidden-calendar set, persisted to localStorage.
 *
 * The visibility rail (§8.4) lets the user toggle which calendars
 * show in the month/week/day views. We persist the *hidden* set
 * rather than the *visible* set so newly-created calendars on the
 * server are visible by default — the user opted into hiding the
 * ones they want hidden, not into showing future calendars.
 */

import { atom } from 'jotai';

const STORAGE_KEY = 'iarsma-calendar-hidden';

function loadHidden(): readonly string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    return [];
  }
}

function persistHidden(ids: readonly string[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Quota / private mode — non-fatal.
  }
}

const hiddenBaseAtom = atom<readonly string[]>(loadHidden());

/**
 * Public derived atom: read returns the readonly id list, write
 * accepts the same shape and persists. Components typically don't
 * write the whole list — they call `toggleCalendarVisibility(atomSet, id)`
 * instead. Exposed as an atom rather than a hook so consumers stay
 * uniform with the rest of the shell's state.
 */
export const hiddenCalendarIdsAtom = atom(
  (get) => get(hiddenBaseAtom),
  (_get, set, next: readonly string[]) => {
    set(hiddenBaseAtom, next);
    persistHidden(next);
  },
);

export function toggleCalendarId(
  hidden: readonly string[],
  id: string,
): readonly string[] {
  if (hidden.includes(id)) return hidden.filter((x) => x !== id);
  return [...hidden, id];
}
