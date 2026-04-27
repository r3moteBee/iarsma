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
    scopes: ['x:read'],
    description: 'A.',
    input: z.object({}),
    output: z.object({ x: z.string() }),
    examples: [],
  });

  const b = capability({
    name: 'b.second',
    scopes: ['y:write'],
    description: 'B.',
    isDestructive: true,
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
    const r = await run({ distDir: tmp });
    expect(r.capabilities).toBeGreaterThanOrEqual(1);
    expect(r.capabilities).toBe(1); // session.get is the only contract today
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
    expect(reg.requiredScopes).toEqual(['session:read']);
    expect(reg.isDestructive).toBe(false);
  });

  it('is idempotent on disk — running twice produces identical bytes', async () => {
    const tmp2 = await fs.mkdtemp(path.join(os.tmpdir(), 'iarsma-codegen-b-'));
    try {
      await run({ distDir: tmp2 });
      const a = await fs.readFile(path.join(tmp, 'openapi.json'), 'utf-8');
      const b = await fs.readFile(path.join(tmp2, 'openapi.json'), 'utf-8');
      expect(a).toBe(b);
    } finally {
      await fs.rm(tmp2, { recursive: true, force: true });
    }
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
