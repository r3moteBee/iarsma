/**
 * Rule: no-refine — flag `z.refine(...)` calls in capability schemas.
 *
 * `z.refine` does not have a clean WIT equivalent. Migration to WIT
 * everywhere would require porting each refine to validation code.
 * Recommended alternative: move the validation predicate into
 * implementation code (apply after Zod's structural parse) so the schema
 * stays declarative and WIT-portable.
 *
 * Severity: warning. Override per-occurrence with `// @migration-cost: ...`.
 */

import { createRule, hasMigrationCostOverride, isMethodCall } from './shared.js';

export const noRefine = createRule({
  name: 'no-refine',
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Disallow z.refine() in capability schemas — not WIT-clean (D-036).',
    },
    schema: [],
    messages: {
      refineFound:
        'z.refine is not WIT-clean (D-036). Move the predicate into implementation ' +
        'code, or annotate with `// @migration-cost: <reason>` to accept the ' +
        'per-capability migration cost when porting to WIT.',
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      CallExpression(node) {
        if (!isMethodCall(node, 'refine')) return;
        if (hasMigrationCostOverride(context, node)) return;
        context.report({ node, messageId: 'refineFound' });
      },
    };
  },
});
