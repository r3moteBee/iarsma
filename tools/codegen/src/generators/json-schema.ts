/**
 * JSON Schema generator. Consumes the intermediate AST (D-035) and produces
 * JSON Schema objects suitable for MCP tool registrations and the OpenAPI
 * doc.
 *
 * We emit JSON Schema from our AST rather than using `zod-to-json-schema`
 * directly — this keeps the AST as the single source of truth for what
 * generators see. If we ever add a non-Zod input format (WIT), this
 * generator doesn't change.
 */

import type { CapabilityAST, TypeNode } from '../types.js';

export type JSONSchema = Record<string, unknown>;

/**
 * The two JSON Schemas a capability surfaces externally: input shape
 * (parameter validation) and output shape (response validation / docs).
 *
 * For destructive capabilities (per D-046), `input` and `output` are the
 * dry-run wrapped shapes (mode envelope on input, discriminated preview/
 * commit union on output). The contract author's natural shapes are
 * exposed separately as `params` (the inner input) and (where set) the
 * preview schema is referenced via `previewParams` for direct
 * introspection.
 */
export type CapabilitySchemas = {
  readonly input: JSONSchema;
  readonly output: JSONSchema;
};

/**
 * Produce JSON Schemas for a capability's input and output.
 *
 * Non-destructive capabilities: input/output emit unchanged (the natural
 * shapes the contract author wrote).
 *
 * Destructive capabilities: input gains the `mode` envelope; output
 * becomes a discriminated `oneOf` of preview-result vs commit-result.
 * See D-046 for the protocol shape rationale.
 */
export function jsonSchemaForCapability(cap: CapabilityAST): CapabilitySchemas {
  if (cap.isDestructive && cap.dryRun !== undefined) {
    return {
      input: wrappedDestructiveInput(cap.input, cap.name),
      output: wrappedDestructiveOutput(cap.output, cap.dryRun.preview, cap.name),
    };
  }
  return {
    input: typeNodeToJsonSchema(cap.input, `${cap.name}.input`),
    output: typeNodeToJsonSchema(cap.output, `${cap.name}.output`),
  };
}

/**
 * Wrap a destructive capability's input in the `{ params, mode }` envelope.
 * `mode` is the discriminated literal that drives preview-vs-commit.
 */
function wrappedDestructiveInput(input: TypeNode, name: string): JSONSchema {
  return {
    title: `${name}.input`,
    type: 'object',
    properties: {
      mode: {
        type: 'string',
        enum: ['preview', 'commit'],
        description:
          "`'preview'` returns the proposed action via the `preview` payload; " +
          "`'commit'` performs the action and returns the result + a log-entry reference.",
      },
      params: typeNodeToJsonSchema(input),
    },
    required: ['mode', 'params'],
    additionalProperties: false,
  };
}

/**
 * Wrap a destructive capability's output in the discriminated preview/commit
 * union. The two cases are tagged by `mode`, mirroring the input envelope.
 */
function wrappedDestructiveOutput(
  output: TypeNode,
  preview: TypeNode,
  name: string,
): JSONSchema {
  return {
    title: `${name}.output`,
    oneOf: [
      {
        type: 'object',
        properties: {
          mode: { const: 'preview' },
          preview: typeNodeToJsonSchema(preview),
        },
        required: ['mode', 'preview'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          mode: { const: 'commit' },
          result: typeNodeToJsonSchema(output),
          logEntryRef: {
            type: 'string',
            description:
              "Hex-encoded SHA-384 hash of the action-log entry recorded for this commit. " +
              "Use the action-log read APIs to fetch full provenance details.",
          },
        },
        required: ['mode', 'result', 'logEntryRef'],
        additionalProperties: false,
      },
    ],
  };
}

/**
 * Convert a single TypeNode to a JSON Schema fragment.
 *
 * The `title` parameter is set on the top-level call (input/output) to make
 * the resulting schemas self-describing. Nested calls don't propagate it.
 */
export function typeNodeToJsonSchema(node: TypeNode, title?: string): JSONSchema {
  const titleField: JSONSchema = title !== undefined ? { title } : {};

  switch (node.kind) {
    case 'string':
      return { ...titleField, type: 'string' };

    case 'number':
      return { ...titleField, type: node.integer ? 'integer' : 'number' };

    case 'boolean':
      return { ...titleField, type: 'boolean' };

    case 'option': {
      // option<T> ≡ T | null in JSON Schema. We use oneOf so consumers see
      // the alternatives explicitly rather than collapsing to nullable.
      const inner = typeNodeToJsonSchema(node.inner);
      return { ...titleField, oneOf: [inner, { type: 'null' }] };
    }

    case 'list':
      return {
        ...titleField,
        type: 'array',
        items: typeNodeToJsonSchema(node.element),
      };

    case 'record': {
      const properties: Record<string, JSONSchema> = {};
      const required: string[] = [];
      for (const f of node.fields) {
        const fieldSchema = typeNodeToJsonSchema(f.type);
        if (f.description !== undefined) {
          (fieldSchema as { description?: string }).description = f.description;
        }
        properties[f.name] = fieldSchema;
        if (!f.optional) required.push(f.name);
      }
      return {
        ...titleField,
        type: 'object',
        properties,
        ...(required.length > 0 ? { required } : {}),
        additionalProperties: false,
      };
    }

    case 'variant':
      return {
        ...titleField,
        oneOf: node.cases.map((c) => {
          const properties: Record<string, JSONSchema> = {
            tag: { const: c.tag },
          };
          const required = ['tag'];
          if (c.payload !== null) {
            properties.payload = typeNodeToJsonSchema(c.payload);
            required.push('payload');
          }
          return {
            type: 'object',
            properties,
            required,
            additionalProperties: false,
          };
        }),
      };

    case 'enum':
      return { ...titleField, type: 'string', enum: [...node.values] };

    case 'unit':
      return {
        ...titleField,
        type: 'object',
        properties: {},
        additionalProperties: false,
      };
  }
}
