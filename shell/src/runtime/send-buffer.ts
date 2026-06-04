/**
 * SendBuffer — in-memory hold-then-send for mail.send (§8.5 undo,
 * PR 23 of the undo-registry plan).
 *
 * Compose calls `enqueue(params, delayMs)` instead of invoking
 * mail.send directly. The buffer keeps the params + a setTimeout for
 * `delayMs`; when the timer fires, `onFire(params)` is called (the
 * real mail.send through the normal invoker chain, which then logs
 * and may register undo for follow-on operations).
 *
 * Cancel before the timer = no JMAP call, no action-log entry. The
 * log records what actually happened on the server, not what the user
 * intended.
 *
 * Holds are not persisted. A page close while a hold is pending
 * cancels the send — the conservative default (better to lose a draft
 * than to surprise-send mail the user thought they cancelled). See
 * docs/superpowers/specs/2026-06-04-undo-registry-design.md §3.3.
 */

import type { MailSendInput, MailSendResult } from './jmap-client.js';

export type SendHold = {
  readonly id: string;
  readonly params: MailSendInput;
  readonly enqueuedAtMs: number;
  readonly fireAtMs: number;
  readonly remainingMs: number;
};

export type CreateSendBufferOptions = {
  /** Called when a hold's timer fires. Should issue the real
   *  mail.send through the production invoker chain. */
  readonly onFire: (params: MailSendInput) => Promise<MailSendResult>;
  /** For tests — overrides the wall clock used for remainingMs. */
  readonly now?: () => number;
};

export interface SendBuffer {
  /** Schedule `params` to fire in `delayMs`. Returns a holdId. */
  enqueue(params: MailSendInput, delayMs: number): string;
  /** Cancel a hold by id. Idempotent / no-op on unknown ids. */
  cancel(holdId: string): void;
  /** Snapshot of active holds with remainingMs computed at call time. */
  list(): readonly SendHold[];
}

type Entry = {
  readonly params: MailSendInput;
  readonly enqueuedAtMs: number;
  readonly fireAtMs: number;
  readonly timer: ReturnType<typeof setTimeout>;
};

export function createSendBuffer(opts: CreateSendBufferOptions): SendBuffer {
  const now = opts.now ?? (() => Date.now());
  const holds = new Map<string, Entry>();
  let nextId = 1;

  return {
    enqueue(params, delayMs) {
      const id = `hold-${nextId++}`;
      const t = now();
      const timer = setTimeout(() => {
        holds.delete(id);
        // Best-effort. Failures here surface through the normal
        // invoker chain (which already handles its own retry +
        // logging policy).
        void opts.onFire(params).catch((e) => {
          // eslint-disable-next-line no-console
          console.warn('[iarsma] send-buffer onFire failed:', e);
        });
      }, delayMs);
      holds.set(id, {
        params,
        enqueuedAtMs: t,
        fireAtMs: t + delayMs,
        timer,
      });
      return id;
    },
    cancel(holdId) {
      const e = holds.get(holdId);
      if (e === undefined) return;
      clearTimeout(e.timer);
      holds.delete(holdId);
    },
    list() {
      const t = now();
      const out: SendHold[] = [];
      for (const [id, e] of holds) {
        out.push({
          id,
          params: e.params,
          enqueuedAtMs: e.enqueuedAtMs,
          fireAtMs: e.fireAtMs,
          remainingMs: Math.max(0, e.fireAtMs - t),
        });
      }
      return out;
    },
  };
}
