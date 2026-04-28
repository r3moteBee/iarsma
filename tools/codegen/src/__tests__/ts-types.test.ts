/**
 * TypeScript types generator tests.
 *
 * Verifies the AST → TS type renderer produces expected output for every
 * TypeNode kind. Used by the React hook generator to inline `Input` /
 * `Output` types in generated hook files.
 */

import { describe, expect, it } from 'vitest';
import { typeNodeToTypeScript } from '../generators/ts-types.js';
import type { TypeNode } from '../types.js';

describe('typeNodeToTypeScript — primitives', () => {
  it('renders string', () => {
    expect(typeNodeToTypeScript({ kind: 'string' })).toBe('string');
  });

  it('renders number (integer or not — both are TS number)', () => {
    expect(typeNodeToTypeScript({ kind: 'number', integer: false })).toBe('number');
    expect(typeNodeToTypeScript({ kind: 'number', integer: true })).toBe('number');
  });

  it('renders boolean', () => {
    expect(typeNodeToTypeScript({ kind: 'boolean' })).toBe('boolean');
  });

  it('renders unit as Record<string, never>', () => {
    expect(typeNodeToTypeScript({ kind: 'unit' })).toBe('Record<string, never>');
  });
});

describe('typeNodeToTypeScript — composites', () => {
  it('renders option<T> as T | null', () => {
    expect(typeNodeToTypeScript({ kind: 'option', inner: { kind: 'string' } })).toBe(
      'string | null',
    );
  });

  it('renders list<T> as Array<T>', () => {
    expect(typeNodeToTypeScript({ kind: 'list', element: { kind: 'string' } })).toBe(
      'Array<string>',
    );
  });

  it('renders empty record as Record<string, never>', () => {
    expect(typeNodeToTypeScript({ kind: 'record', fields: [] })).toBe(
      'Record<string, never>',
    );
  });

  it('renders record with required and optional fields', () => {
    const node: TypeNode = {
      kind: 'record',
      fields: [
        { name: 'a', type: { kind: 'string' }, optional: false },
        { name: 'b', type: { kind: 'number', integer: true }, optional: true },
      ],
    };
    const result = typeNodeToTypeScript(node);
    expect(result).toContain('a: string;');
    expect(result).toContain('b?: number;');
    expect(result.startsWith('{')).toBe(true);
    expect(result.endsWith('}')).toBe(true);
  });

  it('emits JSDoc comments for fields with descriptions', () => {
    const node: TypeNode = {
      kind: 'record',
      fields: [
        { name: 'username', type: { kind: 'string' }, optional: false, description: 'Account email.' },
      ],
    };
    const result = typeNodeToTypeScript(node);
    expect(result).toContain('/** Account email. */');
    expect(result).toContain('username: string;');
  });

  it('escapes JSDoc terminators in descriptions', () => {
    const node: TypeNode = {
      kind: 'record',
      fields: [
        {
          name: 'tricky',
          type: { kind: 'string' },
          optional: false,
          description: 'has a */ in it',
        },
      ],
    };
    const result = typeNodeToTypeScript(node);
    expect(result).toContain('*\\/');
    expect(result).not.toContain('has a */ in it'); // raw form must not appear
  });

  it('renders enums as string union', () => {
    expect(typeNodeToTypeScript({ kind: 'enum', values: ['active', 'paused'] })).toBe(
      "'active' | 'paused'",
    );
  });

  it('renders variants as discriminated union', () => {
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
    const result = typeNodeToTypeScript(node);
    expect(result).toContain("{ tag: 'a'; payload:");
    expect(result).toContain("{ tag: 'b' }");
  });

  it('renders nested records with consistent indentation', () => {
    const node: TypeNode = {
      kind: 'record',
      fields: [
        {
          name: 'outer',
          type: {
            kind: 'record',
            fields: [
              { name: 'inner', type: { kind: 'string' }, optional: false },
            ],
          },
          optional: false,
        },
      ],
    };
    const result = typeNodeToTypeScript(node);
    expect(result).toContain('outer: {');
    expect(result).toMatch(/inner: string;/);
  });
});
