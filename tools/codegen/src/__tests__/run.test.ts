/**
 * Codegen pipeline tests. Exercises the pure parts (generateArtifacts,
 * isCapability, safeName) plus the integration round-trip through tmpdir
 * (loadCapabilities + writeArtifacts).
 *
 * Implements F-3 test category 6 in part: the integration test produces
 * deterministic artifacts on disk. The full end-to-end (round-trip from
 * React hook AND from MCP tool) lands once those generators exist.
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { capability } from '../contract.js';
import {
  generateArtifacts,
  isCapability,
  loadCapabilities,
  run,
  safeName,
  writeArtifacts,
} from '../run.js';

// ──────────────────────────────────────────────────────────────────────────
// Pure helpers
// ──────────────────────────────────────────────────────────────────────────

describe('safeName', () => {
  it('replaces dots with dashes', () => {
    expect(safeName('mail.send')).toBe('mail-send');
    expect(safeName('mail.draft.create')).toBe('mail-draft-create');
  });

  it('leaves single-segment names alone', () => {
    expect(safeName('plain')).toBe('plain');
  });
});

describe('isCapability', () => {
  const real = capability({
    name: 'a.b',
    version: '0.0.1',
    scopes: [],
    description: 'x',
    input: z.object({}),
    output: z.object({}),
    examples: [],
  });

  it('accepts a real Capability', () => {
    expect(isCapability(real)).toBe(true);
  });

  it('rejects non-objects', () => {
    expect(isCapability(null)).toBe(false);
    expect(isCapability(undefined)).toBe(false);
    expect(isCapability('string')).toBe(false);
    expect(isCapability(42)).toBe(false);
  });

  it('rejects objects missing required fields', () => {
    expect(isCapability({ ast: {} })).toBe(false);
    expect(isCapability({ ast: {}, inputSchema: {} })).toBe(false);
    expect(isCapability({ ast: 'not-object', inputSchema: {}, outputSchema: {} })).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// generateArtifacts (pure)
// ──────────────────────────────────────────────────────────────────────────

describe('generateArtifacts', () => {
  const meta = { title: 't', version: '0.0.0' };

  const a = capability({
    name: 'a.first',
    version: '0.0.1',
    scopes: ['x:read'],
    description: 'A.',
    input: z.object({}),
    output: z.object({ x: z.string() }),
    examples: [],
  });

  const b = capability({
    name: 'b.second',
    version: '0.0.1',
    scopes: ['y:write'],
    description: 'B.',
    isDestructive: true,
    dryRun: { preview: z.object({}) },
    input: z.object({ y: z.string() }),
    output: z.object({}),
    examples: [],
  });

  it('produces one entry per capability, keyed by safe-name', () => {
    const out = generateArtifacts([a.ast, b.ast], meta);
    expect([...out.perCapability.keys()]).toEqual(['a-first', 'b-second']);
  });

  it('returns sorted-order regardless of input order', () => {
    const out1 = generateArtifacts([a.ast, b.ast], meta);
    const out2 = generateArtifacts([b.ast, a.ast], meta);
    expect([...out1.perCapability.keys()]).toEqual([...out2.perCapability.keys()]);
    expect(JSON.stringify(out1.openapi)).toBe(JSON.stringify(out2.openapi));
  });

  it('embeds full inputSchema/outputSchema/mcpTool per capability', () => {
    const out = generateArtifacts([a.ast], meta);
    const art = out.perCapability.get('a-first');
    expect(art).toBeDefined();
    expect(art!.inputSchema).toMatchObject({ type: 'object' });
    expect(art!.outputSchema).toMatchObject({ type: 'object' });
    expect(art!.mcpTool.name).toBe('a.first');
  });

  it('is idempotent — repeated runs produce identical artifacts', () => {
    const a1 = generateArtifacts([a.ast, b.ast], meta);
    const a2 = generateArtifacts([a.ast, b.ast], meta);
    expect(JSON.stringify(a1.openapi)).toBe(JSON.stringify(a2.openapi));
    for (const [name, art1] of a1.perCapability) {
      const art2 = a2.perCapability.get(name);
      expect(JSON.stringify(art1)).toBe(JSON.stringify(art2));
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────
// FS round-trip (writeArtifacts + loadCapabilities + run)
// ──────────────────────────────────────────────────────────────────────────

describe('run (integration with the project contracts)', () => {
  let tmp: string;

  beforeAll(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'iarsma-codegen-'));
  });

  afterAll(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('walks the real contracts/ dir and writes to tmpdir', async () => {
    // Pass shellGenDir: null to skip writing into shell/src/generated/.
    // Tests should be hermetic — they shouldn't pollute the shell tree.
    const r = await run({ distDir: tmp, shellGenDir: null });
    expect(r.capabilities).toBeGreaterThanOrEqual(1);
    // session.get + mailbox.list + thread.list + thread.get +
    // mail.draft + mail.send + mail.modify + mail.delete +
    // identity.list + thread.search + calendar.list + event.list +
    // event.get + contact.list + contact.get + files.list +
    // files.read + files.propose_write +
    // mailbox.create + mailbox.update + mailbox.delete +
    // label.list + label.create + label.update + label.delete + label.apply +
    // calendar.create + calendar.update + calendar.delete.
    // Bump explicitly when adding contracts so a missing or duplicate
    // contract surfaces in code review.
    expect(r.capabilities).toBe(29);
  });

  it('produces openapi.json at the dist root', async () => {
    const raw = await fs.readFile(path.join(tmp, 'openapi.json'), 'utf-8');
    const doc = JSON.parse(raw);
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.paths['/mcp/tools/session.get']).toBeDefined();
  });

  it('produces per-capability schema files', async () => {
    const inSchema = JSON.parse(
      await fs.readFile(path.join(tmp, 'schemas', 'session-get.input.schema.json'), 'utf-8'),
    );
    const outSchema = JSON.parse(
      await fs.readFile(path.join(tmp, 'schemas', 'session-get.output.schema.json'), 'utf-8'),
    );
    expect(inSchema.title).toBe('session.get.input');
    expect(outSchema.title).toBe('session.get.output');
  });

  it('produces an MCP tool registration JSON per capability', async () => {
    const reg = JSON.parse(
      await fs.readFile(path.join(tmp, 'tools', 'session-get.json'), 'utf-8'),
    );
    expect(reg.name).toBe('session.get');
    expect(reg.version).toBe('0.0.1');
    expect(reg.stability).toBe('experimental');
    expect(reg.requiredScopes).toEqual(['session:read']);
    expect(reg.isDestructive).toBe(false);
    expect(reg.errorEnvelopeSchema).toMatchObject({ title: 'IarsmaError' });
  });

  it('exposes the workspace error envelope in OpenAPI components (D-043)', async () => {
    const raw = await fs.readFile(path.join(tmp, 'openapi.json'), 'utf-8');
    const doc = JSON.parse(raw);
    expect(doc.components.schemas.IarsmaError).toMatchObject({
      title: 'IarsmaError',
      type: 'object',
      required: ['code', 'message'],
    });
    const op = doc.paths['/mcp/tools/session.get'].post;
    expect(op['x-iarsma-version']).toBe('0.0.1');
    expect(op['x-iarsma-stability']).toBe('experimental');
    expect(op.responses['500'].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/IarsmaError',
    });
  });

  it('produces a markdown docs page per capability', async () => {
    const md = await fs.readFile(
      path.join(tmp, 'docs', 'session-get.md'),
      'utf-8',
    );
    expect(md).toContain('# `session.get`');
    expect(md).toContain('**Scopes:** `session:read`');
    expect(md).toContain('## Input');
    expect(md).toContain('## Output');
  });

  it('produces a markdown docs index', async () => {
    const md = await fs.readFile(path.join(tmp, 'docs', 'index.md'), 'utf-8');
    expect(md).toContain('# Iarsma Capabilities');
    expect(md).toContain('## session');
    expect(md).toContain('[`session.get`](./session-get.md)');
  });

  it('produces llms.txt at the dist root (D-037)', async () => {
    const txt = await fs.readFile(path.join(tmp, 'llms.txt'), 'utf-8');
    expect(txt).toContain('# Iarsma');
    expect(txt).toContain('urn:iarsma:agent-context');
    expect(txt).toContain('`session.get`');
  });

  it('is idempotent on disk — running twice produces identical bytes', async () => {
    const tmp2 = await fs.mkdtemp(path.join(os.tmpdir(), 'iarsma-codegen-b-'));
    try {
      await run({ distDir: tmp2, shellGenDir: null });
      const a = await fs.readFile(path.join(tmp, 'openapi.json'), 'utf-8');
      const b = await fs.readFile(path.join(tmp2, 'openapi.json'), 'utf-8');
      expect(a).toBe(b);
    } finally {
      await fs.rm(tmp2, { recursive: true, force: true });
    }
  });
});

describe('run — React hook output to a shell-gen dir', () => {
  let tmpDist: string;
  let tmpShell: string;

  beforeAll(async () => {
    tmpDist = await fs.mkdtemp(path.join(os.tmpdir(), 'iarsma-rh-dist-'));
    tmpShell = await fs.mkdtemp(path.join(os.tmpdir(), 'iarsma-rh-shell-'));
  });

  afterAll(async () => {
    await fs.rm(tmpDist, { recursive: true, force: true });
    await fs.rm(tmpShell, { recursive: true, force: true });
  });

  it('writes a hook .ts per capability into the shellGenDir', async () => {
    await run({ distDir: tmpDist, shellGenDir: tmpShell });
    const hook = await fs.readFile(path.join(tmpShell, 'session-get.ts'), 'utf-8');
    expect(hook).toContain('export function useSessionGet(');
    expect(hook).toContain('useReadHook');
  });

  it('writes an index.ts barrel re-exporting each hook', async () => {
    const idx = await fs.readFile(path.join(tmpShell, 'index.ts'), 'utf-8');
    expect(idx).toContain("export * from './session-get.js';");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// loadCapabilities + writeArtifacts (composable parts)
// ──────────────────────────────────────────────────────────────────────────

describe('loadCapabilities + writeArtifacts composability', () => {
  it('round-trips through a custom tmpdir without touching project dist/', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'iarsma-rt-'));
    try {
      // Use the real project contracts/, write to a fresh tmpdir.
      // fileURLToPath decodes URL-encoded paths (handles spaces in directory
      // names correctly); `new URL(...).pathname` does not.
      const here = path.dirname(fileURLToPath(import.meta.url));
      const contractsDir = path.resolve(here, '..', '..', 'contracts');
      const caps = await loadCapabilities(contractsDir);
      const artifacts = generateArtifacts(caps, { title: 't', version: '0.0.0' });
      await writeArtifacts(artifacts, tmp);

      const dirEntries = await fs.readdir(tmp);
      expect(dirEntries).toContain('openapi.json');
      expect(dirEntries).toContain('schemas');
      expect(dirEntries).toContain('tools');
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
