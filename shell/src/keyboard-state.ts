/**
 * Global keyboard help overlay state (Phase 1 work item 10).
 *
 * Keyed by an atom so any component can open it without prop drilling.
 * `App.tsx` wires the window-level `?` key listener that flips it true.
 */

import { atom } from 'jotai';

export const keyboardHelpOpenAtom = atom(false);
