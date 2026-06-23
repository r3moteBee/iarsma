/**
 * Tests for label-store read-modify-write functions (Task 4 — Labels feature).
 *
 * All network I/O is mocked. Tests verify:
 *   (a) readRegistry on a missing node returns EMPTY_REGISTRY + nodeId:null
 *   (b) writeRegistry on empty state creates a new FileNode
 *   (c) writeRegistry on an existing node updates it
 *   (d) one stateMismatch causes a re-read + retry that succeeds
 *   (e) two consecutive stateMismatches throw label_registry_conflict
 */

import { describe, expect, it, vi } from 'vitest';
import { readRegistry, writeRegistry, LABEL_DOC_NAME } from '../label-store.js';
import { EMPTY_REGISTRY, serializeRegistry } from '../label-registry.js';
import type { LabelRegistry } from '../label-registry.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

type FetchSpy = ReturnType<typeof vi.fn<typeof fetch>>;

function makeCtx(fetchImpl: FetchSpy) {
  return {
    baseUrl: 'https://sw-mail.r3motely.net',
    getAuthToken: () => 'tok',
    accountId: 'b',
    fetch: fetchImpl,
  };
}

/**
 * Build a mock fetch that returns responses in sequence (one per call).
 * If called more times than there are responses, the last response is reused.
 */
