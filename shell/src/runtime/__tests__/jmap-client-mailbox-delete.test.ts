/**
 * Tests for mailbox.delete — structural refusal guard + orchestration.
 *
 * Guard tests are pure (no I/O). Orchestration tests use a multi-call
 * fetch stub that returns canned responses for each JMAP call in sequence:
 * 1. Mailbox/get  (fetchMailboxList)
 * 2. Email/query  (fetchEmailIdsInMailbox)
 * 3. Email/set    (fetchMailModifyCommit — move to Trash)
 * 4. Mailbox/set  (postMailboxDestroy — destroy)
 */

import { describe, expect, it, vi } from 'vitest';
import {
  assertMailboxDeletable,
  fetchMailboxDeleteCommit,
  makeMailboxDeletePreview,
} from '../jmap-client.js';
import type { Mailbox, Session } from '../jmap-client.js';

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mk = (over: any = {}): Mailbox => ({
  id: 'X',
  name: 'X',
  sortOrder: 0,
  totalEmails: 0,
  unreadEmails: 0,
  totalThreads: 0,
  unreadThreads: 0,
  isSubscribed: true,
  myRights: {
    mayDelete: true,
    mayRename: true,
    mayCreateChild: true,
    mayReadItems: true,
    mayAddItems: true,
    mayRemoveItems: true,
    maySetSeen: true,
    maySetKeywords: true,
    maySubmit: true,
  },
  ...over,
} as Mailbox);

// ──────────────────────────────────────────────────────────────────────
// assertMailboxDeletable — pure guard
// ──────────────────────────────────────────────────────────────────────

describe('assertMailboxDeletable', () => {
  it('refuses a system folder', () => {
    const t = mk({ id: 'I', role: 'inbox', name: 'Inbox' });
    expect(() => assertMailboxDeletable(t, [t])).toThrow(/system folder/i);
  });
  it('refuses when it has child folders', () => {
    const t = mk({ id: 'P', name: 'Projects' });
    const child = mk({ id: 'C', name: 'Acme', parentId: 'P' });
    expect(() => assertMailboxDeletable(t, [t, child])).toThrow(/subfolder/i);
  });
  it('refuses without delete permission', () => {
    const t = mk({ id: 'P', name: 'Projects', myRights: { ...mk().myRights, mayDelete: false } });
    expect(() => assertMailboxDeletable(t, [t])).toThrow(/permission/i);
  });
  it('allows a deletable leaf folder', () => {
    const t = mk({ id: 'P', name: 'Projects' });
    expect(() => assertMailboxDeletable(t, [t])).not.toThrow();
  });
  it('refuses all system roles (sent, drafts, trash, junk, archive)', () => {
    for (const role of ['sent', 'drafts', 'trash', 'junk', 'archive']) {
      const t = mk({ id: 'S', role, name: role });
      expect(() => assertMailboxDeletable(t, [t])).toThrow(/system folder/i);
    }
  });
  it('allows a folder with only the permission check-relevant right (mayDelete true)', () => {
    const t = mk({ id: 'Q', name: 'Shared', myRights: { ...mk().myRights, mayDelete: true } });
    const child = mk({ id: 'X2', name: 'Other', parentId: 'unrelated' });
    expect(() => assertMailboxDeletable(t, [t, child])).not.toThrow();
  });
});

// ──────────────────────────────────────────────────────────────────────
// fetchMailboxDeleteCommit + makeMailboxDeletePreview — orchestration
// ──────────────────────────────────────────────────────────────────────

const SAMPLE_SESSION: Session = {
  username: 'user@example.test',
  apiUrl: 'https://jmap.example.test/api/',
  downloadUrl: '',
  uploadUrl: '',
  eventSourceUrl: '',
  state: 's1',
  primaryAccountIdMail: 'acct1',
};

const TOKEN = 'bearer-test-token';

/**
 * Build a fetch spy that cycles through `responses` in order.
 * Each call consumes the next response. Throws if called more times
 * than responses provided.
 */
function makeFetchSpy(responses: string[]): typeof fetch {
  let callIndex = 0;
  const impl: typeof fetch = async () => {
    const body = responses[callIndex];
    if (body === undefined) {
      throw new Error(`makeFetchSpy: unexpected call #${callIndex + 1} (only ${responses.length} responses configured)`);
    }
    callIndex++;
    return new Response(body, {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
    });
  };
  return vi.fn<typeof fetch>(impl);
}

function jsonStr(val: unknown): string {
  return JSON.stringify(val);
}

/** Canned Mailbox/get response: one user folder P + a trash folder T */
function mailboxGetResponse(): string {
  return jsonStr({
    methodResponses: [
      [
        'Mailbox/get',
        {
          list: [
            {
              id: 'P',
              name: 'Projects',
              sortOrder: 10,
              totalEmails: 2,
              unreadEmails: 0,
              totalThreads: 2,
              unreadThreads: 0,
              isSubscribed: true,
              myRights: {
                mayReadItems: true,
                mayAddItems: true,
                mayRemoveItems: true,
                maySetSeen: true,
                maySetKeywords: true,
                mayCreateChild: true,
                mayRename: true,
                mayDelete: true,
                maySubmit: false,
              },
            },
            {
              id: 'T',
              name: 'Trash',
              role: 'trash',
              sortOrder: 99,
              totalEmails: 0,
              unreadEmails: 0,
              totalThreads: 0,
              unreadThreads: 0,
              isSubscribed: true,
              myRights: {
                mayReadItems: true,
                mayAddItems: true,
                mayRemoveItems: true,
                maySetSeen: true,
                maySetKeywords: true,
                mayCreateChild: false,
                mayRename: false,
                mayDelete: false,
                maySubmit: false,
              },
            },
          ],
        },
        '0',
      ],
    ],
  });
}

