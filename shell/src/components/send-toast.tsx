/**
 * SendToast — bottom-right "Sending in Ns • Undo" toast stack
 * (PR 24 §8.5).
 *
 * Polls the SendBuffer's hold list on a tick so the count-down
 * updates. When a hold's timer fires, the buffer removes it from
 * the list and the toast goes with it.
 *
 * Mounted at the SignedInShell root so it's visible regardless of
 * which view the user is on while a send is buffered.
 */

import { useEffect, useState } from 'react';
import { Button } from './button.js';
import { useSendBufferOrNull } from '../runtime/send-buffer-context.js';
import type { SendHold } from '../runtime/send-buffer.js';
import styles from './send-toast.module.css';

const TICK_MS = 250;

export function SendToast() {
  const buffer = useSendBufferOrNull();
  const [holds, setHolds] = useState<readonly SendHold[]>([]);

  useEffect(() => {
    if (buffer === null) return;
    const refresh = (): void => setHolds(buffer.list());
    refresh();
    const handle = window.setInterval(refresh, TICK_MS);
    return () => window.clearInterval(handle);
  }, [buffer]);

  if (buffer === null || holds.length === 0) return null;

  return (
    <div className={styles['stack']} role="region" aria-label="Pending sends">
      {holds.map((h) => {
        const seconds = Math.max(0, Math.ceil(h.remainingMs / 1000));
        return (
          <div
            key={h.id}
            className={styles['toast']}
            role="status"
            aria-live="polite"
          >
            <span className={styles['label']}>
              Sending in {seconds}s
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => buffer.cancel(h.id)}
              aria-label={`Undo send to ${describeRecipients(h)}`}
            >
              Undo
            </Button>
          </div>
        );
      })}
    </div>
  );
}

function describeRecipients(h: SendHold): string {
  const to = h.params.to ?? [];
  if (to.length === 0) return 'pending message';
  const first = to[0]!.email;
  if (to.length === 1) return first;
  return `${first} and ${to.length - 1} more`;
}
