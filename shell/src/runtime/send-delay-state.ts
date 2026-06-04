/**
 * Send-delay preference — how long the SendBuffer holds an outgoing
 * mail.send before firing. Persisted to localStorage so the value
 * survives reloads.
 *
 * Default 10s. Range 0–30s (a hard cap so a user-typed value can't
 * accidentally hold mail for hours). 0 = immediate send (no undo
 * window, opt-out path for users who don't want the delay).
 */

import { atom } from 'jotai';

const STORAGE_KEY = 'iarsma-send-delay-ms';
export const DEFAULT_SEND_DELAY_MS = 10_000;
export const MAX_SEND_DELAY_MS = 30_000;

function loadStored(): number {
  if (typeof localStorage === 'undefined') return DEFAULT_SEND_DELAY_MS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_SEND_DELAY_MS;
    const n = Number.parseInt(raw, 10);
    if (Number.isNaN(n)) return DEFAULT_SEND_DELAY_MS;
    return clamp(n);
  } catch {
    return DEFAULT_SEND_DELAY_MS;
  }
}

function persist(ms: number): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, String(ms));
  } catch {
    // Quota / private mode — non-fatal.
  }
}

function clamp(ms: number): number {
  if (ms < 0) return 0;
  if (ms > MAX_SEND_DELAY_MS) return MAX_SEND_DELAY_MS;
  return Math.floor(ms);
}

const baseAtom = atom<number>(loadStored());

/**
 * Public derived atom. Read: current delay in ms. Write: any value is
 * clamped to [0, MAX_SEND_DELAY_MS] and persisted to localStorage.
 */
export const sendDelayMsAtom = atom(
  (get) => get(baseAtom),
  (_get, set, next: number) => {
    const v = clamp(next);
    set(baseAtom, v);
    persist(v);
  },
);
