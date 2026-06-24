/**
 * @vitest-environment jsdom
 *
 * Theme preference persistence (issue #2).
 *
 * The Light/Dark/System pick must survive a reload. These tests mirror
 * the appearance.ts persistence pattern: a module-local localStorage
 * round-trip plus a writable jotai atom that persists on write and
 * initializes from the stored value at module load.
 */

import { createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadStored, persist, resolveTheme, themePreferenceAtom } from '../theme.js';

const STORAGE_KEY = 'iarsma-theme-preference';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('loadStored', () => {
  it('returns "system" when the key is absent', () => {
    expect(loadStored()).toBe('system');
  });

  it('returns the stored value for "light" / "dark" / "system"', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify('light'));
    expect(loadStored()).toBe('light');

    localStorage.setItem(STORAGE_KEY, JSON.stringify('dark'));
    expect(loadStored()).toBe('dark');

    localStorage.setItem(STORAGE_KEY, JSON.stringify('system'));
    expect(loadStored()).toBe('system');
  });

  it('returns "system" for an invalid stored value', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify('chartreuse'));
    expect(loadStored()).toBe('system');
  });

  it('returns "system" for corrupt JSON', () => {
    localStorage.setItem(STORAGE_KEY, '{not valid json');
    expect(loadStored()).toBe('system');
  });
});

describe('persist', () => {
  it('writes a JSON-encoded preference that loadStored reads back', () => {
    persist('dark');
    expect(localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify('dark'));
    expect(loadStored()).toBe('dark');
  });
});

describe('themePreferenceAtom', () => {
  it('persists to localStorage when written', () => {
    const store = createStore();
    store.set(themePreferenceAtom, 'dark');

    expect(store.get(themePreferenceAtom)).toBe('dark');
    expect(loadStored()).toBe('dark');
    expect(localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify('dark'));
  });

  it('picks up a pre-seeded localStorage value on fresh initialization (reload)', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify('light'));

    // Re-import the module so its load-time initializer re-reads
    // localStorage — simulates a page reload.
    vi.resetModules();
    const fresh = await import('../theme.js');
    const store = createStore();
    expect(store.get(fresh.themePreferenceAtom)).toBe('light');
  });
});

describe('resolveTheme', () => {
  it('returns the preference verbatim for "light" / "dark"', () => {
    expect(resolveTheme('light')).toBe('light');
    expect(resolveTheme('dark')).toBe('dark');
  });
});
