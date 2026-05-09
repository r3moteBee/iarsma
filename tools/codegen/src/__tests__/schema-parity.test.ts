/**
 * Schema-parity property tests (F-3 test category 4).
 *
 * The codegen-emitted JSON Schema and the runtime Zod validator must agree
 * on accept/reject for the same input. These tests use property-based
 * generation (fast-check) plus deterministic targeted cases to verify that
 * agreement.
 *
 * Common disagreement modes — and how we keep them aligned:
 *
 *   1. Extra properties on objects:
 *      - Our JSON Schema emits `additionalProperties: false` for records.
 *      - Zod object schemas default to *strip* extras (passthrough does not
 *        reject them, just drops them on parse).
 *      - That asymmetry shows up here: a JSON Schema would reject
 *        `{ extra: 1, ... }` while Zod's `safeParse` would silently strip
 *        `extra` and *succeed*.
 *      - Resolution: parity tests always validate against `<schema>.strict()`
 *        for objects. Capability authors should use `.strict()` on inputs
 *        when they want JSON Schema's strict semantics.
 *
 *   2. Optional vs nullable:
 *      - Our walker normalizes both to `option<T>`, which JSON Schema renders
 *        as `oneOf [T, null]`. Zod treats `.optional()` as "field may be
 *        missing" and `.nullable()` as "field may be null." For property
 *        testing, we generate samples that match the AST shape, so both
 *        validators see consistent inputs.
 *
 *   3. Number vs integer:
 *      - JSON Schema emits `type: integer` when AST says `integer: true`.
 *      - Zod's `.int()` enforces the integer constraint.
 *      - Both reject non-integers when the constraint is set, so they agree.
 */

import Ajv from 'ajv';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { capability } from '../contract.js';
import { jsonSchemaForCapability } from '../generators/json-schema.js';

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function makeAjv(): Ajv {
  // strict: false relaxes ajv's own meta-validation, not the schema we feed it.
  // We do not use ajv's strict-keyword checks; we validate the actual data.
  return new Ajv({ strict: false, allErrors: true });
}

/**
 * Validate `input` against both the codegen-emitted JSON Schema and the
 * runtime Zod schema. Returns `{ js, zod }` accept/reject booleans.
 */
