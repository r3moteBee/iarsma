/**
 * Iarsma capability-contract codegen.
 *
 * Public surface re-exported for contract authors and generator implementations.
 * Authors only need `capability` and `z`. Generator implementations consume
 * the AST types and the walker.
 *
 * The codegen entrypoint (walks `contracts/*.ts`, runs every generator,
 * writes outputs) lands in a follow-up commit. F-3 foundation (this commit)
 * provides the AST, walker, capability helper, and the first generator
 * (JSON Schema) — enough for contracts to be defined and for the test
 * pipeline to validate them.
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

export {
  jsonSchemaForCapability,
  typeNodeToJsonSchema,
} from './generators/json-schema.js';
export type { JSONSchema, CapabilitySchemas } from './generators/json-schema.js';
