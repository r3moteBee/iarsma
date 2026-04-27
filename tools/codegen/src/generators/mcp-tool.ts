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

import type { CapabilityAST } from '../types.js';
import { jsonSchemaForCapability, type JSONSchema } from './json-schema.js';

export type McpToolRegistration = {
  /** Dotted-path tool name, e.g. "session.get". */
  readonly name: string;
  /** One-line description shown to agents. */
  readonly description: string;
  /** Required scope set; agent's token must include all of these. */
  readonly requiredScopes: readonly string[];
  /** JSON Schema for tool input. */
  readonly inputSchema: JSONSchema;
  /** JSON Schema for tool output (for response validation / docs). */
  readonly outputSchema: JSONSchema;
  /** True if invocation mutates external state (gates dry-run requirement). */
  readonly isDestructive: boolean;
  /** Examples for tool documentation. */
  readonly examples: readonly { title: string; input: unknown; output: unknown }[];
};

export function mcpToolForCapability(cap: CapabilityAST): McpToolRegistration {
  const schemas = jsonSchemaForCapability(cap);
  return {
    name: cap.name,
    description: cap.description,
    requiredScopes: cap.scopes,
    inputSchema: schemas.input,
    outputSchema: schemas.output,
    isDestructive: cap.isDestructive,
    examples: cap.examples.map((e) => ({
      title: e.title,
      input: e.input,
      output: e.output,
    })),
  };
}
