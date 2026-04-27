/**
 * JSON Schema generator tests.
 *
 * Implements categories 1 and 3 of F-3's six-category test coverage (see
 * docs/implementation-plan.md, Phase 0 work item 4a):
 *
 *   - Generator snapshot: deterministic output for a given AST.
 *   - Idempotency: running codegen twice produces byte-identical output.
 *
 * Category 4 (schema parity — JSON Schema and Zod runtime agree on accept/
 * reject) is more involved and lands in a follow-up commit alongside a
 * property-test framework.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { capability } from '../contract.js';
import { jsonSchemaForCapability, typeNodeToJsonSchema } from '../generators/json-schema.js';
import type { TypeNode } from '../types.js';

describe('typeNodeToJsonSchema — primitives', () => {
  it('emits string', () => {
    expect(typeNodeToJsonSchema({ kind: 'string' })).toEqual({ type: 'string' });
  });

  it('emits number/integer distinction', () => {
    expect(typeNodeToJsonSchema({ kind: 'number', integer: false })).toEqual({
      type: 'number',
    });
    expect(typeNodeToJsonSchema({ kind: 'number', integer: true })).toEqual({
      type: 'integer',
    });
  });

  it('emits boolean', () => {
    expect(typeNodeToJsonSchema({ kind: 'boolean' })).toEqual({ type: 'boolean' });
  });

  it('emits unit as empty closed object', () => {
    expect(typeNodeToJsonSchema({ kind: 'unit' })).toEqual({
      type: 'object',
      properties: {},
      additionalProperties: false,
    });
  });
});

describe('typeNodeToJsonSchema — composites', () => {
  it('emits option<T> as oneOf [T, null]', () => {
    const node: TypeNode = { kind: 'option', inner: { kind: 'string' } };
    expect(typeNodeToJsonSchema(node)).toEqual({
      oneOf: [{ type: 'string' }, { type: 'null' }],
    });
  });

  it('emits list<T> as array', () => {
    const node: TypeNode = { kind: 'list', element: { kind: 'string' } };
    expect(typeNodeToJsonSchema(node)).toEqual({
      type: 'array',
      items: { type: 'string' },
    });
  });

  it('emits record with required + optional + descriptions', () => {
    const node: TypeNode = {
      kind: 'record',
      fields: [
        { name: 'a', type: { kind: 'string' }, optional: false, description: 'alpha' },
        { name: 'b', type: { kind: 'number', integer: true }, optional: true },
      ],
    };
    expect(typeNodeToJsonSchema(node)).toEqual({
      type: 'object',
      properties: {
        a: { type: 'string', description: 'alpha' },
        b: { type: 'integer' },
      },
      required: ['a'],
      additionalProperties: false,
    });
  });

  it('emits enum as string with enum values', () => {
    expect(typeNodeToJsonSchema({ kind: 'enum', values: ['a', 'b'] })).toEqual({
      type: 'string',
      enum: ['a', 'b'],
    });
  });

  it('emits variant as oneOf with tag literals', () => {
    const node: TypeNode = {
      kind: 'variant',
      cases: [
        {
          tag: 'a',
          payload: { kind: 'record', fields: [{ name: 'value', type: { kind: 'string' }, optional: false }] },
        },
        { tag: 'b', payload: null },
      ],
    };
    const schema = typeNodeToJsonSchema(node);
    expect(schema).toMatchObject({
      oneOf: [
        {
          type: 'object',
          properties: { tag: { const: 'a' } },
          required: ['tag', 'payload'],
        },
        {
          type: 'object',
          properties: { tag: { const: 'b' } },
          required: ['tag'],
        },
      ],
    });
  });
});

describe('jsonSchemaForCapability — session.get end-to-end', () => {
  // Build session.get inline so this test doesn't depend on the contracts/
  // directory being included in the tsconfig.
  const sessionGet = capability({
    name: 'session.get',
    scopes: ['session:read'],
    description: 'Get the current authenticated session.',
    input: z.object({}),
    output: z.object({
      username: z.string().describe('Account email.'),
      apiUrl: z.string(),
    }),
    examples: [
      {
        title: 'Fetch session',
        input: {},
        output: { username: 'a@b.example', apiUrl: 'https://example/jmap/' },
      },
    ],
  });

  it('produces the expected input schema', () => {
    expect(jsonSchemaForCapability(sessionGet.ast).input).toEqual({
      title: 'session.get.input',
      type: 'object',
      properties: {},
      additionalProperties: false,
    });
  });

  it('produces the expected output schema (snapshot)', () => {
    expect(jsonSchemaForCapability(sessionGet.ast).output).toEqual({
      title: 'session.get.output',
      type: 'object',
      properties: {
        username: { type: 'string', description: 'Account email.' },
        apiUrl: { type: 'string' },
      },
      required: ['username', 'apiUrl'],
      additionalProperties: false,
    });
  });

  it('is idempotent — repeated runs are byte-identical', () => {
    const a = JSON.stringify(jsonSchemaForCapability(sessionGet.ast));
    const b = JSON.stringify(jsonSchemaForCapability(sessionGet.ast));
    expect(a).toBe(b);
  });
});
