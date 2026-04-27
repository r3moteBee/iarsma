/**
 * Capability: session.get
 *
 * The first capability defined in Iarsma. Used as the F-3 end-to-end smoke
 * test: contract → AST → JSON Schema (this commit), → React hook + MCP tool
 * registration (follow-up commits) → live JMAP call against Stalwart.
 *
 * The Session shape mirrors the JMAP session resource per RFC 8620, narrowed
 * to the fields the shell and MCP server actually use today. Don't
 * speculatively model the full spec — add fields as consumers need them.
 *
 * Reference: deployed Stalwart v1.0.0 advertises a much richer session; see
 * docs/project-brief.md "Phase -1" findings.
 */

import { z } from 'zod';
import { capability } from '../src/index.js';

const Session = z.object({
  username: z.string().describe('Account email for the authenticated user.'),
  apiUrl: z.string().describe('JMAP API endpoint URL.'),
  downloadUrl: z.string().describe('Blob download URL template per RFC 8620.'),
  uploadUrl: z.string().describe('Blob upload URL template per RFC 8620.'),
  eventSourceUrl: z.string().describe('JMAP push EventSource URL.'),
  state: z.string().describe('Server state token for change detection.'),
  primaryAccountIdMail: z
    .string()
    .describe('Primary account ID for the urn:ietf:params:jmap:mail capability.'),
});

export const sessionGet = capability({
  name: 'session.get',
  scopes: ['session:read'],
  description:
    'Get the current authenticated session resource. Returns account info, ' +
    'JMAP endpoint URLs, and the server state token used for change detection.',
  input: z.object({}),
  output: Session,
  examples: [
    {
      title: 'Fetch session for the signed-in user',
      input: {},
      output: {
        username: 'brent@r3motely.net',
        apiUrl: 'https://sw-mail.r3motely.net/jmap/',
        downloadUrl:
          'https://sw-mail.r3motely.net/jmap/download/{accountId}/{blobId}/{name}?accept={type}',
        uploadUrl: 'https://sw-mail.r3motely.net/jmap/upload/{accountId}/',
        eventSourceUrl:
          'https://sw-mail.r3motely.net/jmap/eventsource/?types={types}&closeafter={closeafter}&ping={ping}',
        state: '817d3028',
        primaryAccountIdMail: 'c',
      },
    },
  ],
});
