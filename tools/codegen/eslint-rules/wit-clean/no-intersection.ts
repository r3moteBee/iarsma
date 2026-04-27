/**
 * Rule: no-intersection — flag `z.intersection(a, b)` calls.
 *
 * For intersecting two object schemas, use `.merge(other)`, which produces
 * a single record with the union of the two field sets. WIT records map
 * cleanly; intersections do not.
 *
 * Severity: warning. Override per-occurrence with `// @migration-cost: ...`.
 */

import { createRule, hasMigrationCostOverride, isZodTopLevelCall } from './shared.js';

export const noIntersection = createRule({
  name: 'no-intersection',
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Disallow z.intersection() in capability schemas — not WIT-clean (D-036).',
    },
    schema: [],
    messages: {
      intersectionFound:
        'z.intersection is not WIT-clean (D-036). Use .merge() to combine ' +
        'object schemas (which produces a single record), or annotate with ' +
        '`// @migration-cost: <reason>` to accept the migration cost.',
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      CallExpression(node) {
        if (!isZodTopLevelCall(node, 'intersection')) return;
        if (hasMigrationCostOverride(context, node)) return;
        context.report({ node, messageId: 'intersectionFound' });
      },
    };
  },
});
