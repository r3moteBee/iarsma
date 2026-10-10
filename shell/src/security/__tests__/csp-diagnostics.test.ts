/**
 * @vitest-environment jsdom
 *
 * Runtime CSP diagnostics: a config.json / JMAP session that points at an
 * origin the build's connect-src doesn't list must produce one actionable
 * warning instead of a wall of opaque "Failed to fetch" errors.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectSrcAllows, warnIfCspBlocksConnect } from '../csp-diagnostics.js';

const SELF = 'https://mail.example.com';

describe('connectSrcAllows', () => {
  const policy = ["'self'", 'https://api.github.com', 'https://*.example.org', 'wss:'];

  it.each([
    ['https://mail.example.com/jmap/', true],
    ['wss://mail.example.com/push', true], // 'self' covers the ws(s) twin
    ['https://api.github.com/repos/x', true],
    ['https://a.b.example.org/', true],
    ['wss://anything.test/', true],
    ['relative/path', true],
    ['https://example.org/', false], // *.example.org needs a subdomain
    ['http://api.github.com/', false],
    ['https://api.github.com:8443/', false],
    ['https://evil.test/', false],
  ])('%s -> %s', (target, allowed) => {
    expect(connectSrcAllows(policy, target, SELF)).toBe(allowed);
  });

  it("'*' allows any http(s) origin; an empty list allows nothing", () => {
    expect(connectSrcAllows(['*'], 'https://evil.test/', SELF)).toBe(true);
    expect(connectSrcAllows([], 'https://mail.example.com/', SELF)).toBe(false);
  });
});

describe('warnIfCspBlocksConnect', () => {
  afterEach(() => {
    document.head.innerHTML = '';
    vi.restoreAllMocks();
  });

  function withPolicy(content: string): void {
    const meta = document.createElement('meta');
    meta.setAttribute('http-equiv', 'Content-Security-Policy');
    meta.setAttribute('content', content);
    document.head.appendChild(meta);
  }

  it('warns once, naming each blocked origin, and skips allowed/undefined URLs', () => {
    withPolicy("default-src 'self'; connect-src 'self' https://api.github.com");
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const blocked = warnIfCspBlocksConnect(
      [
        `${window.location.origin}/jmap`,
        'https://jmap.other.test/api',
        'https://jmap.other.test/download/{accountId}',
        undefined,
        'https://auth.other.test',
      ],
      'config.json',
    );
    expect(blocked).toEqual(['https://jmap.other.test', 'https://auth.other.test']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/config\.json .*jmap\.other\.test.*IARSMA_CSP_CONNECT_SRC/);
  });

  it('falls back to default-src when connect-src is absent', () => {
    withPolicy("default-src 'self'");
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(warnIfCspBlocksConnect(['https://jmap.other.test/'], 'x')).toEqual(['https://jmap.other.test']);
  });

  it('is silent with no CSP <meta> (dev server, tests) or when everything is allowed', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(warnIfCspBlocksConnect(['https://jmap.other.test/'], 'x')).toEqual([]);
    withPolicy("connect-src 'self'");
    expect(warnIfCspBlocksConnect([`${window.location.origin}/jmap`], 'x')).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });
});
