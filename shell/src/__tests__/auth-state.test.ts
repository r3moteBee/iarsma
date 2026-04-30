/**
 * Smoke tests for the singleton state wiring in `auth-state.ts`.
 *
 * The atoms themselves are exercised end-to-end via the Playwright spec;
 * these tests pin the contract that consumers (App.tsx + future modules)
 * rely on — that `actionLog` exists, accepts appends, and produces a
 * verifiable chain.
 */

import { describe, expect, it } from 'vitest';
import { createStore } from 'jotai';
import { actionLog, agentContextAtom } from '../auth-state.js';

describe('auth-state.actionLog singleton', () => {
  it('appends an entry and surfaces it via verify()', async () => {
    const before = await actionLog.verify();
    expect(before).toBeNull();

    const entry = await actionLog.append({
      identity: { id: 'test-singleton@example.net' },
      action: 'auth.signin',
      params: { email: 'test-singleton@example.net' },
    });
    expect(entry.data.identity).toBe('test-singleton@example.net');
    expect(entry.data.action).toBe('auth.signin');
    expect(entry.hashHex).toMatch(/^[0-9a-f]{96}$/);

    expect(await actionLog.verify()).toBeNull();
  });
});

describe('auth-state.agentContextAtom', () => {
  it('starts as null until App.tsx populates it from config', () => {
    const store = createStore();
    expect(store.get(agentContextAtom)).toBeNull();
  });

  it('round-trips an agent-context value', () => {
    const store = createStore();
    store.set(agentContextAtom, {
      webmailMcpUrl: 'https://sw-mail.example.net/mcp',
      actionLogUrl: 'https://sw-mail.example.net/log',
    });
    const v = store.get(agentContextAtom);
    expect(v?.webmailMcpUrl).toBe('https://sw-mail.example.net/mcp');
    expect(v?.actionLogUrl).toBe('https://sw-mail.example.net/log');
    expect(v?.memoryBackendUrl).toBeUndefined();
  });
});
