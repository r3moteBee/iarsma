/**
 * React context for the per-session SendBuffer (PR 24).
 *
 * The buffer needs the invoker to fire its held sends, so it's
 * constructed inside ConnectedApp (where the invoker is composed)
 * and shared through context to Compose + the toast component +
 * the Activity view's pending-send rows.
 */

import { createContext, useContext, useEffect, useState } from 'react';
import type { SendBuffer } from './send-buffer.js';

const SendBufferContext = createContext<SendBuffer | null>(null);

export const SendBufferProvider = SendBufferContext.Provider;

/** Read the SendBuffer. Throws if used outside the provider — that
 *  means the producer wasn't wired correctly, not a per-request
 *  failure to handle gracefully. */
export function useSendBuffer(): SendBuffer {
  const buf = useContext(SendBufferContext);
  if (buf === null) {
    throw new Error('useSendBuffer: no SendBufferProvider in the tree.');
  }
  return buf;
}

/** Read the SendBuffer or null. Use in places that may render
 *  outside the provider (server-side rendering of a sign-in surface,
 *  isolated tests). */
export function useSendBufferOrNull(): SendBuffer | null {
  return useContext(SendBufferContext);
}

/** Polled count of active SendBuffer holds (PR 27). Returns 0 when
 *  the provider isn't mounted. 500ms tick is coarse enough to avoid
 *  re-rendering the sidebar every frame but fine enough that the
 *  badge appears/disappears feel instant. */
export function useOutboxCount(): number {
  const buffer = useContext(SendBufferContext);
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (buffer === null) return;
    const tick = (): void => setCount(buffer.list().length);
    tick();
    const handle = window.setInterval(tick, 500);
    return () => window.clearInterval(handle);
  }, [buffer]);
  return count;
}
