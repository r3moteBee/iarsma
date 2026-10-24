/**
 * Content-Security-Policy pinning tests.
 *
 * The policy lives in a <meta> in shell/index.html (Stalwart's Web Apps
 * host can't send response headers). These tests parse the real file so a
 * loosened directive, a new inline script without a hash, or a moved meta
 * fails CI rather than silently weakening or breaking the deployed shell.
 * The build-time transform (src/security/csp.ts, wired in vite.config.ts) is
 * covered below it.
 */

import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  cspConnectOrigins,
  extractCspPolicy,
  parseCsp,
  stripMonacoCdnDefault,
  transformCspMeta,
} from '../security/csp.js';

const SHELL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const INDEX_HTML = readFileSync(join(SHELL_DIR, 'index.html'), 'utf8');

function policy(): Map<string, string[]> {
  const raw = extractCspPolicy(INDEX_HTML);
  expect(raw, 'index.html must carry a CSP <meta>').not.toBeNull();
  return parseCsp(raw ?? '');
}

/** Bodies of classic inline <script> elements (no src attribute). */
function inlineScripts(html: string): string[] {
  return [...html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script\s*>/gi)]
    .filter((m) => !/\bsrc\s*=/.test(m[1] ?? ''))
    .map((m) => m[2] ?? '');
}

