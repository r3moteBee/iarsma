/**
 * Tests for label-operations.ts — Task 7 (Labels feature).
 *
 * All network I/O is mocked. Tests cover:
 *   - label.list → returns registry labels
 *   - label.create → refusal at cap, invalid name, happy path
 *   - label.update → not_found, rename-to-blank, key immutability, happy path
 *   - label.delete dry-run → affectedCount, not_found
 *   - label.delete commit → untag paging >500 messages (no cap), registry removal
 *   - label.apply dry-run → affectedCount, label_not_found listing valid names
 *   - label.apply commit → name→key resolution, patch shape, email_not_found
 *
 * Sequence convention:
 *   readRegistry = FileNode/get (+ optional blob download if node exists)
 *   writeRegistry = readRegistry + blob-upload-POST + FileNode/set
 *   Operations that read before write issue TWO readRegistry calls total.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  labelList,
  labelCreate,
  labelUpdate,
  labelDeletePreview,
  labelDeleteCommit,
  labelApplyPreview,
  labelApplyCommit,
} from '../label-operations.js';
import type { LabelOpsCtx } from '../label-operations.js';
import { serializeRegistry } from '../label-registry.js';
import type { LabelRegistry } from '../label-registry.js';
import { LABEL_DOC_NAME } from '../label-store.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const SESSION = {
  username: 'user@example.test',
  apiUrl: 'https://jmap.example.test/api',
  downloadUrl: 'https://jmap.example.test/download/{accountId}/{blobId}/{name}',
  uploadUrl: 'https://jmap.example.test/upload/{accountId}/',
  eventSourceUrl: '',
  state: 's0',
  primaryAccountIdMail: 'acct1',
};

const TOKEN = 'test-token';

// ─── Fetch mock helpers ───────────────────────────────────────────────────────

type FetchSpy = ReturnType<typeof vi.fn<typeof fetch>>;

/**
 * Sequenced fetch mock. Each call consumes the next response. If the
 * sequence runs out the last response is reused (for paging tests that
 * terminate on a repeated empty-query).
 *
 * IMPORTANT: blob uploads POST a Blob body, not a string. The spy must
 * handle both. Tests that need to inspect the blob content should use
 * `readBlobBody` below.
 */
function makeFetchSpy(responses: string[]): FetchSpy {
  let callIndex = 0;
  const impl: typeof fetch = async () => {
    const body = responses[callIndex] ?? responses[responses.length - 1]!;
    callIndex++;
    return new Response(body, {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
    });
  };
  return vi.fn<typeof fetch>(impl);
}

/**
 * Read the body from a mock fetch call. Handles both string and Blob body.
 */
async function readCallBody(calls: unknown[][], callIndex: number): Promise<string> {
  const init = calls[callIndex]?.[1] as RequestInit | undefined;
  if (init === undefined) return '';
  const body = init.body;
  if (typeof body === 'string') return body;
  if (body instanceof Blob) return await body.text();
  return String(body ?? '');
}

function jsonStr(val: unknown): string {
  return JSON.stringify(val);
}

// ─── Registry helpers ─────────────────────────────────────────────────────────

/** FileNode/get with NO label doc. */
const FILENODE_EMPTY = jsonStr({
  methodResponses: [
    ['FileNode/get', { accountId: 'acct1', state: 'sa0', list: [], notFound: [] }, 'c1'],
  ],
});

/** Blob upload response. */
const BLOB_UPLOAD = jsonStr({
  accountId: 'acct1',
  blobId: 'blob-123',
  type: 'application/json',
  size: 50,
});

/** FileNode/set create success. */
const FILENODE_SET_OK = jsonStr({
  methodResponses: [
    ['FileNode/set', { accountId: 'acct1', newState: 'sa1', created: { n1: { id: 'node-1' } } }, 'c1'],
  ],
});

/** FileNode/set update success. */
const FILENODE_UPDATE_OK = jsonStr({
  methodResponses: [
    ['FileNode/set', { accountId: 'acct1', newState: 'sa2', updated: { 'node-1': null } }, 'c1'],
  ],
});

