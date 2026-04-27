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
import type { CapabilityAST, ErrorVariant, Example } from './types.js';
import { walkZod } from './walk.js';

export type CapabilityDef<I extends z.ZodTypeAny, O extends z.ZodTypeAny> = {
  /** Dotted-path tool name, e.g. "session.get". */
  readonly name: string;
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
  /** Typed error variants. */
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
 * Define a capability contract.
 *
 * @example
 *   import { z } from 'zod';
 *   import { capability } from '../src/contract.js';
 *
 *   export const sessionGet = capability({
 *     name: 'session.get',
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
  const ast: CapabilityAST = {
    name: def.name,
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
