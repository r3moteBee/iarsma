/**
 * Host wrapper around the `iarsma:jmap-client` WASM component.
 *
 * Per D-038 the component is parse-only — this module performs the HTTP
 * fetch (with the auth bearer) and routes the response body through the
 * component to produce a typed Session record.
 */

import { session as jmapClientSession } from '../wasm/jmap-client/jmap_client.js';
import type { ToolError } from './types.js';

export type Session = {
  readonly username: string;
  readonly apiUrl: string;
  readonly downloadUrl: string;
  readonly uploadUrl: string;
  readonly eventSourceUrl: string;
  readonly state: string;
  readonly primaryAccountIdMail: string;
};

export type JmapClientOptions = {
  /** Base URL of the JMAP server, e.g. 'https://sw-mail.example.net'. */
  readonly baseUrl: string;
  /** Returns the current Bearer token. Called on each request. */
  readonly getAuthToken: () => string | null;
  /** Override for tests. Defaults to the global `fetch`. */
  readonly fetch?: typeof fetch;
};

/**
 * Fetch and parse the JMAP session resource.
 *
 * Network errors surface as `ToolError` with stable codes; component-side
 * parse errors come through with the WIT `parse-error-code` as the payload
 * so callers can branch on `malformed-json` vs `missing-field` etc.
 */
export async function fetchSession(opts: JmapClientOptions): Promise<Session> {
  const token = opts.getAuthToken();
  if (token === null) {
    throw makeError('unauthorized', 'No auth token available.');
  }
  const url = `${opts.baseUrl.replace(/\/$/, '')}/.well-known/jmap`;
  const fetchImpl = opts.fetch ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
      },
    });
  } catch (e) {
    throw makeError('network_error', `JMAP fetch failed: ${describe(e)}`);
  }
  if (!response.ok) {
    throw makeError(
      response.status === 401 ? 'unauthorized' : 'jmap_http_error',
      `JMAP /.well-known/jmap returned ${response.status} ${response.statusText}`,
    );
  }
  const body = await response.text();
  return parseSession(body);
}

/**
 * Parse a JMAP session response body. Exposed for tests; production
 * callers use `fetchSession`.
 */
export function parseSession(body: string): Session {
  try {
    return jmapClientSession.parseSession(body);
  } catch (e) {
    throw makeError('jmap_parse_error', `Failed to parse session: ${describe(e)}`, e);
  }
}

function makeError(code: string, message: string, payload?: unknown): ToolError {
  return payload === undefined ? { code, message } : { code, message, payload };
}

function describe(e: unknown): string {
  if (e !== null && typeof e === 'object' && 'message' in e) {
    return String((e as { message: unknown }).message);
  }
  return String(e);
}
