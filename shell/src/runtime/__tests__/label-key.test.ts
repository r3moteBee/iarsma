import { describe, it, expect } from 'vitest';
import { mintLabelKey } from '../label-key';

describe('mintLabelKey', () => {
  it('slugifies a simple name', () => {
    expect(mintLabelKey('Work', [])).toBe('work');
  });
  it('collapses spaces and punctuation to single underscores', () => {
    expect(mintLabelKey('Project: ACME', [])).toBe('project_acme');
    expect(mintLabelKey('  My   Work  ', [])).toBe('my_work');
  });
  it('trims leading/trailing separators', () => {
    expect(mintLabelKey('---Hello---', [])).toBe('hello');
  });
  it('folds case when checking uniqueness and auto-suffixes', () => {
    expect(mintLabelKey('Work', ['work'])).toBe('work_2');
    expect(mintLabelKey('WORK', ['work', 'work_2'])).toBe('work_3');
  });
  it('truncates to 63 chars', () => {
    const key = mintLabelKey('a'.repeat(100), []);
    expect(key && key.length).toBe(63);
  });
  it('returns null when name slugifies to empty', () => {
    expect(mintLabelKey('   ', [])).toBeNull();
    expect(mintLabelKey('!!!', [])).toBeNull();
  });
  it('produces keys matching the key regex', () => {
    const re = /^[a-z0-9][a-z0-9_-]{0,62}$/;
    for (const n of ['Work', 'Project: ACME', '2024 Taxes', 'a'.repeat(100)]) {
      const k = mintLabelKey(n, []);
      expect(k && re.test(k)).toBe(true);
    }
  });
});
