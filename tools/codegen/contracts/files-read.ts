/**
 * Capability: files.read
 *
 * Phase 5b work item 2. Reads a single file's content from the connected
 * GitHub repo. Returns UTF-8 text for text files and base64 for binaries
 * (detection by extension). The output shape matches the browser client's
 * `FileContent` (`shell/src/runtime/github-client.ts`).
 *
 * Returning `sha` lets `files.propose_write` later submit a conditional
 * commit (if the blob SHA has changed by the time the human approves,
 * the browser-side committer can detect the race and surface a conflict).
 */

import { z } from 'zod';
import { capability } from '../src/index.js';

export const filesRead = capability({
  name: 'files.read',
  version: '0.0.1',
  scopes: ['files:read'],
  description:
    'Read a single file from the connected GitHub repo. Text files are ' +
    'decoded UTF-8; binaries (detected by extension) are returned base64. ' +
    'The returned `sha` is the current blob SHA — feed it to `files.propose_write` ' +
    'so the eventual commit can detect concurrent edits.',
  input: z.object({
    path: z
      .string()
      .min(1)
      .describe('File path relative to repo root.'),
  }),
  output: z.object({
    path: z.string(),
    sha: z.string().describe('Current Git blob SHA.'),
    size: z.number().int(),
    content: z
      .string()
      .describe(
        'File content. UTF-8 string for text files; base64 (no whitespace) for binaries.',
      ),
    encoding: z
      .enum(['utf-8', 'base64'])
      .describe(
        '`utf-8` for text, `base64` for binaries. The client uses this to decide whether to decode or display the raw bytes.',
      ),
  }),
  examples: [
    {
      title: 'Read a Markdown file',
      input: { path: 'README.md' },
      output: {
        path: 'README.md',
        sha: 'abc123',
        size: 42,
        content: '# Example\n\nHello.',
        encoding: 'utf-8',
      },
    },
  ],
});
