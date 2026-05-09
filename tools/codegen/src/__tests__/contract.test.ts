/**
 * Contract envelope tests — `capability()` validation, version field
 * (D-044), stability annotation (D-045), error envelope shape (D-043).
 *
 * The codegen pipeline rejects non-semver versions at definition time so
 * authors find out before generated outputs ship to consumers. Stability
 * defaults to 'experimental' per D-045.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { capability, isValidSemver } from '../contract.js';
import { errorEnvelopeJsonSchema } from '../types.js';

describe('isValidSemver', () => {
  it('accepts canonical MAJOR.MINOR.PATCH', () => {
    expect(isValidSemver('0.0.0')).toBe(true);
    expect(isValidSemver('1.2.3')).toBe(true);
    expect(isValidSemver('10.20.30')).toBe(true);
  });

  it('accepts pre-release and build metadata', () => {
    expect(isValidSemver('1.2.3-rc.1')).toBe(true);
    expect(isValidSemver('1.2.3-alpha.0.beta')).toBe(true);
    expect(isValidSemver('1.2.3+build.5')).toBe(true);
    expect(isValidSemver('1.2.3-rc.1+build.5')).toBe(true);
  });

  it('rejects malformed versions', () => {
    expect(isValidSemver('1')).toBe(false);
    expect(isValidSemver('1.2')).toBe(false);
    expect(isValidSemver('1.2.3.4')).toBe(false);
    expect(isValidSemver('v1.2.3')).toBe(false);
    expect(isValidSemver('1.2.x')).toBe(false);
    expect(isValidSemver('')).toBe(false);
    expect(isValidSemver('latest')).toBe(false);
    expect(isValidSemver('01.2.3')).toBe(false); // leading-zero MAJOR
  });
});

describe('capability() — version field (D-044)', () => {
  const minimal = {
    name: 'session.get',
    scopes: [],
    description: 'd',
    input: z.object({}),
    output: z.object({}),
    examples: [],
  } as const;

  it('throws on missing or invalid semver', () => {
    expect(() => capability({ ...minimal, version: '1' })).toThrow(/invalid version/);
    expect(() => capability({ ...minimal, version: 'latest' })).toThrow(/invalid version/);
    expect(() => capability({ ...minimal, version: '1.2.x' })).toThrow(/invalid version/);
  });

  it('preserves the version string on the AST', () => {
    const cap = capability({ ...minimal, version: '0.0.1' });
    expect(cap.ast.version).toBe('0.0.1');
  });

  it('accepts pre-release versions', () => {
    const cap = capability({ ...minimal, version: '1.0.0-rc.1' });
    expect(cap.ast.version).toBe('1.0.0-rc.1');
  });
});

describe('capability() — stability annotation (D-045)', () => {
  const minimal = {
    name: 'session.get',
    version: '0.0.1',
    scopes: [],
    description: 'd',
    input: z.object({}),
    output: z.object({}),
    examples: [],
  } as const;

  it("defaults to 'experimental'", () => {
    const cap = capability(minimal);
    expect(cap.ast.stability).toBe('experimental');
  });

  it("preserves explicit 'stable' and 'deprecated'", () => {
    const stable = capability({ ...minimal, stability: 'stable' });
    expect(stable.ast.stability).toBe('stable');

    const deprecated = capability({ ...minimal, stability: 'deprecated' });
    expect(deprecated.ast.stability).toBe('deprecated');
  });
});

describe('errorEnvelopeJsonSchema (D-043)', () => {
  it('exposes the workspace-wide envelope shape', () => {
    const schema = errorEnvelopeJsonSchema();
    expect(schema).toMatchObject({
      title: 'IarsmaError',
      type: 'object',
      required: ['code', 'message'],
      additionalProperties: false,
    });
    expect((schema as { properties: Record<string, unknown> }).properties).toHaveProperty('code');
    expect((schema as { properties: Record<string, unknown> }).properties).toHaveProperty('message');
    expect((schema as { properties: Record<string, unknown> }).properties).toHaveProperty('details');
  });

  it('returns a fresh object per call (callers may mutate)', () => {
    const a = errorEnvelopeJsonSchema();
    const b = errorEnvelopeJsonSchema();
    expect(a).not.toBe(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
