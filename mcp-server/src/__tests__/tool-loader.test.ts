/**
 * Tool loader tests. Verifies that the JSON contract emitted by the codegen
 * pipeline (`tools/codegen/dist/tools/*.json`) loads cleanly here.
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ToolLoadError, loadTools } from '../tool-loader.js';

const VALID_TOOL = {
  name: 'session.get',
  description: 'Get the session.',
  requiredScopes: ['session:read'],
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  outputSchema: { type: 'object' },
  isDestructive: false,
  examples: [],
};

describe('loadTools', () => {
  let tmp: string;

  beforeAll(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'iarsma-tool-loader-'));
  });

  afterAll(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('loads a directory of valid tool registrations', async () => {
    await fs.writeFile(
      path.join(tmp, 'session-get.json'),
      JSON.stringify(VALID_TOOL),
    );
    const tools = await loadTools(tmp);
    expect(tools.size).toBe(1);
    const tool = tools.get('session.get');
    expect(tool).toBeDefined();
    expect(tool!.requiredScopes).toEqual(['session:read']);
    expect(tool!.isDestructive).toBe(false);
  });

  it('ignores non-JSON files', async () => {
    const tmp2 = await fs.mkdtemp(path.join(os.tmpdir(), 'iarsma-tl-2-'));
    try {
      await fs.writeFile(path.join(tmp2, 'session-get.json'), JSON.stringify(VALID_TOOL));
      await fs.writeFile(path.join(tmp2, 'README.md'), '# ignored');
      const tools = await loadTools(tmp2);
      expect(tools.size).toBe(1);
    } finally {
      await fs.rm(tmp2, { recursive: true, force: true });
    }
  });

  it('throws ToolLoadError when the directory does not exist', async () => {
    await expect(loadTools('/nonexistent/iarsma/tools/dir')).rejects.toBeInstanceOf(
      ToolLoadError,
    );
  });

  it('throws ToolLoadError for invalid JSON', async () => {
    const tmp3 = await fs.mkdtemp(path.join(os.tmpdir(), 'iarsma-tl-3-'));
    try {
      await fs.writeFile(path.join(tmp3, 'broken.json'), '{ not valid');
      await expect(loadTools(tmp3)).rejects.toBeInstanceOf(ToolLoadError);
    } finally {
      await fs.rm(tmp3, { recursive: true, force: true });
    }
  });

  it('throws ToolLoadError for schema violations', async () => {
    const tmp4 = await fs.mkdtemp(path.join(os.tmpdir(), 'iarsma-tl-4-'));
    try {
      await fs.writeFile(
        path.join(tmp4, 'wrong.json'),
        JSON.stringify({ name: 'x' /* missing other required fields */ }),
      );
      await expect(loadTools(tmp4)).rejects.toBeInstanceOf(ToolLoadError);
    } finally {
      await fs.rm(tmp4, { recursive: true, force: true });
    }
  });

  it('throws ToolLoadError on duplicate tool names', async () => {
    const tmp5 = await fs.mkdtemp(path.join(os.tmpdir(), 'iarsma-tl-5-'));
    try {
      await fs.writeFile(path.join(tmp5, 'a.json'), JSON.stringify(VALID_TOOL));
      await fs.writeFile(path.join(tmp5, 'b.json'), JSON.stringify(VALID_TOOL));
      await expect(loadTools(tmp5)).rejects.toBeInstanceOf(ToolLoadError);
    } finally {
      await fs.rm(tmp5, { recursive: true, force: true });
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Integration: load the real codegen output if available
// ──────────────────────────────────────────────────────────────────────────

describe('loadTools — integration with codegen output', () => {
  it('loads dist/tools/*.json from the codegen package when present', async () => {
    const here = path.dirname(new URL(import.meta.url).pathname);
    // Decode URL-encoded spaces (the project lives at "JMAP based Webmail").
    const decoded = decodeURIComponent(here);
    const codegenTools = path.resolve(
      decoded,
      '..',
      '..',
      '..',
      'tools',
      'codegen',
      'dist',
      'tools',
    );
    try {
      await fs.access(codegenTools);
    } catch {
      // dist/ may not exist in a fresh clone; skip rather than fail.
      return;
    }
    const tools = await loadTools(codegenTools);
    expect(tools.size).toBeGreaterThanOrEqual(1);
    expect(tools.has('session.get')).toBe(true);
  });
});
