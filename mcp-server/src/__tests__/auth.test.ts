/**
 * Auth tests. Phase 0 auth is intentionally simple — Bearer token passthrough
 * plus scope reading from a header. Tests pin the contract before Phase 1+
 * replaces the internals with real OIDC introspection.
 */

import { describe, expect, it } from 'vitest';
import { AuthError, extractIdentity, headersFromObject } from '../auth.js';

describe('extractIdentity', () => {
  it('returns identity when Authorization header is well-formed', () => {
    const id = extractIdentity(
      headersFromObject({
        authorization: 'Bearer abc123',
        'x-iarsma-scopes': 'mail:read,mail:send',
      }),
    );
    expect(id.id).toBe('abc123');
    expect(id.scopes.size).toBe(2);
    expect(id.scopes.has('mail:read')).toBe(true);
    expect(id.scopes.has('mail:send')).toBe(true);
  });

  it('uses x-iarsma-agent-id when provided as the canonical id', () => {
    const id = extractIdentity(
      headersFromObject({
        authorization: 'Bearer some-token',
        'x-iarsma-agent-id': 'agent-1',
      }),
    );
    expect(id.id).toBe('agent-1');
  });

  it('throws AuthError when Authorization is missing', () => {
    expect(() => extractIdentity(headersFromObject({}))).toThrow(AuthError);
  });

  it('throws AuthError when Authorization is not Bearer scheme', () => {
    expect(() =>
      extractIdentity(headersFromObject({ authorization: 'Basic dXNlcjpwYXNz' })),
    ).toThrow(AuthError);
  });

  it('throws AuthError when bearer token is empty', () => {
    expect(() =>
      extractIdentity(headersFromObject({ authorization: 'Bearer ' })),
    ).toThrow(AuthError);
  });

  it('handles missing scope header by defaulting to empty scope set', () => {
    const id = extractIdentity(headersFromObject({ authorization: 'Bearer t' }));
    expect(id.scopes.size).toBe(0);
  });

  it('is case-insensitive on header lookups', () => {
    const id = extractIdentity(
      headersFromObject({
        Authorization: 'Bearer x',
        'X-Iarsma-Scopes': 'mail:read',
      }),
    );
    expect(id.scopes.has('mail:read')).toBe(true);
  });
});
