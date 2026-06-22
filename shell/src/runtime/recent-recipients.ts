/**
 * Recent-recipients source for compose autocomplete (U-5).
 *
 * Contacts already feed RecipientField's suggestions; this adds the
 * Gmail-style "people you've recently emailed" source by mining
 * `mail.send` entries from the action-log. Pure extractor + a thin hook
 * that reads the chain once on mount.
 */

import { useEffect, useState } from 'react';
import { actionLog } from '../auth-state.js';
import type { StoredEntry } from './action-log.js';

export type RecentRecipient = {
  readonly email: string;
  readonly name?: string;
  /** Wall-clock ms of the most recent send to this address. */
  readonly lastUsedMs: number;
};

/**
 * Collect distinct recipient addresses from `mail.send` action-log
 * entries, most-recent first. Deduped by lowercased email; a name is
 * kept if any send carried one.
 */
export function extractRecentRecipients(
  entries: readonly StoredEntry[],
): RecentRecipient[] {
  const byEmail = new Map<string, RecentRecipient>();
  for (const e of entries) {
    if (e.data.action !== 'mail.send') continue;
    let params: unknown;
    try {
      params = JSON.parse(e.data.paramsJson);
    } catch {
      continue;
    }
    if (params === null || typeof params !== 'object') continue;
    const p = params as { to?: unknown; cc?: unknown; bcc?: unknown };
    const ts = e.data.timestampMs;
    for (const field of [p.to, p.cc, p.bcc]) {
      if (!Array.isArray(field)) continue;
      for (const a of field) {
        if (a === null || typeof a !== 'object') continue;
        const addr = a as { email?: unknown; name?: unknown };
        if (typeof addr.email !== 'string' || addr.email === '') continue;
        const key = addr.email.toLowerCase();
        const name =
          typeof addr.name === 'string' && addr.name.trim() !== ''
            ? addr.name
            : undefined;
        const existing = byEmail.get(key);
        if (existing === undefined || ts > existing.lastUsedMs) {
          byEmail.set(key, {
            email: addr.email,
            ...(name !== undefined ? { name } : existing?.name !== undefined ? { name: existing.name } : {}),
            lastUsedMs: Math.max(ts, existing?.lastUsedMs ?? ts),
          });
        } else if (existing.name === undefined && name !== undefined) {
          byEmail.set(key, { ...existing, name });
        }
      }
    }
  }
  return [...byEmail.values()].sort((a, b) => b.lastUsedMs - a.lastUsedMs);
}

/** Reads the action-log once on mount and returns recent recipients. */
export function useRecentRecipients(): readonly RecentRecipient[] {
  const [recents, setRecents] = useState<readonly RecentRecipient[]>([]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const entries = await actionLog.entries();
        if (!cancelled) setRecents(extractRecentRecipients(entries));
      } catch {
        // Best-effort — autocomplete still has the contacts source.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return recents;
}
