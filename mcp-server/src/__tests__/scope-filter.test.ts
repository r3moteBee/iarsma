/**
 * Scope filter tests. The filter decides which tools an agent can see/call
 * based on its token's scope set. Logic from docs/capability-scopes.md.
 */

import { describe, expect, it } from 'vitest';
import { hasAllScopes, makeScopeSet, visibleTools } from '../scope-filter.js';

describe('makeScopeSet', () => {
  it('normalizes a scope list', () => {
    const set = makeScopeSet(['mail:read', '  mail:send  ', '']);
    expect(set.size).toBe(2);
    expect(set.has('mail:read')).toBe(true);
    expect(set.has('mail:send')).toBe(true);
  });

  it('deduplicates', () => {
    const set = makeScopeSet(['mail:read', 'mail:read', 'mail:read']);
    expect(set.size).toBe(1);
  });
});

describe('hasAllScopes', () => {
  it('accepts when no scopes are required', () => {
    expect(hasAllScopes(makeScopeSet([]), [])).toBe(true);
    expect(hasAllScopes(makeScopeSet(['mail:read']), [])).toBe(true);
  });

  it('accepts when held is a strict superset', () => {
    expect(hasAllScopes(makeScopeSet(['mail:read', 'mail:send']), ['mail:read'])).toBe(true);
  });

  it('accepts when sets are equal', () => {
    expect(hasAllScopes(makeScopeSet(['mail:read']), ['mail:read'])).toBe(true);
  });

  it('rejects when held is missing a required scope', () => {
    expect(hasAllScopes(makeScopeSet(['mail:read']), ['mail:send'])).toBe(false);
  });

  it('does NOT treat refinements as implied (mail:read.metadata is independent of mail:read)', () => {
    // Conventions in docs/capability-scopes.md: dot syntax indicates a
    // refinement, not a sub-permission.
    expect(hasAllScopes(makeScopeSet(['mail:read']), ['mail:read.metadata'])).toBe(false);
    expect(hasAllScopes(makeScopeSet(['mail:read.metadata']), ['mail:read'])).toBe(false);
  });

  it('admin:* matches any admin:<x>', () => {
    expect(hasAllScopes(makeScopeSet(['admin:*']), ['admin:users'])).toBe(true);
    expect(hasAllScopes(makeScopeSet(['admin:*']), ['admin:scopes'])).toBe(true);
  });

  it('admin:* does not match non-admin scopes', () => {
    expect(hasAllScopes(makeScopeSet(['admin:*']), ['mail:read'])).toBe(false);
  });

  it('multiple required scopes all must match', () => {
    const held = makeScopeSet(['mail:read', 'calendar:read']);
    expect(hasAllScopes(held, ['mail:read', 'calendar:read'])).toBe(true);
    expect(hasAllScopes(held, ['mail:read', 'calendar:write'])).toBe(false);
  });
});

describe('visibleTools', () => {
  const tools = [
    { name: 'mail.read', requiredScopes: ['mail:read'] },
    { name: 'mail.send', requiredScopes: ['mail:send'] },
    { name: 'cal.list', requiredScopes: ['calendar:read'] },
    { name: 'public', requiredScopes: [] },
  ];

  it('returns tools whose scopes are all satisfied', () => {
    const result = visibleTools(tools, makeScopeSet(['mail:read', 'calendar:read']));
    expect(result.map((t) => t.name)).toEqual(['mail.read', 'cal.list', 'public']);
  });

  it('always includes tools with no required scopes', () => {
    const result = visibleTools(tools, makeScopeSet([]));
    expect(result.map((t) => t.name)).toEqual(['public']);
  });

  it('returns empty array when nothing matches and there are no public tools', () => {
    const onlyPrivate = tools.filter((t) => t.requiredScopes.length > 0);
    expect(visibleTools(onlyPrivate, makeScopeSet([]))).toEqual([]);
  });
});
