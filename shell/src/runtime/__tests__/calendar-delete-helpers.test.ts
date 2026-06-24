import { describe, expect, it } from 'vitest';
import { resolveCalendarDeleteState } from '../calendar-delete-helpers.js';

describe('resolveCalendarDeleteState', () => {
  it('escalates to typed confirm on not_empty refusal', () => {
    expect(resolveCalendarDeleteState({ refusal: 'not_empty', error: null }).mode).toBe('typed');
  });
  it('stays light with no refusal', () => {
    expect(resolveCalendarDeleteState({ refusal: null, error: null }).mode).toBe('light');
  });
  it('passes an error through', () => {
    expect(resolveCalendarDeleteState({ refusal: null, error: 'boom' }).errorMsg).toBe('boom');
  });
});
