import { describe, expect, it } from 'vitest';
import {
  toggle,
  selectRange,
  selectAll,
  clearSelection,
} from '../thread-selection.js';

const IDS = ['a', 'b', 'c', 'd', 'e'];

describe('thread-selection reducer', () => {
  it('toggle adds an id not present', () => {
    expect([...toggle(new Set(), 'a')]).toEqual(['a']);
  });

  it('toggle removes an id already present', () => {
    expect([...toggle(new Set(['a', 'b']), 'a')]).toEqual(['b']);
  });

  it('toggle does not mutate the input set', () => {
    const input = new Set(['a']);
    toggle(input, 'b');
    expect([...input]).toEqual(['a']);
  });

  it('selectRange unions the inclusive range into the base set', () => {
    const result = selectRange(IDS, 1, 3, new Set(['a']));
    expect([...result].sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('selectRange handles a reversed range (click before anchor)', () => {
    const result = selectRange(IDS, 3, 1, new Set());
    expect([...result].sort()).toEqual(['b', 'c', 'd']);
  });

  it('selectRange with equal anchor/click selects the single row', () => {
    expect([...selectRange(IDS, 2, 2, new Set())]).toEqual(['c']);
  });

  it('selectAll selects every id in order', () => {
    expect([...selectAll(IDS)]).toEqual(IDS);
  });

  it('clearSelection returns an empty set', () => {
    expect(clearSelection().size).toBe(0);
  });
});
