/**
 * Shared inline SVG icon components.
 *
 * Each icon is a zero-prop React component that renders a single <svg>.
 * All icons use `stroke="currentColor"` so they inherit color from CSS,
 * and `aria-hidden="true"` because they are always accompanied by a
 * visible or screen-reader label at the call site.
 */

/** Task 7 — folder/move icon for the "Move to…" menu trigger. */
export function MoveToFolderIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
      <line x1="12" y1="11" x2="12" y2="17" />
      <polyline points="9 14 12 17 15 14" />
    </svg>
  );
}

/** Task 10 — label/tag icon for the label picker menu trigger. */
export function LabelTagIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </svg>
  );
}
