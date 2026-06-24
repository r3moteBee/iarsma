/**
 * Pure thread-selection transitions (multi-select / bulk actions, #5).
 *
 * Deliberately React-free so the selection logic is unit-testable in
 * isolation. The atom writers in `mail-state.ts` call these; the view
 * (`thread-list.tsx`) decides WHEN to call them from clicks/keys.
 *
 * Every function returns a fresh `Set` and never mutates its inputs —
 * jotai atom identity changes are how subscribers re-render.
 */

/** Add `id` if absent, remove it if present. */
export function toggle(set: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}

/**
 * Union the inclusive range of `orderedIds` between `anchorIdx` and
 * `clickIdx` (either order) into `base`. Used for Shift-click range
 * selection — additive, so an existing selection is preserved.
 */
export function selectRange(
  orderedIds: readonly string[],
  anchorIdx: number,
  clickIdx: number,
  base: ReadonlySet<string>,
): Set<string> {
  const next = new Set(base);
  const lo = Math.max(0, Math.min(anchorIdx, clickIdx));
  const hi = Math.min(orderedIds.length - 1, Math.max(anchorIdx, clickIdx));
  for (let i = lo; i <= hi; i++) {
    const id = orderedIds[i];
    if (id !== undefined) next.add(id);
  }
  return next;
}

/** Select every id in `orderedIds` (the loaded/visible list). */
export function selectAll(orderedIds: readonly string[]): Set<string> {
  return new Set(orderedIds);
}

/** Empty selection. */
export function clearSelection(): Set<string> {
  return new Set();
}
