/**
 * Dispatcher tests. Verifies the scope check, missing-tool/missing-handler
 * paths, and dry-run/commit semantics.
 */

import { describe, expect, it } from 'vitest';
import { createDispatcher, type ToolHandler } from '../invocation.js';
import { makeScopeSet } from '../scope-filter.js';
import type { ToolRegistration } from '../tool-loader.js';

const sessionGet: ToolRegistration = {
  name: 'session.get',
  description: 'Get the session.',
  requiredScopes: ['mail:read'],
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  isDestructive: false,
  examples: [],
};

const mailSend: ToolRegistration = {
  name: 'mail.send',
  description: 'Send mail.',
  requiredScopes: ['mail:send'],
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  isDestructive: true,
  examples: [],
};

const tools = new Map([
  [sessionGet.name, sessionGet],
  [mailSend.name, mailSend],
]);

describe('dispatcher', () => {
  it('returns not_found for unknown tool', async () => {
    const d = createDispatcher({ tools });
    const r = await d.invoke('does.not.exist', {}, makeScopeSet([]));
    expect(r).toMatchObject({ kind: 'denied', code: 'not_found' });
  });

  it('returns scope_denied when caller scopes are insufficient', async () => {
    const d = createDispatcher({ tools });
    const r = await d.invoke('session.get', {}, makeScopeSet([]));
    expect(r).toMatchObject({ kind: 'denied', code: 'scope_denied' });
  });

  it('returns not_implemented when a tool has no handler', async () => {
    const d = createDispatcher({ tools });
    const r = await d.invoke('session.get', {}, makeScopeSet(['mail:read']));
    expect(r).toMatchObject({ kind: 'error', code: 'not_implemented' });
  });

  it('dispatches to the handler when scopes match and a handler is registered', async () => {
    const handler: ToolHandler = async (input) => {
      return { echo: input };
    };
    const d = createDispatcher({
      tools,
      handlers: new Map([['session.get', handler]]),
    });
    const r = await d.invoke(
      'session.get',
      { hello: 'world' },
      makeScopeSet(['mail:read']),
    );
    expect(r).toEqual({ kind: 'ok', output: { echo: { hello: 'world' } } });
  });

  it('returns preview kind for dry-run calls', async () => {
    const handler: ToolHandler = async () => ({ would: 'send' });
    const d = createDispatcher({
      tools,
      handlers: new Map([['mail.send', handler]]),
    });
    const r = await d.invoke('mail.send', {}, makeScopeSet(['mail:send']), {
      dryRun: true,
    });
    expect(r).toEqual({ kind: 'preview', preview: { would: 'send' } });
  });

  it('returns ok kind for commit calls', async () => {
    const handler: ToolHandler = async () => ({ messageId: 'M-1' });
    const d = createDispatcher({
      tools,
      handlers: new Map([['mail.send', handler]]),
    });
    const r = await d.invoke('mail.send', {}, makeScopeSet(['mail:send']), {
      dryRun: false,
    });
    expect(r).toEqual({ kind: 'ok', output: { messageId: 'M-1' } });
  });

  it('passes scopes and dryRun flag to the handler', async () => {
    const calls: { input: unknown; dryRun: boolean; scopeCount: number }[] = [];
    const handler: ToolHandler = async (input, ctx) => {
      calls.push({ input, dryRun: ctx.dryRun, scopeCount: ctx.scopes.size });
      return null;
    };
    const d = createDispatcher({
      tools,
      handlers: new Map([['session.get', handler]]),
    });
    await d.invoke('session.get', { x: 1 }, makeScopeSet(['mail:read']));
    expect(calls).toEqual([{ input: { x: 1 }, dryRun: false, scopeCount: 1 }]);
  });

  it('wraps thrown handler errors as error kind', async () => {
    const handler: ToolHandler = async () => {
      throw new Error('boom');
    };
    const d = createDispatcher({
      tools,
      handlers: new Map([['session.get', handler]]),
    });
    const r = await d.invoke('session.get', {}, makeScopeSet(['mail:read']));
    expect(r).toMatchObject({ kind: 'error', code: 'tool_error', message: 'boom' });
  });
});
