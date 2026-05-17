/**
 * SHA-384 over the canonical-form preview output (D-047, Phase 2
 * item 12).
 *
 * The action-log records destructive commits with a
 * `provenance.previewHashHex` that binds the entry to "the preview
 * the user approved." This helper produces that hash. Uses the
 * same canonicalization (`canonicalize()`) the action-log itself
 * uses for entry-hash computation, so the two hashes are
 * comparable across the chain — a verifier can re-canonicalize an
 * earlier `mode: 'preview'` entry's params and re-hash to confirm
 * the commit references it.
 *
 * Pure function: synchronous canonicalization + a single Web
 * Crypto SHA-384 call. Production callers (compose-view.tsx) await
 * this between `preview()` returning and showing the confirmation
 * modal.
 */

import { canonicalize } from './canonical.js';
import { webCryptoSha384 } from './action-log.js';

export async function previewHashHex(preview: unknown): Promise<string> {
  const canonical = canonicalize(preview);
  const bytes = new TextEncoder().encode(canonical);
  return webCryptoSha384(bytes);
}
