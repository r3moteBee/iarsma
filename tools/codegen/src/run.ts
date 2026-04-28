/**
 * Codegen entrypoint. Walks `contracts/*.ts`, runs every generator, writes
 * outputs to disk.
 *
 * The pipeline is structured as three pure functions plus an orchestrator:
 *
 *   loadCapabilities()  — file system in, capability ASTs out
 *   generateArtifacts() — capability ASTs in, in-memory artifacts out
 *   writeArtifacts()    — in-memory artifacts in, file system out
 *   run()               — orchestrates the three above
 *
 * Tests exercise generateArtifacts() directly with hand-built inputs (no FS
 * required), and the run() integration is exercised against a tmpdir.
 *
 * Output layout:
 *   dist/openapi.json                              — full OpenAPI 3.1 doc
 *   dist/schemas/<name>.input.schema.json          — per-cap input schema
 *   dist/schemas/<name>.output.schema.json         — per-cap output schema
 *   dist/tools/<name>.json                         — MCP tool registration
 *
 * The mcp-server reads dist/tools/*.json at startup; the docs site
 * (iarsma.io) consumes dist/openapi.json and dist/schemas/* (D-037).
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Capability } from './contract.js';
import { jsonSchemaForCapability, type JSONSchema } from './generators/json-schema.js';
import {
  llmsTxtForCapabilities,
  markdownForCapability,
  markdownIndexForCapabilities,
} from './generators/markdown.js';
import { mcpToolForCapability, type McpToolRegistration } from './generators/mcp-tool.js';
import { openApiForCapabilities, type OpenAPIDoc } from './generators/openapi.js';
import type { CapabilityAST } from './types.js';

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

export type GeneratedArtifacts = {
  /** Combined OpenAPI 3.1 doc. */
  readonly openapi: OpenAPIDoc;
  /** Markdown index page listing all capabilities. */
  readonly markdownIndex: string;
  /** llms.txt content for AI-readable site indexing (D-037). */
  readonly llmsTxt: string;
  /** Per-capability artifacts, keyed by safe-filename (cap.name with dots → dashes). */
  readonly perCapability: ReadonlyMap<string, PerCapabilityArtifacts>;
};

export type PerCapabilityArtifacts = {
  readonly capability: CapabilityAST;
  readonly inputSchema: JSONSchema;
  readonly outputSchema: JSONSchema;
  readonly mcpTool: McpToolRegistration;
  readonly markdown: string;
};

export type RunOptions = {
  /** Directory containing contract `.ts` files. Defaults to `<package>/contracts`. */
  readonly contractsDir?: string;
  /** Output directory. Defaults to `<package>/dist`. */
  readonly distDir?: string;
  /** OpenAPI doc metadata. */
  readonly meta?: { title: string; version: string; description?: string };
};

// ──────────────────────────────────────────────────────────────────────────
// Pure functions (testable without FS)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Convert a capability name to a safe filename component.
 * `mail.send.bulk` → `mail-send-bulk`.
 */
export function safeName(capName: string): string {
  return capName.replace(/\./g, '-');
}

/**
 * Discriminate a Capability instance from arbitrary exports.
 * The shape check keeps this independent of nominal typing across
 * package boundaries (which can be fragile in pnpm workspaces).
 */
export function isCapability(value: unknown): value is Capability<never, never> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'ast' in value &&
    'inputSchema' in value &&
    'outputSchema' in value &&
    typeof (value as { ast: unknown }).ast === 'object'
  );
}

/**
 * Build the in-memory artifact bundle from a list of capability ASTs.
 * Pure function; no FS access. Idempotent (D-035 test category 3).
 */
