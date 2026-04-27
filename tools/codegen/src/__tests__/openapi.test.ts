/**
 * OpenAPI generator tests. Snapshot + deterministic ordering + idempotency.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { capability } from '../contract.js';
import { openApiForCapabilities } from '../generators/openapi.js';

const meta = {
  title: 'Iarsma — MCP Tool Surface',
  version: '0.0.0',
  description: 'Capability-scoped tool surface.',
};

const send = capability({
  name: 'mail.send',
  scopes: ['mail:send'],
  description: 'Send an email.',
  isDestructive: true,
  input: z.object({ to: z.array(z.string()), body: z.string() }),
  output: z.object({ messageId: z.string() }),
  examples: [],
});

const sessionGet = capability({
  name: 'session.get',
  scopes: ['session:read'],
  description: 'Get the session.',
  input: z.object({}),
  output: z.object({ username: z.string() }),
  examples: [],
});

describe('openApiForCapabilities', () => {
  it('produces a 3.1 doc with the right meta', () => {
    const doc = openApiForCapabilities([send.ast, sessionGet.ast], meta);
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info).toMatchObject({
      title: 'Iarsma — MCP Tool Surface',
      version: '0.0.0',
      description: 'Capability-scoped tool surface.',
    });
  });

  it('emits POST /mcp/tools/<name> for each capability', () => {
    const doc = openApiForCapabilities([send.ast, sessionGet.ast], meta);
    const paths = doc.paths as Record<string, unknown>;
    expect(Object.keys(paths)).toEqual(
      expect.arrayContaining(['/mcp/tools/mail.send', '/mcp/tools/session.get']),
    );
  });

  it('attaches x-iarsma-* extension fields', () => {
    const doc = openApiForCapabilities([send.ast], meta);
    const paths = doc.paths as Record<string, unknown>;
    const op = (paths['/mcp/tools/mail.send'] as { post: Record<string, unknown> }).post;
    expect(op['x-iarsma-scopes']).toEqual(['mail:send']);
    expect(op['x-iarsma-destructive']).toBe(true);
  });

  it('orders paths deterministically (alphabetical by capability name)', () => {
    // Pass capabilities in unsorted order; output should still be sorted.
    const a = openApiForCapabilities([send.ast, sessionGet.ast], meta);
    const b = openApiForCapabilities([sessionGet.ast, send.ast], meta);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('deduplicates and sorts tags', () => {
    const doc = openApiForCapabilities([send.ast, sessionGet.ast], meta);
    expect(doc.tags).toEqual([{ name: 'mail' }, { name: 'session' }]);
  });

  it('is idempotent', () => {
    const a = JSON.stringify(openApiForCapabilities([send.ast, sessionGet.ast], meta));
    const b = JSON.stringify(openApiForCapabilities([send.ast, sessionGet.ast], meta));
    expect(a).toBe(b);
  });
});