/**
 * Build [FileNode/get, blobBody] responses for a registry.
 * The FileNode/get points to a node with blobId; the blob body is the serialized registry.
 */
function filenodeWithRegistry(registry: LabelRegistry): [string, string] {
  const regJson = serializeRegistry(registry);
  const fileNodeGet = jsonStr({
    methodResponses: [
      [
        'FileNode/get',
        {
          accountId: 'acct1',
          state: 'sa0',
          list: [
            {
              id: 'node-1',
              name: LABEL_DOC_NAME,
              parentId: null,
              blobId: 'blob-existing',
              size: regJson.length,
            },
          ],
          notFound: [],
        },
        'c1',
      ],
    ],
  });
  return [fileNodeGet, regJson];
}

/** Email/query response with given ids. */
function emailQueryResponse(ids: string[]): string {
  return jsonStr({
    methodResponses: [['Email/query', { ids }, '0']],
  });
}

/** Email/query response reporting a total count (limit: 0 path). */
function emailQueryCountResponse(total: number): string {
  return jsonStr({
    methodResponses: [['Email/query', { ids: [], total }, '0']],
  });
}

/** Email/set update success for given ids. */
function emailSetUpdateOk(ids: string[]): string {
  const updated: Record<string, unknown> = {};
  for (const id of ids) updated[id] = null;
  return jsonStr({
    methodResponses: [['Email/set', { updated }, '0']],
  });
}

/** Email/set update with notUpdated entries (triggers email_not_found). */
function emailSetNotUpdated(ids: string[]): string {
  const notUpdated: Record<string, unknown> = {};
  for (const id of ids) notUpdated[id] = { type: 'notFound' };
  return jsonStr({
    methodResponses: [['Email/set', { notUpdated }, '0']],
  });
}

function makeCtx(fetchImpl: FetchSpy): LabelOpsCtx {
  return {
    baseUrl: 'https://jmap.example.test',
    getAuthToken: () => TOKEN,
    fetch: fetchImpl as typeof fetch,
    session: SESSION,
  };
}

// ─── label.list ───────────────────────────────────────────────────────────────

describe('label.list', () => {
  it('returns empty labels when registry is empty', async () => {
    const fetchFn = makeFetchSpy([FILENODE_EMPTY]);
    const result = await labelList(makeCtx(fetchFn));
    expect(result).toEqual({ labels: [] });
  });

  it('returns labels from the stored registry', async () => {
    const registry: LabelRegistry = {
      version: 1,
      labels: [
        { key: 'work', name: 'Work', color: '#ff6b35', order: 0 },
        { key: 'personal', name: 'Personal', color: '#ff9d23', order: 1 },
      ],
    };
    const [fileNodeGet, blobBody] = filenodeWithRegistry(registry);
    const fetchFn = makeFetchSpy([fileNodeGet, blobBody]);
    const result = await labelList(makeCtx(fetchFn));
    expect(result.labels).toHaveLength(2);
    expect(result.labels[0]?.key).toBe('work');
    expect(result.labels[1]?.key).toBe('personal');
  });
});

// ─── label.create ─────────────────────────────────────────────────────────────

