/**
 * The `capability(...)` helper — entry point for defining a capability
 * contract.
 *
 * Authors write a contract file using Zod schemas; this helper walks them
 * into the intermediate AST that all generators consume. The Zod-typed
 * `input` and `output` are preserved on the returned object too so runtime
 * validators can still call `.parse(...)` on them — same source of truth,
 * two consumers (codegen + runtime).
 */

import type { z } from 'zod';
import type { CapabilityAST, ErrorVariant, Example, Stability } from './types.js';
import { walkZod } from './walk.js';

export type CapabilityDef<I extends z.ZodTypeAny, O extends z.ZodTypeAny> = {
  /** Dotted-path tool name, e.g. "session.get". */
  readonly name: string;
  /**
   * Semver version of this contract (D-042, D-044). Required.
   *
   * Pre-1.0 contracts default to `0.0.x` and are not stable. Bump rules:
   *   - **patch (`x.y.Z`)** — implementation-only changes; no schema diff.
   *   - **minor (`x.Y.0`)** — additive backward-compatible changes (new
   *     optional fields, new error variants, new examples).
   *   - **major (`X.0.0`)** — breaking schema changes (removed/renamed
   *     fields, type changes, required↔optional flips, dry-run preview
   *     shape changes, scope changes).
   *
   * Major-bumped contracts ship side-by-side with the previous major for
   * at least one minor bundle release. Full mechanics in
   * `docs/schema-migration.md`.
   */
  readonly version: string;
  /**
   * Stability annotation (D-045). Defaults to `'experimental'`.
   *
   * Set explicitly to `'stable'` only at the v1.0 GA milestone (the v1
   * contract set is promoted collectively). New post-v1 contracts default
   * back to `'experimental'` for one minor bundle release before being
   * promoted. `'deprecated'` marks a contract whose successor major has
   * shipped — kept registered for the side-by-side window.
   */
  readonly stability?: Stability;
  /** Required scopes from docs/capability-scopes.md. */
  readonly scopes: readonly string[];
  /** One-line human description. Used in docs and tool listings. */
  readonly description: string;
  /** True if invocation mutates external state. Defaults to false. */
  readonly isDestructive?: boolean;
  /** Input schema. Use z.object({}) for "no input." */
  readonly input: I;
  /** Output schema on success. */
  readonly output: O;
  /**
   * Typed error variants. The `code` strings flow through the workspace
   * `ErrorEnvelope`; the optional `payload` defines the shape of
   * `envelope.details` for that variant.
   */
  readonly errors?: readonly ErrorVariant[];
  /**
   * Examples for documentation (D-037) and example round-trip tests.
   * Required at runtime even if the array is empty — the field's presence
   * is what catches "I forgot to add examples for this capability."
   */
  readonly examples: readonly Example[];
};

/**
 * The fully-resolved capability — AST plus the original Zod schemas (kept
 * around for runtime validation in the shell and the MCP server).
 */
export type Capability<I extends z.ZodTypeAny, O extends z.ZodTypeAny> = {
  readonly ast: CapabilityAST;
  readonly inputSchema: I;
  readonly outputSchema: O;
};

/**
 * Strict semver pattern (`MAJOR.MINOR.PATCH` plus optional pre-release and
 * build metadata). Mirrors the semver.org BNF; lenient enough to accept
 * `0.0.0`, `1.2.3-rc.1`, `1.2.3+build.5`. Codegen rejects anything else.
 */
const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/** True if `s` is a valid semver string per the canonical pattern. */
export function isValidSemver(s: string): boolean {
  return SEMVER_RE.test(s);
}

/**
 * Define a capability contract.
 *
 * @example
 *   import { z } from 'zod';
 *   import { capability } from '../src/contract.js';
 *
 *   export const sessionGet = capability({
 *     name: 'session.get',
 *     version: '0.0.1',
 *     scopes: ['session:read'],
 *     description: 'Get the current authenticated session.',
 *     input: z.object({}),
 *     output: SessionSchema,
 *     examples: [...],
 *   });
 */
export function capability<I extends z.ZodTypeAny, O extends z.ZodTypeAny>(
  def: CapabilityDef<I, O>,
): Capability<I, O> {
  if (!isValidSemver(def.version)) {
    throw new Error(
      `capability(${def.name}): invalid version ${JSON.stringify(def.version)} — must be semver per docs/schema-migration.md`,
    );
  }
  const ast: CapabilityAST = {
    name: def.name,
    version: def.version,
    stability: def.stability ?? 'experimental',
    scopes: def.scopes,
    description: def.description,
    isDestructive: def.isDestructive ?? false,
    input: walkZod(def.input),
    output: walkZod(def.output),
    errors: def.errors ?? [],
    examples: def.examples,
  };
  return {
    ast,
    inputSchema: def.input,
    outputSchema: def.output,
  };
}
