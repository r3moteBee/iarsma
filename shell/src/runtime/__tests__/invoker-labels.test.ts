/**
 * Tests for the five `label.*` switch cases in `jmapInvoker` (Task 7).
 *
 * Drives the PRODUCTION `jmapInvoker` with a mocked fetch/session — the same
 * way the existing invoker tests do — to cover the 5 new switch cases that
 * direct unit tests in label-operations.test.ts bypass:
 *
 *   label.list    — non-destructive read
 *   label.create  — non-destructive write (no dryRun gate)
 *   label.update  — non-destructive write (no dryRun gate)
 *   label.delete  — destructive; dryRun=true → preview, false → commit
 *   label.apply   — destructive; dryRun=true → preview, false → commit
 *
 * The label-store makes FileNode calls to `{baseUrl}/jmap/api`.
 * Label-operations makes Email/query + Email/set calls to `session.apiUrl`
 * (from the fixture: https://sw-mail.example.net/jmap/).
 * Blob uploads go to `session.uploadUrl` (https://sw-mail.example.net/jmap/upload/{accountId}/).
 *
 * The mock fetch routes all of these by URL pattern.
 */

import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { jmapInvoker } from '../invoker.js';
import { serializeRegistry } from '../label-registry.js';
import type { LabelRegistry } from '../label-registry.js';
import { LABEL_DOC_NAME } from '../label-store.js';

// ─── Session fixture ──────────────────────────────────────────────────────────

const SESSION_FIXTURE = readFileSync(
  resolve(__dirname, '../../../../components/jmap-client/tests/fixtures/session.json'),
  'utf8',
);

// The session fixture uses account id 'c'.
const ACCOUNT_ID = 'c';

// ─── JMAP response helpers ────────────────────────────────────────────────────

function jsonStr(val: unknown): string {
  return JSON.stringify(val);
}

function filenodeEmptyResponse(): string {
  return jsonStr({
    methodResponses: [
      ['FileNode/get', { accountId: ACCOUNT_ID, state: 'sa0', list: [], notFound: [] }, 'c1'],
    ],
  });
}

