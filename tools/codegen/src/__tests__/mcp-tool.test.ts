/**
 * MCP tool registration generator tests.
 *
 * Implements test category 1 (snapshot) for the MCP tool generator. Pairs
 * with json-schema.test.ts which covers the underlying schema generation.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { capability } from '../contract.js';
import { mcpToolForCapability } from '../generators/mcp-tool.js';

describe('mcpToolForCapability', () => {
  const sample = capability({
    name: 'mail.send',
    version: '0.0.1',
    scopes: ['mail:send'],
    description: 'Send an email through the configured outbound relay.',
    isDestructive: true,
    input: z.object({
      to: z.array(z.string()),
      subject: z.string(),
      body: z.string(),
    }),
    output: z.object({
      messageId: z.string(),
      sentAt: z.string().describe('ISO 8601 timestamp.'),
    }),
    examples: [
      {
        title: 'Send a plain text message',
        input: { to: ['alice@example.com'], subject: 'Hi', body: 'Hello.' },
        output: { messageId: 'M-1', sentAt: '2026-04-26T22:00:00Z' },
      },
    ],
  });

  it('captures name, description, scopes, destructiveness', () => {
    const reg = mcpToolForCapability(sample.ast);
    expect(reg.name).toBe('mail.send');
    expect(reg.description).toContain('Send an email');
    expect(reg.requiredScopes).toEqual(['mail:send']);
    expect(reg.isDestructive).toBe(true);
  });

  it('stamps version and stability on the registration (D-044, D-045)', () => {
    const reg = mcpToolForCapability(sample.ast);
    expect(reg.version).toBe('0.0.1');
    expect(reg.stability).toBe('experimental');
  });

  it('includes the workspace error envelope schema (D-043)', () => {
    const reg = mcpToolForCapability(sample.ast);
    expect(reg.errorEnvelopeSchema).toMatchObject({
      title: 'IarsmaError',
      type: 'object',
      required: ['code', 'message'],
    });
  });

  it('embeds input + output schemas', () => {
    const reg = mcpToolForCapability(sample.ast);
    expect(reg.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        to: { type: 'array', items: { type: 'string' } },
      },
      required: expect.arrayContaining(['to', 'subject', 'body']),
    });
    expect(reg.outputSchema).toMatchObject({
      type: 'object',
      properties: {
        messageId: { type: 'string' },
        sentAt: { type: 'string', description: 'ISO 8601 timestamp.' },
      },
    });
  });

  it('preserves examples for docs (D-037)', () => {
    const reg = mcpToolForCapability(sample.ast);
    expect(reg.examples).toHaveLength(1);
    expect(reg.examples[0]?.title).toBe('Send a plain text message');
  });

  it('defaults isDestructive to false', () => {
    const readOnly = capability({
      name: 'mail.list',
      version: '0.0.1',
      scopes: ['mail:read'],
      description: 'List messages.',
      input: z.object({}),
      output: z.array(z.string()),
      examples: [],
    });
    expect(mcpToolForCapability(readOnly.ast).isDestructive).toBe(false);
  });

  it('is JSON-serializable', () => {
    const reg = mcpToolForCapability(sample.ast);
    const json = JSON.stringify(reg);
    const round = JSON.parse(json);
    expect(round.name).toBe(reg.name);
    expect(round.requiredScopes).toEqual([...reg.requiredScopes]);
  });
});
