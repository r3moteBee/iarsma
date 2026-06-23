/**
 * Label store — read-modify-write for the label registry document.
 *
 * The label registry is stored as a JSON blob in a root-level FileNode named
 * `.iarsma-labels.json` (flat name, `parentId: null`). This module isolates
 * the FileNode/get → blob-download → blob-upload → FileNode/set dance, with
 * a single optimistic-concurrency retry on `stateMismatch`.
 *
 * NOTE: The live Stalwart server does NOT actually enforce `ifInState` today
 * (last-write-wins in practice), so the retry path is defensive for future
 * server versions. Tests still exercise and validate the retry contract.
 */

import type { JmapClientOptions, FileNodeSetResult } from './jmap-client.js';
import {
  buildFileNodeGetRequest,
  parseFileNodeList,
  buildFileNodeSetRequest,
  parseFileNodeSet,
  fetchBlobUpload,
  fetchBlobText,
} from './jmap-client.js';
import {
  parseRegistry,
  serializeRegistry,
  EMPTY_REGISTRY,
  type LabelRegistry,
} from './label-registry.js';
import type { ToolError } from './types.js';

// ─── Public constant ──────────────────────────────────────────────────────────

/** Flat root-level filename for the label registry document (parentId: null). */
export const LABEL_DOC_NAME = '.iarsma-labels.json';

// ─── Context type ─────────────────────────────────────────────────────────────

/** JMAP call context: the base JmapClientOptions plus the resolved account ID. */
export type LabelStoreCtx = JmapClientOptions & { readonly accountId: string };

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Read the current label registry from the server.
 *
 * Performs a `FileNode/get` to list all nodes, then looks for the node whose
 * `name === LABEL_DOC_NAME`. If absent, returns `EMPTY_REGISTRY` with
 * `nodeId: null`. If present, downloads the blob and parses it.
 */
export async function readRegistry(
  ctx: LabelStoreCtx,
): Promise<{ registry: LabelRegistry; nodeId: string | null; state: string }> {
  const body = buildFileNodeGetRequest({ accountId: ctx.accountId });
  const fetchImpl = ctx.fetch ?? fetch;

  const token = await ctx.getAuthToken();
  if (token === null) {
    throw makeError('unauthorized', 'No auth token available.');
  }

  let response: Response;
  try {
    response = await fetchImpl(`${ctx.baseUrl.replace(/\/$/, '')}/jmap/api`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body,
    });
  } catch (e) {
    throw makeError('network_error', `FileNode/get failed: ${describe(e)}`);
  }
  if (!response.ok) {
    throw makeError(
      response.status === 401 ? 'unauthorized' : 'jmap_http_error',
      `FileNode/get returned ${response.status} ${response.statusText}`,
    );
  }

  const nodeList = parseFileNodeList(await response.text());
  const { state } = nodeList;
  const node = nodeList.nodes.find((n) => n.name === LABEL_DOC_NAME) ?? null;

  if (node === null) {
    return { registry: EMPTY_REGISTRY, nodeId: null, state };
  }

  // Node found — download the blob
  if (!node.blobId) {
    // Node exists but has no blobId yet — treat as empty
    return { registry: EMPTY_REGISTRY, nodeId: node.id, state };
  }

  const json = await fetchBlobText({
    ...ctx,
    blobId: node.blobId,
    filename: LABEL_DOC_NAME,
  });

  return { registry: parseRegistry(json), nodeId: node.id, state };
}

/**
 * Atomically mutate and persist the label registry.
 *
 * 1. Reads current state via `readRegistry`.
 * 2. Applies `mutate` to the current registry.
 * 3. Uploads the mutated registry as a new blob.
 * 4. Creates a new FileNode (if `nodeId === null`) or updates the existing one
 *    (with `ifInState` for defensive optimistic concurrency).
 * 5. If the set response reports a `stateMismatch` in `notCreated`/`notUpdated`,
 *    re-reads once and retries steps 2–4.
 * 6. If the retry also reports a mismatch, throws `label_registry_conflict`.
 *
 * Returns the mutated registry on success.
 */
export async function writeRegistry(
  ctx: LabelStoreCtx,
  mutate: (r: LabelRegistry) => LabelRegistry,
): Promise<LabelRegistry> {
  // First attempt
  const first = await readRegistry(ctx);
  const firstMutated = mutate(first.registry);
  const firstSetResult = await uploadAndSet(ctx, firstMutated, first.nodeId, first.state);

  if (!hasMismatch(firstSetResult)) {
    return firstMutated;
  }

  // One mismatch — re-read once and retry
  const second = await readRegistry(ctx);
  const secondMutated = mutate(second.registry);
  const secondSetResult = await uploadAndSet(ctx, secondMutated, second.nodeId, second.state);

  if (!hasMismatch(secondSetResult)) {
    return secondMutated;
  }

  // Two mismatches — give up
  throw makeError(
    'label_registry_conflict',
    'Labels were changed elsewhere just now. Reopen and try again.',
  );
}

// ─── Private helpers ──────────────────────────────────────────────────────────

/**
 * Upload the registry blob and issue a FileNode/set create or update.
 * Returns the raw `FileNodeSetResult` for the caller to inspect for mismatches.
 */
async function uploadAndSet(
  ctx: LabelStoreCtx,
  registry: LabelRegistry,
  nodeId: string | null,
  state: string,
): Promise<FileNodeSetResult> {
  const json = serializeRegistry(registry);
  const bytes = new TextEncoder().encode(json);

  const { blobId } = await fetchBlobUpload({
    ...ctx,
    bytes,
    contentType: 'application/json',
  });

  const fetchImpl = ctx.fetch ?? fetch;
  const token = await ctx.getAuthToken();
  if (token === null) {
    throw makeError('unauthorized', 'No auth token available.');
  }

  let setBody: string;
  if (nodeId === null) {
    // Create a new FileNode
    setBody = buildFileNodeSetRequest({
      accountId: ctx.accountId,
      ifInState: state,
      create: {
        n1: {
          name: LABEL_DOC_NAME,
          blobId,
          parentId: null,
        },
      },
    });
  } else {
    // Update the existing FileNode
    setBody = buildFileNodeSetRequest({
      accountId: ctx.accountId,
      ifInState: state,
      update: {
        [nodeId]: { blobId },
      },
    });
  }

  let response: Response;
  try {
    response = await fetchImpl(`${ctx.baseUrl.replace(/\/$/, '')}/jmap/api`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: setBody,
    });
  } catch (e) {
    throw makeError('network_error', `FileNode/set failed: ${describe(e)}`);
  }
  if (!response.ok) {
    throw makeError(
      response.status === 401 ? 'unauthorized' : 'jmap_http_error',
      `FileNode/set returned ${response.status} ${response.statusText}`,
    );
  }

  return parseFileNodeSet(await response.text());
}

/**
 * Returns true if the set result contains any `stateMismatch` error in
 * `notCreated` or `notUpdated`.
 */
function hasMismatch(result: FileNodeSetResult): boolean {
  if (result.notCreated) {
    for (const v of Object.values(result.notCreated)) {
      if (v.type === 'stateMismatch') return true;
    }
  }
  if (result.notUpdated) {
    for (const v of Object.values(result.notUpdated)) {
      if (v.type === 'stateMismatch') return true;
    }
  }
  return false;
}

function makeError(code: string, message: string): ToolError {
  return { code, message };
}

function describe(e: unknown): string {
  if (e !== null && typeof e === 'object' && 'message' in e) {
    return String((e as { message: unknown }).message);
  }
  return String(e);
}