export function generateArtifacts(
  caps: readonly CapabilityAST[],
  meta: { title: string; version: string; description?: string },
): GeneratedArtifacts {
  // Sort for deterministic output regardless of FS read order.
  const sorted = [...caps].sort((a, b) => a.name.localeCompare(b.name));
  const perCapability = new Map<string, PerCapabilityArtifacts>();

  for (const cap of sorted) {
    const schemas = jsonSchemaForCapability(cap);
    const mcpTool = mcpToolForCapability(cap);
    const markdown = markdownForCapability(cap);
    perCapability.set(safeName(cap.name), {
      capability: cap,
      inputSchema: schemas.input,
      outputSchema: schemas.output,
      mcpTool,
      markdown,
    });
  }

  return {
    openapi: openApiForCapabilities(sorted, meta),
    markdownIndex: markdownIndexForCapabilities(sorted),
    llmsTxt: llmsTxtForCapabilities(sorted),
    perCapability,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// FS-touching functions
// ──────────────────────────────────────────────────────────────────────────

/**
 * Discover and load all capabilities from a contracts directory.
 * Reads `*.ts` files, dynamically imports them, and collects exported
 * Capability instances.
 */
export async function loadCapabilities(contractsDir: string): Promise<CapabilityAST[]> {
  const entries = await fs.readdir(contractsDir);
  const capabilities: CapabilityAST[] = [];

  for (const file of entries.sort()) {
    if (!file.endsWith('.ts') && !file.endsWith('.js')) continue;
    const modPath = path.join(contractsDir, file);
    // Pass the raw absolute path (not a file:// URL) — Vite's resolver
    // (under vitest) chokes on URL-encoded spaces in paths, and tsx + Node
    // both handle absolute paths natively.
    const mod = (await import(modPath)) as Record<string, unknown>;
    for (const exp of Object.values(mod)) {
      if (isCapability(exp)) {
        capabilities.push(exp.ast);
      }
    }
  }

  return capabilities;
}

/**
 * Write generated artifacts to disk. Always produces deterministic output
 * (sorted JSON keys preserved by JSON.stringify on objects we built in
 * insertion order; sorted file order from generateArtifacts()).
 */
export async function writeArtifacts(
  artifacts: GeneratedArtifacts,
  distDir: string,
): Promise<void> {
  const schemasDir = path.join(distDir, 'schemas');
  const toolsDir = path.join(distDir, 'tools');
  const docsDir = path.join(distDir, 'docs');
  await fs.mkdir(schemasDir, { recursive: true });
  await fs.mkdir(toolsDir, { recursive: true });
  await fs.mkdir(docsDir, { recursive: true });

  // OpenAPI
  await fs.writeFile(
    path.join(distDir, 'openapi.json'),
    JSON.stringify(artifacts.openapi, null, 2) + '\n',
  );

  // Docs index + llms.txt
  await fs.writeFile(path.join(docsDir, 'index.md'), artifacts.markdownIndex);
  await fs.writeFile(path.join(distDir, 'llms.txt'), artifacts.llmsTxt);

  // Per-capability files
  for (const [name, art] of artifacts.perCapability) {
    await fs.writeFile(
      path.join(schemasDir, `${name}.input.schema.json`),
      JSON.stringify(art.inputSchema, null, 2) + '\n',
    );
    await fs.writeFile(
      path.join(schemasDir, `${name}.output.schema.json`),
      JSON.stringify(art.outputSchema, null, 2) + '\n',
    );
    await fs.writeFile(
      path.join(toolsDir, `${name}.json`),
      JSON.stringify(art.mcpTool, null, 2) + '\n',
    );
    await fs.writeFile(path.join(docsDir, `${name}.md`), art.markdown);
  }
}

/**
 * End-to-end orchestrator. Defaults the directories relative to this
 * package's location.
 */
export async function run(opts: RunOptions = {}): Promise<{ capabilities: number }> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const packageRoot = path.resolve(here, '..');
  const contractsDir = opts.contractsDir ?? path.join(packageRoot, 'contracts');
  const distDir = opts.distDir ?? path.join(packageRoot, 'dist');
  const meta = opts.meta ?? {
    title: 'Iarsma — MCP Tool Surface',
    version: '0.0.0',
    description:
      'Capability-scoped tool surface for Iarsma agents. ' +
      'Generated from capability contracts; do not edit by hand.',
  };

  const caps = await loadCapabilities(contractsDir);
  const artifacts = generateArtifacts(caps, meta);
  await writeArtifacts(artifacts, distDir);
  return { capabilities: caps.length };
}

// ──────────────────────────────────────────────────────────────────────────
// CLI
// ──────────────────────────────────────────────────────────────────────────

// Run when invoked as a script (e.g. `tsx src/run.ts` or compiled JS via node).
const isMain =
  typeof process !== 'undefined' &&
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  run()
    .then((r) => {
      const noun = r.capabilities === 1 ? 'capability' : 'capabilities';
      // eslint-disable-next-line no-console
      console.log(`✓ codegen: generated artifacts for ${r.capabilities} ${noun}`);
    })
    .catch((e: unknown) => {
      // eslint-disable-next-line no-console
      console.error('codegen failed:', e);
      process.exit(1);
    });
}
