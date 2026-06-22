/**
 * "Skip send review" preference (U-10) — when true, sending a message
 * you composed goes straight to the Undo-Send window without the
 * "Send this message?" confirmation dialog. Persisted to localStorage.
 *
 * Default false: the review dialog is the safe, intentional default
 * (it's part of the agent-collaboration design). This only affects sends
 * from the human composer — agent sends are gated server-side by the
 * policy engine and never touch this UI path.
 */

import { atom } from 'jotai';

const STORAGE_KEY = 'iarsma-skip-send-review';

function loadStored(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function persist(v: boolean): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, v ? 'true' : 'false');
  } catch {
    // Quota / private mode — non-fatal.
  }
}

const baseAtom = atom<boolean>(loadStored());

/**
 * Public derived atom. Read: whether to skip the send-review dialog.
 * Write: sets + persists the preference.
 */
export const skipSendReviewAtom = atom(
  (get) => get(baseAtom),
  (_get, set, next: boolean) => {
    set(baseAtom, next);
    persist(next);
  },
);