describe('label.create', () => {
  // Sequence for empty registry create:
  // 1. labelCreate → readRegistry: FileNode/get (empty)
  // 2. writeRegistry → readRegistry: FileNode/get (empty)
  // 3. writeRegistry → fetchBlobUpload: POST to /jmap/upload/...
  // 4. writeRegistry → FileNode/set: POST to /jmap/api
  const createEmptySeq = () =>
    makeFetchSpy([FILENODE_EMPTY, FILENODE_EMPTY, BLOB_UPLOAD, FILENODE_SET_OK]);

  it('returns { key } for a valid new label', async () => {
    const fetchFn = createEmptySeq();
    const result = await labelCreate(makeCtx(fetchFn), { name: 'Work' });
    expect(result.key).toBe('work');
  });

  it('uses DEFAULT_LABEL_COLOR (#ff6b35) when color is omitted', async () => {
    const fetchFn = createEmptySeq();
    await labelCreate(makeCtx(fetchFn), { name: 'Default Color' });
    // Call 3 (index 2) is the blob upload; read its body
    const calls = (fetchFn as ReturnType<typeof vi.fn>).mock.calls;
    const uploadBody = JSON.parse(await readCallBody(calls, 2)) as {
      labels: Array<{ color: string }>;
    };
    expect(uploadBody.labels[0]?.color).toBe('#ff6b35');
  });

  it('uses the provided color when supplied', async () => {
    const fetchFn = createEmptySeq();
    await labelCreate(makeCtx(fetchFn), { name: 'Red', color: '#ff0000' });
    const calls = (fetchFn as ReturnType<typeof vi.fn>).mock.calls;
    const uploadBody = JSON.parse(await readCallBody(calls, 2)) as {
      labels: Array<{ color: string }>;
    };
    expect(uploadBody.labels[0]?.color).toBe('#ff0000');
  });

  it('throws label_name_invalid for a name that slugifies to empty', async () => {
    const fetchFn = makeFetchSpy([FILENODE_EMPTY]);
    await expect(
      labelCreate(makeCtx(fetchFn), { name: '---' }),
    ).rejects.toMatchObject({
      code: 'label_name_invalid',
      message: 'Enter a label name using letters or numbers.',
    });
  });

  it('throws label_limit_reached when registry has 200 labels', async () => {
    const labels = Array.from({ length: 200 }, (_, i) => ({
      key: `lbl_${i}`,
      name: `Label ${i}`,
      color: '#ff6b35',
      order: i,
    }));
    const registry: LabelRegistry = { version: 1, labels };
    const [fileNodeGet, blobBody] = filenodeWithRegistry(registry);
    const fetchFn = makeFetchSpy([fileNodeGet, blobBody]);
    await expect(
      labelCreate(makeCtx(fetchFn), { name: 'One More' }),
    ).rejects.toMatchObject({
      code: 'label_limit_reached',
      message: "You've reached the maximum of 200 labels. Delete one to add another.",
    });
  });

  it('auto-suffixes collisions via mintLabelKey (work → work_2)', async () => {
    const registry: LabelRegistry = {
      version: 1,
      labels: [{ key: 'work', name: 'Work', color: '#ff6b35', order: 0 }],
    };
    const [fileNodeGet, blobBody] = filenodeWithRegistry(registry);
    const [fileNodeGet2, blobBody2] = filenodeWithRegistry(registry);
    const fetchFn = makeFetchSpy([
      fileNodeGet, blobBody,
      fileNodeGet2, blobBody2,
      BLOB_UPLOAD, FILENODE_UPDATE_OK,
    ]);
    const result = await labelCreate(makeCtx(fetchFn), { name: 'Work' });
    expect(result.key).toBe('work_2');
  });
});

// ─── label.update ─────────────────────────────────────────────────────────────

