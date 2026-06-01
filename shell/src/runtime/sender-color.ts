/**
 * Sender avatar color rule — PR 4 of the UI redesign (§7.3.1).
 *
 * The avatar fill encodes a meaning, not decoration:
 *
 *   - **Agent**: `var(--accent)`. Reads as "yours / action". Tracks
 *     the accent picker live (PR 6 will land that).
 *   - **Automated / system** (no-reply, GitHub, CI, Stalwart Releases,
 *     etc.): `var(--badge-system)` — muted neutral. Low-signal machine
 *     mail recedes visually.
 *   - **Human**: a stable hue derived from the sender's email address.
 *     Same person → same color, forever. Reuses the mockup's tiny
 *     `hashHue(s) % 360` so the color is reproducible in TypeScript
 *     and in the HTML mockup.
 *
 * The kind is classified by `classifySender()` — heuristics today,
 * a per-contact override store later (Phase 5+). Agent senders need
 * an explicit caller-provided flag because the JMAP `from` field
 * can't be relied on to identify an agent message (an agent sends as
 * the user). PR 4 wires `kind: 'human' | 'system'` only; agent
 * classification lands when the agent-action surface starts decorating
 * inbox rows with provenance metadata.
 */

export type SenderKind = 'human' | 'agent' | 'system';

const KIND_LABEL: Record<SenderKind, string> = {
  human: 'Contact',
  agent: 'Agent',
  system: 'Automated',
};

/**
 * Map a kind + identifying name (typically the from-email for humans)
 * to the CSS color value the avatar uses. The agent and system kinds
 * return `var(...)` so they track the live theme; humans return a
 * concrete HSL string so the same address yields the same swatch on
 * every machine.
 */
export function colorFor(name: string, kind: SenderKind): string {
  if (kind === 'agent') return 'var(--accent)';
  if (kind === 'system') return 'var(--badge-system)';
  return `hsl(${hashHue(name)} 46% 50%)`;
}

/** Stable string-hash → 0..359 hue. Mirrors the mockup verbatim so
 *  the mockup and the live UI render the same avatar colors. */
export function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h % 360;
}

export function kindLabel(kind: SenderKind): string {
  return KIND_LABEL[kind];
}

/**
 * Heuristic classifier for the From: address. Agent senders are NOT
 * detected here (the JMAP From: of an agent message looks like the
 * user); callers that know the message came from an agent should
 * pass that in explicitly. Returns 'system' for known-automated
 * patterns and 'human' otherwise.
 *
 * The list is deliberately conservative — false-positive "system"
 * mutes legitimate humans behind grey, which is worse than a
 * false-positive "human" giving an automated sender a hashed hue.
 */
export function classifySender(emailAddress: string, displayName?: string): SenderKind {
  const email = emailAddress.toLowerCase();
  const local = email.split('@')[0] ?? '';
  // Local-part patterns: no-reply, do-not-reply, notifications,
  // mailer-daemon, postmaster, noreply, automated.
  if (
    local === 'noreply' ||
    local === 'no-reply' ||
    local === 'do-not-reply' ||
    local === 'donotreply' ||
    local === 'mailer-daemon' ||
    local === 'postmaster' ||
    local === 'notifications' ||
    local === 'automated' ||
    local.startsWith('noreply-') ||
    local.startsWith('no-reply-') ||
    local.endsWith('-noreply') ||
    local.endsWith('-no-reply')
  ) {
    return 'system';
  }
  // Display names that announce themselves as a service / app /
  // notifications even when the address looks human.
  if (displayName !== undefined) {
    const dn = displayName.toLowerCase();
    if (
      dn.includes('notifications') ||
      dn.includes('no-reply') ||
      dn.includes('noreply') ||
      dn.includes(' bot') ||
      dn.startsWith('bot ') ||
      dn === 'github'
    ) {
      return 'system';
    }
  }
  return 'human';
}

/**
 * Derive a 1-2 character avatar monogram from a sender name (preferred)
 * or email address (fallback). Capitalised so non-Latin scripts still
 * surface a single visible glyph.
 */
export function initialsFor(name: string | undefined, email: string): string {
  const source = (name ?? '').trim();
  if (source.length === 0) {
    const local = (email.split('@')[0] ?? '?').trim();
    return (local.charAt(0) || '?').toUpperCase();
  }
  const parts = source.split(/\s+/).filter((p) => p.length > 0);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.charAt(0).toUpperCase();
  return (parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)).toUpperCase();
}
