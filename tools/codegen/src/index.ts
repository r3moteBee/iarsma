// Capability-contract codegen pipeline.
//
// F-3 fills this in:
//
//   contracts/*.ts (Zod schemas)
//        ↓ introspection (schema._def)
//   intermediate AST
//        ↓
//   ┌────────────┬───────────────┬───────────────┬───────────────┐
//   │ React hook │ MCP tool reg  │ JSON Schema   │ OpenAPI docs  │
//   └────────────┴───────────────┴───────────────┴───────────────┘
//
// The intermediate AST is the seam that lets us migrate to WIT-everywhere later
// (D-021). Generators consume the AST, never Zod directly.
//
// The WIT-clean lint runs alongside the codegen. It walks each schema and emits
// warnings (never failures, per D-021) when it sees:
//   - z.refine
//   - z.transform (use z.coerce.* or implement in code)
//   - z.intersection (use .merge() for objects)
//   - branded types in schemas (use TS-only consumption-site brands)
//
// Authors override per-case with an `// @migration-cost` annotation comment
// in the contract file.

console.log('codegen scaffold — implementation lands in F-3');