describe('label.update', () => {
  const registry: LabelRegistry = {
    version: 1,
    labels: [
      { key: 'work', name: 'Work', color: '#ff6b35', order: 0 },
      { key: 'personal', name: 'Personal', color: '#ff9d23', order: 1 },
    ],
  };

  // Sequence for update:
  // 1. labelUpdate → readRegistry: FileNode/get + blob
  // 2. writeRegistry → readRegistry: FileNode/get + blob
  // 3. writeRegistry → fetchBlobUpload
  // 4. writeRegistry → FileNode/set
  function makeUpdateSeq() {
    const [fg1, b1] = filenodeWithRegistry(registry);
    const [fg2, b2] = filenodeWithRegistry(registry);
    return makeFetchSpy([fg1, b1, fg2, b2, BLOB_UPLOAD, FILENODE_UPDATE_OK]);
  }

  it('returns { updated: true } for a valid update', async () => {
    const fetchFn = makeUpdateSeq();
    const result = await labelUpdate(makeCtx(fetchFn), { key: 'work', name: 'Work Projects' });
    expect(result).toEqual({ updated: true });
  });

  it('throws label_not_found when key does not exist', async () => {
    const [fileNodeGet, blobBody] = filenodeWithRegistry(registry);
    const fetchFn = makeFetchSpy([fileNodeGet, blobBody]);
    await expect(
      labelUpdate(makeCtx(fetchFn), { key: 'nonexistent', name: 'New' }),
    ).rejects.toMatchObject({ code: 'label_not_found' });
  });

  it('error message lists available label names on not_found', async () => {
    const [fileNodeGet, blobBody] = filenodeWithRegistry(registry);
    const fetchFn = makeFetchSpy([fileNodeGet, blobBody]);
    await expect(
      labelUpdate(makeCtx(fetchFn), { key: 'missing', name: 'X' }),
    ).rejects.toMatchObject({
      code: 'label_not_found',
      message: expect.stringContaining('Work'),
    });
  });

  it('throws label_name_invalid when renaming to a blank-slugifying name', async () => {
    const [fileNodeGet, blobBody] = filenodeWithRegistry(registry);
    const fetchFn = makeFetchSpy([fileNodeGet, blobBody]);
    await expect(
      labelUpdate(makeCtx(fetchFn), { key: 'work', name: '---' }),
    ).rejects.toMatchObject({
      code: 'label_name_invalid',
      message: 'Enter a label name using letters or numbers.',
    });
  });

  it('key is IMMUTABLE — never changes on update', async () => {
    const fetchFn = makeUpdateSeq();
    await labelUpdate(makeCtx(fetchFn), { key: 'work', name: 'Renamed' });
    // Call index 4 is the blob upload (0-based: fg1,b1,fg2,b2,upload,filenode-set)
    const calls = (fetchFn as ReturnType<typeof vi.fn>).mock.calls;
    const uploadBody = JSON.parse(await readCallBody(calls, 4)) as {
      labels: Array<{ key: string; name: string }>;
    };
    const updatedLabel = uploadBody.labels.find((l) => l.name === 'Renamed');
    expect(updatedLabel?.key).toBe('work');
  });

  it('updates only color when name is not provided', async () => {
    const fetchFn = makeUpdateSeq();
    await labelUpdate(makeCtx(fetchFn), { key: 'work', color: '#123456' });
    const calls = (fetchFn as ReturnType<typeof vi.fn>).mock.calls;
    const uploadBody = JSON.parse(await readCallBody(calls, 4)) as {
      labels: Array<{ key: string; name: string; color: string }>;
    };
    const updatedLabel = uploadBody.labels.find((l) => l.key === 'work');
    expect(updatedLabel?.color).toBe('#123456');
    expect(updatedLabel?.name).toBe('Work'); // unchanged
  });
});

// ─── label.delete (dry-run) ───────────────────────────────────────────────────

describe('label.delete (dry-run)', () => {
  it('returns { affectedCount } from Email/query count', async () => {
    const registry: LabelRegistry = {
      version: 1,
      labels: [{ key: 'work', name: 'Work', color: '#ff6b35', order: 0 }],
    };
    const [fileNodeGet, blobBody] = filenodeWithRegistry(registry);
    const countResponse = emailQueryCountResponse(7);
    const fetchFn = makeFetchSpy([fileNodeGet, blobBody, countResponse]);
    const result = await labelDeletePreview(makeCtx(fetchFn), { key: 'work' });
    expect(result).toEqual({ affectedCount: 7 });
  });

  it('throws label_not_found when key is not in registry', async () => {
    const [fileNodeGet, blobBody] = filenodeWithRegistry({
      version: 1,
      labels: [{ key: 'work', name: 'Work', color: '#ff6b35', order: 0 }],
    });
    const fetchFn = makeFetchSpy([fileNodeGet, blobBody]);
    await expect(
      labelDeletePreview(makeCtx(fetchFn), { key: 'nonexistent' }),
    ).rejects.toMatchObject({ code: 'label_not_found' });
  });

  it('lists valid names in label_not_found message', async () => {
    const registry: LabelRegistry = {
      version: 1,
      labels: [
        { key: 'work', name: 'Work', color: '#ff6b35', order: 0 },
        { key: 'personal', name: 'Personal', color: '#ff9d23', order: 1 },
      ],
    };
    const [fileNodeGet, blobBody] = filenodeWithRegistry(registry);
    const fetchFn = makeFetchSpy([fileNodeGet, blobBody]);
    await expect(
      labelDeletePreview(makeCtx(fetchFn), { key: 'missing' }),
    ).rejects.toMatchObject({
      code: 'label_not_found',
      message: expect.stringContaining('Work'),
    });
  });
});

