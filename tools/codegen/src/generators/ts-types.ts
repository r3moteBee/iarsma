/**
 * TypeScript types generator. Renders TypeNode → TS type expression as a
 * string. Used by the React hook generator to inline `Input` / `Output`
 * types into the generated hook file (decision (c) from the F-3 design
 * conversation: emit plain TS types, no Zod runtime in the shell).
 *
 * The output is human-readable TS source — multi-line for records,
 * with JSDoc descriptions preserved on fields.
 */

import type { Field, TypeNode, VariantCase } from '../types.js';

/**
 * Render a TypeNode as a TypeScript type expression. The `indent` parameter
 * is used for record fields so nested objects format with consistent
 * indentation.
 */
export function typeNodeToTypeScript(node: TypeNode, indent = ''): string {
  switch (node.kind) {
    case 'string':
      return 'string';
    case 'number':
      // TypeScript has no separate `integer` type; integer constraint is
      // enforced at the JSON Schema layer. Both render as `number`.
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'option':
      return `${typeNodeToTypeScript(node.inner, indent)} | null`;
    case 'list':
      return `Array<${typeNodeToTypeScript(node.element, indent)}>`;
    case 'record':
      return renderRecord(node.fields, indent);
    case 'variant':
      return renderVariant(node.cases, indent);
    case 'enum':
      return node.values.map((v) => `'${v}'`).join(' | ');
    case 'unit':
      return 'Record<string, never>';
  }
}

function renderRecord(fields: readonly Field[], indent: string): string {
  if (fields.length === 0) return 'Record<string, never>';
  const innerIndent = `${indent}  `;
  const lines: string[] = ['{'];
  for (const f of fields) {
    if (f.description !== undefined && f.description.length > 0) {
      lines.push(`${innerIndent}/** ${escapeJsDoc(f.description)} */`);
    }
    const opt = f.optional ? '?' : '';
    lines.push(`${innerIndent}${f.name}${opt}: ${typeNodeToTypeScript(f.type, innerIndent)};`);
  }
  lines.push(`${indent}}`);
  return lines.join('\n');
}

function renderVariant(cases: readonly VariantCase[], indent: string): string {
  if (cases.length === 0) return 'never';
  return cases
    .map((c) => {
      if (c.payload === null) {
        return `{ tag: '${c.tag}' }`;
      }
      return `{ tag: '${c.tag}'; payload: ${typeNodeToTypeScript(c.payload, indent)} }`;
    })
    .join('\n  | ');
}

function escapeJsDoc(s: string): string {
  // Prevent prematurely closing the JSDoc comment.
  return s.replace(/\*\//g, '*\\/');
}
