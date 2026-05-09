/**
 * Versioned crypto envelope for at-rest token storage (D-050).
 *
 * Wraps a JSON-serializable value with AES-GCM-256 + a random 96-bit IV
 * per encryption, embedding the result in a self-describing envelope:
 *
 *   { v: 1, alg: 'A256GCM', kid: <wrap-key-id>, iv: <b64u>, ct: <b64u> }
 *
 * **Why this shape:**
 *   - **Versioned** (`v`) — adding a new wrap algorithm or KDF (when one
 *     is needed) is a forward-compatible bump per `docs/versioning.md`.
 *     Old envelopes still decrypt as long as the previous version's
 *     reader stays in code.
 *   - **Algorithm-tagged** (`alg`) — picks AES-GCM-256, which has ~128-bit
 *     post-quantum security under Grover (matches D-027's SHA-384
 *     reasoning). Symmetric AEAD doesn't need PQ replacement; asymmetric
 *     does, and we don't do asymmetric here. Future swaps (e.g., a PQ
 *     AEAD candidate) bump `alg` and add a new code path.
 *   - **Key-id** (`kid`) — supports key rotation. A new wrapping key gets
 *     a new kid; old envelopes still decrypt as long as the old key is
 *     resolvable (e.g., kept in IndexedDB during a rotation grace period).
 *   - **Per-encryption random IV** (`iv`) — required for AES-GCM safety;
 *     the same plaintext encrypts to different ciphertexts each time.
 *
 * Authenticated additional data (AAD): the envelope's `kid` + a caller-
 * provided `purpose` string are mixed in. Re-using a wrapped value across
 * purposes (e.g., feeding a `pkce` envelope to the `tokens` reader) fails
 * the auth tag check rather than silently succeeding — domain separation
 * the cheap way.
 *
 * The wrapping key itself is generated, persisted, and resolved by the
 * caller (typically `auth-storage.ts`). This module only does the
 * pure crypto bits.
 */

const ENVELOPE_VERSION = 1 as const;
const WRAP_ALG = 'A256GCM' as const;
const IV_BYTES = 12;

/** A wrapped, self-describing ciphertext blob. */
export type CryptoEnvelope = {
  /** Envelope schema version. Bumped only on incompatible shape changes. */
  readonly v: typeof ENVELOPE_VERSION;
  /** Wrap algorithm. Currently only `A256GCM` is supported. */
  readonly alg: typeof WRAP_ALG;
  /** Wrapping-key identifier — the caller resolves this to a CryptoKey. */
  readonly kid: string;
  /** 96-bit random IV, base64url-encoded. */
  readonly iv: string;
  /** Ciphertext (with embedded AES-GCM auth tag), base64url-encoded. */
  readonly ct: string;
};

/** Constants exported for test introspection and decision-doc cross-ref. */
export const CRYPTO_ENVELOPE_VERSION = ENVELOPE_VERSION;
export const CRYPTO_ENVELOPE_ALG = WRAP_ALG;

export class CryptoEnvelopeError extends Error {
  readonly code: 'unsupported_version' | 'unsupported_alg' | 'decrypt_failed';
  constructor(code: CryptoEnvelopeError['code'], message: string) {
    super(message);
    this.code = code;
    this.name = 'CryptoEnvelopeError';
  }
}

/**
 * Encrypt a JSON-serializable value into a versioned envelope.
 *
 * `purpose` is mixed into AES-GCM's AAD alongside `kid`, so an envelope
 * encrypted with `purpose: 'tokens'` cannot be successfully decrypted
 * as `purpose: 'pkce'`. Cheap domain separation across stores.
 */
export async function encryptEnvelope<T>(opts: {
  readonly key: CryptoKey;
  readonly kid: string;
  readonly purpose: string;
  readonly value: T;
}): Promise<CryptoEnvelope> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plaintext = new TextEncoder().encode(JSON.stringify(opts.value));
  const aad = buildAad(opts.kid, opts.purpose);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: toArrayBufferView(iv), additionalData: toArrayBufferView(aad) },
      opts.key,
      toArrayBufferView(plaintext),
    ),
  );
  return {
    v: ENVELOPE_VERSION,
    alg: WRAP_ALG,
    kid: opts.kid,
    iv: bytesToBase64Url(iv),
    ct: bytesToBase64Url(ciphertext),
  };
}

/**
 * Decrypt and JSON-parse a previously-encrypted envelope.
 *
 * Throws `CryptoEnvelopeError` on:
 *   - unrecognized envelope `v` (forward-compat: caller can decide
 *     whether to ignore the value or fail the load).
 *   - unrecognized `alg` (same).
 *   - any auth-tag failure — wrong key, tampered ciphertext, mismatched
 *     `purpose`, or kid-mismatch handled by the caller.
 */
export async function decryptEnvelope<T>(opts: {
  readonly key: CryptoKey;
  readonly purpose: string;
  readonly envelope: CryptoEnvelope;
}): Promise<T> {
  if (opts.envelope.v !== ENVELOPE_VERSION) {
    throw new CryptoEnvelopeError(
      'unsupported_version',
      `crypto-envelope: unsupported version ${opts.envelope.v}`,
    );
  }
  if (opts.envelope.alg !== WRAP_ALG) {
    throw new CryptoEnvelopeError(
      'unsupported_alg',
      `crypto-envelope: unsupported alg ${opts.envelope.alg}`,
    );
  }
  const iv = base64UrlToBytes(opts.envelope.iv);
  const ct = base64UrlToBytes(opts.envelope.ct);
  const aad = buildAad(opts.envelope.kid, opts.purpose);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toArrayBufferView(iv), additionalData: toArrayBufferView(aad) },
      opts.key,
      toArrayBufferView(ct),
    );
  } catch (e) {
    throw new CryptoEnvelopeError(
      'decrypt_failed',
      `crypto-envelope: decrypt failed (wrong key, tampered ciphertext, or purpose mismatch): ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

/**
 * Generate a fresh non-extractable AES-GCM-256 wrapping key suitable for
 * persistence in IndexedDB via Web Crypto's structured-clone support.
 * The key never leaves the secure context — `extractable: false`.
 */
export async function generateWrapKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Generate a short opaque key id for use in envelope `kid` fields.
 * 16 random bytes, base64url-encoded; collision risk for the persisted
 * single-key scenario is negligible. Length kept short so envelopes
 * stay readable in dev tools.
 */
export function generateKid(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16)));
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function buildAad(kid: string, purpose: string): Uint8Array {
  // `kid|purpose` is sufficient — both values are application-controlled
  // and cannot contain a literal `|` (kids are base64url; purposes are
  // ascii identifiers). This keeps the AAD format byte-stable across
  // platforms without a dedicated framing scheme.
  return new TextEncoder().encode(`${kid}|${purpose}`);
}

/**
 * Copy a Uint8Array into a fresh ArrayBuffer-backed view so it satisfies
 * lib.dom's strict `BufferSource` (which rejects `ArrayBufferLike`-backed
 * Uint8Arrays since they could in principle wrap a SharedArrayBuffer).
 * Same workaround the action-log host wrapper uses.
 */
function toArrayBufferView(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(bytes.length));
  copy.set(bytes);
  return copy as Uint8Array<ArrayBuffer>;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (padded.length % 4)) % 4);
  const bin = atob(padded + padding);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
