/**
 * DeleteToast (U-4) — bottom-right "Moved to Trash · Undo" toast.
 *
 * Unlike SendToast (which holds an outgoing send for a countdown and
 * cancels it on Undo), a delete has *already* happened: the soft-delete
 * moved the message to Trash and the loggingInvoker registered an
 * inverse under an action-log seq. This toast surfaces that inverse for
 * a short window so a misclick — including the live-push layout-shift
 * misclick (U-4) — is recoverable, then auto-dismisses.
 *
 * Mounted at the SignedInShell root next to SendToast so it shows
 * regardless of the active view. Reuses send-toast.module.css for a
 * consistent toast appearance.
 */

import { useAtom } from 'jotai';
import { useEffect } from 'react';
import { Button } from './button.js';
import { pendingDeleteUndoAtom } from '../mail-state.js';
import styles from './send-toast.module.css';

/** How long the Undo affordance stays before auto-dismissing. */
export const DELETE_UNDO_MS = 8000;

export function DeleteToast({ onUndo }: { readonly onUndo: (seq: number) => void }) {
  const [pending, setPending] = useAtom(pendingDeleteUndoAtom);

  useEffect(() => {
    if (pending === null) return;
    const handle = window.setTimeout(() => setPending(null), DELETE_UNDO_MS);
    return () => window.clearTimeout(handle);
  }, [pending, setPending]);

  if (pending === null) return null;

  const label =
    pending.count === 1
      ? 'Message moved to Trash'
      : `${pending.count} messages moved to Trash`;

  return (
    <div className={styles['stack']} role="region" aria-label="Recently deleted">
      <div className={styles['toast']} role="status" aria-live="polite">
        <span className={styles['label']}>{label}</span>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            onUndo(pending.seq);
            setPending(null);
          }}
          aria-label="Undo delete"
        >
          Undo
        </Button>
      </div>
    </div>
  );
}
