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
 */
export type CapabilitySchemas = {
  readonly input: JSONSchema;
  readonly output: JSONSchema;
};

/**
 * Produce JSON Schemas for a capability's input and output.
 */
export function jsonSchemaForCapability(cap: CapabilityAST): CapabilitySchemas {
  return {
    input: typeNodeToJsonSchema(cap.input, `${cap.name}.input`),
    output: typeNodeToJsonSchema(cap.output, `${cap.name}.output`),
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
