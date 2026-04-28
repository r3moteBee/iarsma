/**
 * Markdown docs generator (D-037). Produces one markdown page per capability
 * for ingestion by the `iarsma.io` docs site, plus an `llms.txt`-style index.
 *
 * The output is plain markdown with stable anchors (no JS framework required
 * to render), so curl/wget/agents can consume it natively. The site stack
 * (Astro/Docusaurus/etc.) is a Phase 1 decision; this generator just emits
 * source files that any markdown-aware site can include.
 */

import type {
  CapabilityAST,
  Example,
  Field,
  TypeNode,
  VariantCase,
} from '../types.js';

// ──────────────────────────────────────────────────────────────────────────
// Per-capability page
// ──────────────────────────────────────────────────────────────────────────

/**
 * Produce a markdown documentation page for a single capability. Layout:
 *
 *   # <name>
 *   <description>
 *
 *   - **Scopes:** `<scope>`, `<scope>`
 *   - **Destructive:** yes/no
 *
 *   ## Input
 *   <table>
 *
 *   ## Output
 *   <table>
 *
 *   ## Errors  (only if any)
 *
 *   ## Examples
 */
export function markdownForCapability(cap: CapabilityAST): string {
  const lines: string[] = [];

  // Heading + description
  lines.push(`# \`${cap.name}\``);
  lines.push('');
  lines.push(cap.description);
  lines.push('');

  // Front matter (scopes, destructiveness)
  lines.push(
    `- **Scopes:** ${cap.scopes.length === 0 ? '(none)' : cap.scopes.map((s) => `\`${s}\``).join(', ')}`,
  );
  lines.push(`- **Destructive:** ${cap.isDestructive ? 'yes (requires dry-run)' : 'no'}`);
  lines.push('');

  // Input
  lines.push('## Input');
  lines.push('');
  lines.push(...renderTypeAsSection(cap.input));
  lines.push('');

  // Output
  lines.push('## Output');
  lines.push('');
  lines.push(...renderTypeAsSection(cap.output));
  lines.push('');

  // Errors (if any)
  if (cap.errors.length > 0) {
    lines.push('## Errors');
    lines.push('');
    lines.push('| Code | Description |');
    lines.push('|---|---|');
    for (const err of cap.errors) {
      lines.push(`| \`${err.code}\` | ${escapeTableCell(err.description)} |`);
    }
    lines.push('');
  }

  // Examples (D-037 — required field on every contract)
  if (cap.examples.length > 0) {
    lines.push('## Examples');
    lines.push('');
    for (const ex of cap.examples) {
      lines.push(...renderExample(ex));
    }
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

function renderTypeAsSection(node: TypeNode): string[] {
  if (node.kind === 'record') {
    return renderRecordTable(node.fields);
  }
  if (node.kind === 'unit') {
    return ['_(no fields)_'];
  }
  // Non-object input/output: render the type expression.
  return [`Type: \`${typeNodeToInlineMarkdown(node)}\``];
}

function renderRecordTable(fields: readonly Field[]): string[] {
  if (fields.length === 0) {
    return ['_(no fields)_'];
  }
  const out: string[] = [];
  out.push('| Field | Type | Required | Description |');
  out.push('|---|---|---|---|');
  for (const f of fields) {
    const required = f.optional ? '' : '✓';
    // Pipe characters inside table cells must be escaped so they don't
    // break the column boundary. Type expressions like `string | null`
    // (from option<T>) and `'a' | 'b'` (from enums) trigger this.
    const typeStr = typeNodeToInlineMarkdown(f.type).replace(/\|/g, '\\|');
    out.push(
      `| \`${f.name}\` | \`${typeStr}\` | ${required} | ${escapeTableCell(f.description ?? '')} |`,
    );
  }
  return out;
}

function renderExample(ex: Example): string[] {
  return [
    `### ${ex.title}`,
    '',
    '**Input:**',
    '',
    '```json',
    JSON.stringify(ex.input, null, 2),
    '```',
    '',
    '**Output:**',
    '',
    '```json',
    JSON.stringify(ex.output, null, 2),
    '```',
    '',
  ];
}

/**
 * Render a TypeNode as a single-line markdown-safe type expression.
 * Used inside table cells, so it must not contain backticks/pipes/newlines.
 */
export function typeNodeToInlineMarkdown(node: TypeNode): string {
  switch (node.kind) {
    case 'string':
      return 'string';
    case 'number':
      return node.integer ? 'integer' : 'number';
    case 'boolean':
      return 'boolean';
    case 'option':
      return `${typeNodeToInlineMarkdown(node.inner)} | null`;
    case 'list':
      return `Array<${typeNodeToInlineMarkdown(node.element)}>`;
    case 'record':
      return inlineRecord(node.fields);
    case 'variant':
      return inlineVariant(node.cases);
    case 'enum':
      return node.values.map((v) => `'${v}'`).join(' | ');
    case 'unit':
      return 'void';
  }
}

function inlineRecord(fields: readonly Field[]): string {
  const parts = fields.map((f) => {
    const opt = f.optional ? '?' : '';
    return `${f.name}${opt}: ${typeNodeToInlineMarkdown(f.type)}`;
  });
  return `{ ${parts.join('; ')} }`;
}

function inlineVariant(cases: readonly VariantCase[]): string {
  return cases
    .map((c) =>
      c.payload === null
        ? `{ tag: '${c.tag}' }`
        : `{ tag: '${c.tag}'; payload: ${typeNodeToInlineMarkdown(c.payload)} }`,
    )
    .join(' | ');
}

function escapeTableCell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

// ──────────────────────────────────────────────────────────────────────────
// Index page (lists all capabilities by tag)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Produce an index page listing capabilities grouped by tag (the segment
 * before the first dot in the capability name).
 */
