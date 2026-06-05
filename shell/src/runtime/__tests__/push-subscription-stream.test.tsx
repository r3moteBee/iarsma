/**
 * @vitest-environment jsdom
 *
 * Integration test for the fetch-based SSE reader (PR 29).
 *
 * Mocks `fetch` to return a streaming Response and verifies the hook
 * dispatches parsed `state` events into onStateChange.
 */

import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePushSubscription } from '../push-subscription.js';
import type { Session, MailboxRights } from '../jmap-client.js';
import type { StateChange } from '../push-subscription.js';

const TEST_SESSION: Session = {
  username: 'me@example.test',
  apiUrl: 'https://jmap.example.test/jmap/',
  downloadUrl: 'https://jmap.example.test/jmap/download/',
  uploadUrl: 'https://jmap.example.test/jmap/upload/',
  eventSourceUrl: 'https://jmap.example.test/jmap/eventsource/',
  state: 's-0',
  primaryAccountIdMail: 'c',
} as unknown as Session;
void ({} as MailboxRights); // exercise type import

afterEach(cleanup);

function Harness({
  onStateChange,
}: {
  onStateChange: (c: StateChange) => void;
}) {
  usePushSubscription({
    session: TEST_SESSION,
    getAuthToken: () => 'tok-abc',
    onStateChange,
  });
  return null;
}

function makeStreamResponse(chunks: readonly string[]): Response {
  let i = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[i++];
      if (chunk === undefined) {
        controller.close();
        return;
      }
      controller.enqueue(new TextEncoder().encode(chunk));
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

describe('usePushSubscription — fetch-based SSE (PR 29)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('opens fetch with Authorization: Bearer + accept: text/event-stream', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(makeStreamResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    const onChange = vi.fn();
    render(<Harness onStateChange={onChange} />);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const [, init] = fetchMock.mock.calls[0]!;
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer tok-abc');
    expect(headers.accept).toBe('text/event-stream');
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toMatch(/eventsource/);
    expect(url).toMatch(/types=\*/);
    // The legacy access_token query param MUST NOT appear — Stalwart
    // rejects it. PR 29 fix.
    expect(url).not.toMatch(/access_token/);
  });

  it('parses a state event and dispatches the flattened changed map', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        makeStreamResponse([
          'event: state\n',
          'data: {"changed":{"c":{"Email":"s-42","Mailbox":"s-7"}}}\n',
          '\n',
        ]),
      );
    vi.stubGlobal('fetch', fetchMock);

    const onChange = vi.fn();
    render(<Harness onStateChange={onChange} />);
    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    const call = onChange.mock.calls[0]![0] as StateChange;
    expect(call.changed).toEqual({ Email: 's-42', Mailbox: 's-7' });
  });

  it('ignores SSE comment lines (keep-alive pings)', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        makeStreamResponse([
          ': ping\n\n',
          'event: state\n',
          'data: {"changed":{"c":{"Email":"s-1"}}}\n',
          '\n',
        ]),
      );
    vi.stubGlobal('fetch', fetchMock);

    const onChange = vi.fn();
    render(<Harness onStateChange={onChange} />);
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledTimes(1);
    });
    expect((onChange.mock.calls[0]![0] as StateChange).changed).toEqual({
      Email: 's-1',
    });
  });

  it('handles CRLF line endings', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        makeStreamResponse([
          'event: state\r\n',
          'data: {"changed":{"c":{"Email":"s-2"}}}\r\n',
          '\r\n',
        ]),
      );
    vi.stubGlobal('fetch', fetchMock);

    const onChange = vi.fn();
    render(<Harness onStateChange={onChange} />);
    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    expect((onChange.mock.calls[0]![0] as StateChange).changed).toEqual({
      Email: 's-2',
    });
  });

  it('handles chunk boundaries that split an SSE record', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        makeStreamResponse([
          'event: stat',
          'e\ndata: {"chan',
          'ged":{"c":{"Email":"s-3"}}}\n\n',
        ]),
      );
    vi.stubGlobal('fetch', fetchMock);

    const onChange = vi.fn();
    render(<Harness onStateChange={onChange} />);
    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    expect((onChange.mock.calls[0]![0] as StateChange).changed).toEqual({
      Email: 's-3',
    });
  });

  it('skips dispatch when fetch returns a non-OK status', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('unauthorized', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    const onChange = vi.fn();
    render(<Harness onStateChange={onChange} />);
    // Wait a beat for the response to be processed.
    await new Promise((r) => setTimeout(r, 50));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not open the connection when session is null', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    function NullHarness() {
      usePushSubscription({
        session: null,
        getAuthToken: () => 'tok',
        onStateChange: () => {},
      });
      return null;
    }
    render(<NullHarness />);
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
