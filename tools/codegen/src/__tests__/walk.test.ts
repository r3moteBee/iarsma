/**
 * AST walker tests.
 *
 * Implements categories 2 and 5 of F-3's six-category test coverage (see
 * docs/implementation-plan.md, Phase 0 work item 4a):
 *
 *   - Walker exhaustiveness: every WIT-clean violation throws UnhandledZodKind,
 *     and every genuinely-unsupported Zod kind also throws (never silently
 *     produces wrong output).
 *   - Lint positive cases (the WIT-clean violations) — the walker enforces
 *     these even when the lint rule is bypassed (D-036 belt-and-suspenders).
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { UnhandledZodKind, walkZod } from '../walk.js';

describe('walkZod — primitives', () => {
  it('walks string', () => {
    expect(walkZod(z.string())).toEqual({ kind: 'string' });
  });

  it('walks number (non-integer)', () => {
    expect(walkZod(z.number())).toEqual({ kind: 'number', integer: false });
  });

  it('walks number (integer)', () => {
    expect(walkZod(z.number().int())).toEqual({ kind: 'number', integer: true });
  });

  it('walks boolean', () => {
    expect(walkZod(z.boolean())).toEqual({ kind: 'boolean' });
  });

  it('walks void/null/undefined as unit', () => {
    expect(walkZod(z.void())).toEqual({ kind: 'unit' });
    expect(walkZod(z.null())).toEqual({ kind: 'unit' });
    expect(walkZod(z.undefined())).toEqual({ kind: 'unit' });
  });
});

describe('walkZod — composites', () => {
  it('walks records with required and optional fields', () => {
    const ast = walkZod(
      z.object({
        a: z.string(),
        b: z.number().optional(),
      }),
    );
    expect(ast.kind).toBe('record');
    if (ast.kind !== 'record') return;
    expect(ast.fields).toHaveLength(2);
    expect(ast.fields[0]).toMatchObject({
      name: 'a',
      type: { kind: 'string' },
      optional: false,
    });
    expect(ast.fields[1]?.name).toBe('b');
    expect(ast.fields[1]?.optional).toBe(true);
    // Optional fields don't wrap their type in `option` — the field-level
    // `optional: true` flag captures the optionality, so the inner type
    // stays clean (otherwise generators would emit `b?: T | null`,
    // doubly-optional, since `?` already means "or undefined").
    expect(ast.fields[1]?.type).toMatchObject({ kind: 'number' });
  });

  it('distinguishes ZodOptional (field-level absence) from ZodNullable (value-level null)', () => {
    const ast = walkZod(
      z.object({
        opt: z.string().optional(),
        nul: z.string().nullable(),
      }),
    );
    if (ast.kind !== 'record') throw new Error('expected record');
    // `.optional()` → field marked optional, type stays `string`.
    expect(ast.fields[0]).toMatchObject({
      name: 'opt',
      optional: true,
      type: { kind: 'string' },
    });
    // `.nullable()` → field NOT marked optional (Zod's nullable accepts
    // null but requires the property to be present), type wrapped in
    // `option<string>` to convey the value-level null.
    expect(ast.fields[1]).toMatchObject({
      name: 'nul',
      optional: false,
      type: { kind: 'option', inner: { kind: 'string' } },
    });
  });

  it('captures field descriptions', () => {
    const ast = walkZod(z.object({ a: z.string().describe('the alpha') }));
    if (ast.kind !== 'record') throw new Error('expected record');
    expect(ast.fields[0]?.description).toBe('the alpha');
  });

  it('walks arrays', () => {
    expect(walkZod(z.array(z.string()))).toEqual({
      kind: 'list',
      element: { kind: 'string' },
    });
  });

  it('walks enums', () => {
    expect(walkZod(z.enum(['a', 'b', 'c']))).toEqual({
      kind: 'enum',
      values: ['a', 'b', 'c'],
    });
  });

  it('walks string literals as single-value enums', () => {
    expect(walkZod(z.literal('hello'))).toEqual({
      kind: 'enum',
      values: ['hello'],
    });
  });

  it('walks discriminated unions to variants', () => {
    const schema = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('a'), value: z.string() }),
      z.object({ kind: z.literal('b'), value: z.number() }),
    ]);
    const ast = walkZod(schema);
    expect(ast.kind).toBe('variant');
    if (ast.kind !== 'variant') return;
    expect(ast.cases).toHaveLength(2);
    expect(ast.cases[0]?.tag).toBe('a');
    expect(ast.cases[1]?.tag).toBe('b');
  });
});

describe('walkZod — WIT-clean enforcement (D-036)', () => {
  it('rejects z.refine', () => {
    expect(() => walkZod(z.string().refine((s) => s.length > 0))).toThrow(
      UnhandledZodKind,
    );
  });

  it('rejects z.transform', () => {
    expect(() => walkZod(z.string().transform((s) => s.toUpperCase()))).toThrow(
      UnhandledZodKind,
    );
  });

  it('rejects z.intersection', () => {
    expect(() =>
      walkZod(z.intersection(z.object({ a: z.string() }), z.object({ b: z.string() }))),
    ).toThrow(UnhandledZodKind);
  });

  it('rejects branded types', () => {
    expect(() => walkZod(z.string().brand<'BrandedId'>())).toThrow(UnhandledZodKind);
  });

  it('rejects non-discriminated z.union', () => {
    expect(() => walkZod(z.union([z.string(), z.number()]))).toThrow(UnhandledZodKind);
  });

  it("error message names the violation and points at the fix", () => {
    try {
      walkZod(z.string().refine(() => true));
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(UnhandledZodKind);
      expect((e as Error).message).toContain('z.refine');
      expect((e as Error).message).toContain('D-036');
    }
  });
});

describe('walkZod — exhaustiveness (no silent fall-through)', () => {
  it('rejects z.bigint', () => {
    expect(() => walkZod(z.bigint())).toThrow(UnhandledZodKind);
  });

  it('rejects z.date', () => {
    expect(() => walkZod(z.date())).toThrow(UnhandledZodKind);
  });

  it('rejects z.tuple (positional records have no WIT equivalent)', () => {
    expect(() => walkZod(z.tuple([z.string(), z.number()]))).toThrow(UnhandledZodKind);
  });

  it('rejects z.record (open-ended maps)', () => {
    expect(() => walkZod(z.record(z.string()))).toThrow(UnhandledZodKind);
  });

  it('rejects z.any', () => {
    expect(() => walkZod(z.any())).toThrow(UnhandledZodKind);
  });

  it('rejects z.unknown', () => {
    expect(() => walkZod(z.unknown())).toThrow(UnhandledZodKind);
  });
});
