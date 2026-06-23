/**
 * Tests for FileNode + Blob JMAP wire layer (Task 3 — Labels feature).
 *
 * Fixtures are captured live wire shapes from Stalwart sw-mail.r3motely.net
 * (captured 2026-06-23, see task-3-fixtures.md). Tests assert:
 *   - each builder emits the correct JMAP request JSON,
 *   - each parser extracts the correct fields from fixture responses,
 *   - stateMismatch error is surfaced distinctly in parseFileNodeSet,
 *   - fetch helpers perform auth check → POST/GET → parse round-trip.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  JMAP_USING_FILES,
  buildFileNodeGetRequest,
  parseFileNodeList,
  buildFileNodeSetRequest,
  parseFileNodeSet,
  parseBlobUpload,
  fetchBlobUpload,
  fetchBlobText,
  type Session,
} from '../jmap-client.js';
import type { ToolError } from '../types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const SAMPLE_SESSION: Session = {
  username: 'admin@r3motely.net',
  apiUrl: 'https://sw-mail.r3motely.net/jmap/',
  downloadUrl: 'https://sw-mail.r3motely.net/jmap/download/{accountId}/{blobId}/{name}?accept={type}',
  uploadUrl: 'https://sw-mail.r3motely.net/jmap/upload/{accountId}/',
  eventSourceUrl:
    'https://sw-mail.r3motely.net/jmap/eventsource/?types={types}&closeafter={closeafter}&ping={ping}',
  state: '817d3028',
  primaryAccountIdMail: 'b',
};

type FetchSpy = ReturnType<typeof makeFetchSpy>;

function makeFetchSpy(
  body: string,
  init: { status?: number; statusText?: string } = {},
) {
  const status = init.status ?? 200;
  const impl: typeof fetch = async () =>
    new Response(body, {
      status,
      statusText: init.statusText ?? (status >= 200 && status < 300 ? 'OK' : 'Error'),
    });
  return vi.fn<typeof fetch>(impl);
}

// ── Fixtures (exact wire shapes from live probe) ──────────────────────────────

// §1 — Blob upload response
const BLOB_UPLOAD_RESPONSE = JSON.stringify({
  accountId: 'b',
  blobId: 'ecrqakfj0w3nu1orhjhnduve02iir7zoi3pw2zzhyae1ndet32sw7aowutv0cbq',
  type: 'application/json',
  size: 25,
});

// §2 — FileNode/set create response
const FILENODE_SET_CREATE_RESPONSE = JSON.stringify({
  methodResponses: [
    [
      'FileNode/set',
      { accountId: 'b', newState: 'sam', created: { n1: { id: 'b' } } },
      'c1',
    ],
  ],
});

// §3 — FileNode/get list-all response
const FILENODE_GET_RESPONSE = JSON.stringify({
  methodResponses: [
    [
      'FileNode/get',
      {
        accountId: 'b',
        state: 'saa',
        list: [
          {
            id: 'b',
            name: '.iarsma-labels.json',
            parentId: null,
            blobId: 'ccrqakfj0w3nu1orhjhnduve02iir7zoi3pw2zzhyae1ndet32sw7aimae',
            size: 25,
            type: null,
          },
        ],
        notFound: [],
      },
      'c1',
    ],
  ],
});

// §5 — FileNode/set update response
const FILENODE_SET_UPDATE_RESPONSE = JSON.stringify({
  methodResponses: [
    [
      'FileNode/set',
      { accountId: 'b', newState: 'saq', updated: { b: null } },
      'c1',
    ],
  ],
});

// §6 — FileNode/set destroy response
const FILENODE_SET_DESTROY_RESPONSE = JSON.stringify({
  methodResponses: [
    [
      'FileNode/set',
      { accountId: 'b', newState: 'say', destroyed: ['b'] },
      'c1',
    ],
  ],
});

// §⚠️ — stateMismatch error shape (JMAP standard; defensive fixture)
const FILENODE_SET_STATE_MISMATCH_RESPONSE = JSON.stringify({
  methodResponses: [
    [
      'FileNode/set',
      {
        accountId: 'b',
        newState: 'saz',
        notUpdated: {
          b: { type: 'stateMismatch', description: 'State mismatch — retry.' },
        },
      },
      'c1',
    ],
  ],
});

// ── JMAP_USING_FILES ──────────────────────────────────────────────────────────

describe('JMAP_USING_FILES', () => {
  it('is the correct using array for filenode/blob ops', () => {
    expect(JMAP_USING_FILES).toEqual([
      'urn:ietf:params:jmap:core',
      'urn:ietf:params:jmap:filenode',
      'urn:ietf:params:jmap:blob',
    ]);
  });
});

// ── buildFileNodeGetRequest ───────────────────────────────────────────────────

describe('buildFileNodeGetRequest', () => {
  it('produces FileNode/get with ids:null and required properties array', () => {
    const body = buildFileNodeGetRequest({ accountId: 'b' });
    const parsed = JSON.parse(body) as {
      using: string[];
      methodCalls: Array<[string, Record<string, unknown>, string]>;
    };
    expect(parsed.using).toEqual(JMAP_USING_FILES);
    expect(parsed.methodCalls).toHaveLength(1);
    expect(parsed.methodCalls[0]![0]).toBe('FileNode/get');
    const args = parsed.methodCalls[0]![1]!;
    expect(args.accountId).toBe('b');
    expect(args.ids).toBeNull();
    expect(args.properties).toEqual([
      'id',
      'name',
      'parentId',
      'blobId',
      'size',
      'type',
    ]);
  });

  it('uses the provided accountId', () => {
    const body = buildFileNodeGetRequest({ accountId: 'other-account' });
    const parsed = JSON.parse(body);
    expect(parsed.methodCalls[0][1].accountId).toBe('other-account');
  });
});

// ── parseFileNodeList ─────────────────────────────────────────────────────────

describe('parseFileNodeList', () => {
  it('extracts state and nodes from the fixture response', () => {
    const result = parseFileNodeList(FILENODE_GET_RESPONSE);
    expect(result.state).toBe('saa');
    expect(result.nodes).toHaveLength(1);
    const node = result.nodes[0]!;
    expect(node.id).toBe('b');
    expect(node.name).toBe('.iarsma-labels.json');
    expect(node.parentId).toBeNull();
    expect(node.blobId).toBe(
      'ccrqakfj0w3nu1orhjhnduve02iir7zoi3pw2zzhyae1ndet32sw7aimae',
    );
    expect(node.size).toBe(25);
  });

  it('returns an empty nodes array when list is empty', () => {
    const body = JSON.stringify({
      methodResponses: [
        [
          'FileNode/get',
          { accountId: 'b', state: 'saa', list: [], notFound: [] },
          'c1',
        ],
      ],
    });
    const result = parseFileNodeList(body);
    expect(result.state).toBe('saa');
    expect(result.nodes).toHaveLength(0);
  });

  it('throws jmap_parse_error on malformed JSON', () => {
    expect(() => parseFileNodeList('not json')).toThrow(
      expect.objectContaining({ code: 'jmap_parse_error' }),
    );
  });

  it('throws jmap_parse_error when methodResponses is empty', () => {
    const body = JSON.stringify({ methodResponses: [] });
    expect(() => parseFileNodeList(body)).toThrow(
      expect.objectContaining({ code: 'jmap_parse_error' }),
    );
  });

  it('throws jmap_parse_error when first methodResponse is not FileNode/get', () => {
    const body = JSON.stringify({
      methodResponses: [['error', { type: 'unknownMethod' }, 'c1']],
    });
    expect(() => parseFileNodeList(body)).toThrow(
      expect.objectContaining({ code: 'jmap_parse_error' }),
    );
  });
});

// ── buildFileNodeSetRequest ───────────────────────────────────────────────────

describe('buildFileNodeSetRequest — create', () => {
  it('produces FileNode/set create matching fixture §2', () => {
    const body = buildFileNodeSetRequest({
      accountId: 'b',
      create: {
        n1: {
          name: '.iarsma-labels.json',
          parentId: null,
          blobId: 'ecrqakfj0w3nu1orhjhnduve02iir7zoi3pw2zzhyae1ndet32sw7aowutv0cbq',
        },
      },
    });
    const parsed = JSON.parse(body) as {
      using: string[];
      methodCalls: Array<[string, Record<string, unknown>, string]>;
    };
    expect(parsed.using).toEqual(JMAP_USING_FILES);
    expect(parsed.methodCalls).toHaveLength(1);
    expect(parsed.methodCalls[0]![0]).toBe('FileNode/set');
    const args = parsed.methodCalls[0]![1]!;
    expect(args.accountId).toBe('b');
    expect(args.create).toEqual({
      n1: {
        name: '.iarsma-labels.json',
        parentId: null,
        blobId: 'ecrqakfj0w3nu1orhjhnduve02iir7zoi3pw2zzhyae1ndet32sw7aowutv0cbq',
      },
    });
    expect(args.ifInState).toBeUndefined();
  });
});

describe('buildFileNodeSetRequest — update', () => {
  it('produces FileNode/set update with ifInState matching fixture §5', () => {
    const body = buildFileNodeSetRequest({
      accountId: 'b',
      ifInState: 'saa',
      update: {
        b: { blobId: 'new-blob-id' },
      },
    });
    const parsed = JSON.parse(body);
    const args = parsed.methodCalls[0][1];
    expect(args.accountId).toBe('b');
    expect(args.ifInState).toBe('saa');
    expect(args.update).toEqual({ b: { blobId: 'new-blob-id' } });
    expect(args.create).toBeUndefined();
    expect(args.destroy).toBeUndefined();
  });
});

describe('buildFileNodeSetRequest — destroy', () => {
  it('produces FileNode/set destroy matching fixture §6', () => {
    const body = buildFileNodeSetRequest({
      accountId: 'b',
      destroy: ['b'],
    });
    const parsed = JSON.parse(body);
    const args = parsed.methodCalls[0][1];
    expect(args.accountId).toBe('b');
    expect(args.destroy).toEqual(['b']);
    expect(args.create).toBeUndefined();
    expect(args.update).toBeUndefined();
    expect(args.ifInState).toBeUndefined();
  });
});

// ── parseFileNodeSet ──────────────────────────────────────────────────────────

describe('parseFileNodeSet — create', () => {
  it('extracts created and newState from fixture §2', () => {
    const result = parseFileNodeSet(FILENODE_SET_CREATE_RESPONSE);
    expect(result.newState).toBe('sam');
    expect(result.created).toEqual({ n1: { id: 'b' } });
    expect(result.updated).toBeUndefined();
    expect(result.destroyed).toBeUndefined();
  });
});

describe('parseFileNodeSet — update', () => {
  it('extracts updated and newState from fixture §5', () => {
    const result = parseFileNodeSet(FILENODE_SET_UPDATE_RESPONSE);
    expect(result.newState).toBe('saq');
    expect(result.updated).toEqual({ b: null });
    expect(result.created).toBeUndefined();
    expect(result.destroyed).toBeUndefined();
  });
});

describe('parseFileNodeSet — destroy', () => {
  it('extracts destroyed and newState from fixture §6', () => {
    const result = parseFileNodeSet(FILENODE_SET_DESTROY_RESPONSE);
    expect(result.newState).toBe('say');
    expect(result.destroyed).toEqual(['b']);
    expect(result.created).toBeUndefined();
    expect(result.updated).toBeUndefined();
  });
});

describe('parseFileNodeSet — stateMismatch', () => {
  it('surfaces stateMismatch in notUpdated so Task 4 can detect it', () => {
    const result = parseFileNodeSet(FILENODE_SET_STATE_MISMATCH_RESPONSE);
    expect(result.notUpdated).toBeDefined();
    expect(result.notUpdated!['b']).toEqual(
      expect.objectContaining({ type: 'stateMismatch' }),
    );
    // The type must be 'stateMismatch' exactly — not obscured
    expect(result.notUpdated!['b']!.type).toBe('stateMismatch');
  });
});

describe('parseFileNodeSet — errors', () => {
  it('throws jmap_parse_error on malformed JSON', () => {
    expect(() => parseFileNodeSet('not json')).toThrow(
      expect.objectContaining({ code: 'jmap_parse_error' }),
    );
  });

  it('throws jmap_parse_error when methodResponses is empty', () => {
    const body = JSON.stringify({ methodResponses: [] });
    expect(() => parseFileNodeSet(body)).toThrow(
      expect.objectContaining({ code: 'jmap_parse_error' }),
    );
  });

  it('throws jmap_parse_error when first methodResponse is not FileNode/set', () => {
    const body = JSON.stringify({
      methodResponses: [['error', { type: 'unknownMethod' }, 'c1']],
    });
    expect(() => parseFileNodeSet(body)).toThrow(
      expect.objectContaining({ code: 'jmap_parse_error' }),
    );
  });
});

// ── parseBlobUpload ───────────────────────────────────────────────────────────

describe('parseBlobUpload', () => {
  it('extracts blobId from upload response fixture §1', () => {
    const result = parseBlobUpload(BLOB_UPLOAD_RESPONSE);
    expect(result.blobId).toBe(
      'ecrqakfj0w3nu1orhjhnduve02iir7zoi3pw2zzhyae1ndet32sw7aowutv0cbq',
    );
  });

  it('throws jmap_parse_error on malformed JSON', () => {
    expect(() => parseBlobUpload('not json')).toThrow(
      expect.objectContaining({ code: 'jmap_parse_error' }),
    );
  });

  it('throws jmap_parse_error when blobId is missing', () => {
    expect(() => parseBlobUpload(JSON.stringify({ accountId: 'b' }))).toThrow(
      expect.objectContaining({ code: 'jmap_parse_error' }),
    );
  });
});

// ── fetchBlobUpload ───────────────────────────────────────────────────────────

describe('fetchBlobUpload', () => {
  it('POSTs raw bytes to /jmap/upload/{accountId}/ and returns blobId', async () => {
    const fetchSpy: FetchSpy = makeFetchSpy(BLOB_UPLOAD_RESPONSE);
    const bytes = new Uint8Array([1, 2, 3]);
    const result = await fetchBlobUpload({
      baseUrl: 'https://sw-mail.r3motely.net',
      getAuthToken: () => 'tok',
      fetch: fetchSpy,
      accountId: 'b',
      bytes,
      contentType: 'application/json',
    });
    expect(result.blobId).toBe(
      'ecrqakfj0w3nu1orhjhnduve02iir7zoi3pw2zzhyae1ndet32sw7aowutv0cbq',
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://sw-mail.r3motely.net/jmap/upload/b/');
    expect(init?.method).toBe('POST');
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.authorization).toBe('Bearer tok');
    expect(headers['content-type']).toBe('application/json');
  });

  it('rejects with code=unauthorized when no token is available', async () => {
    await expect(
      fetchBlobUpload({
        baseUrl: 'https://sw-mail.r3motely.net',
        getAuthToken: () => null,
        fetch: makeFetchSpy(BLOB_UPLOAD_RESPONSE),
        accountId: 'b',
        bytes: new Uint8Array([1]),
        contentType: 'application/json',
      }),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('rejects with code=jmap_http_error on a non-2xx response', async () => {
    await expect(
      fetchBlobUpload({
        baseUrl: 'https://sw-mail.r3motely.net',
        getAuthToken: () => 'tok',
        fetch: makeFetchSpy('err', { status: 500, statusText: 'Server Error' }),
        accountId: 'b',
        bytes: new Uint8Array([1]),
        contentType: 'application/json',
      }),
    ).rejects.toMatchObject({ code: 'jmap_http_error' });
  });
});

// ── fetchBlobText ─────────────────────────────────────────────────────────────

describe('fetchBlobText', () => {
  it('GETs /jmap/download/{accountId}/{blobId}/{filename} and returns text', async () => {
    const fetchSpy: FetchSpy = makeFetchSpy('{"version":1,"labels":[]}');
    const result = await fetchBlobText({
      baseUrl: 'https://sw-mail.r3motely.net',
      getAuthToken: () => 'tok',
      fetch: fetchSpy,
      accountId: 'b',
      blobId: 'ccrqakfj0w3nu1orhjhnduve02iir7zoi3pw2zzhyae1ndet32sw7aimae',
      filename: 'labels.json',
    });
    expect(result).toBe('{"version":1,"labels":[]}');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(
      'https://sw-mail.r3motely.net/jmap/download/b/ccrqakfj0w3nu1orhjhnduve02iir7zoi3pw2zzhyae1ndet32sw7aimae/labels.json',
    );
    expect(init?.method).toBe('GET');
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.authorization).toBe('Bearer tok');
  });

  it('rejects with code=unauthorized when no token is available', async () => {
    await expect(
      fetchBlobText({
        baseUrl: 'https://sw-mail.r3motely.net',
        getAuthToken: () => null,
        fetch: makeFetchSpy('{"version":1,"labels":[]}'),
        accountId: 'b',
        blobId: 'some-blob-id',
        filename: 'labels.json',
      }),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('rejects with code=jmap_http_error on a non-2xx response', async () => {
    await expect(
      fetchBlobText({
        baseUrl: 'https://sw-mail.r3motely.net',
        getAuthToken: () => 'tok',
        fetch: makeFetchSpy('not found', { status: 404, statusText: 'Not Found' }),
        accountId: 'b',
        blobId: 'some-blob-id',
        filename: 'labels.json',
      }),
    ).rejects.toMatchObject({ code: 'jmap_http_error' });
  });
});
