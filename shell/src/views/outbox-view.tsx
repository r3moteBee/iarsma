/**
 * OutboxView — pending sends from the SendBuffer surfaced as a
 * navigable list (PR 27).
 *
 * Polls the buffer every 250ms so the per-row count-down ticks. The
 * empty state explains the cancel-on-reload policy (D-056) so the
 * user understands why their Outbox is sometimes empty after a
 * refresh.
 */

import { useEffect, useState } from 'react';
import { Button } from '../components/button.js';
import { useSendBufferOrNull } from '../runtime/send-buffer-context.js';
import type { SendHold } from '../runtime/send-buffer.js';
import styles from './outbox-view.module.css';

const TICK_MS = 250;

export type OutboxViewProps = {
  /** Snapshot for tests; defaults to live polling of the SendBuffer
   *  context. When supplied, polling is skipped and the list is the
   *  caller's source of truth. */
  readonly holds?: readonly SendHold[];
  readonly onCancel?: (holdId: string) => void;
};

export function OutboxView(props: OutboxViewProps) {
  const buffer = useSendBufferOrNull();
  const [polledHolds, setPolledHolds] = useState<readonly SendHold[]>([]);

  useEffect(() => {
    // If props.holds is supplied (tests), don't bind to the buffer.
    if (props.holds !== undefined) return;
    if (buffer === null) return;
    const refresh = (): void => setPolledHolds(buffer.list());
    refresh();
    const handle = window.setInterval(refresh, TICK_MS);
    return () => window.clearInterval(handle);
  }, [buffer, props.holds]);

  const holds = props.holds ?? polledHolds;
  const onCancel = props.onCancel ?? ((id: string) => buffer?.cancel(id));

  return (
    <section className={styles['container']} aria-labelledby="outbox-heading">
      <div className={styles['header']}>
        <h2 id="outbox-heading" className={styles['heading']}>Outbox</h2>
        <p className={styles['description']}>
          Messages waiting to be sent. Hit Undo before the timer runs
          out and the message stays in Drafts.
        </p>
      </div>
      {holds.length === 0 ? (
        <div className={styles['empty']}>
          Nothing pending. New sends appear here for the duration of
          the configured delay (Settings → Sending). Closing the tab
          cancels any pending send.
        </div>
      ) : (
        <ul className={styles['list']}>
          {holds.map((h) => (
            <OutboxRow
              key={h.id}
              hold={h}
              onCancel={() => onCancel(h.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function OutboxRow({
  hold,
  onCancel,
}: {
  readonly hold: SendHold;
  readonly onCancel: () => void;
}) {
  const seconds = Math.max(0, Math.ceil(hold.remainingMs / 1000));
  const subject = hold.params.subject ?? '(no subject)';
  return (
    <li className={styles['row']}>
      <div>
        <h3 className={styles['subject']}>{subject}</h3>
        <p className={styles['recipients']}>
          To {describeRecipients(hold)}
        </p>
        <p className={styles['countdown']} aria-live="polite">
          Sending in {seconds}s
        </p>
      </div>
      <div className={styles['actions']}>
        <Button
          variant="secondary"
          size="sm"
          onClick={onCancel}
          aria-label={`Undo send: ${subject}`}
        >
          Undo
        </Button>
      </div>
    </li>
  );
}

function describeRecipients(h: SendHold): string {
  const to = h.params.to ?? [];
  if (to.length === 0) return '(no recipient)';
  const first = to[0]!.name ?? to[0]!.email;
  if (to.length === 1) return first;
  return `${first} and ${to.length - 1} more`;
}
