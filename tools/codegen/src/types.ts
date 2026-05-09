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
  /**
   * Semver version of the contract (D-042, D-044). Bumped when the schema
   * shape changes (input/output records, error variants, examples). Required;
   * default for new contracts is `0.0.0` until the v1.0 GA milestone.
   * Major-bumped contracts ship side-by-side with the previous major for at
   * least one minor bundle release per `docs/schema-migration.md`.
   */
  readonly version: string;
  /**
   * Stability annotation (D-045). `experimental` is the pre-1.0 default;
   * the v1.0 contract set is collectively promoted to `stable` at v1 GA;
   * `deprecated` is set on a contract whose successor major has shipped.
   */
  readonly stability: Stability;
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
  /** Typed error variants. Codes flow through the workspace `ErrorEnvelope`. */
  readonly errors: readonly ErrorVariant[];
  /** Examples for docs and round-trip tests (D-037). */
  readonly examples: readonly Example[];
};

export type Stability = 'experimental' | 'stable' | 'deprecated';

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

// ──────────────────────────────────────────────────────────────────────────
// Workspace error envelope (D-043)
// ──────────────────────────────────────────────────────────────────────────

/**
 * The workspace-wide application-level error envelope. Every consumer of
 * Iarsma's symmetric capability surface (React UI, MCP agents, native-app
 * embedders, tuatha) sees errors as this shape:
 *
 *   { code: string, message: string, details?: unknown }
 *
 * Wire mapping per surface:
 *
 *   - **MCP (JSON-RPC):** the envelope lives inside `error.data` of the
 *     JSON-RPC error response. JSON-RPC's own `error.code` is numeric and
 *     used for transport-level codes; the application-level string `code` is
 *     in `data.code`.
 *   - **OpenAPI / HTTP:** the envelope is the response body for non-2xx
 *     status codes. Referenced as `#/components/schemas/IarsmaError` in the
 *     generated OpenAPI doc.
 *   - **React hooks / library API:** the envelope is the type of the
 *     `error` field returned by the generated hook (or the value of a
 *     thrown / rejected error in the library API path).
 *
 * Per-tool error variants (`ErrorVariant[]` on the capability AST) declare
 * the set of `code` values a given tool can emit. The envelope is the
 * transport shape; variants are the per-tool contract on `code`.
 */
export type ErrorEnvelope<Code extends string = string, Details = unknown> = {
  readonly code: Code;
  readonly message: string;
  readonly details?: Details;
};

/**
 * The JSON Schema fragment for the workspace error envelope. Embedded by
 * generators into OpenAPI's `components.schemas` and referenced from every
 * non-2xx response. MCP tool registrations carry it as a top-level
 * `errorEnvelope` field so consumers don't have to compose it themselves.
 *
 * Returns a fresh object each call so callers can mutate without affecting
 * other generators (idempotency: same input → same output bytes).
 */
export function errorEnvelopeJsonSchema(): Record<string, unknown> {
  return {
    title: 'IarsmaError',
    description:
      "Workspace-wide application-level error envelope. Every consumer " +
      "(React hooks, MCP agents, native-app embedders) sees errors in this " +
      "shape. Per-tool error codes are declared on the capability contract's " +
      'error variants; this envelope is the transport.',
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description:
          "Stable, machine-readable error code. Dotted-path scoped to the " +
          "originating capability where applicable (e.g. 'mail.send.recipient_invalid').",
      },
      message: {
        type: 'string',
        description: 'Human-readable description suitable for logging and end-user surfaces.',
      },
      details: {
        description:
          "Optional structured details. Per-tool shape declared in the " +
          "capability contract's error variant payload.",
      },
    },
    required: ['code', 'message'],
    additionalProperties: false,
  };
}
