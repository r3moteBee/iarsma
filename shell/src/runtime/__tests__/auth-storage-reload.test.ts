// @vitest-environment jsdom
/**
 * `AuthStorage.reloadTokens()` contract: re-read the shared backing so a
 * tab sees what another tab wrote (rotated refresh token) or removed
 * (sign-out). Two `sessionAuthStorage()` instances share one
 * `window.sessionStorage`, standing in for two tabs over one backing.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { sessionAuthStorage, type StoredTokens } from '../auth-storage.js';

const T1: StoredTokens = { accessToken: 'at-1', refreshToken: 'rt-1', expiresAtMs: 1 };
const T2: StoredTokens = { accessToken: 'at-2', refreshToken: 'rt-2', expiresAtMs: 2 };

beforeEach(() => {
  window.sessionStorage.clear();
});

describe('sessionAuthStorage.reloadTokens', () => {
  it("picks up another instance's write that loadTokens() does not see", async () => {
    const tabA = sessionAuthStorage();
    const tabB = sessionAuthStorage();
    await tabA.saveTokens(T1);
    await tabB.ready();
    await tabA.saveTokens(T2);
    expect(tabB.loadTokens()).toEqual(T1);
    expect(await tabB.reloadTokens()).toEqual(T2);
    expect(tabB.loadTokens()).toEqual(T2);
  });

  it("reflects another instance's clear", async () => {
    const tabA = sessionAuthStorage();
    const tabB = sessionAuthStorage();
    await tabA.saveTokens(T1);
    await tabB.ready();
    await tabA.clearTokens();
    expect(await tabB.reloadTokens()).toBeNull();
    expect(tabB.loadTokens()).toBeNull();
  });
});
