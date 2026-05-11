/**
 * Per-tool log policy (D-052).
 *
 * Bias: log everything. Tools that are too noisy / uninteresting for an
 * audit trail opt out by name. Adding a new capability does NOT require
 * updating this file unless its calls would clutter the chain.
 */

export const EXCLUDED_FROM_LOG: ReadonlySet<string> = new Set([
  // session.get fires once per invoker construction (sign-in + initial
  // discovery). The first call is interesting; the next 50 are noise.
  // We accept losing the "user signed in and discovered" event in the
  // chain because the sign-in itself already records `auth.signin` at
  // a higher tier.
  'session.get',
]);

export function isLoggable(toolName: string): boolean {
  return !EXCLUDED_FROM_LOG.has(toolName);
}
