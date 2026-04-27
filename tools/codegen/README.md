# @iarsma/codegen

Capability-contract codegen for Iarsma. Single source of truth for what every capability looks like; generators produce React hooks, MCP tool registrations, JSON Schema, OpenAPI, and docs pages from one definition.

See [docs/decisions.md](../../docs/decisions.md) entries D-020, D-021, D-035, D-036, D-037 for the full architecture and [docs/implementation-plan.md](../../docs/implementation-plan.md) F-3 + Phase 0 work item 4a for the build order.

## Layout

```
tools/codegen/
├── contracts/          # capability contract files (Zod schemas)
│   └── session.ts      # the F-3 smoke-test capability
├── src/
│   ├── types.ts        # the intermediate AST (D-035)
│   ├── walk.ts         # Zod → AST walker; fails loud on WIT-clean violations
│   ├── contract.ts     # capability() helper — entry point for authors
│   ├── generators/
│   │   └── json-schema.ts  # AST → JSON Schema for MCP / OpenAPI consumers
│   ├── __tests__/      # vitest tests
│   └── index.ts        # public re-exports
└── eslint-rules/       # WIT-clean lint rules (D-036) — lands in a follow-up commit
```

## Status

**F-3 foundation in place** — AST types, walker, capability helper, JSON Schema generator, and the `session.get` contract are written. Tests cover walker exhaustiveness, WIT-clean enforcement, and JSON Schema generation.

**Still landing in F-3 (follow-up commits):**
- React hook generator (`useSessionGet` etc.)
- MCP tool registration generator
- OpenAPI doc generator
- Local ESLint rule set for WIT-clean checks
- Schema-parity property tests
- Codegen entrypoint that walks `contracts/*.ts` and writes outputs

## Authoring a capability

```ts
import { z } from 'zod';
import { capability } from '../src/index.js';

export const myCapability = capability({
  name: 'my.capability',
  scopes: ['some:scope'],
  description: 'One-line human description.',
  input: z.object({ /* ... */ }),
  output: z.object({ /* ... */ }),
  examples: [
    { title: '...', input: { /* ... */ }, output: { /* ... */ } },
  ],
});
```

The walker will refuse `z.refine`, `z.transform`, `z.intersection`, branded types, non-discriminated `z.union`, `z.tuple`, `z.record`, `z.date`, and several other Zod features that have no clean WIT equivalent. See `src/walk.ts` for the full list and the recommended alternatives.