export function markdownIndexForCapabilities(caps: readonly CapabilityAST[]): string {
  const sorted = [...caps].sort((a, b) => a.name.localeCompare(b.name));
  const byTag = new Map<string, CapabilityAST[]>();
  for (const cap of sorted) {
    const tag = cap.name.split('.')[0] ?? 'general';
    const list = byTag.get(tag) ?? [];
    list.push(cap);
    byTag.set(tag, list);
  }

  const lines: string[] = [];
  lines.push('# Iarsma Capabilities');
  lines.push('');
  lines.push(
    'Auto-generated from capability contracts in `tools/codegen/contracts/`. ' +
      'See [decisions.md D-037](../decisions.md) for the documentation-generation rationale.',
  );
  lines.push('');

  const tags = [...byTag.keys()].sort();
  for (const tag of tags) {
    lines.push(`## ${tag}`);
    lines.push('');
    for (const cap of byTag.get(tag) ?? []) {
      const safeName = cap.name.replace(/\./g, '-');
      const flag = cap.isDestructive ? ' _(destructive)_' : '';
      lines.push(`- [\`${cap.name}\`](./${safeName}.md) — ${cap.description}${flag}`);
    }
    lines.push('');
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

// ──────────────────────────────────────────────────────────────────────────
// llms.txt — agent-readable site index per llmstxt.org
// ──────────────────────────────────────────────────────────────────────────

/**
 * Produce an `llms.txt`-style index per the proposed convention
 * (https://llmstxt.org/). The format is markdown with a specific structure
 * that LLMs can parse to learn what's on the site.
 *
 * Iarsma's llms.txt advertises:
 *   - The project description
 *   - The MCP discovery URN
 *   - Per-capability links so an agent can fetch one tool's docs at a time
 */
export function llmsTxtForCapabilities(
  caps: readonly CapabilityAST[],
  meta: { siteUrl?: string } = {},
): string {
  const sorted = [...caps].sort((a, b) => a.name.localeCompare(b.name));
  const base = meta.siteUrl ?? '';
  const lines: string[] = [];

  lines.push('# Iarsma');
  lines.push('');
  lines.push(
    '> JMAP webmail where agents can be colleagues without chaos — ' +
      'built-in capability scoping, dry-run evaluation, and tamper-evident auditing.',
  );
  lines.push('');
  lines.push('## Discovery');
  lines.push('');
  lines.push(
    'Iarsma extends the JMAP session resource with the `urn:iarsma:agent-context` ' +
      'capability URN. Agents that understand the URN receive `webmailMcpUrl`, ' +
      '`actionLogUrl`, and (when configured) `memoryBackendUrl` in one discovery call.',
  );
  lines.push('');
  lines.push('## Capabilities');
  lines.push('');
  for (const cap of sorted) {
    const safeName = cap.name.replace(/\./g, '-');
    const url = base ? `${base}/${safeName}.md` : `./${safeName}.md`;
    lines.push(`- [\`${cap.name}\`](${url}): ${cap.description}`);
  }
  lines.push('');
  lines.push('## Optional');
  lines.push('');
  lines.push(
    `- [OpenAPI 3.1 doc](${base ? `${base}/openapi.json` : './openapi.json'}): ` +
      'Machine-readable description of the full MCP tool surface.',
  );
  lines.push('');
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
