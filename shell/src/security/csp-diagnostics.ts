/**
 * Runtime CSP diagnostics.
 *
 * The meta CSP's `connect-src` is fixed at build time, but the JMAP / OIDC
 * endpoints come from config.json or the JMAP session at runtime. When
 * those point at an origin the policy doesn't list, every call fails as an
 * opaque "Failed to fetch". This turns that into one actionable console
 * warning naming the blocked origin and the fix (docs/deployment.md,
 * "Content-Security-Policy"). Diagnostic only: it never changes behaviour,
 * and it is a no-op when the page carries no CSP <meta> (dev server, tests).
 */

import { parseCsp } from './csp.js';

const WS_TO_HTTP: Readonly<Record<string, string>> = { 'ws:': 'http:', 'wss:': 'https:' };

/**
 * Does a `connect-src` source list allow `target`? Covers the source forms
 * this app's policy and IARSMA_CSP_CONNECT_SRC can produce ('self', '*',
 * scheme sources, origins with an optional `*.` host wildcard); unknown
 * forms count as non-matching, which can only over-warn.
 */
export function connectSrcAllows(sources: readonly string[], target: string, selfOrigin: string): boolean {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return true; // Not an absolute URL: relative to self.
  }
  // CSP3: 'self' and http(s) sources also cover the matching ws(s) scheme.
  const httpProtocol = WS_TO_HTTP[url.protocol] ?? url.protocol;
  const httpOrigin = `${httpProtocol}//${url.host}`;
  return sources.some((source) => {
    if (source === "'self'") return httpOrigin === selfOrigin;
    if (source === '*') return ['http:', 'https:'].includes(httpProtocol);
    if (/^[a-z][a-z0-9+.-]*:$/i.test(source)) {
      return source === url.protocol || source === httpProtocol || (source === 'http:' && httpProtocol === 'https:');
    }
    const m = /^([a-z][a-z0-9+.-]*:)\/\/(\*\.)?([^/:]+)(:\d+)?/i.exec(source);
    if (m === null) return false;
    const [, scheme, wildcard, host, port] = m;
    if (scheme !== url.protocol && scheme !== httpProtocol) return false;
    const hostOk =
      wildcard !== undefined ? url.hostname.endsWith(`.${host}`) : url.hostname === host?.toLowerCase();
    const portOk = port !== undefined ? port.slice(1) === url.port : url.port === '';
    return hostOk && portOk;
  });
}

/** The `connect-src` (or `default-src`) list of the page's CSP <meta>, if any. */
function pageConnectSrc(doc: Document): string[] | null {
  const meta = doc.querySelector('meta[http-equiv="Content-Security-Policy" i]');
  const content = meta?.getAttribute('content');
  if (content === null || content === undefined) return null;
  const directives = parseCsp(content);
  return directives.get('connect-src') ?? directives.get('default-src') ?? null;
}

/**
 * Warn once per call about any of `urls` the page's CSP would block.
 * Returns the blocked origins (for tests).
 */
export function warnIfCspBlocksConnect(
  urls: readonly (string | undefined)[],
  where: string,
  doc: Document | undefined = typeof document === 'undefined' ? undefined : document,
): string[] {
  if (doc === undefined) return [];
  const sources = pageConnectSrc(doc);
  const selfOrigin = doc.location?.origin;
  if (sources === null || selfOrigin === undefined) return [];
  const blocked = new Set<string>();
  for (const url of urls) {
    if (url === undefined || connectSrcAllows(sources, url, selfOrigin)) continue;
    blocked.add(new URL(url).origin);
  }
  if (blocked.size > 0) {
    console.warn(
      `[iarsma] ${where} points at ${[...blocked].join(', ')}, which this build's ` +
        'Content-Security-Policy (connect-src) blocks. Rebuild with ' +
        'IARSMA_CSP_CONNECT_SRC="<origins>" or add them to connect-src in index.html. ' +
        'See docs/deployment.md, "Content-Security-Policy".',
    );
  }
  return [...blocked];
}