// ─── label.delete (commit) ────────────────────────────────────────────────────

describe('label.delete (commit)', () => {
  // Sequence for delete with 0 messages:
  // 1. labelDeleteCommit → readRegistry: FileNode/get + blob
  // 2. untagAllWithKeyword → Email/query (empty → done)
  // 3. writeRegistry → readRegistry: FileNode/get + blob
  // 4. writeRegistry → fetchBlobUpload
  // 5. writeRegistry → FileNode/set
  it('untagging 0 messages → { deleted: true, untagged: 0 }', async () => {
    const registry: LabelRegistry = {
      version: 1,
      labels: [{ key: 'work', name: 'Work', color: '#ff6b35', order: 0 }],
    };
    const [fg1, b1] = filenodeWithRegistry(registry);
    const [fg2, b2] = filenodeWithRegistry(registry);
    const fetchFn = makeFetchSpy([
      fg1, b1,                   // readRegistry (delete check)
      emailQueryResponse([]),    // untag loop: empty → done
      fg2, b2,                   // writeRegistry → readRegistry
      BLOB_UPLOAD, FILENODE_UPDATE_OK,
    ]);
    const result = await labelDeleteCommit(makeCtx(fetchFn), { key: 'work' });
    expect(result).toEqual({ deleted: true, untagged: 0 });
  });

  it('removes the label from the registry after untagging', async () => {
    const registry: LabelRegistry = {
      version: 1,
      labels: [
        { key: 'work', name: 'Work', color: '#ff6b35', order: 0 },
        { key: 'personal', name: 'Personal', color: '#ff9d23', order: 1 },
      ],
    };
    const [fg1, b1] = filenodeWithRegistry(registry);
    const [fg2, b2] = filenodeWithRegistry(registry);
    const fetchFn = makeFetchSpy([
      fg1, b1,
      emailQueryResponse([]),
      fg2, b2,
      BLOB_UPLOAD, FILENODE_UPDATE_OK,
    ]);
    await labelDeleteCommit(makeCtx(fetchFn), { key: 'work' });
    // Call index 5 is the blob upload
    const calls = (fetchFn as ReturnType<typeof vi.fn>).mock.calls;
    const uploadBody = JSON.parse(await readCallBody(calls, 5)) as {
      labels: Array<{ key: string }>;
    };
    // Only 'personal' should remain
    expect(uploadBody.labels).toHaveLength(1);
    expect(uploadBody.labels[0]?.key).toBe('personal');
  });

  it('pages through >500 messages with NO cap (1200-message test)', async () => {
    // 3 pages: 500 + 500 + 200 = 1200 messages
    const registry: LabelRegistry = {
      version: 1,
      labels: [{ key: 'bulk', name: 'Bulk', color: '#ff6b35', order: 0 }],
    };
    const page1Ids = Array.from({ length: 500 }, (_, i) => `E-p1-${i}`);
    const page2Ids = Array.from({ length: 500 }, (_, i) => `E-p2-${i}`);
    const page3Ids = Array.from({ length: 200 }, (_, i) => `E-p3-${i}`);

    const [fg1, b1] = filenodeWithRegistry(registry);
    const [fg2, b2] = filenodeWithRegistry(registry);
    const fetchFn = makeFetchSpy([
      fg1, b1,                             // readRegistry (delete check)
      emailQueryResponse(page1Ids),        // query page 1 (500 → full batch)
      emailSetUpdateOk(page1Ids),          // untag page 1
      emailQueryResponse(page2Ids),        // query page 2 (500 → full batch)
      emailSetUpdateOk(page2Ids),          // untag page 2
      emailQueryResponse(page3Ids),        // query page 3 (200 → partial, done)
      emailSetUpdateOk(page3Ids),          // untag page 3
      fg2, b2,                             // writeRegistry → readRegistry
      BLOB_UPLOAD, FILENODE_UPDATE_OK,     // writeRegistry: upload + set
    ]);

    const result = await labelDeleteCommit(makeCtx(fetchFn), { key: 'bulk' });
    expect(result).toEqual({ deleted: true, untagged: 1200 });

    // Verify total call count: 2 + 3*(1query+1set) + 2 + 1 + 1 = 2 + 6 + 4 = 12
    const mockFn = fetchFn as ReturnType<typeof vi.fn>;
    expect(mockFn.mock.calls.length).toBe(12);
  });

  it('throws label_not_found on commit when key is missing', async () => {
    const [fileNodeGet, blobBody] = filenodeWithRegistry({
      version: 1,
      labels: [{ key: 'work', name: 'Work', color: '#ff6b35', order: 0 }],
    });
    const fetchFn = makeFetchSpy([fileNodeGet, blobBody]);
    await expect(
      labelDeleteCommit(makeCtx(fetchFn), { key: 'nonexistent' }),
    ).rejects.toMatchObject({ code: 'label_not_found' });
  });
});

