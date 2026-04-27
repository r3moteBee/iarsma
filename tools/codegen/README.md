# @iarsma/codegen

Capability-contract codegen for Iarsma. Single source of truth for what every capability looks like; generators produce JSON Schema, MCP tool registrations, OpenAPI docs, and (later) React hooks and docs pages from one definition.

See [docs/decisions.md](../../docs/decisions.md) entries D-020, D-021, D-035, D-036, D-037 for the full architecture and [docs/implementation-plan.md](../../docs/implementation-plan.md) F-3 + Phase 0 work item 4a for the build order.

## Layout

```
tools/codegen/
├── contracts/                       # capability contracts (Zod schemas)
│   └── session.ts                   # the F-3 smoke-test capability
├── src/
│   ├── types.ts                     # the intermediate AST (D-035)
│   ├── walk.ts                      # Zod → AST walker; fails loud on WIT-clean violations
│   ├── contract.ts                  # capability() helper — entry point for authors
│   ├── run.ts                       # codegen entrypoint (loadCapabilities → generateArtifacts → writeArtifacts)
│   ├── generators/
│   │   ├── json-schema.ts           # AST → JSON Schema
│   │   ├── mcp-tool.ts              # AST → MCP tool registration
│   │   └── openapi.ts               # AST list → OpenAPI 3.1 doc
│   ├── __tests__/                   # vitest tests for the codegen pipeline
│   └── index.ts                     # public re-exports
└── eslint-rules/
    └── wit-clean/                   # local ESLint rules (D-036)
        ├── index.ts
        ├── shared.ts
        ├── no-refine.ts
        ├── no-transform.ts
        ├── no-intersection.ts
        ├── no-branded.ts
        └── __tests__/
```

## Running

```bash
pnpm --filter '@iarsma/codegen' run codegen   # walks contracts/, writes dist/
pnpm --filter '@iarsma/codegen' run test      # runs vitest
just codegen                                  # alias for the first
```

Outputs land in `dist/`:

```
dist/
├── openapi.json                                  # full OpenAPI 3.1 doc
├── schemas/
│   ├── <name>.input.schema.json                  # per-capability input schema
│   └── <name>.output.schema.json                 # per-capability output schema
└── tools/
    └── <name>.json                               # MCP tool registration (consumed by mcp-server)
```

## Authoring a capability

```ts
import { z } from 'zod';
import { capability } from '../src/index.js';

export const myCapability = capability({
  name: 'my.capability',
  scopes: ['some:scope'],
  description: 'One-line human description.',
  // isDestructive: true,    // gates dry-run
  input: z.object({ /* ... */ }),
  output: z.object({ /* ... */ }),
  examples: [
    { title: '...', input: { /* ... */ }, output: { /* ... */ } },
  ],
});
```

The walker rejects `z.refine`, `z.transform`, `z.intersection`, branded types, non-discriminated `z.union`, `z.tuple`, `z.record`, `z.date`, and several other Zod features that have no clean WIT equivalent. The ESLint rules in `eslint-rules/wit-clean/` warn at edit time before the walker hard-fails at codegen time.

If you genuinely need an exception, annotate the offending line with `// @migration-cost: <reason>` — the lint rule respects the override (the walker does not, since the codegen pipeline must produce a clean artifact regardless).

## Status

**F-3 substantially landed:**
- AST + walker + WIT-clean enforcement
- JSON Schema, MCP tool registration, and OpenAPI generators
- Pipeline orchestrator (loadCapabilities, generateArtifacts, writeArtifacts, run)
- ESLint rules for the four WIT-clean checks (warning-level)
- Tests: walker exhaustiveness, WIT-clean enforcement, generator snapshots, idempotency, integration round-trip, ESLint rule positive/negative

**Still landing in F-3 (follow-up commits):**
- React hook generator (Jotai-integrated)
- Schema-parity property tests (test category 4)
- End-to-end JMAP roundtrip (test category 6) — gated on the JMAP client component (Phase 0 work item 5)
- Markdown docs page generator (D-037)
