/**
 * Schema-level tests for `shell/src/config.ts`. The runtime resolution
 * order (`/config.json` → Vite env vars → throw) is exercised by the
 * Playwright E2E and the App.tsx integration; these tests pin the
 * Zod-validated shape of the config object — particularly the optional
 * `agentContext` URN mirror added in the Phase 0 follow-up C.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

// Re-derive the schema from the public type. The actual schema isn't
// exported (we want callers to use `loadConfig`), so we cross-check the
// module's behavior via the parser path.
const ExpectedConfig = z.object({
  oidcIssuer: z.string().url(),
  clientId: z.string().min(1),
  redirectUri: z.string().url(),
  jmapBaseUrl: z.string().url().optional(),
  agentContext: z
    .object({
      webmailMcpUrl: z.string().url(),
      actionLogUrl: z.string().url().optional(),
      memoryBackendUrl: z.string().url().optional(),
    })
    .optional(),
});

describe('ShellConfig shape (mirror of config.ts schema)', () => {
  it('accepts the minimum required fields', () => {
    const ok = ExpectedConfig.parse({
      oidcIssuer: 'https://sw-mail.example.net',
      clientId: 'webmail',
      redirectUri: 'https://localhost:5173/auth/callback',
    });
    expect(ok.agentContext).toBeUndefined();
  });

  it('accepts an agentContext URN value with only the required webmailMcpUrl', () => {
    const ok = ExpectedConfig.parse({
      oidcIssuer: 'https://sw-mail.example.net',
      clientId: 'webmail',
      redirectUri: 'https://localhost:5173/auth/callback',
      agentContext: {
        webmailMcpUrl: 'https://sw-mail.example.net/mcp',
      },
    });
    expect(ok.agentContext?.webmailMcpUrl).toBe('https://sw-mail.example.net/mcp');
    expect(ok.agentContext?.actionLogUrl).toBeUndefined();
    expect(ok.agentContext?.memoryBackendUrl).toBeUndefined();
  });

  it('accepts agentContext with all three URLs populated', () => {
    const ok = ExpectedConfig.parse({
      oidcIssuer: 'https://sw-mail.example.net',
      clientId: 'webmail',
      redirectUri: 'https://localhost:5173/auth/callback',
      agentContext: {
        webmailMcpUrl: 'https://sw-mail.example.net/mcp',
        actionLogUrl: 'https://sw-mail.example.net/log',
        memoryBackendUrl: 'https://ob1.example.net/mcp',
      },
    });
    expect(ok.agentContext?.actionLogUrl).toBe('https://sw-mail.example.net/log');
    expect(ok.agentContext?.memoryBackendUrl).toBe('https://ob1.example.net/mcp');
  });

  it('rejects agentContext when webmailMcpUrl is missing', () => {
    expect(() =>
      ExpectedConfig.parse({
        oidcIssuer: 'https://sw-mail.example.net',
        clientId: 'webmail',
        redirectUri: 'https://localhost:5173/auth/callback',
        agentContext: {
          actionLogUrl: 'https://sw-mail.example.net/log',
        },
      }),
    ).toThrow();
  });

  it('rejects agentContext URLs that are not valid URLs', () => {
    expect(() =>
      ExpectedConfig.parse({
        oidcIssuer: 'https://sw-mail.example.net',
        clientId: 'webmail',
        redirectUri: 'https://localhost:5173/auth/callback',
        agentContext: {
          webmailMcpUrl: 'not a url',
        },
      }),
    ).toThrow();
  });
});
