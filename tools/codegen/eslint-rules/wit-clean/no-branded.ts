/**
 * Rule: no-branded — flag `<schema>.brand<...>()` calls in capability schemas.
 *
 * Branded types are useful for distinguishing nominally-similar values at
 * compile time (e.g. ThreadId vs MailboxId, both string at runtime), but
 * the brand is a TypeScript-only concept with no WIT equivalent. The
 * recommended pattern is to apply the brand at the consumption site (where
 * the codegen-produced raw `string` type gets cast to `ThreadId`), keeping
 * the schema brand-free.
 *
 * Severity: warning. Override per-occurrence with `// @migration-cost: ...`.
 */

import { createRule, hasMigrationCostOverride, isMethodCall } from './shared.js';

export const noBranded = createRule({
  name: 'no-branded',
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Disallow .brand<>() in capability schemas — not WIT-clean (D-036).',
    },
    schema: [],
    messages: {
      brandedFound:
        'Branded types in capability schemas are not WIT-clean (D-036). ' +
        'Apply the brand at the consumption site (cast a generated raw type ' +
        'to a branded type in code), or annotate with ' +
        '`// @migration-cost: <reason>`.',
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      CallExpression(node) {
        if (!isMethodCall(node, 'brand')) return;
        if (hasMigrationCostOverride(context, node)) return;
        context.report({ node, messageId: 'brandedFound' });
      },
    };
  },
});
