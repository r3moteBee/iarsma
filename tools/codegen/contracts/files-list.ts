/**
 * Capability: files.list
 *
 * Phase 5b work item 1. Lists the entries at a directory path inside the
 * MCP server's configured GitHub repo. Scope is `files:read` — the same
 * scope the human browser session holds via its IDB-stored PAT, but the
 * server uses its own env-loaded PAT (see `mcp-server/src/github-config.ts`).
 *
 * The shape mirrors the browser-side `FileEntry` returned by
 * `shell/src/runtime/github-client.ts` so the same diff/preview pipeline
 * the human UI uses works on the server side without translation.
 */

import { z } from 'zod';
import { capability } from '../src/index.js';

const FileEntry = z.object({
  path: z.string().describe('Full path from repo root.'),
  name: z.string().describe('Last segment of the path.'),
  type: z.enum(['file', 'dir']),
  sha: z
    .string()
    .optional()
    .describe('Git blob SHA. Present for files; omitted for directories.'),
  size: z
    .number()
    .int()
    .optional()
    .describe('Size in bytes. Present for files; omitted for directories.'),
});

export const filesList = capability({
  name: 'files.list',
  version: '0.0.1',
  scopes: ['files:read'],
  description:
    'List the entries at a directory path in the connected GitHub repo. ' +
    'Pass an empty string for the repo root. Uses the GitHub REST `contents` ' +
    'endpoint scoped to the configured branch.',
  input: z.object({
    path: z
      .string()
      .describe(
        'Directory path, relative to repo root. Use `""` (empty string) for the root. ' +
          'A path that resolves to a file rather than a directory still returns a one-element array.',
      ),
  }),
  output: z.object({
    entries: z.array(FileEntry),
  }),
  examples: [
    {
      title: 'List the repo root',
      input: { path: '' },
      output: {
        entries: [
          { path: 'README.md', name: 'README.md', type: 'file', sha: 'abc123', size: 1024 },
          { path: 'src', name: 'src', type: 'dir' },
        ],
      },
    },
  ],
});
