/**
 * Iarsma capability-contract codegen.
 *
 * Public surface re-exported for contract authors and generator
 * implementations. Authors only need `capability` (and `z` from zod).
 * Generator implementations consume the AST types and the walker.
 *
 * The CLI entrypoint is `src/run.ts` — invoked by `pnpm codegen`.
 */

export type {
  CapabilityAST,
  TypeNode,
  Field,
  VariantCase,
  ErrorVariant,
  Example,
} from './types.js';

export { capability } from './contract.js';
export type { Capability, CapabilityDef } from './contract.js';

export { walkZod, UnhandledZodKind } from './walk.js';

// Generators
export {
  jsonSchemaForCapability,
  typeNodeToJsonSchema,
} from './generators/json-schema.js';
export type { JSONSchema, CapabilitySchemas } from './generators/json-schema.js';

export { mcpToolForCapability } from './generators/mcp-tool.js';
export type { McpToolRegistration } from './generators/mcp-tool.js';

export { openApiForCapabilities } from './generators/openapi.js';
export type { OpenAPIDoc } from './generators/openapi.js';

export {
  markdownForCapability,
  markdownIndexForCapabilities,
  llmsTxtForCapabilities,
  typeNodeToInlineMarkdown,
} from './generators/markdown.js';

export { typeNodeToTypeScript } from './generators/ts-types.js';

export { reactHookForCapability, pascalCase } from './generators/react-hook.js';

// Pipeline
export {
  generateArtifacts,
  loadCapabilities,
  writeArtifacts,
  run,
  safeName,
  isCapability,
} from './run.js';
export type {
  GeneratedArtifacts,
  PerCapabilityArtifacts,
  RunOptions,
} from './run.js';
