/**
 * Memory backend adapter — thin client for OB1's MCP-over-HTTP API
 * (Phase 5c work item 11).
 *
 * Scope: scaffold only. No UI surface invokes this yet. The shape is
 * pre-agreed via D-054 so when the first caller arrives — likely a
 * "user opened thread X" profile-signal write or a "context for the
 * thread agent is composing about" lookup — it has a typed seam.
 *
 * Architecture (D-031 + D-054):
 *   - Iarsma does NOT proxy free-text / vector queries on behalf of
 *     agents. Agents discover OB1 via `urn:iarsma:agent-context` and
 *     connect to it directly with their own bearer.
 *   - This adapter exists for *webmail-initiated* writes/reads — when
 *     the webmail itself wants to record or look up a structured
 *     signal. Annotations and profile entries are deterministic and
 *     small; they fit the "structured store" half of the memory model
 *     (the brief reserves vector queries for agent-direct access).
 *
 * Wire format: OB1 speaks MCP over Streamable HTTP (Hono server, JSON-
 * RPC body). For this scaffold we POST `tools/call` envelopes directly
 * — no SDK client. A real-traffic migration to `@modelcontextprotocol/
 * sdk/client/streamableHttp` is appropriate when concurrent calls,
 * server-pushed events, or session resumption matter.
 */

// ─── Public types ──────────────────────────────────────────────────

/** A "thought" — OB1's universal record type. Annotations, profile
 *  entries, and behavior signals are all thoughts with shaped metadata. */
export type Thought = {
  readonly id: number;
  readonly content: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
};

export type SearchMatch = Thought & {
  readonly similarity: number;
};

export type CaptureInput = {
  /** Free-text content. OB1 embeds this. */
  readonly content: string;
  /** Optional JSONB filter tag, e.g. `{ kind: 'annotation', threadId: 'T-1' }`. */
  readonly metadata?: Readonly<Record<string, unknown>>;
};

export type SearchInput = {
  readonly query: string;
  /** Cosine-similarity floor, 0..1. OB1's default is 0.5. */
  readonly threshold?: number;
  /** Max results. OB1's default is 10. */
  readonly limit?: number;
  /** Optional JSONB metadata filter — matched as a JSONB containment. */
  readonly filter?: Readonly<Record<string, unknown>>;
};

export interface MemoryBackend {
  /** Persist a thought. Returns the assigned id once OB1 confirms. */
  captureThought(input: CaptureInput): Promise<{ readonly id: number }>;
  /** Vector similarity search. Empty array means no matches. */
  searchThoughts(input: SearchInput): Promise<readonly SearchMatch[]>;
}

export type MemoryBackendOptions = {
  /** OB1 MCP endpoint. Same value `agentContext.memoryBackendUrl`
   *  advertises to agents — typically `https://.../mcp`. */
  readonly baseUrl: string;
  /** Returns the bearer to send in `Authorization`. Allowed to return
   *  `null` (call fails with `unauthorized`). The webmail does not
   *  store OB1 credentials in IDB; the operator wires a per-session
   *  token through here. */
  readonly getAuthToken: () => string | null;
  /** Override for tests. */
  readonly fetch?: typeof fetch;
};

// ─── Factory ───────────────────────────────────────────────────────

export function openbrainMemoryBackend(
  opts: MemoryBackendOptions,
): MemoryBackend {
  const fetchImpl = opts.fetch ?? fetch;
  // OB1's MCP server is JSON-RPC 2.0 underneath. Each call needs a
  // monotonic id; concurrent calls are fine because the response carries
  // the same id back. A counter is sufficient — sessions are per-process.
  let nextId = 1;

  async function callTool(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    const token = opts.getAuthToken();
    if (token === null) {
      throw makeError('unauthorized', 'No auth token available for OB1.');
    }
    const id = nextId++;
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name, arguments: args },
    });
    let response: Response;
    try {
      response = await fetchImpl(opts.baseUrl, {
        method: 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body,
      });
    } catch (e) {
      throw makeError('network_error', `OB1 fetch failed: ${describe(e)}`);
    }
    if (!response.ok) {
      throw makeError(
        response.status === 401 || response.status === 403
          ? 'unauthorized'
          : 'mcp_http_error',
        `OB1 returned ${response.status} ${response.statusText}`,
      );
    }
    const parsed = (await response.json()) as {
      result?: { content?: ReadonlyArray<{ type: string; text?: string }> };
      error?: { code: number; message: string };
    };
    if (parsed.error !== undefined) {
      throw makeError(
        'mcp_tool_error',
        `OB1 tool '${name}' failed: ${parsed.error.message}`,
      );
    }
    // Streamable-HTTP tool responses wrap the payload in `result.content[]`
    // as MCP content parts. OB1 returns a single text part with a JSON
    // body — parse it back out.
    const text = parsed.result?.content?.[0]?.text;
    if (typeof text !== 'string') {
      throw makeError(
        'mcp_parse_error',
        `OB1 tool '${name}' returned no text content.`,
      );
    }
    try {
      return JSON.parse(text);
    } catch {
      // Some tools return plain strings; pass them through.
      return text;
    }
  }

  return {
    async captureThought(input) {
      const result = (await callTool('capture_thought', {
        content: input.content,
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      })) as { id?: unknown };
      if (typeof result.id !== 'number') {
        throw makeError(
          'mcp_parse_error',
          'OB1 capture_thought response missing numeric id.',
        );
      }
      return { id: result.id };
    },

    async searchThoughts(input) {
      const result = (await callTool('search_thoughts', {
        query: input.query,
        ...(input.threshold !== undefined ? { match_threshold: input.threshold } : {}),
        ...(input.limit !== undefined ? { match_count: input.limit } : {}),
        ...(input.filter !== undefined ? { filter: input.filter } : {}),
      })) as unknown;
      if (!Array.isArray(result)) {
        throw makeError(
          'mcp_parse_error',
          'OB1 search_thoughts response is not an array.',
        );
      }
      return result.map((r) => {
        const o = r as {
          id?: unknown;
          content?: unknown;
          metadata?: unknown;
          similarity?: unknown;
          created_at?: unknown;
        };
        if (
          typeof o.id !== 'number' ||
          typeof o.content !== 'string' ||
          typeof o.similarity !== 'number'
        ) {
          throw makeError(
            'mcp_parse_error',
            'OB1 search_thoughts row missing required fields.',
          );
        }
        return {
          id: o.id,
          content: o.content,
          metadata:
            o.metadata !== null && typeof o.metadata === 'object'
              ? (o.metadata as Record<string, unknown>)
              : {},
          similarity: o.similarity,
          createdAt: typeof o.created_at === 'string' ? o.created_at : '',
        };
      });
    },
  };
}

// ─── Helpers ───────────────────────────────────────────────────────

function makeError(code: string, message: string): Error {
  const err = new Error(message);
  (err as Error & { code?: string }).code = code;
  return err;
}

function describe(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