// ─── label.apply (dry-run) ────────────────────────────────────────────────────

describe('label.apply (dry-run)', () => {
  const registry: LabelRegistry = {
    version: 1,
    labels: [
      { key: 'work', name: 'Work', color: '#ff6b35', order: 0 },
      { key: 'urgent', name: 'Urgent', color: '#ff0000', order: 1 },
    ],
  };

  it('returns { affectedCount: emailIds.length }', async () => {
    const [fileNodeGet, blobBody] = filenodeWithRegistry(registry);
    const fetchFn = makeFetchSpy([fileNodeGet, blobBody]);
    const result = await labelApplyPreview(makeCtx(fetchFn), {
      emailIds: ['e1', 'e2', 'e3'],
      add: ['work'],
    });
    expect(result).toEqual({ affectedCount: 3 });
  });

  it('resolves label by NAME in dry-run', async () => {
    const [fileNodeGet, blobBody] = filenodeWithRegistry(registry);
    const fetchFn = makeFetchSpy([fileNodeGet, blobBody]);
    const result = await labelApplyPreview(makeCtx(fetchFn), {
      emailIds: ['e1'],
      add: ['Work'], // name, not key
    });
    expect(result).toEqual({ affectedCount: 1 });
  });

  it('throws label_not_found with valid names listed when add entry is unresolved', async () => {
    const [fileNodeGet, blobBody] = filenodeWithRegistry(registry);
    const fetchFn = makeFetchSpy([fileNodeGet, blobBody]);
    await expect(
      labelApplyPreview(makeCtx(fetchFn), {
        emailIds: ['e1'],
        add: ['nonexistent'],
      }),
    ).rejects.toMatchObject({
      code: 'label_not_found',
      message: expect.stringContaining('Work'),
    });
  });

  it('throws label_not_found when remove entry is unresolved', async () => {
    const [fileNodeGet, blobBody] = filenodeWithRegistry(registry);
    const fetchFn = makeFetchSpy([fileNodeGet, blobBody]);
    await expect(
      labelApplyPreview(makeCtx(fetchFn), {
        emailIds: ['e1'],
        remove: ['ghost'],
      }),
    ).rejects.toMatchObject({ code: 'label_not_found' });
  });

  it('label_not_found message format matches spec exactly', async () => {
    const [fileNodeGet, blobBody] = filenodeWithRegistry(registry);
    const fetchFn = makeFetchSpy([fileNodeGet, blobBody]);
    await expect(
      labelApplyPreview(makeCtx(fetchFn), {
        emailIds: ['e1'],
        add: ['ghost'],
      }),
    ).rejects.toMatchObject({
      code: 'label_not_found',
      message: "That label doesn't exist. Available labels: Work, Urgent.",
    });
  });
});

