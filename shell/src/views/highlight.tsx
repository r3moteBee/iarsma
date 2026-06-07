/**
 * Highlight — wrap matched query tokens in `<mark>` (PR 53 / CoWork #15).
 *
 * Pure helpers + a trivial renderer. Split out of thread-list so the
 * tokenize / segment logic can be unit-tested in isolation and reused
 * by future search surfaces (e.g. command palette, calendar event
 * search).
 *
 * Design notes:
 *
 *   - **Tokens are whitespace-delimited.** We don't try to parse
 *     phrase quoting today; the server (Stalwart's tantivy) is the
 *     authority on what matched. The client's job is to make the
 *     match *visible*, and per-word highlights are forgiving when the
 *     server is permissive (stemming, prefix). Quoted-phrase mode is
 *     additive — drop it in when the search UI grows a query DSL.
 *   - **Min token length = 2.** Filter `a` / `i` etc. so they don't
 *     drown the row in highlights. Numbers are kept (a 1-digit value
 *     is still rare enough to be useful in subjects).
 *   - **Case-insensitive.** We match by lowercased haystack against
 *     lowercased needles but reconstruct the highlighted output from
 *     the original `text` so casing is preserved in the UI.
 *   - **Non-overlapping spans.** When tokens overlap (`"john"` and
 *     `"johnny"` both in the query), we pick the longer match at each
 *     starting position; never produce nested marks.
 */

import type { ReactNode } from 'react';
import styles from './highlight.module.css';

/**
 * Tokenize a search query into the substrings we'll highlight.
 * Whitespace-delimited, lowercased, deduped, and pruned of trivial
 * lengths. Returns the empty array for an empty/all-whitespace query
 * so callers can early-out (no segmentation work at all).
 */
export function tokenize(query: string): readonly string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of query.split(/\s+/)) {
    const t = raw.toLowerCase();
    if (t.length < 2) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/**
 * One segment of the highlighted output. Consumers render `<mark>`
 * around segments where `match === true`.
 */
export type Segment = { readonly text: string; readonly match: boolean };

/**
 * Walk `text` once and break it into alternating match / non-match
 * segments. Adjacent matches are merged (one `<mark>` spans them).
 *
 * Complexity: O(text.length × tokens.length). For row rendering this
 * is fine — `text` is bounded (subject ~ 100 chars, snippet ~ 120
 * chars) and `tokens.length` is at most a handful.
 */
export function segment(text: string, tokens: readonly string[]): readonly Segment[] {
  if (tokens.length === 0 || text === '') {
    return text === '' ? [] : [{ text, match: false }];
  }
  const lower = text.toLowerCase();
  const segments: Segment[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    // Find the best match starting at `cursor` — the *longest* token
    // that prefixes lower[cursor..]. Picking the longest avoids
    // nested marks when "john" and "johnny" are both query tokens.
    let bestLen = 0;
    for (const tok of tokens) {
      if (tok.length > bestLen && lower.startsWith(tok, cursor)) {
        bestLen = tok.length;
      }
    }
    if (bestLen > 0) {
      pushOrExtend(segments, text.slice(cursor, cursor + bestLen), true);
      cursor += bestLen;
      continue;
    }
    pushOrExtend(segments, text.slice(cursor, cursor + 1), false);
    cursor += 1;
  }
  return segments;
}

function pushOrExtend(segments: Segment[], next: string, match: boolean): void {
  const last = segments[segments.length - 1];
  if (last !== undefined && last.match === match) {
    segments[segments.length - 1] = { text: last.text + next, match };
    return;
  }
  segments.push({ text: next, match });
}

/**
 * Build a 120-char snippet centered on the first matching token.
 * Falls back to the leading window when no token is present (which
 * happens for results whose match landed in the subject only).
 *
 * The window is tightened around word boundaries so we don't slice
 * mid-token: starting from the centered window edges, walk outward
 * until we hit whitespace or the source bounds.
 */
export function buildSnippet(
  text: string,
  tokens: readonly string[],
  maxLen = 120,
): string {
  if (text.length <= maxLen) return text;
  const lower = text.toLowerCase();
  let matchIdx = -1;
  for (const tok of tokens) {
    const i = lower.indexOf(tok);
    if (i >= 0 && (matchIdx < 0 || i < matchIdx)) matchIdx = i;
  }
  // Center the window on the first match. When no match, just take
  // the leading window.
  const center = matchIdx < 0 ? Math.floor(maxLen / 2) : matchIdx;
  const half = Math.floor(maxLen / 2);
  let start = Math.max(0, center - half);
  let end = Math.min(text.length, start + maxLen);
  // Re-anchor `start` if we hit the right edge.
  start = Math.max(0, end - maxLen);
  // Snap to word boundaries so the snippet doesn't begin/end
  // mid-token. Capped at a small budget — fine for English; for CJK
  // this is a no-op.
  for (let i = 0; i < 12 && start > 0 && /\S/.test(text[start - 1] ?? ''); i++) start--;
  for (let i = 0; i < 12 && end < text.length && /\S/.test(text[end] ?? ''); i++) end++;
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}

export type HighlightProps = {
  readonly text: string;
  readonly tokens: readonly string[];
};

/**
 * Render `text` with matches wrapped in `<mark>`. When `tokens` is
 * empty (or `text` is empty), renders the text untouched — zero
 * overhead.
 */
export function Highlight({ text, tokens }: HighlightProps): ReactNode {
  if (tokens.length === 0) return text;
  const segs = segment(text, tokens);
  return (
    <>
      {segs.map((s, i) =>
        s.match ? (
          <mark key={i} className={styles['mark']}>
            {s.text}
          </mark>
        ) : (
          s.text
        ),
      )}
    </>
  );
}
