/**
 * Capability scope filter — decides which tools an agent can see/call based
 * on its token's scope set.
 *
 * Scope semantics from `docs/capability-scopes.md`:
 *   - Scopes are additive. An agent with `mail:read` does NOT implicitly get
 *     `mail:read.metadata` (or vice versa). Both must be declared explicitly.
 *   - A tool is callable iff the agent's scope set is a superset of the
 *     tool's `requiredScopes`.
 *   - The wildcard `admin:*` matches any `admin:<x>` scope by convention but
 *     is reserved for human use.
 */

export type ScopeSet = ReadonlySet<string>;

/**
 * Make a normalized scope set from a list of scope strings. Trims whitespace
 * and discards empty entries.
 */
export function makeScopeSet(scopes: readonly string[]): ScopeSet {
  const set = new Set<string>();
  for (const s of scopes) {
    const trimmed = s.trim();
    if (trimmed.length > 0) set.add(trimmed);
  }
  return set;
}

/**
 * True if `held` includes every scope in `required`. The wildcard
 * `admin:*` in `held` matches any `admin:<x>` in `required`.
 */
export function hasAllScopes(held: ScopeSet, required: readonly string[]): boolean {
  if (required.length === 0) return true;
  for (const req of required) {
    if (held.has(req)) continue;
    if (req.startsWith('admin:') && held.has('admin:*')) continue;
    return false;
  }
  return true;
}

/**
 * Return the subset of `tools` whose `requiredScopes` are all satisfied by
 * `held`. Used to filter the tool list returned to an agent on `listTools`.
 */
export function visibleTools<T extends { requiredScopes: readonly string[] }>(
  tools: readonly T[],
  held: ScopeSet,
): T[] {
  return tools.filter((t) => hasAllScopes(held, t.requiredScopes));
}
