/**
 * Tests for the OB1 memory-backend adapter scaffold (Phase 5c).
 *
 * The adapter has no UI callers yet — these tests pin the wire shape so
 * the first caller doesn't have to discover it the hard way.
 */

import { describe, expect, it, vi } from 'vitest';
import { openbrainMemoryBackend } from '../memory-backend.js';

function jsonRpcResponse(id: number, payload: unknown): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      id,
      result: {
        content: [{ type: 'text', text: JSON.stringify(payload) }],
      },
    }),
    { status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' } },
  );
}

describe('openbrainMemoryBackend.captureThought', () => {
  it('POSTs a tools/call JSON-RPC envelope and returns the new id', async () => {
    const fetchSpy = vi.fn(async () => jsonRpcResponse(1, { id: 42 })) as unknown as typeof fetch;
    const backend = openbrainMemoryBackend({
      baseUrl: 'https://ob1.example/mcp',
      getAuthToken: () => 'secret',
      fetch: fetchSpy,
    });

    const out = await backend.captureThought({
      content: 'hello',
      metadata: { kind: 'annotation', threadId: 'T-1' },
    });
    expect(out).toEqual({ id: 42 });

    const [url, init] = (
      fetchSpy as unknown as {
        mock: { calls: [string, { method: string; headers: Record<string, string>; body: string }][] };
      }
    ).mock.calls[0]!;
    expect(url).toBe('https://ob1.example/mcp');
    expect(init.method).toBe('POST');
    expect(init.headers['authorization']).toBe('Bearer secret');
    const body = JSON.parse(init.body) as {
      jsonrpc: string;
      method: string;
      params: { name: string; arguments: { content: string; metadata: Record<string, string> } };
    };
    expect(body.jsonrpc).toBe('2.0');
    expect(body.method).toBe('tools/call');
    expect(body.params.name).toBe('capture_thought');
    expect(body.params.arguments.content).toBe('hello');
    expect(body.params.arguments.metadata.kind).toBe('annotation');
  });

  it('fails fast when getAuthToken returns null', async () => {
    const backend = openbrainMemoryBackend({
      baseUrl: 'https://ob1.example/mcp',
      getAuthToken: () => null,
    });
    await expect(backend.captureThought({ content: 'x' })).rejects.toThrow(/No auth token/);
  });

  it('translates 401 to a typed unauthorized error', async () => {
    const fetchSpy = vi.fn(async () => new Response('nope', { status: 401, statusText: 'Unauthorized' })) as unknown as typeof fetch;
    const backend = openbrainMemoryBackend({
      baseUrl: 'https://ob1.example/mcp',
      getAuthToken: () => 't',
      fetch: fetchSpy,
    });
    await expect(backend.captureThought({ content: 'x' })).rejects.toThrow(/401/);
  });
});

describe('openbrainMemoryBackend.searchThoughts', () => {
  it('maps OB1 rows into SearchMatch objects', async () => {
    const fetchSpy = vi.fn(async () =>
      jsonRpcResponse(1, [
        {
          id: 7,
          content: 'remembered thing',
          metadata: { source: 'inbox' },
          similarity: 0.81,
          created_at: '2026-05-01T00:00:00Z',
        },
      ]),
    ) as unknown as typeof fetch;
    const backend = openbrainMemoryBackend({
      baseUrl: 'https://ob1.example/mcp',
      getAuthToken: () => 't',
      fetch: fetchSpy,
    });
    const matches = await backend.searchThoughts({ query: 'thing', limit: 5 });
    expect(matches).toHaveLength(1);
    expect(matches[0]?.id).toBe(7);
    expect(matches[0]?.similarity).toBeCloseTo(0.81);
    expect(matches[0]?.metadata['source']).toBe('inbox');
    expect(matches[0]?.createdAt).toBe('2026-05-01T00:00:00Z');

    const body = JSON.parse(
      (fetchSpy as unknown as { mock: { calls: [string, { body: string }][] } }).mock.calls[0]![1].body,
    ) as { params: { name: string; arguments: Record<string, unknown> } };
    expect(body.params.name).toBe('search_thoughts');
    expect(body.params.arguments['match_count']).toBe(5);
    expect(body.params.arguments['query']).toBe('thing');
  });

  it('returns an empty array when OB1 has no matches', async () => {
    const fetchSpy = vi.fn(async () => jsonRpcResponse(1, [])) as unknown as typeof fetch;
    const backend = openbrainMemoryBackend({
      baseUrl: 'https://ob1.example/mcp',
      getAuthToken: () => 't',
      fetch: fetchSpy,
    });
    const matches = await backend.searchThoughts({ query: 'nothing' });
    expect(matches).toEqual([]);
  });

  it('surfaces a JSON-RPC error from OB1', async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32600, message: 'invalid filter' },
        }),
        { status: 200, statusText: 'OK' },
      ),
    ) as unknown as typeof fetch;
    const backend = openbrainMemoryBackend({
      baseUrl: 'https://ob1.example/mcp',
      getAuthToken: () => 't',
      fetch: fetchSpy,
    });
    await expect(backend.searchThoughts({ query: 'x' })).rejects.toThrow(/invalid filter/);
  });
});