function filenodeWithRegistry(registry: LabelRegistry): [string, string] {
  const regJson = serializeRegistry(registry);
  const fileNodeGet = jsonStr({
    methodResponses: [
      [
        'FileNode/get',
        {
          accountId: ACCOUNT_ID,
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

const BLOB_UPLOAD_OK = jsonStr({
  accountId: ACCOUNT_ID,
  blobId: 'blob-new',
  type: 'application/json',
  size: 100,
});

const FILENODE_SET_CREATE_OK = jsonStr({
  methodResponses: [
    ['FileNode/set', { accountId: ACCOUNT_ID, newState: 'sa1', created: { n1: { id: 'node-1' } } }, 'c1'],
  ],
});

const FILENODE_SET_UPDATE_OK = jsonStr({
  methodResponses: [
    ['FileNode/set', { accountId: ACCOUNT_ID, newState: 'sa2', updated: { 'node-1': null } }, 'c1'],
  ],
});

function emailQueryCountResponse(total: number): string {
  return jsonStr({
    methodResponses: [['Email/query', { ids: [], total }, '0']],
  });
}

function emailQueryResponse(ids: string[]): string {
  return jsonStr({
    methodResponses: [['Email/query', { ids }, '0']],
  });
}

function emailSetUpdateOk(ids: string[]): string {
  const updated: Record<string, null> = {};
  for (const id of ids) updated[id] = null;
  return jsonStr({
    methodResponses: [['Email/set', { updated }, '0']],
  });
}

// ─── Fetch mock factory ───────────────────────────────────────────────────────

/**
 * Build a sequenced fetch mock that:
 *   - Always answers /.well-known/jmap with the session fixture.
 *   - Routes blob downloads (URL matches /jmap/download/) to the next blobBody
 *     in the blobDownloads queue.
 *   - Routes blob uploads (URL matches /jmap/upload/) to blobUploadBody.
 *   - Routes all other POST calls (FileNode/get via /jmap/api, and JMAP API
 *     calls via /jmap/) to the next apiBody in the apiBodies queue.
 *
 * Because label-store POSTs to `/jmap/api` and label-operations POSTs JMAP
 * queries to `session.apiUrl` (= `/jmap/`), both go through the same apiBody
 * sequence — which matches how the existing invoker tests work.
 */
function makeFetch(opts: {
  apiBodies: string[];
  blobDownloads?: string[];
  blobUploadBody?: string;
}): { fetch: ReturnType<typeof vi.fn<typeof fetch>>; apiCalls: string[] } {
  const apiCalls: string[] = [];
  let apiIdx = 0;
  let blobIdx = 0;
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;

    if (url.endsWith('/.well-known/jmap')) {
      return new Response(SESSION_FIXTURE, { status: 200 });
    }
    if (url.includes('/jmap/download/')) {
      const body = opts.blobDownloads?.[blobIdx++];
      if (body === undefined) {
        throw new Error(`Unexpected blob download call: ${url}`);
      }
      return new Response(body, { status: 200 });
    }
    if (url.includes('/jmap/upload/')) {
      return new Response(opts.blobUploadBody ?? BLOB_UPLOAD_OK, { status: 200 });
    }
    // All other POST requests go to the api sequence.
    const body = String(init?.body ?? '');
    apiCalls.push(body);
    const next = opts.apiBodies[apiIdx++];
    if (next === undefined) {
      throw new Error(`Unexpected API call #${apiIdx}: ${body.slice(0, 200)}`);
    }
    return new Response(next, { status: 200 });
  });
  return { fetch: fetchMock, apiCalls };
}

function makeInvoker(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>) {
  return jmapInvoker({
    baseUrl: 'https://sw-mail.example.net',
    getAuthToken: () => 'tok',
    fetch: fetchMock as typeof globalThis.fetch,
  });
}

// ─── label.list ───────────────────────────────────────────────────────────────

describe('jmapInvoker — label.list', () => {
  it('returns empty labels when registry does not exist', async () => {
    const { fetch: fetchMock } = makeFetch({
      apiBodies: [filenodeEmptyResponse()],
    });
    const inv = makeInvoker(fetchMock);
    const result = await inv.invoke('label.list', {});
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
    const { fetch: fetchMock } = makeFetch({
      apiBodies: [fileNodeGet],
      blobDownloads: [blobBody],
    });
    const inv = makeInvoker(fetchMock);
    const result = await inv.invoke('label.list', {}) as { labels: Array<{ key: string }> };
    expect(result.labels).toHaveLength(2);
    expect(result.labels[0]?.key).toBe('work');
    expect(result.labels[1]?.key).toBe('personal');
  });
});

// ─── label.create ─────────────────────────────────────────────────────────────

describe('jmapInvoker — label.create', () => {
  it('routes to label.create and returns { key }', async () => {
    // readRegistry(create-check) + writeRegistry(readRegistry + upload + FileNode/set)
    const { fetch: fetchMock } = makeFetch({
      apiBodies: [
        filenodeEmptyResponse(),          // readRegistry: no existing registry
        filenodeEmptyResponse(),          // writeRegistry → readRegistry
        FILENODE_SET_CREATE_OK,           // writeRegistry → FileNode/set
      ],
    });
    const inv = makeInvoker(fetchMock);
    const result = await inv.invoke('label.create', { name: 'Invoker Test' }) as { key: string };
    expect(result.key).toBe('invoker_test');
  });

  it('throws label_limit_reached when registry is at cap (200)', async () => {
    const labels = Array.from({ length: 200 }, (_, i) => ({
      key: `lbl_${i}`,
      name: `Label ${i}`,
      color: '#ff6b35',
      order: i,
    }));
    const registry: LabelRegistry = { version: 1, labels };
    const [fileNodeGet, blobBody] = filenodeWithRegistry(registry);
    const { fetch: fetchMock } = makeFetch({
      apiBodies: [fileNodeGet],
      blobDownloads: [blobBody],
    });
    const inv = makeInvoker(fetchMock);
    await expect(
      inv.invoke('label.create', { name: 'One More' }),
    ).rejects.toMatchObject({ code: 'label_limit_reached' });
  });
});

// ─── label.update ─────────────────────────────────────────────────────────────

describe('jmapInvoker — label.update', () => {
  it('routes to label.update and returns { updated: true }', async () => {
    const registry: LabelRegistry = {
      version: 1,
      labels: [{ key: 'work', name: 'Work', color: '#ff6b35', order: 0 }],
    };
    const [fg1, b1] = filenodeWithRegistry(registry);
    const [fg2, b2] = filenodeWithRegistry(registry);
    const { fetch: fetchMock } = makeFetch({
      apiBodies: [fg1, fg2, FILENODE_SET_UPDATE_OK],
      blobDownloads: [b1, b2],
    });
    const inv = makeInvoker(fetchMock);
    const result = await inv.invoke('label.update', { key: 'work', name: 'Work (updated)' });
    expect(result).toEqual({ updated: true });
  });

  it('throws label_not_found for an unknown key', async () => {
    const registry: LabelRegistry = {
      version: 1,
      labels: [{ key: 'work', name: 'Work', color: '#ff6b35', order: 0 }],
    };
    const [fg1, b1] = filenodeWithRegistry(registry);
    const { fetch: fetchMock } = makeFetch({
      apiBodies: [fg1],
      blobDownloads: [b1],
    });
    const inv = makeInvoker(fetchMock);
    await expect(
      inv.invoke('label.update', { key: 'nonexistent', name: 'X' }),
    ).rejects.toMatchObject({ code: 'label_not_found' });
  });
});

// ─── label.delete ─────────────────────────────────────────────────────────────

describe('jmapInvoker — label.delete', () => {
  it('dryRun=true returns { affectedCount } without mutating', async () => {
    const registry: LabelRegistry = {
      version: 1,
      labels: [{ key: 'work', name: 'Work', color: '#ff6b35', order: 0 }],
    };
    const [fg1, b1] = filenodeWithRegistry(registry);
    const { fetch: fetchMock, apiCalls } = makeFetch({
      apiBodies: [fg1, emailQueryCountResponse(5)],
      blobDownloads: [b1],
    });
    const inv = makeInvoker(fetchMock);
    const result = await inv.invoke('label.delete', { key: 'work' }, { dryRun: true });
    expect(result).toEqual({ affectedCount: 5 });
    // No FileNode/set (write) calls should have happened.
    expect(apiCalls.some((c) => c.includes('FileNode/set'))).toBe(false);
  });

  it('dryRun=false (commit) untags messages and removes registry entry', async () => {
    const registry: LabelRegistry = {
      version: 1,
      labels: [{ key: 'work', name: 'Work', color: '#ff6b35', order: 0 }],
    };
    const msgIds = ['E-1', 'E-2', 'E-3'];
    // msgIds.length (3) < UNTAG_BATCH_SIZE (500) → partial page, loop exits after one pass.
    const [fg1, b1] = filenodeWithRegistry(registry);
    const [fg2, b2] = filenodeWithRegistry(registry);
    const { fetch: fetchMock, apiCalls } = makeFetch({
      apiBodies: [
        fg1,                               // readRegistry: delete check
        emailQueryResponse(msgIds),        // query: 3 ids (< 500 → partial, done)
        emailSetUpdateOk(msgIds),          // set: untag 3
        fg2,                               // writeRegistry → readRegistry
        FILENODE_SET_UPDATE_OK,            // writeRegistry → FileNode/set
      ],
      blobDownloads: [b1, b2],
    });
    const inv = makeInvoker(fetchMock);
    const result = await inv.invoke('label.delete', { key: 'work' }, { dryRun: false });
    expect(result).toEqual({ deleted: true, untagged: 3 });
    // Verify FileNode/set was called (registry was updated).
    expect(apiCalls.some((c) => c.includes('FileNode/set'))).toBe(true);
  });

  it('throws label_not_found for an unknown key on commit', async () => {
    const registry: LabelRegistry = {
      version: 1,
      labels: [{ key: 'work', name: 'Work', color: '#ff6b35', order: 0 }],
    };
    const [fg1, b1] = filenodeWithRegistry(registry);
    const { fetch: fetchMock } = makeFetch({
      apiBodies: [fg1],
      blobDownloads: [b1],
    });
    const inv = makeInvoker(fetchMock);
    await expect(
      inv.invoke('label.delete', { key: 'missing' }),
    ).rejects.toMatchObject({ code: 'label_not_found' });
  });
});

// ─── label.apply ──────────────────────────────────────────────────────────────

describe('jmapInvoker — label.apply', () => {
  const registry: LabelRegistry = {
    version: 1,
    labels: [
      { key: 'work', name: 'Work', color: '#ff6b35', order: 0 },
      { key: 'urgent', name: 'Urgent', color: '#ff0000', order: 1 },
    ],
  };

  it('dryRun=true returns { affectedCount } without touching JMAP Email/set', async () => {
    const [fg1, b1] = filenodeWithRegistry(registry);
    const { fetch: fetchMock, apiCalls } = makeFetch({
      apiBodies: [fg1],
      blobDownloads: [b1],
    });
    const inv = makeInvoker(fetchMock);
    const result = await inv.invoke(
      'label.apply',
      { emailIds: ['e1', 'e2'], add: ['work'] },
      { dryRun: true },
    );
    expect(result).toEqual({ affectedCount: 2 });
    // No Email/set calls.
    expect(apiCalls.some((c) => c.includes('Email/set'))).toBe(false);
  });

  it('dryRun=false (commit) applies keyword patch and returns { modifiedCount }', async () => {
    const [fg1, b1] = filenodeWithRegistry(registry);
    const { fetch: fetchMock, apiCalls } = makeFetch({
      apiBodies: [fg1, emailSetUpdateOk(['e1', 'e2'])],
      blobDownloads: [b1],
    });
    const inv = makeInvoker(fetchMock);
    const result = await inv.invoke('label.apply', {
      emailIds: ['e1', 'e2'],
      add: ['work'],
      remove: ['urgent'],
    });
    expect(result).toEqual({ modifiedCount: 2 });
    // Email/set call should include the keyword patch.
    const setCall = apiCalls.find((c) => c.includes('Email/set'));
    expect(setCall).toBeDefined();
    expect(setCall).toMatch(/"keywords\/work":true/);
    expect(setCall).toMatch(/"keywords\/urgent":null/);
  });

  it('resolves label by NAME on commit (Work → key work)', async () => {
    const [fg1, b1] = filenodeWithRegistry(registry);
    const { fetch: fetchMock, apiCalls } = makeFetch({
      apiBodies: [fg1, emailSetUpdateOk(['e1'])],
      blobDownloads: [b1],
    });
    const inv = makeInvoker(fetchMock);
    await inv.invoke('label.apply', {
      emailIds: ['e1'],
      add: ['Work'], // name, not key
    });
    const setCall = apiCalls.find((c) => c.includes('Email/set'));
    expect(setCall).toMatch(/"keywords\/work":true/);
  });

  it('throws label_not_found for an unresolved label name', async () => {
    const [fg1, b1] = filenodeWithRegistry(registry);
    const { fetch: fetchMock } = makeFetch({
      apiBodies: [fg1],
      blobDownloads: [b1],
    });
    const inv = makeInvoker(fetchMock);
    await expect(
      inv.invoke('label.apply', { emailIds: ['e1'], add: ['ghost'] }),
    ).rejects.toMatchObject({ code: 'label_not_found' });
  });

  it('throws tool_not_found for an unrecognised capability name', async () => {
    const { fetch: fetchMock } = makeFetch({ apiBodies: [] });
    const inv = makeInvoker(fetchMock);
    await expect(inv.invoke('label.nonexistent', {})).rejects.toMatchObject({
      code: 'tool_not_found',
    });
  });
});

// ─── thread.list invoker seam ─────────────────────────────────────────────────

import { readFileSync as _readFileSync } from 'node:fs';
import { resolve as _resolve } from 'node:path';

const EMAIL_QUERY_FIXTURE = _readFileSync(
  _resolve(__dirname, '../../../../components/jmap-client/tests/fixtures/email_query.json'),
  'utf8',
);

describe('jmapInvoker — thread.list (invoker seam)', () => {
  it('forwards hasKeyword and builds filter:{hasKeyword} in JMAP request', async () => {
    const { fetch: fetchMock, apiCalls } = makeFetch({
      apiBodies: [EMAIL_QUERY_FIXTURE],
    });
    const inv = makeInvoker(fetchMock);
    await inv.invoke('thread.list', { hasKeyword: 'work' });
    // The single API call is the Email/query+Email/get POST to session.apiUrl.
    expect(apiCalls).toHaveLength(1);
    const body = JSON.parse(apiCalls[0]!);
    const [, queryArgs] = body.methodCalls[0];
    expect(queryArgs.filter).toEqual({ hasKeyword: 'work' });
  });

  it('forwards mailboxId and builds filter:{inMailbox} in JMAP request', async () => {
    const { fetch: fetchMock, apiCalls } = makeFetch({
      apiBodies: [EMAIL_QUERY_FIXTURE],
    });
    const inv = makeInvoker(fetchMock);
    await inv.invoke('thread.list', { mailboxId: 'Mb01' });
    expect(apiCalls).toHaveLength(1);
    const body = JSON.parse(apiCalls[0]!);
    const [, queryArgs] = body.methodCalls[0];
    expect(queryArgs.filter).toEqual({ inMailbox: 'Mb01' });
  });
});
