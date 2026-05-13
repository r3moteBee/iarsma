/**
 * Capability: identity.list
 *
 * Phase 2 work item 6. Lists every JMAP submission identity the
 * authenticated account is permitted to send as.
 *
 * Wire shape: `Identity/get` (no ids → fetch all) under the
 * `urn:ietf:params:jmap:submission` capability. The response carries
 * a flat list of records; no body content, no chained methods.
 *
 * Scope is `mail:send` (not `mail:read.metadata`): only callers
 * permitted to actually send need to enumerate identities. Phase 3
 * scope-enforcement may need to relax this — e.g., a read-only
 * agent wants to know which identity owns a thread for filtering —
 * but the default is restrictive.
 *
 * Cached under `cache.identities.v1` (D-051) — identities change
 * rarely, and the compose modal opens once per session.
 */

import { z } from 'zod';
import { capability } from '../src/index.js';

const EmailAddress = z.object({
  name: z.string().optional(),
  email: z.string(),
});

const Identity = z.object({
  id: z.string().describe('JMAP Identity id. Passed verbatim to `mail.send.identityId`.'),
  name: z.string().describe('Display name the user picked for this identity ("Brent", "Brent (work)", etc.).'),
  email: z
    .string()
    .describe(
      'Address the identity sends from. The relay rejects submissions whose `from` doesn\'t match this (or an allowed alias).',
    ),
  replyTo: z
    .array(EmailAddress)
    .optional()
    .describe('Optional `Reply-To` set when sending — surfaced so the UI can warn the user.'),
  bcc: z
    .array(EmailAddress)
    .optional()
    .describe('Optional `Bcc` the relay always adds (e.g., a self-archive address).'),
  textSignature: z
    .string()
    .optional()
    .describe('Plain-text signature the user wants appended. Composer surfaces in future polish.'),
  htmlSignature: z
    .string()
    .optional()
    .describe('HTML signature; same as `textSignature` but for the HTML body.'),
  mayDelete: z
    .boolean()
    .describe('True iff the user is allowed to delete this identity (e.g., the primary identity is often pinned).'),
});

export const identityList = capability({
  name: 'identity.list',
  version: '0.0.1',
  scopes: ['mail:send'],
  description:
    'List every JMAP submission identity the authenticated account ' +
    'is permitted to send as. Powers the compose-modal identity ' +
    'selector (Phase 2 item 6).',
  input: z.object({}),
  output: z.object({
    identities: z.array(Identity),
  }),
  examples: [
    {
      title: 'Single-identity account',
      input: {},
      output: {
        identities: [
          {
            id: 'I-1',
            name: 'Brent',
            email: 'brent@r3motely.net',
            mayDelete: false,
          },
        ],
      },
    },
  ],
});
