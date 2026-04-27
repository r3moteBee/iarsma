/**
 * Shared utilities for the `wit-clean` rule set.
 *
 * The four rules share two concerns: (1) creating a properly-typed
 * RuleCreator and (2) checking for the `@migration-cost` override comment
 * on the relevant source line.
 */

import { ESLintUtils, type TSESTree } from '@typescript-eslint/utils';

const REPO_DOC_BASE =
  'https://github.com/r3moteBee/iarsma/blob/main/docs/decisions.md';

/**
 * RuleCreator that points docs URLs at this repo's decisions log.
 * Each rule's `name` becomes the docs anchor target (we point at D-036 in
 * `description` for now; per-rule anchors can come later).
 */
export const createRule = ESLintUtils.RuleCreator(() => `${REPO_DOC_BASE}#d-036`);

/**
 * Returns true if the source line containing `node` is annotated with
 * `// @migration-cost: ...` (anywhere on that line, in any comment).
 *
 * Using `getSourceCode().getCommentsBefore(node)` would catch annotations
 * one line above; we use line-on-line comments to keep override scope
 * unambiguous: the annotation must be on the same line as the violating
 * call. This makes the override surgical — overriding `z.refine(...)` does
 * not silently override a different violation later in the same expression.
 */
export function hasMigrationCostOverride(
  context: Readonly<{ sourceCode: { getAllComments(): TSESTree.Comment[] } }>,
  node: TSESTree.Node,
): boolean {
  const startLine = node.loc?.start.line;
  if (startLine === undefined) return false;
  const comments = context.sourceCode.getAllComments();
  return comments.some(
    (c) =>
      c.loc?.start.line === startLine &&
      /@migration-cost\b/i.test(c.value),
  );
}

/**
 * Returns true if `node` is a CallExpression whose callee is a MemberExpression
 * matching the chain `<...>.method(...)` — i.e. the rightmost member of the
 * callee is named `method`.
 *
 * Examples that match `isMethodCall(node, 'refine')`:
 *   z.string().refine(...)
 *   someSchema.refine(...)
 *   z.object({...}).optional().refine(...)
 */
export function isMethodCall(
  node: TSESTree.Node,
  method: string,
): node is TSESTree.CallExpression {
  if (node.type !== 'CallExpression') return false;
  const callee = node.callee;
  if (callee.type !== 'MemberExpression') return false;
  if (callee.computed) return false;
  const prop = callee.property;
  return prop.type === 'Identifier' && prop.name === method;
}

/**
 * Returns true if `node` is a CallExpression whose callee is the `z.<fn>`
 * top-level helper — e.g., `z.intersection(a, b)`.
 */
export function isZodTopLevelCall(
  node: TSESTree.Node,
  fn: string,
): node is TSESTree.CallExpression {
  if (node.type !== 'CallExpression') return false;
  const callee = node.callee;
  if (callee.type !== 'MemberExpression' || callee.computed) return false;
  const obj = callee.object;
  const prop = callee.property;
  return (
    obj.type === 'Identifier' &&
    obj.name === 'z' &&
    prop.type === 'Identifier' &&
    prop.name === fn
  );
}