function validateBoth<I extends z.ZodTypeAny, O extends z.ZodTypeAny>(
  cap: ReturnType<typeof capability<I, O>>,
  input: unknown,
): { js: boolean; zod: boolean } {
  const ajv = makeAjv();
  const validate = ajv.compile(jsonSchemaForCapability(cap.ast).input);
  return {
    js: validate(input) === true,
    zod: cap.inputSchema.safeParse(input).success,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Targeted parity tests — known-good and known-bad cases
// ──────────────────────────────────────────────────────────────────────────

describe('schema-parity — empty object input', () => {
  const cap = capability({
    name: 'session.get',
    version: '0.0.1',
    scopes: ['session:read'],
    description: 'Get the session.',
    input: z.object({}).strict(),
    output: z.object({}),
    examples: [],
  });

  it('both accept {}', () => {
    expect(validateBoth(cap, {})).toEqual({ js: true, zod: true });
  });

  it('both reject extra fields when input is strict', () => {
    expect(validateBoth(cap, { extra: 1 })).toEqual({ js: false, zod: false });
  });

  it('both reject non-objects', () => {
    expect(validateBoth(cap, null)).toEqual({ js: false, zod: false });
    expect(validateBoth(cap, 42)).toEqual({ js: false, zod: false });
    expect(validateBoth(cap, 'string')).toEqual({ js: false, zod: false });
    expect(validateBoth(cap, [])).toEqual({ js: false, zod: false });
  });
});

describe('schema-parity — primitives and required fields', () => {
  const cap = capability({
    name: 't.echo',
    version: '0.0.1',
    scopes: [],
    description: 'echo',
    input: z
      .object({
        s: z.string(),
        n: z.number().int(),
        b: z.boolean(),
      })
      .strict(),
    output: z.object({}),
    examples: [],
  });

  it('both accept the canonical example', () => {
    expect(validateBoth(cap, { s: 'hi', n: 1, b: true })).toEqual({ js: true, zod: true });
  });

  it('both reject missing required field', () => {
    expect(validateBoth(cap, { s: 'hi', n: 1 })).toEqual({ js: false, zod: false });
  });

  it('both reject wrong types', () => {
    expect(validateBoth(cap, { s: 1, n: 1, b: true })).toEqual({ js: false, zod: false });
    expect(validateBoth(cap, { s: 'hi', n: 1.5, b: true })).toEqual({ js: false, zod: false });
    expect(validateBoth(cap, { s: 'hi', n: 1, b: 'no' })).toEqual({ js: false, zod: false });
  });
});

describe('schema-parity — optional fields', () => {
  const cap = capability({
    name: 't.opt',
    version: '0.0.1',
    scopes: [],
    description: 'opt',
    input: z
      .object({
        required: z.string(),
        optional: z.number().optional(),
      })
      .strict(),
    output: z.object({}),
    examples: [],
  });

  it('both accept with optional present', () => {
    expect(validateBoth(cap, { required: 'x', optional: 1 })).toEqual({ js: true, zod: true });
  });

  it('both accept with optional absent', () => {
    expect(validateBoth(cap, { required: 'x' })).toEqual({ js: true, zod: true });
  });

  it('both reject when optional has wrong type', () => {
    expect(validateBoth(cap, { required: 'x', optional: 'no' })).toEqual({
      js: false,
      zod: false,
    });
  });
});

describe('schema-parity — enum', () => {
  const cap = capability({
    name: 't.enum',
    version: '0.0.1',
    scopes: [],
    description: 'enum',
    input: z.object({ status: z.enum(['active', 'paused']) }).strict(),
    output: z.object({}),
    examples: [],
  });

  it('both accept valid enum values', () => {
    expect(validateBoth(cap, { status: 'active' })).toEqual({ js: true, zod: true });
    expect(validateBoth(cap, { status: 'paused' })).toEqual({ js: true, zod: true });
  });

  it('both reject unknown enum values', () => {
    expect(validateBoth(cap, { status: 'unknown' })).toEqual({ js: false, zod: false });
  });
});

describe('schema-parity — list', () => {
  const cap = capability({
    name: 't.list',
    version: '0.0.1',
    scopes: [],
    description: 'list',
    input: z.object({ items: z.array(z.string()) }).strict(),
    output: z.object({}),
    examples: [],
  });

  it('both accept empty and non-empty arrays', () => {
    expect(validateBoth(cap, { items: [] })).toEqual({ js: true, zod: true });
    expect(validateBoth(cap, { items: ['a', 'b'] })).toEqual({ js: true, zod: true });
  });

  it('both reject non-array', () => {
    expect(validateBoth(cap, { items: 'a' })).toEqual({ js: false, zod: false });
  });

  it('both reject heterogeneous arrays', () => {
    expect(validateBoth(cap, { items: ['a', 1] })).toEqual({ js: false, zod: false });
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Property-based parity — random inputs
// ──────────────────────────────────────────────────────────────────────────

describe('schema-parity — fast-check property tests', () => {
  const flatCap = capability({
    name: 't.flat',
    version: '0.0.1',
    scopes: [],
    description: 'flat',
    input: z
      .object({
        s: z.string(),
        n: z.number().int(),
        flag: z.boolean().optional(),
      })
      .strict(),
    output: z.object({}),
    examples: [],
  });

  const ajv = makeAjv();
  const validate = ajv.compile(jsonSchemaForCapability(flatCap.ast).input);

  it('JSON Schema and Zod agree on randomly-generated structured inputs (200 runs)', () => {
    fc.assert(
      fc.property(
        fc.record({
          s: fc.oneof(fc.string(), fc.integer(), fc.constant(undefined)),
          n: fc.oneof(
            fc.integer(),
            fc.float({ noNaN: true }),
            fc.string(),
            fc.constant(undefined),
          ),
          flag: fc.oneof(fc.boolean(), fc.string(), fc.constant(undefined)),
        }),
        (sample) => {
          // Drop undefined keys to simulate "field absent"
          const cleaned: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(sample)) {
            if (v !== undefined) cleaned[k] = v;
          }
          const jsOk = validate(cleaned) === true;
          const zodOk = flatCap.inputSchema.safeParse(cleaned).success;
          return jsOk === zodOk;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('JSON Schema and Zod agree on garbage non-object inputs', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(null),
          fc.integer(),
          fc.string(),
          fc.boolean(),
          fc.array(fc.anything()),
        ),
        (sample) => {
          const jsOk = validate(sample) === true;
          const zodOk = flatCap.inputSchema.safeParse(sample).success;
          return jsOk === zodOk;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('JSON Schema and Zod agree on extra-property objects (strict)', () => {
    fc.assert(
      fc.property(
        fc.record({
          s: fc.string(),
          n: fc.integer(),
          extra1: fc.anything(),
          extra2: fc.anything(),
        }),
        (sample) => {
          const jsOk = validate(sample) === true;
          const zodOk = flatCap.inputSchema.safeParse(sample).success;
          // Both must reject due to .strict() / additionalProperties: false
          return jsOk === false && zodOk === false;
        },
      ),
      { numRuns: 50 },
    );
  });
});
