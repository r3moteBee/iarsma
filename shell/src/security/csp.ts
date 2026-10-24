/**
 * Build-time helpers for the Content-Security-Policy <meta> in index.html.
 *
 * index.html is the single source of truth for the policy (Stalwart's Web
 * Apps host can't add response headers, so it has to be a <meta>). The
 * `iarsma-csp` Vite plugin in vite.config.ts runs these over the HTML:
 *
 *   - `vite build`: extend `connect-src` with operator-supplied origins
 *     (`IARSMA_CSP_CONNECT_SRC`) plus the origins of any build-time
 *     `VITE_OIDC_ISSUER` / `VITE_JMAP_BASE_URL`, for deploys whose JMAP /
 *     OIDC host is not the bundle's origin. Same-origin deploys (the
 *     Stalwart default) need nothing.
 *   - `vite` (dev server): drop the policy. The dev server injects an
 *     inline React-refresh preamble and an HMR client whose hashes we
 *     can't pin; `vite preview` serves the built HTML with the policy.
 *
 * Pure string functions, no Node APIs, so they're unit-testable and type-
 * checked with the rest of src/.
 */

const CSP_META_RE = /[ \t]*<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"\s*\/?>\n?/i;

export type CspDirectives = Map<string, string[]>;

/** Extract the policy string from the CSP <meta>, or null when absent. */
export function extractCspPolicy(html: string): string | null {
  const match = CSP_META_RE.exec(html);
  return match?.[1] ?? null;
}

/** Parse `a x y; b z` into an ordered directive → sources map. */
export function parseCsp(policy: string): CspDirectives {
  const out: CspDirectives = new Map();
  for (const part of policy.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name === undefined || name === '') continue;
    // First occurrence wins, matching browser behaviour for duplicates.
    if (!out.has(name.toLowerCase())) out.set(name.toLowerCase(), sources);
  }
  return out;
}

export function serializeCsp(directives: CspDirectives): string {
  return [...directives].map(([name, sources]) => [name, ...sources].join(' ')).join('; ');
}

/**
 * Normalize one operator-supplied connect-src entry to a bare origin.
 * Only http(s)/ws(s) origins are accepted: a keyword or wildcard here
 * (`*`, `https:`, `'unsafe-eval'`) would silently gut the policy, so the
 * build fails instead.
 */
function toConnectOrigin(raw: string, source: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`iarsma-csp: ${source} entry ${JSON.stringify(raw)} is not an absolute URL`);
  }
  if (!['https:', 'http:', 'wss:', 'ws:'].includes(url.protocol) || url.host === '') {
    throw new Error(
      `iarsma-csp: ${source} entry ${JSON.stringify(raw)} must be an http(s)/ws(s) origin`,
    );
  }
  return url.origin;
}

/**
 * Origins to add to `connect-src` for a build, from the build env.
 * `IARSMA_CSP_CONNECT_SRC` is a space- or comma-separated list.
 */
export function cspConnectOrigins(env: Readonly<Record<string, string | undefined>>): string[] {
  const origins: string[] = [];
  const explicit = env['IARSMA_CSP_CONNECT_SRC'];
  if (explicit !== undefined) {
    for (const entry of explicit.split(/[\s,]+/)) {
      if (entry !== '') origins.push(toConnectOrigin(entry, 'IARSMA_CSP_CONNECT_SRC'));
    }
  }
  for (const key of ['VITE_OIDC_ISSUER', 'VITE_JMAP_BASE_URL']) {
    const value = env[key];
    if (value !== undefined && value !== '') origins.push(toConnectOrigin(value, key));
  }
  return [...new Set(origins)];
}

/**
 * Apply the build/serve policy transform to index.html. Throws when a
 * build finds no CSP <meta>: shipping without one must be a decision made
 * in index.html, not an accident of a regex miss.
 */
export function transformCspMeta(
  html: string,
  opts: { readonly command: 'build' | 'serve'; readonly extraConnectSrc: readonly string[] },
): string {
  if (opts.command === 'serve') return html.replace(CSP_META_RE, '');
  const current = extractCspPolicy(html);
  if (current === null) {
    throw new Error('iarsma-csp: index.html has no Content-Security-Policy <meta>');
  }
  if (opts.extraConnectSrc.length === 0) return html;
  const directives = parseCsp(current);
  const connect = directives.get('connect-src') ?? ["'self'"];
  directives.set('connect-src', [...new Set([...connect, ...opts.extraConnectSrc])]);
  const policy = serializeCsp(directives);
  return html.replace(CSP_META_RE, (meta) => meta.replace(current, () => policy));
}

/**
 * `@monaco-editor/loader` ships a default `paths.vs` pointing at
 * cdn.jsdelivr.net. We always call `loader.config({ monaco })` (see
 * views/monaco/setup.ts), so the default is dead code, but blanking it
 * means a regression fails closed (a same-origin 404) instead of fetching
 * third-party script, and keeps the CDN URL out of the shipped bundle.
 */
export function stripMonacoCdnDefault(code: string): string {
  return code.replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/monaco-editor@[^'"`]*/g, '');
}
