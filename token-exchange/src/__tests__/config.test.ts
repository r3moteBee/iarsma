/**
 * Config loader tests. Verifies env-based config parsing, defaults, and
 * actionable error messages on misconfiguration.
 */

import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../config.js';

const baseEnv = {
  OIDC_ISSUER: 'https://sw-mail.example.net',
  OIDC_CLIENT_ID: 'webmail',
  OIDC_CLIENT_SECRET: 's3cr3t',
  TOKEN_EXCHANGE_ALLOWED_REDIRECT_URIS:
    'http://localhost:5173/auth/callback,https://app.example.net/auth/callback',
};

describe('loadConfig', () => {
  it('parses a valid environment', () => {
    const cfg = loadConfig(baseEnv as NodeJS.ProcessEnv);
    expect(cfg.oidcIssuer).toBe('https://sw-mail.example.net');
    expect(cfg.clientId).toBe('webmail');
    expect(cfg.clientSecret).toBe('s3cr3t');
    expect(cfg.port).toBe(4000);
    expect(cfg.allowedRedirectUris).toEqual([
      'http://localhost:5173/auth/callback',
      'https://app.example.net/auth/callback',
    ]);
    expect(cfg.corsOrigins).toEqual([]);
    expect(cfg.tokenEndpoint).toBeUndefined();
    // Fail-safe default: loopback, not all-interfaces (U-2 / High-2).
    expect(cfg.host).toBe('127.0.0.1');
  });

  it('respects custom port', () => {
    const cfg = loadConfig({ ...baseEnv, TOKEN_EXCHANGE_PORT: '4321' } as NodeJS.ProcessEnv);
    expect(cfg.port).toBe(4321);
  });

  it('respects a custom bind host', () => {
    const cfg = loadConfig({ ...baseEnv, TOKEN_EXCHANGE_HOST: '0.0.0.0' } as NodeJS.ProcessEnv);
    expect(cfg.host).toBe('0.0.0.0');
  });

  it('parses CORS origins as a CSV', () => {
    const cfg = loadConfig({
      ...baseEnv,
      TOKEN_EXCHANGE_CORS_ORIGINS: 'https://a.example, https://b.example',
    } as NodeJS.ProcessEnv);
    expect(cfg.corsOrigins).toEqual(['https://a.example', 'https://b.example']);
  });

  it('parses an explicit token endpoint when provided', () => {
    const cfg = loadConfig({
      ...baseEnv,
      TOKEN_EXCHANGE_TOKEN_ENDPOINT: 'https://example.net/oauth/token',
    } as NodeJS.ProcessEnv);
    expect(cfg.tokenEndpoint).toBe('https://example.net/oauth/token');
  });

  it('throws ConfigError when OIDC_ISSUER is missing', () => {
    const { OIDC_ISSUER, ...rest } = baseEnv;
    void OIDC_ISSUER;
    expect(() => loadConfig(rest as NodeJS.ProcessEnv)).toThrow(ConfigError);
  });

  it('throws ConfigError when OIDC_ISSUER is not a URL', () => {
    expect(() =>
      loadConfig({ ...baseEnv, OIDC_ISSUER: 'not-a-url' } as NodeJS.ProcessEnv),
    ).toThrow(ConfigError);
  });

  it('throws ConfigError when redirect-URIs list is empty', () => {
    expect(() =>
      loadConfig({
        ...baseEnv,
        TOKEN_EXCHANGE_ALLOWED_REDIRECT_URIS: '',
      } as NodeJS.ProcessEnv),
    ).toThrow(ConfigError);
  });

  it('error message lists the offending fields', () => {
    try {
      loadConfig({} as NodeJS.ProcessEnv);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      expect((e as Error).message).toContain('OIDC_ISSUER');
      expect((e as Error).message).toContain('OIDC_CLIENT_ID');
    }
  });
});
