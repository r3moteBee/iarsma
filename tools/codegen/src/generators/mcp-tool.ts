/**
 * MCP tool registration generator. Produces the registration object that the
 * MCP server consumes when exposing a capability as a tool to agents.
 *
 * The output is intentionally JSON-serializable: the MCP server can read it
 * from a file at startup, so there's no compile-time coupling between the
 * codegen package and the mcp-server package. Loose coupling = simpler builds.
 *
 * The `requiredScopes` field is what the MCP server uses to filter the tool
 * surface presented to each agent: an agent's token's scope set must be a
 * superset of `requiredScopes` for the tool to appear (D-021 / D-036).
 *
 * The `isDestructive` field is what the MCP server uses to gate dry-run:
 * destructive tools must execute the propose/preview/approve/commit pattern
 * (project brief, "Agent/Human Collaboration Model").
 */

import { errorEnvelopeJsonSchema, type CapabilityAST, type Stability } from '../types.js';
import { jsonSchemaForCapability, type JSONSchema } from './json-schema.js';

export type McpToolRegistration = {
  /** Dotted-path tool name, e.g. "session.get". */
  readonly name: string;
  /**
   * Semver version of the contract (D-044). Wired through to consumers for
   * pinning and migration detection per `docs/schema-migration.md`.
   */
  readonly version: string;
  /** Stability annotation (D-045). */
  readonly stability: Stability;
  /** One-line description shown to agents. */
  readonly description: string;
  /** Required scope set; agent's token must include all of these. */
  readonly requiredScopes: readonly string[];
  /** JSON Schema for tool input. */
  readonly inputSchema: JSONSchema;
  /** JSON Schema for tool output (for response validation / docs). */
  readonly outputSchema: JSONSchema;
  /**
   * JSON Schema for the workspace error envelope (D-043). Carried on every
   * tool registration so MCP consumers don't have to compose it themselves.
   * In the JSON-RPC error response the envelope lives in `error.data`.
   */
  readonly errorEnvelopeSchema: JSONSchema;
  /** True if invocation mutates external state (gates dry-run requirement). */
  readonly isDestructive: boolean;
  /**
   * Per-tool error codes a consumer should expect to see in `errorEnvelope.code`.
   * Empty array means "tool only emits transport-level errors (transport, scope,
   * schema-validation)" — those still flow through the envelope shape.
   */
  readonly errorCodes: readonly { code: string; description: string }[];
  /** Examples for tool documentation. */
  readonly examples: readonly { title: string; input: unknown; output: unknown }[];
};

export function mcpToolForCapability(cap: CapabilityAST): McpToolRegistration {
  const schemas = jsonSchemaForCapability(cap);
  return {
    name: cap.name,
    version: cap.version,
    stability: cap.stability,
    description: cap.description,
    requiredScopes: cap.scopes,
    inputSchema: schemas.input,
    outputSchema: schemas.output,
    errorEnvelopeSchema: errorEnvelopeJsonSchema(),
    isDestructive: cap.isDestructive,
    errorCodes: cap.errors.map((e) => ({ code: e.code, description: e.description })),
    examples: cap.examples.map((e) => ({
      title: e.title,
      input: e.input,
      output: e.output,
    })),
  };
}
