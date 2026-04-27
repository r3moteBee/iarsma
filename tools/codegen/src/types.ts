/**
 * Iarsma capability-contract codegen — intermediate AST.
 *
 * The AST sits between the contract source (Zod schemas in TypeScript) and
 * the generators (React hooks, MCP tool registrations, JSON Schema, OpenAPI,
 * docs pages). It mirrors the WIT type system so a future migration to
 * WIT-everywhere is a serializer addition rather than a redesign (D-035).
 *
 * Generators consume this AST, never Zod directly — that's the seam that
 * makes WIT-everywhere migration cheap and that lets us evolve generators
 * independently of the input format.
 */

export type CapabilityAST = {
  /** Dotted-path tool name, e.g. "session.get", "mail.send". */
  readonly name: string;
  /** Required scopes to invoke this capability. See docs/capability-scopes.md. */
  readonly scopes: readonly string[];
  /** Human-readable description. Used in docs and tool listings. */
  readonly description: string;
  /** Whether the capability mutates external state. Drives dry-run requirement. */
  readonly isDestructive: boolean;
  /** Input shape (parameters). */
  readonly input: TypeNode;
  /** Output shape on success. */
  readonly output: TypeNode;
  /** Typed error variants. */
  readonly errors: readonly ErrorVariant[];
  /** Examples for docs and round-trip tests (D-037). */
  readonly examples: readonly Example[];
};

export type TypeNode =
  | { kind: 'string' }
  | { kind: 'number'; integer: boolean }
  | { kind: 'boolean' }
  | { kind: 'option'; inner: TypeNode }
  | { kind: 'list'; element: TypeNode }
  | { kind: 'record'; fields: readonly Field[] }
  | { kind: 'variant'; cases: readonly VariantCase[] }
  | { kind: 'enum'; values: readonly string[] }
  | { kind: 'unit' };

export type Field = {
  readonly name: string;
  readonly type: TypeNode;
  readonly optional: boolean;
  readonly description?: string;
};

export type VariantCase = {
  readonly tag: string;
  readonly payload: TypeNode | null;
  readonly description?: string;
};

export type ErrorVariant = {
  readonly code: string;
  readonly description: string;
  readonly payload?: TypeNode;
};

export type Example = {
  readonly title: string;
  readonly input: unknown;
  readonly output: unknown;
};
