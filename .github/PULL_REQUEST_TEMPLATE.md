<!-- One feature per PR. Small, reviewable diffs. -->

## What this changes

<!-- One or two sentences. Optimize for the reviewer. -->

## Why

<!-- Link to a docs/decisions.md entry if this introduces a new architectural choice.
     If this implements a phase work item from docs/implementation-plan.md, link the item. -->

## Decision-log entry

<!-- Required if this PR makes an architectural choice (new dep, new component, new
     platform target, new capability scope, new contract). Otherwise: "n/a". -->

- [ ] Updates `docs/decisions.md` with rationale, OR
- [ ] n/a — no new architectural choices.

## Capability contracts

<!-- If this touches contracts: -->

- [ ] Capability schemas stay WIT-clean (no `z.refine`/`z.transform`/`z.intersection`/branded types
      without an `@migration-cost` annotation).
- [ ] Codegen output regenerated (`just codegen`) and committed.
- [ ] n/a — no contract changes.

## Tests

- [ ] Unit tests added/updated.
- [ ] axe-core a11y checks pass on touched components (if UI).
- [ ] `just test` passes locally.

## Documentation

- [ ] README / docs / inline comments updated where behavior changes.
- [ ] n/a — no behavior change.
