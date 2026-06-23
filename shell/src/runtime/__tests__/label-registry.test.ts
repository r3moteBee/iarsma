import { describe, it, expect } from 'vitest';
import {
  serializeRegistry, parseRegistry, EMPTY_REGISTRY, DEFAULT_LABEL_COLOR,
} from '../label-registry';

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
    expect(parseRegistry(json).labels[0].color).toBe(DEFAULT_LABEL_COLOR);
  });
});