function makeSequenceFetch(...responses: string[]): FetchSpy {
  let callCount = 0;
  const impl: typeof fetch = async () => {
    const body = responses[callCount] ?? responses[responses.length - 1]!;
    callCount++;
    return new Response(body, { status: 200, statusText: 'OK' });
  };
  return vi.fn<typeof fetch>(impl);
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** FileNode/get response with NO label doc node. */
const FILENODE_GET_EMPTY = JSON.stringify({
  methodResponses: [
    ['FileNode/get', { accountId: 'b', state: 'saa', list: [], notFound: [] }, 'c1'],
  ],
});

/** FileNode/get response with ONE label doc node (blobId present). */
const EXISTING_BLOB_ID = 'ccrqakfj0w3nu1orhjhnduve02iir7zoi3pw2zzhyae1ndet32sw7aimae';
const EXISTING_NODE_ID = 'node-xyz';
const FILENODE_GET_WITH_NODE = JSON.stringify({
  methodResponses: [
    [
      'FileNode/get',
      {
        accountId: 'b',
        state: 'saa',
        list: [
          {
            id: EXISTING_NODE_ID,
            name: LABEL_DOC_NAME,
            parentId: null,
            blobId: EXISTING_BLOB_ID,
            size: 2,
          },
        ],
        notFound: [],
      },
      'c1',
    ],
  ],
});

/** Blob content for an existing registry with one label. */
const EXISTING_REGISTRY_JSON = JSON.stringify({
  version: 1,
  labels: [{ key: 'lbl_existing', name: 'Existing', color: '#ff6b35', order: 0 }],
});

/** Blob upload response (staging blobId). */
const STAGING_BLOB_ID = 'ecrqakfj0w3nu1orhjhnduve02iir7zoi3pw2zzhyae1ndet32sw7aowutv0cbq';
const BLOB_UPLOAD_RESPONSE = JSON.stringify({
  accountId: 'b',
  blobId: STAGING_BLOB_ID,
  type: 'application/json',
  size: 25,
});

/** FileNode/set create-success response. */
const FILENODE_SET_CREATE_OK = JSON.stringify({
  methodResponses: [
    ['FileNode/set', { accountId: 'b', newState: 'sab', created: { n1: { id: 'new-node-1' } } }, 'c1'],
  ],
});

/** FileNode/set update-success response. */
const FILENODE_SET_UPDATE_OK = JSON.stringify({
  methodResponses: [
    ['FileNode/set', { accountId: 'b', newState: 'sac', updated: { [EXISTING_NODE_ID]: null } }, 'c1'],
  ],
});

/** FileNode/set stateMismatch on UPDATE. */
const FILENODE_SET_UPDATE_MISMATCH = JSON.stringify({
  methodResponses: [
    [
      'FileNode/set',
      {
        accountId: 'b',
        newState: 'sad',
        notUpdated: {
          [EXISTING_NODE_ID]: { type: 'stateMismatch', description: 'State mismatch — retry.' },
        },
      },
      'c1',
    ],
  ],
});

/** FileNode/set stateMismatch on CREATE. */
const FILENODE_SET_CREATE_MISMATCH = JSON.stringify({
  methodResponses: [
    [
      'FileNode/set',
      {
        accountId: 'b',
        newState: 'sae',
        notCreated: {
          n1: { type: 'stateMismatch', description: 'State mismatch — retry.' },
        },
      },
      'c1',
    ],
  ],
});

/**
 * A concurrent writer created the node while our create was in-flight.
 * The re-read now returns a node with a different id.
 */
const CONCURRENT_NODE_ID = 'node-concurrent-abc';
const CONCURRENT_BLOB_ID = 'dcrqakfj0w3nu1orhjhnduve02iir7zoi3pw2zzhyae1ndet32sw7bcnxy';
const FILENODE_GET_WITH_CONCURRENT_NODE = JSON.stringify({
  methodResponses: [
    [
      'FileNode/get',
      {
        accountId: 'b',
        state: 'saf',
        list: [
          {
            id: CONCURRENT_NODE_ID,
            name: LABEL_DOC_NAME,
            parentId: null,
            blobId: CONCURRENT_BLOB_ID,
            size: 2,
          },
        ],
        notFound: [],
      },
      'c1',
    ],
  ],
});

/** Blob content served from the concurrent node (empty registry — concurrent writer created but left it empty). */
const CONCURRENT_REGISTRY_JSON = JSON.stringify({ version: 1, labels: [] });

/** FileNode/set update-success response for the concurrent node. */
const FILENODE_SET_CONCURRENT_UPDATE_OK = JSON.stringify({
  methodResponses: [
    ['FileNode/set', { accountId: 'b', newState: 'sag', updated: { [CONCURRENT_NODE_ID]: null } }, 'c1'],
  ],
});

// ── LABEL_DOC_NAME ────────────────────────────────────────────────────────────

describe('LABEL_DOC_NAME', () => {
  it('is the flat root-level filename', () => {
    expect(LABEL_DOC_NAME).toBe('.iarsma-labels.json');
  });
});

// ── readRegistry ──────────────────────────────────────────────────────────────

describe('readRegistry', () => {
  it('(a) returns EMPTY_REGISTRY and nodeId:null when the label doc node is absent', async () => {
    const spy = makeSequenceFetch(FILENODE_GET_EMPTY);
    const result = await readRegistry(makeCtx(spy));
    expect(result.registry).toEqual(EMPTY_REGISTRY);
    expect(result.nodeId).toBeNull();
    expect(result.state).toBe('saa');
    // Only one fetch call (FileNode/get) — no blob download needed
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('returns the parsed registry and nodeId when the label doc node exists', async () => {
    // fetch sequence: 1) FileNode/get, 2) blob download
    const spy = makeSequenceFetch(FILENODE_GET_WITH_NODE, EXISTING_REGISTRY_JSON);
    const result = await readRegistry(makeCtx(spy));
    expect(result.nodeId).toBe(EXISTING_NODE_ID);
    expect(result.state).toBe('saa');
    expect(result.registry.labels).toHaveLength(1);
    expect(result.registry.labels[0]!.key).toBe('lbl_existing');
    // Two fetches: FileNode/get + blob download
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

// ── writeRegistry ─────────────────────────────────────────────────────────────

describe('writeRegistry', () => {
  const addLabel = (r: LabelRegistry): LabelRegistry => ({
    version: 1,
    labels: [
      ...r.labels,
      { key: 'lbl_new', name: 'New Label', color: '#ff6b35', order: 1 },
    ],
  });

  it('(b) creates a new FileNode when no node existed (nodeId:null)', async () => {
    // fetch sequence: 1) FileNode/get empty, 2) blob upload, 3) FileNode/set create
    const spy = makeSequenceFetch(FILENODE_GET_EMPTY, BLOB_UPLOAD_RESPONSE, FILENODE_SET_CREATE_OK);
    const result = await writeRegistry(makeCtx(spy), addLabel);
    expect(result.labels).toHaveLength(1);
    expect(result.labels[0]!.key).toBe('lbl_new');
    expect(spy).toHaveBeenCalledTimes(3);

    // The blob upload (call index 1) must carry the POST body equal to the
    // serialized MUTATED registry — not the pre-mutation EMPTY_REGISTRY.
    const uploadCall = spy.mock.calls[1]!;
    const uploadBody = uploadCall[1]?.body as Blob;
    expect(uploadBody).toBeInstanceOf(Blob);
    const uploadedText = await uploadBody.text();
    const expectedMutated = addLabel(EMPTY_REGISTRY);
    expect(JSON.parse(uploadedText)).toEqual(JSON.parse(serializeRegistry(expectedMutated)));
  });

  it('(c) updates the existing FileNode when a node already exists', async () => {
    // fetch sequence: 1) FileNode/get with node, 2) blob download, 3) blob upload, 4) FileNode/set update
    const spy = makeSequenceFetch(
      FILENODE_GET_WITH_NODE,
      EXISTING_REGISTRY_JSON,
      BLOB_UPLOAD_RESPONSE,
      FILENODE_SET_UPDATE_OK,
    );
    const result = await writeRegistry(makeCtx(spy), addLabel);
    expect(result.labels).toHaveLength(2);
    expect(spy).toHaveBeenCalledTimes(4);
  });

  it('(d) retries once on stateMismatch (update) and succeeds', async () => {
    // Attempt 1: FileNode/get → existing node, blob download, blob upload, set → mismatch
    // Attempt 2: FileNode/get → existing node (re-read), blob download, blob upload, set → ok
    const spy = makeSequenceFetch(
      FILENODE_GET_WITH_NODE,   // initial read
      EXISTING_REGISTRY_JSON,   // initial blob download
      BLOB_UPLOAD_RESPONSE,     // initial upload
      FILENODE_SET_UPDATE_MISMATCH, // first set → mismatch
      FILENODE_GET_WITH_NODE,   // re-read
      EXISTING_REGISTRY_JSON,   // re-read blob download
      BLOB_UPLOAD_RESPONSE,     // retry upload
      FILENODE_SET_UPDATE_OK,   // retry set → ok
    );
    const result = await writeRegistry(makeCtx(spy), addLabel);
    expect(result.labels).toHaveLength(2);
    expect(spy).toHaveBeenCalledTimes(8);
  });

  it('(d) retries once on stateMismatch (create) and succeeds', async () => {
    // Empty node on first read, mismatch on create, then empty again on re-read, create ok
    const spy = makeSequenceFetch(
      FILENODE_GET_EMPTY,       // initial read (no node)
      BLOB_UPLOAD_RESPONSE,     // initial upload
      FILENODE_SET_CREATE_MISMATCH, // first create → mismatch
      FILENODE_GET_EMPTY,       // re-read (still empty)
      BLOB_UPLOAD_RESPONSE,     // retry upload
      FILENODE_SET_CREATE_OK,   // retry create → ok
    );
    const result = await writeRegistry(makeCtx(spy), addLabel);
    expect(result.labels).toHaveLength(1);
    expect(spy).toHaveBeenCalledTimes(6);
  });

  it('(d) create→update flip: create mismatch then re-read finds concurrent node → retry issues update', async () => {
    // First attempt: no node → create → stateMismatch.
    // Re-read: a concurrent writer created the node in the meantime.
    // Retry MUST issue an update (not another create) for the now-existing nodeId.
    const spy = makeSequenceFetch(
      FILENODE_GET_EMPTY,                 // initial read (no node)
      BLOB_UPLOAD_RESPONSE,               // initial upload
      FILENODE_SET_CREATE_MISMATCH,       // first create → mismatch
      FILENODE_GET_WITH_CONCURRENT_NODE,  // re-read → node now exists (concurrent writer)
      CONCURRENT_REGISTRY_JSON,           // re-read blob download (concurrent node's content)
      BLOB_UPLOAD_RESPONSE,               // retry upload
      FILENODE_SET_CONCURRENT_UPDATE_OK,  // retry set → ok (update, NOT create)
    );
    const result = await writeRegistry(makeCtx(spy), addLabel);
    expect(result.labels).toHaveLength(1);
    expect(spy).toHaveBeenCalledTimes(7);

    // The retry's FileNode/set call (index 6) must carry `update` for the
    // concurrent node id, NOT `create` — proving the flip path is exercised.
    const retrySetCall = spy.mock.calls[6]!;
    const retrySetBody = JSON.parse(retrySetCall[1]?.body as string) as {
      methodCalls: Array<[string, Record<string, unknown>, string]>;
    };
    const retrySetArgs = retrySetBody.methodCalls[0]![1];
    expect(retrySetArgs).not.toHaveProperty('create');
    expect(retrySetArgs).toHaveProperty('update');
    expect(retrySetArgs['update']).toHaveProperty(CONCURRENT_NODE_ID);
  });

  it('(e) throws label_registry_conflict on two consecutive stateMismatches', async () => {
    const spy = makeSequenceFetch(
      FILENODE_GET_WITH_NODE,       // initial read
      EXISTING_REGISTRY_JSON,       // initial blob download
      BLOB_UPLOAD_RESPONSE,         // initial upload
      FILENODE_SET_UPDATE_MISMATCH, // first set → mismatch
      FILENODE_GET_WITH_NODE,       // re-read
      EXISTING_REGISTRY_JSON,       // re-read blob
      BLOB_UPLOAD_RESPONSE,         // retry upload
      FILENODE_SET_UPDATE_MISMATCH, // retry set → mismatch again
    );
    await expect(writeRegistry(makeCtx(spy), addLabel)).rejects.toMatchObject({
      code: 'label_registry_conflict',
      message: 'Labels were changed elsewhere just now. Reopen and try again.',
    });
    expect(spy).toHaveBeenCalledTimes(8);
  });
});
