/**
 * Capability: files.propose_write
 *
 * Phase 5b work item 3. Proposes a write to a file in the connected GitHub
 * repo. Always destructive; non-dry-run never touches GitHub — it appends
 * an approval record to the user's `Approvals` mailbox keyed `$approval_pending`.
 *
 * Execution split (D-053):
 *   - Server (here): reads current content, computes a unified diff for the
 *     dry-run preview, and on commit creates the approval record. The server
 *     never writes to GitHub.
 *   - Browser: on human approval, the existing browser GitHub client
 *     (`shell/src/runtime/github-client.ts`) issues the actual commit using
 *     the params + `baseSha` captured in the approval record.
 *
 * This keeps GitHub write credentials in one place (the browser's IDB
 * config) while still letting agents propose changes from the server side.
 */

import { z } from 'zod';
import { capability } from '../src/index.js';

const Diff = z.object({
  unified: z
    .string()
    .describe('Unified diff (`--- a/path` / `+++ b/path` headers + hunks).'),
  baseSha: z
    .string()
    .describe(
      'Current Git blob SHA of the target file at proposal time. Empty string when creating a new file. The browser-side committer passes this back to GitHub so concurrent edits are detected.',
    ),
  isCreate: z.boolean().describe('`true` when the target path does not yet exist.'),
  isBinary: z
    .boolean()
    .describe(
      '`true` when the target path is detected as a binary file (by extension). Binary writes are still possible — the diff just shows a placeholder line.',
    ),
});

export const filesProposeWrite = capability({
  name: 'files.propose_write',
  version: '0.0.1',
  scopes: ['files:write'],
  isDestructive: true,
  description:
    'Propose a write to a file in the connected GitHub repo. Dry-run reads the ' +
    'current content and returns a unified diff. Commit appends a pending ' +
    'approval to the user\'s Approvals mailbox; the actual GitHub commit happens ' +
    'browser-side after the human approves.',
  input: z.object({
    path: z
      .string()
      .min(1)
      .describe('Target file path relative to repo root.'),
    content: z
      .string()
      .describe(
        'Proposed new content. UTF-8 for text; base64 (no whitespace) for binaries — match `encoding`.',
      ),
    encoding: z
      .enum(['utf-8', 'base64'])
      .describe(
        '`utf-8` for text content (the default for source files); `base64` for binary content. The browser committer encodes appropriately for GitHub on the way out.',
      ),
    message: z
      .string()
      .min(1)
      .describe('Git commit message the browser will use when the human approves.'),
  }),
  output: z.object({
    approvalId: z
      .string()
      .describe(
        'JMAP Email id of the appended approval record. Surfaces in the Approvals UI; the committer reads back the params and posts the GitHub commit on approve.',
      ),
  }),
  dryRun: {
    preview: z.object({
      path: z.string(),
      message: z.string(),
      diff: Diff,
    }),
  },
  examples: [
    {
      title: 'Propose an edit to README.md',
      input: {
        path: 'README.md',
        content: '# Example\n\nHello, world.\n',
        encoding: 'utf-8',
        message: 'docs: tweak greeting',
      },
      output: { approvalId: 'M-001' },
    },
  ],
});