describe('index.html Content-Security-Policy', () => {
  it('pins every directive', () => {
    const p = policy();
    const hashes = (p.get('script-src') ?? []).filter((s) => s.startsWith("'sha256-"));
    expect(Object.fromEntries(p)).toEqual({
      'default-src': ["'self'"],
      // jco instantiates the WASM components with WebAssembly.compile /
      // compileStreaming, which CSP gates behind 'wasm-unsafe-eval'.
      'script-src': ["'self'", "'wasm-unsafe-eval'", ...hashes],
      // React style={} attributes, sanitized mail-body style attributes,
      // and Monaco's runtime <style> injection all need inline styles.
      'style-src': ["'self'", "'unsafe-inline'"],
      // https: is required by the per-message "Show external images"
      // opt-in (a meta CSP can't be relaxed at runtime). The sanitizer is
      // what blocks remote images by default.
      'img-src': ["'self'", 'data:', 'blob:', 'https:'],
      // JMAP, EventSource push and OIDC are same-origin on Stalwart; the
      // Files view talks to the GitHub REST API.
      'connect-src': ["'self'", 'https://api.github.com'],
      // Monaco workers are same-origin Vite chunks handed out by
      // MonacoEnvironment.getWorker, so Monaco never falls back to blob:.
      'worker-src': ["'self'"],
      'object-src': ["'none'"],
      'base-uri': ["'none'"],
      'form-action': ["'self'"],
    });
  });

  it('never allows eval, inline script by keyword, or remote script hosts', () => {
    const scriptSrc = policy().get('script-src') ?? [];
    for (const forbidden of ["'unsafe-eval'", "'unsafe-inline'", "'strict-dynamic'", '*', 'https:', 'data:', 'blob:']) {
      expect(scriptSrc).not.toContain(forbidden);
    }
    expect(scriptSrc.filter((s) => /^https?:\/\//.test(s))).toEqual([]);
  });

  it('hashes exactly the inline scripts present (theme bootstrap)', () => {
    const scripts = inlineScripts(INDEX_HTML);
    expect(scripts.length).toBeGreaterThan(0);
    const expected = scripts.map(
      (body) => `'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`,
    );
    const actual = (policy().get('script-src') ?? []).filter((s) => s.startsWith("'sha256-"));
    // On failure after editing the inline script, copy the expected hash
    // into index.html's script-src.
    expect(actual).toEqual(expected);
  });

  it('places the policy before any script so it governs all of them', () => {
    const metaAt = INDEX_HTML.search(/<meta\s+http-equiv="Content-Security-Policy"/i);
    const firstScriptAt = INDEX_HTML.search(/<script[\s>]/i);
    expect(metaAt).toBeGreaterThan(-1);
    expect(metaAt).toBeLessThan(firstScriptAt);
    // Exactly one policy: a second <meta> would intersect, not override.
    expect(INDEX_HTML.match(/http-equiv="Content-Security-Policy"/gi)).toHaveLength(1);
  });

  it('has no inline event-handler attributes (blocked by the policy)', () => {
    expect(INDEX_HTML).not.toMatch(/<[^>]+\son[a-z]+\s*=/i);
  });

  it('sends no Referer (mail URLs and remote image loads stay private)', () => {
    expect(INDEX_HTML).toMatch(/<meta\s+name="referrer"\s+content="no-referrer"\s*\/?>/i);
  });
});

describe('transformCspMeta', () => {
  it('build with no extra origins leaves the HTML byte-identical', () => {
    expect(transformCspMeta(INDEX_HTML, { command: 'build', extraConnectSrc: [] })).toBe(INDEX_HTML);
  });

  it('build appends extra origins to connect-src only, deduplicated', () => {
    const out = transformCspMeta(INDEX_HTML, {
      command: 'build',
      extraConnectSrc: ['https://mail.example.com', 'https://api.github.com'],
    });
    const before = policy();
    const after = parseCsp(extractCspPolicy(out) ?? '');
    expect(after.get('connect-src')).toEqual(["'self'", 'https://api.github.com', 'https://mail.example.com']);
    for (const [name, sources] of before) {
      if (name !== 'connect-src') expect(after.get(name)).toEqual(sources);
    }
  });

  it('serve strips the policy (dev server injects unhashed inline scripts)', () => {
    const out = transformCspMeta(INDEX_HTML, { command: 'serve', extraConnectSrc: [] });
    expect(extractCspPolicy(out)).toBeNull();
    expect(out).toContain('name="referrer"');
  });

  it('build refuses HTML without a policy', () => {
    expect(() =>
      transformCspMeta('<html><head></head></html>', { command: 'build', extraConnectSrc: [] }),
    ).toThrow(/no Content-Security-Policy/);
  });
});

describe('cspConnectOrigins', () => {
  it('collects explicit and VITE_* origins as bare, deduplicated origins', () => {
    expect(
      cspConnectOrigins({
        IARSMA_CSP_CONNECT_SRC: 'https://mail.example.com/jmap, wss://push.example.com  ',
        VITE_OIDC_ISSUER: 'https://mail.example.com',
        VITE_JMAP_BASE_URL: 'https://jmap.example.com/base/',
      }),
    ).toEqual(['https://mail.example.com', 'wss://push.example.com', 'https://jmap.example.com']);
  });

  it('is empty for a same-origin build', () => {
    expect(cspConnectOrigins({})).toEqual([]);
    expect(cspConnectOrigins({ IARSMA_CSP_CONNECT_SRC: '' })).toEqual([]);
  });

  it.each(['*', 'https:', "'unsafe-eval'", 'mail.example.com', 'javascript:alert(1)', 'data:text/plain,x'])(
    'rejects %j instead of widening the policy',
    (entry) => {
      expect(() => cspConnectOrigins({ IARSMA_CSP_CONNECT_SRC: entry })).toThrow(/iarsma-csp/);
    },
  );
});

describe('stripMonacoCdnDefault', () => {
  it('blanks the CDN default in the installed @monaco-editor/loader', () => {
    // Read the real file so an upstream format change that slips past the
    // regex fails here, not silently in the bundle.
    const reactPkg = realpathSync(join(SHELL_DIR, 'node_modules', '@monaco-editor', 'react'));
    const configJs = readFileSync(
      join(reactPkg, '..', 'loader', 'lib', 'es', 'config', 'index.js'),
      'utf8',
    );
    expect(configJs).toContain('cdn.jsdelivr.net');
    expect(stripMonacoCdnDefault(configJs)).not.toContain('jsdelivr');
  });
});
