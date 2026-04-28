/**
 * Canonical JSON serialization for atom keying.
 *
 * Two equivalent inputs (e.g., `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }`) must
 * produce the same atom-family key. Default `JSON.stringify` doesn't sort
 * keys, so we walk the value and emit a key-sorted form.
 *
 * Used as the cache key in atomFamily for read-hooks.
 */

export function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) {
      sorted[k] = sortKeys(obj[k]);
    }
    return sorted;
  }
  return value;
}
