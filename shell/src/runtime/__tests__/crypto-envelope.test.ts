/**
 * Crypto envelope tests (D-050).
 *
 * AES-GCM is provided by Node's built-in Web Crypto (via globalThis.crypto)
 * since Node 19+, so these tests run in the default vitest Node environment
 * without any DOM polyfills.
 */

import { describe, expect, it } from 'vitest';
import {
  CRYPTO_ENVELOPE_ALG,
  CRYPTO_ENVELOPE_VERSION,
  CryptoEnvelopeError,
  decryptEnvelope,
  encryptEnvelope,
  generateKid,
  generateWrapKey,
  type CryptoEnvelope,
} from '../crypto-envelope.js';

describe('crypto-envelope — round-trip', () => {
  it('encrypts and decrypts a JSON-serializable value', async () => {
    const key = await generateWrapKey();
    const kid = generateKid();
    const original = { sub: 'user-1', email: 'a@b', expiresAtMs: 1700000000000 };

    const env = await encryptEnvelope({ key, kid, purpose: 'tokens.v1', value: original });
    expect(env.v).toBe(CRYPTO_ENVELOPE_VERSION);
    expect(env.alg).toBe(CRYPTO_ENVELOPE_ALG);
    expect(env.kid).toBe(kid);
    expect(env.iv).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(env.ct).toMatch(/^[A-Za-z0-9_-]+$/);

    const out = await decryptEnvelope({ key, purpose: 'tokens.v1', envelope: env });
    expect(out).toEqual(original);
  });

  it('produces different ciphertexts for the same plaintext (random IV)', async () => {
    const key = await generateWrapKey();
    const kid = generateKid();
    const value = { x: 1 };
    const a = await encryptEnvelope({ key, kid, purpose: 'tokens.v1', value });
    const b = await encryptEnvelope({ key, kid, purpose: 'tokens.v1', value });
    expect(a.ct).not.toBe(b.ct);
    expect(a.iv).not.toBe(b.iv);
  });

  it('round-trips arbitrary nested JSON values', async () => {
    const key = await generateWrapKey();
    const kid = generateKid();
    const value = {
      tokens: { access: 'a', refresh: 'r', expiresAtMs: 0 },
      meta: { issuedBy: 'iss', scopes: ['s1', 's2'] },
      flag: true,
      n: 42,
    };
    const env = await encryptEnvelope({ key, kid, purpose: 'tokens.v1', value });
    const out = await decryptEnvelope<typeof value>({ key, purpose: 'tokens.v1', envelope: env });
    expect(out).toEqual(value);
  });
});

describe('crypto-envelope — domain separation (AAD)', () => {
  it('rejects decryption when the purpose mismatches the encryption purpose', async () => {
    const key = await generateWrapKey();
    const kid = generateKid();
    const env = await encryptEnvelope({ key, kid, purpose: 'tokens.v1', value: { ok: 1 } });
    await expect(
      decryptEnvelope({ key, purpose: 'pkce.v1', envelope: env }),
    ).rejects.toMatchObject({ code: 'decrypt_failed' });
  });

  it('rejects decryption when the kid was tampered with', async () => {
    const key = await generateWrapKey();
    const kid = generateKid();
    const env = await encryptEnvelope({ key, kid, purpose: 'tokens.v1', value: { ok: 1 } });
    const tampered: CryptoEnvelope = { ...env, kid: 'tampered-kid' };
    await expect(
      decryptEnvelope({ key, purpose: 'tokens.v1', envelope: tampered }),
    ).rejects.toMatchObject({ code: 'decrypt_failed' });
  });

  it('rejects decryption with the wrong wrapping key', async () => {
    const k1 = await generateWrapKey();
    const k2 = await generateWrapKey();
    const kid = generateKid();
    const env = await encryptEnvelope({ key: k1, kid, purpose: 'tokens.v1', value: { ok: 1 } });
    await expect(
      decryptEnvelope({ key: k2, purpose: 'tokens.v1', envelope: env }),
    ).rejects.toMatchObject({ code: 'decrypt_failed' });
  });

  it('rejects decryption when the ciphertext was tampered with', async () => {
    const key = await generateWrapKey();
    const kid = generateKid();
    const env = await encryptEnvelope({ key, kid, purpose: 'tokens.v1', value: { ok: 1 } });
    // Flip a bit: replace the last char of the ciphertext with a different one.
    const last = env.ct.slice(-1);
    const flipped = (last === 'A' ? 'B' : 'A') as string;
    const tampered: CryptoEnvelope = { ...env, ct: env.ct.slice(0, -1) + flipped };
    await expect(
      decryptEnvelope({ key, purpose: 'tokens.v1', envelope: tampered }),
    ).rejects.toMatchObject({ code: 'decrypt_failed' });
  });
});

describe('crypto-envelope — version + alg gating', () => {
  it('throws unsupported_version on a future envelope version', async () => {
    const key = await generateWrapKey();
    const kid = generateKid();
    const env = await encryptEnvelope({ key, kid, purpose: 'tokens.v1', value: { ok: 1 } });
    const future = { ...env, v: 99 } as unknown as CryptoEnvelope;
    await expect(
      decryptEnvelope({ key, purpose: 'tokens.v1', envelope: future }),
    ).rejects.toBeInstanceOf(CryptoEnvelopeError);
    await expect(
      decryptEnvelope({ key, purpose: 'tokens.v1', envelope: future }),
    ).rejects.toMatchObject({ code: 'unsupported_version' });
  });

  it('throws unsupported_alg on an unknown algorithm', async () => {
    const key = await generateWrapKey();
    const kid = generateKid();
    const env = await encryptEnvelope({ key, kid, purpose: 'tokens.v1', value: { ok: 1 } });
    const wrongAlg = { ...env, alg: 'XSALSA20-POLY1305' } as unknown as CryptoEnvelope;
    await expect(
      decryptEnvelope({ key, purpose: 'tokens.v1', envelope: wrongAlg }),
    ).rejects.toMatchObject({ code: 'unsupported_alg' });
  });
});

describe('crypto-envelope — wrapping-key generation', () => {
  it('produces non-extractable AES-GCM-256 keys', async () => {
    const key = await generateWrapKey();
    expect(key.type).toBe('secret');
    expect(key.extractable).toBe(false);
    expect(key.algorithm.name).toBe('AES-GCM');
    expect(key.usages).toEqual(expect.arrayContaining(['encrypt', 'decrypt']));
  });

  it('produces unique kids per call', () => {
    const a = generateKid();
    const b = generateKid();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
