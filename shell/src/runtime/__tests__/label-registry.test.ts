import { describe, it, expect } from 'vitest';
import {
  serializeRegistry, parseRegistry, EMPTY_REGISTRY, DEFAULT_LABEL_COLOR, resolveLabels,
} from '../label-registry';
import type { LabelDef } from '../label-registry';

describe('label-registry', () => {
  it('round-trips a registry, sorted by order then key', () => {
    const r = { version: 1 as const, labels: [
      { key: 'b', name: 'B', color: '#111111', order: 1 },
      { key: 'a', name: 'A', color: '#222222', order: 0 },
    ]};
    const parsed = parseRegistry(serializeRegistry(r));
    expect(parsed.labels.map((l) => l.key)).toEqual(['a', 'b']);
  });
  it('returns EMPTY_REGISTRY for empty/garbage input', () => {
    expect(parseRegistry('')).toEqual(EMPTY_REGISTRY);
    expect(parseRegistry('not json')).toEqual(EMPTY_REGISTRY);
    expect(parseRegistry('{"version":1}')).toEqual(EMPTY_REGISTRY);
  });
  it('drops malformed label entries but keeps valid ones', () => {
    const json = JSON.stringify({ version: 1, labels: [
      { key: 'ok', name: 'Ok', color: '#abcabc', order: 0 },
      { key: 'NO SPACES', name: 'x', color: '#fff', order: 1 }, // invalid key
      { name: 'missing key', color: '#fff', order: 2 },
    ]});
    const parsed = parseRegistry(json);
    expect(parsed.labels.map((l) => l.key)).toEqual(['ok']);
  });
  it('defaults a missing color to the orange accent', () => {
    const json = JSON.stringify({ version: 1, labels: [
      { key: 'ok', name: 'Ok', order: 0 },
    ]});
    expect(parseRegistry(json).labels[0]!.color).toBe(DEFAULT_LABEL_COLOR);
  });
});

// ---------------------------------------------------------------------------
// resolveLabels
// ---------------------------------------------------------------------------

const LABEL_A: LabelDef = { key: 'work', name: 'Work', color: '#ff6b35', order: 1 };
const LABEL_B: LabelDef = { key: 'personal', name: 'Personal', color: '#0088cc', order: 0 };
const LABEL_C: LabelDef = { key: 'urgent', name: 'Urgent', color: '#cc0000', order: 2 };

describe('resolveLabels', () => {
  it('returns matching LabelDefs sorted by order then key', () => {
    const keywords = [
      { name: 'work', value: true },
      { name: 'personal', value: true },
    ];
    const result = resolveLabels(keywords, [LABEL_A, LABEL_B]);
    // LABEL_B has order 0, LABEL_A has order 1 — expect [personal, work]
    expect(result.map((l) => l.key)).toEqual(['personal', 'work']);
  });

  it('sorts by key when order values are equal', () => {
    const labelX: LabelDef = { key: 'zzz', name: 'Z', color: '#000', order: 0 };
    const labelY: LabelDef = { key: 'aaa', name: 'A', color: '#000', order: 0 };
    const keywords = [
      { name: 'zzz', value: true },
      { name: 'aaa', value: true },
    ];
    const result = resolveLabels(keywords, [labelX, labelY]);
    expect(result.map((l) => l.key)).toEqual(['aaa', 'zzz']);
  });

  it('drops keywords with value: false', () => {
    const keywords = [
      { name: 'work', value: false },
      { name: 'personal', value: true },
    ];
    const result = resolveLabels(keywords, [LABEL_A, LABEL_B]);
    expect(result.map((l) => l.key)).toEqual(['personal']);
  });

  it('drops keywords not in the labels list (unknown)', () => {
    const keywords = [
      { name: 'unknown-tag', value: true },
      { name: 'personal', value: true },
    ];
    const result = resolveLabels(keywords, [LABEL_A, LABEL_B]);
    expect(result.map((l) => l.key)).toEqual(['personal']);
  });

  it('drops system keywords like $seen and $flagged', () => {
    const keywords = [
      { name: '$seen', value: true },
      { name: '$flagged', value: true },
      { name: 'work', value: true },
    ];
    const result = resolveLabels(keywords, [LABEL_A, LABEL_B, LABEL_C]);
    // $seen and $flagged won't match any label key (labels use keys like 'work')
    expect(result.map((l) => l.key)).toEqual(['work']);
  });

  it('returns [] when labels list is empty', () => {
    const keywords = [{ name: 'work', value: true }];
    const result = resolveLabels(keywords, []);
    expect(result).toEqual([]);
  });

  it('returns [] when keywords list is empty', () => {
    const result = resolveLabels([], [LABEL_A, LABEL_B]);
    expect(result).toEqual([]);
  });

  it('is robust to undefined labels argument', () => {
    const keywords = [{ name: 'work', value: true }];
    const result = resolveLabels(keywords, undefined as unknown as readonly LabelDef[]);
    expect(result).toEqual([]);
  });
});
