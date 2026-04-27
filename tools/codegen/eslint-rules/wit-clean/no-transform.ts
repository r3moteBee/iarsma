/**
 * Rule: no-transform — flag `z.transform(...)` calls in capability schemas.
 *
 * Transformations encode behavior in the schema, which fights the
 * "schema is a static contract" principle and has no WIT equivalent. For
 * type coercions (string→number, ISO string→Date), use `z.coerce.*`
 * (which is WIT-clean because it doesn't capture an arbitrary closure).
 * For non-coercive transformations, do them in implementation code.
 *
 * Severity: warning. Override per-occurrence with `// @migration-cost: ...`.
 */

import { createRule, hasMigrationCostOverride, isMethodCall } from './shared.js';

export const noTransform = createRule({
  name: 'no-transform',
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Disallow z.transform() in capability schemas — not WIT-clean (D-036).',
    },
    schema: [],
    messages: {
      transformFound:
        'z.transform is not WIT-clean (D-036). Use z.coerce.* for type ' +
        'coercions, or move the transformation into implementation code, or ' +
        'annotate with `// @migration-cost: <reason>` to accept the migration cost.',
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      CallExpression(node) {
        if (!isMethodCall(node, 'transform')) return;
        if (hasMigrationCostOverride(context, node)) return;
        context.report({ node, messageId: 'transformFound' });
      },
    };
  },
});