/** Canned Email/query response: two email ids in folder P */
function emailQueryResponse(): string {
  return jsonStr({
    methodResponses: [
      ['Email/query', { ids: ['E-1', 'E-2'] }, '0'],
    ],
  });
}

/** Canned Email/set update (move-to-Trash) response */
function emailSetUpdateResponse(): string {
  return jsonStr({
    methodResponses: [
      ['Email/set', { updated: { 'E-1': {}, 'E-2': {} } }, '0'],
    ],
  });
}

/** Canned Mailbox/set destroy response */
function mailboxSetDestroyResponse(): string {
  return jsonStr({
    methodResponses: [
      ['Mailbox/set', { destroyed: ['P'] }, '0'],
    ],
  });
}

describe('fetchMailboxDeleteCommit', () => {
  it('calls 4 JMAP requests in sequence and returns { deleted: true, movedToTrash: 2 }', async () => {
    const fetchFn = makeFetchSpy([
      mailboxGetResponse(),
      emailQueryResponse(),
      emailSetUpdateResponse(),
      mailboxSetDestroyResponse(),
    ]);

    const result = await fetchMailboxDeleteCommit({
      baseUrl: 'https://jmap.example.test',
      getAuthToken: () => TOKEN,
      fetch: fetchFn,
      session: SAMPLE_SESSION,
      params: { mailboxId: 'P' },
    });

    expect(result).toEqual({ deleted: true, movedToTrash: 2 });
    expect((fetchFn as ReturnType<typeof vi.fn>).mock.calls.length).toBe(4);
  });

  it('skips the Email/set move when the folder is empty, does 3 requests total', async () => {
    const emptyQueryResponse = jsonStr({
      methodResponses: [['Email/query', { ids: [] }, '0']],
    });
    const fetchFn = makeFetchSpy([
      mailboxGetResponse(),
      emptyQueryResponse,
      mailboxSetDestroyResponse(),
    ]);

    const result = await fetchMailboxDeleteCommit({
      baseUrl: 'https://jmap.example.test',
      getAuthToken: () => TOKEN,
      fetch: fetchFn,
      session: SAMPLE_SESSION,
      params: { mailboxId: 'P' },
    });

    expect(result).toEqual({ deleted: true, movedToTrash: 0 });
    expect((fetchFn as ReturnType<typeof vi.fn>).mock.calls.length).toBe(3);
  });

  it('throws not_found when mailboxId does not exist in the list', async () => {
    const fetchFn = makeFetchSpy([mailboxGetResponse()]);

    await expect(
      fetchMailboxDeleteCommit({
        baseUrl: 'https://jmap.example.test',
        getAuthToken: () => TOKEN,
        fetch: fetchFn,
        session: SAMPLE_SESSION,
        params: { mailboxId: 'nonexistent' },
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('throws mailbox_protected when attempting to delete a system folder (trash)', async () => {
    const fetchFn = makeFetchSpy([mailboxGetResponse()]);

    await expect(
      fetchMailboxDeleteCommit({
        baseUrl: 'https://jmap.example.test',
        getAuthToken: () => TOKEN,
        fetch: fetchFn,
        session: SAMPLE_SESSION,
        params: { mailboxId: 'T' },
      }),
    ).rejects.toMatchObject({ code: 'mailbox_protected' });
  });

  it('throws mailbox_set_failed when Mailbox/set notDestroyed', async () => {
    const destroyFailResponse = jsonStr({
      methodResponses: [
        [
          'Mailbox/set',
          {
            notDestroyed: {
              P: { type: 'forbidden', description: 'Not allowed' },
            },
          },
          '0',
        ],
      ],
    });
    const fetchFn = makeFetchSpy([
      mailboxGetResponse(),
      emailQueryResponse(),
      emailSetUpdateResponse(),
      destroyFailResponse,
    ]);

    await expect(
      fetchMailboxDeleteCommit({
        baseUrl: 'https://jmap.example.test',
        getAuthToken: () => TOKEN,
        fetch: fetchFn,
        session: SAMPLE_SESSION,
        params: { mailboxId: 'P' },
      }),
    ).rejects.toMatchObject({ code: 'mailbox_set_failed' });
  });
});

describe('makeMailboxDeletePreview', () => {
  it('returns { affectedCount: 2 } without destroying anything', async () => {
    // Only 2 JMAP calls: Mailbox/get + Email/query — no mutations.
    const fetchFn = makeFetchSpy([
      mailboxGetResponse(),
      emailQueryResponse(),
    ]);

    const result = await makeMailboxDeletePreview({
      baseUrl: 'https://jmap.example.test',
      getAuthToken: () => TOKEN,
      fetch: fetchFn,
      session: SAMPLE_SESSION,
      params: { mailboxId: 'P' },
    });

    expect(result).toEqual({ affectedCount: 2 });
    expect((fetchFn as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  it('throws mailbox_protected in dry-run mode too', async () => {
    const fetchFn = makeFetchSpy([mailboxGetResponse()]);

    await expect(
      makeMailboxDeletePreview({
        baseUrl: 'https://jmap.example.test',
        getAuthToken: () => TOKEN,
        fetch: fetchFn,
        session: SAMPLE_SESSION,
        params: { mailboxId: 'T' },
      }),
    ).rejects.toMatchObject({ code: 'mailbox_protected' });
  });
});
