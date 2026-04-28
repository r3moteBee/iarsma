/**
 * Loads tool registrations from a directory of JSON files produced by the
 * codegen pipeline (`tools/codegen/dist/tools/*.json`).
 *
 * The MCP server reads these at startup and exposes each as an MCP tool.
 * Decoupling: the codegen pipeline writes JSON, the MCP server reads JSON,
 * neither imports the other at compile time. If the codegen package is
 * republished, the MCP server picks up the new tool list on restart.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

/**
 * Schema mirroring `McpToolRegistration` in the codegen package. We don't
 * import the type from `@iarsma/codegen` to keep the loose coupling — the
 * JSON contract is the only shared surface.
 */
export const ToolRegistrationSchema = z.object({
  name: z.string(),
  description: z.string(),
  requiredScopes: z.array(z.string()),
  inputSchema: z.record(z.unknown()),
  outputSchema: z.record(z.unknown()),
  isDestructive: z.boolean(),
  examples: z.array(
    z.object({
      title: z.string(),
      input: z.unknown(),
      output: z.unknown(),
    }),
  ),
});

export type ToolRegistration = z.infer<typeof ToolRegistrationSchema>;

export class ToolLoadError extends Error {
  constructor(
    message: string,
    public readonly file?: string,
  ) {
    super(message);
    this.name = 'ToolLoadError';
  }
}

/**
 * Read a directory of `*.json` tool registrations and return them keyed by
 * tool name. Validates each file against the schema and throws ToolLoadError
 * on any malformed input.
 */
export async function loadTools(toolsDir: string): Promise<Map<string, ToolRegistration>> {
  let entries: string[];
  try {
    entries = await fs.readdir(toolsDir);
  } catch (e) {
    throw new ToolLoadError(
      `Cannot read tools directory: ${toolsDir}. ` +
        `Run \`pnpm codegen\` to populate it. (${(e as Error).message})`,
    );
  }

  const tools = new Map<string, ToolRegistration>();
  for (const file of entries.sort()) {
    if (!file.endsWith('.json')) continue;
    const fullPath = path.join(toolsDir, file);
    let raw: string;
    try {
      raw = await fs.readFile(fullPath, 'utf-8');
    } catch (e) {
      throw new ToolLoadError(
        `Failed to read tool file: ${(e as Error).message}`,
        fullPath,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new ToolLoadError(
        `Invalid JSON in tool file: ${(e as Error).message}`,
        fullPath,
      );
    }
    const result = ToolRegistrationSchema.safeParse(parsed);
    if (!result.success) {
      throw new ToolLoadError(
        `Tool registration failed schema validation: ${result.error.message}`,
        fullPath,
      );
    }
    if (tools.has(result.data.name)) {
      throw new ToolLoadError(
        `Duplicate tool name: ${result.data.name}`,
        fullPath,
      );
    }
    tools.set(result.data.name, result.data);
  }
  return tools;
}
