/**
 * OpenAPI 3.1 generator. Accumulates all capabilities into a single OpenAPI
 * document suitable for ingestion by Swagger UI, code generators, and the
 * `iarsma.io` docs site (D-037).
 *
 * The doc models the MCP tool surface as an HTTP API: each capability
 * becomes a `POST /mcp/tools/<name>` operation. This is a simplification —
 * MCP itself uses JSON-RPC over stdio/SSE, not HTTP — but OpenAPI is
 * universally consumable and accurately captures the *contract*: input
 * schema, output schema, scopes, and destructive flag. Tools that want to
 * understand "what can this server do" can read this and get the answer.
 *
 * Iarsma-specific concerns (scopes, destructive flag, examples) are surfaced
 * via `x-iarsma-*` extension fields, which OpenAPI consumers either honor or
 * ignore.
 */

import { errorEnvelopeJsonSchema, type CapabilityAST } from '../types.js';
import { jsonSchemaForCapability } from './json-schema.js';

export type OpenAPIDoc = Record<string, unknown>;

const ERROR_REF = { $ref: '#/components/schemas/IarsmaError' };
const ERROR_RESPONSE = {
  description: '',
  content: { 'application/json': { schema: ERROR_REF } },
};

export function openApiForCapabilities(
  caps: readonly CapabilityAST[],
  meta: { title: string; version: string; description?: string },
): OpenAPIDoc {
  const paths: Record<string, unknown> = {};
  const tagSet = new Set<string>();

  // Sort caps by name for deterministic output (idempotency, D-035 test category 3).
  const sortedCaps = [...caps].sort((a, b) => a.name.localeCompare(b.name));

  for (const cap of sortedCaps) {
    const schemas = jsonSchemaForCapability(cap);
    const tag = cap.name.split('.')[0] ?? 'general';
    tagSet.add(tag);

    paths[`/mcp/tools/${cap.name}`] = {
      post: {
        operationId: cap.name.replace(/\./g, '_'),
        summary: cap.description,
        tags: [tag],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: schemas.input },
          },
        },
        responses: {
          '200': {
            description: 'Successful response',
            content: { 'application/json': { schema: schemas.output } },
          },
          '403': {
            ...ERROR_RESPONSE,
            description: 'Insufficient scopes for this tool.',
          },
          '422': {
            ...ERROR_RESPONSE,
            description: 'Input did not validate against the schema.',
          },
          '500': {
            ...ERROR_RESPONSE,
            description: 'Server-side failure (downstream JMAP error, internal error, etc.).',
          },
        },
        'x-iarsma-version': cap.version,
        'x-iarsma-stability': cap.stability,
        'x-iarsma-scopes': [...cap.scopes],
        'x-iarsma-destructive': cap.isDestructive,
        'x-iarsma-error-codes': cap.errors.map((e) => ({
          code: e.code,
          description: e.description,
        })),
        'x-iarsma-examples': cap.examples.map((e) => ({
          title: e.title,
          input: e.input,
          output: e.output,
        })),
      },
    };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: meta.title,
      version: meta.version,
      ...(meta.description !== undefined ? { description: meta.description } : {}),
    },
    tags: [...tagSet].sort().map((name) => ({ name })),
    paths,
    components: {
      schemas: {
        IarsmaError: errorEnvelopeJsonSchema(),
      },
    },
  };
}
