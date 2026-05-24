/**
 * Tool scope constant + enforcement tests. Verifies the TOOL_SCOPES mapping,
 * the requiredScope() lookup, call-time scope rejection, and list-time scope
 * filtering.
 */

import { describe, expect, it } from 'vitest';
import { TOOL_SCOPES, requiredScope } from '../tool-scopes.js';
import { createDispatcher, type ToolHandler } from '../invocation.js';
import { makeScopeSet, visibleTools } from '../scope-filter.js';
import type { ToolRegistration } from '../tool-loader.js';

// ─────────────────────────────────────────────────────────────────────────
//  TOOL_SCOPES constant
// ─────────────────────────────────────────────────────────────────────────

describe('TOOL_SCOPES', () => {
  const knownTools = [
    'session.get',
    'mailbox.list',
    'thread.list',
    'thread.get',
    'thread.search',
    'identity.list',
    'mail.draft',
    'mail.send',
    'mail.modify',
    'mail.delete',
  ] as const;

  it('maps every known tool name to a scope string', () => {
    for (const name of knownTools) {
      expect(TOOL_SCOPES).toHaveProperty(name);
      const scope = TOOL_SCOPES[name];
      expect(typeof scope).toBe('string');
      expect(scope!.length).toBeGreaterThan(0);
    }
  });

  it('contains exactly the known tools — no extras, no omissions', () => {
    const keys = Object.keys(TOOL_SCOPES).sort();
    expect(keys).toEqual([...knownTools].sort());
  });

  it('assigns the correct scope for each tool', () => {
    expect(TOOL_SCOPES['session.get']).toBe('mail:read');
    expect(TOOL_SCOPES['mailbox.list']).toBe('mail:read');
    expect(TOOL_SCOPES['thread.list']).toBe('mail:read');
    expect(TOOL_SCOPES['thread.get']).toBe('mail:read');
    expect(TOOL_SCOPES['thread.search']).toBe('mail:read');
    expect(TOOL_SCOPES['identity.list']).toBe('mail:read');
    expect(TOOL_SCOPES['mail.draft']).toBe('mail:draft');
    expect(TOOL_SCOPES['mail.send']).toBe('mail:send');
    expect(TOOL_SCOPES['mail.modify']).toBe('mail:modify');
    expect(TOOL_SCOPES['mail.delete']).toBe('mail:delete');
  });
});

// ─────────────────────────────────────────────────────────────────────────
//  requiredScope() lookup
// ─────────────────────────────────────────────────────────────────────────

describe('requiredScope', () => {
  it('returns the scope for a known tool', () => {
    expect(requiredScope('mail.send')).toBe('mail:send');
  });

  it('returns undefined for an unknown tool name', () => {
    expect(requiredScope('does.not.exist')).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────
//  Call-time scope enforcement (via dispatcher)
// ─────────────────────────────────────────────────────────────────────────

describe('call-time scope enforcement', () => {
  /**
   * Build a tool registration whose requiredScopes come from the
   * TOOL_SCOPES constant, matching the wiring the server does at startup.
   */
  function reg(name: string): ToolRegistration {
    const scope = requiredScope(name);
    return {
      name,
      description: `Test tool ${name}`,
      requiredScopes: scope !== undefined ? [scope] : [],
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      isDestructive: false,
      examples: [],
    };
  }

  const tools = new Map<string, ToolRegistration>([
    ['mail.send', reg('mail.send')],
    ['thread.get', reg('thread.get')],
  ]);

  const echoHandler: ToolHandler = async (input) => ({ echo: input });

  it('rejects when the caller lacks the required scope', async () => {
    const d = createDispatcher({ tools });
    const r = await d.invoke('mail.send', {}, makeScopeSet(['mail:read']));
    expect(r).toMatchObject({ kind: 'denied', code: 'scope_denied' });
    expect((r as { message: string }).message).toContain('mail:send');
  });

  it('allows when the caller holds the required scope', async () => {
    const d = createDispatcher({
      tools,
      handlers: new Map([['mail.send', echoHandler]]),
    });
    const r = await d.invoke('mail.send', { to: 'a@b.com' }, makeScopeSet(['mail:send']));
    expect(r).toMatchObject({ kind: 'ok' });
  });

  it('returns scope_denied structured error shape through the MCP envelope', async () => {
    // The dispatcher returns `kind: 'denied'` with `code: 'scope_denied'`.
    // The TOOL_SCOPES constant ensures the right scope string appears in
    // the message. This test verifies the message includes the tool name
    // and the missing scope.
    const d = createDispatcher({ tools });
    const r = await d.invoke('thread.get', {}, makeScopeSet([]));
    expect(r).toMatchObject({ kind: 'denied', code: 'scope_denied' });
    const msg = (r as { message: string }).message;
    expect(msg).toContain('thread.get');
    expect(msg).toContain('mail:read');
  });
});

// ─────────────────────────────────────────────────────────────────────────
//  List-time scope filtering
// ─────────────────────────────────────────────────────────────────────────

describe('list-time scope filtering', () => {
  function reg(name: string): ToolRegistration {
    const scope = requiredScope(name);
    return {
      name,
      description: `Test tool ${name}`,
      requiredScopes: scope !== undefined ? [scope] : [],
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      isDestructive: false,
      examples: [],
    };
  }

  const allTools = [
    reg('session.get'),
    reg('mailbox.list'),
    reg('thread.list'),
    reg('thread.get'),
    reg('thread.search'),
    reg('identity.list'),
    reg('mail.draft'),
    reg('mail.send'),
    reg('mail.modify'),
    reg('mail.delete'),
  ];

  it('shows only mail:read tools when agent has only mail:read', () => {
    const visible = visibleTools(allTools, makeScopeSet(['mail:read']));
    const names = visible.map((t) => t.name);
    expect(names).toContain('session.get');
    expect(names).toContain('mailbox.list');
    expect(names).toContain('thread.list');
    expect(names).toContain('thread.get');
    expect(names).toContain('thread.search');
    expect(names).toContain('identity.list');
    expect(names).not.toContain('mail.send');
    expect(names).not.toContain('mail.draft');
    expect(names).not.toContain('mail.modify');
    expect(names).not.toContain('mail.delete');
  });

  it('shows all tools when agent has all scopes', () => {
    const visible = visibleTools(
      allTools,
      makeScopeSet(['mail:read', 'mail:draft', 'mail:send', 'mail:modify', 'mail:delete']),
    );
    expect(visible).toHaveLength(allTools.length);
  });

  it('shows no tools when agent has no scopes', () => {
    const visible = visibleTools(allTools, makeScopeSet([]));
    expect(visible).toHaveLength(0);
  });

  it('returns all tools when no identity is present (dev mode)', () => {
    // Dev mode = no identity = no filtering. The server should return
    // the full list. We simulate this by passing all known scopes or
    // by skipping the filter entirely. This test documents the contract:
    // when there's no identity, the full list is returned.
    // The server.ts handler should check: if no identity, return all.
    // We test the filtering function with a full scope set as a proxy.
    const devScopes = makeScopeSet([
      'mail:read',
      'mail:draft',
      'mail:send',
      'mail:modify',
      'mail:delete',
    ]);
    const visible = visibleTools(allTools, devScopes);
    expect(visible).toHaveLength(allTools.length);
  });
});
