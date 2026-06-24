/**
 * Pure helpers for the label-delete two-step (dry-run → confirm) flow.
 *
 * Kept in a standalone module so they can be unit-tested without
 * importing App.tsx (which pulls in WASM bindings).
 */

/**
 * Maps a label.delete dry-run outcome to the delete-dialog state fields.
 *
 * - Happy path (error === null): returns affectedCount from the preview.
 * - Error path (error !== null): returns affectedCount=undefined so the
 *   dialog renders the neutral "remove it from any tagged messages" line
 *   instead of the misleading "0 message(s)" text.
 */
export function resolveLabelDeleteDialogState(
  preview: { affectedCount: number } | null,
  error: string | null,
): { affectedCount: number | undefined; errorMsg: string | undefined } {
  if (error !== null) {
    return { affectedCount: undefined, errorMsg: error };
  }
  return {
    affectedCount: preview?.affectedCount,
    errorMsg: undefined,
  };
}