// ─── label.apply (commit) ─────────────────────────────────────────────────────

describe('label.apply (commit)', () => {
  const registry: LabelRegistry = {
    version: 1,
    labels: [
      { key: 'work', name: 'Work', color: '#ff6b35', order: 0 },
      { key: 'urgent', name: 'Urgent', color: '#ff0000', order: 1 },
    ],
  };

  it('returns { modifiedCount } on success', async () => {
    const [fileNodeGet, blobBody] = filenodeWithRegistry(registry);
    const fetchFn = makeFetchSpy([
      fileNodeGet, blobBody,
      emailSetUpdateOk(['e1', 'e2']),
    ]);
    const result = await labelApplyCommit(makeCtx(fetchFn), {
      emailIds: ['e1', 'e2'],
      add: ['work'],
    });
    expect(result).toEqual({ modifiedCount: 2 });
  });

  it('resolves label by NAME (not key) in commit', async () => {
    const [fileNodeGet, blobBody] = filenodeWithRegistry(registry);
    const fetchFn = makeFetchSpy([
      fileNodeGet, blobBody,
      emailSetUpdateOk(['e1']),
    ]);
    await labelApplyCommit(makeCtx(fetchFn), {
      emailIds: ['e1'],
      add: ['Work'], // NAME resolution → key 'work'
    });
    const calls = (fetchFn as ReturnType<typeof vi.fn>).mock.calls;
    const setBody = JSON.parse(calls[2]?.[1]?.body as string ?? '{}') as {
      methodCalls: [[string, { update: Record<string, Record<string, unknown>> }, string]];
    };
    const patch = setBody.methodCalls[0]?.[1]?.update?.['e1'];
    expect(patch?.['keywords/work']).toBe(true);
  });

  it('add → keywords/{key}: true, remove → keywords/{key}: null', async () => {
    const [fileNodeGet, blobBody] = filenodeWithRegistry(registry);
    const fetchFn = makeFetchSpy([
      fileNodeGet, blobBody,
      emailSetUpdateOk(['e1']),
    ]);
    await labelApplyCommit(makeCtx(fetchFn), {
      emailIds: ['e1'],
      add: ['work'],
      remove: ['urgent'],
    });
    const calls = (fetchFn as ReturnType<typeof vi.fn>).mock.calls;
    const setBody = JSON.parse(calls[2]?.[1]?.body as string ?? '{}') as {
      methodCalls: [[string, { update: Record<string, Record<string, unknown>> }, string]];
    };
    const patch = setBody.methodCalls[0]?.[1]?.update?.['e1'];
    expect(patch?.['keywords/work']).toBe(true);
    expect(patch?.['keywords/urgent']).toBeNull();
  });

  it('throws email_not_found when JMAP returns notUpdated', async () => {
    const [fileNodeGet, blobBody] = filenodeWithRegistry(registry);
    const fetchFn = makeFetchSpy([
      fileNodeGet, blobBody,
      emailSetNotUpdated(['e-gone']),
    ]);
    await expect(
      labelApplyCommit(makeCtx(fetchFn), {
        emailIds: ['e-gone'],
        add: ['work'],
      }),
    ).rejects.toMatchObject({
      code: 'email_not_found',
      message: 'One or more of those messages no longer exist.',
    });
  });

  it('throws label_not_found for unresolved label in commit', async () => {
    const [fileNodeGet, blobBody] = filenodeWithRegistry(registry);
    const fetchFn = makeFetchSpy([fileNodeGet, blobBody]);
    await expect(
      labelApplyCommit(makeCtx(fetchFn), {
        emailIds: ['e1'],
        add: ['ghost'],
      }),
    ).rejects.toMatchObject({ code: 'label_not_found' });
  });
});
