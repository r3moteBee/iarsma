/**
 * Tests for the two-stage delete (PR 19 of the undo-registry plan).
 *
 * mail.delete no longer issues Email/set destroy. It:
 *   1. resolves the role:'trash' mailbox,
 *   2. reads each email's current mailbox memberships,
 *   3. issues Email/set update that adds Trash and removes the
 *      union of source mailboxes.
 *
 * mail.purge is the new tool that does the actual Email/set destroy.
 * UI-only — no MCP handler exposes it.
 */

import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { jmapInvoker } from '../invoker.js';

const SESSION_FIXTURE = readFileSync(
  resolve(__dirname, '../../../../components/jmap-client/tests/fixtures/session.json'),
  'utf8',
);

const MAILBOX_GET_TRASH_AND_INBOX = JSON.stringify({
  methodResponses: [
    [
      'Mailbox/get',
      {
        accountId: 'c',
        list: [
          {
            id: 'Mb-trash',
            name: 'Trash',
            role: 'trash',
            sortOrder: 0,
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
          {
            id: 'Mb-inbox',
            name: 'Inbox',
            role: 'inbox',
            sortOrder: 0,
            totalEmails: 1,
            unreadEmails: 0,
            totalThreads: 1,
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

const EMAIL_GET_MEMBERSHIPS_ONE = JSON.stringify({
  methodResponses: [
    [
      'Email/get',
      {
        accountId: 'c',
        list: [{ id: 'em-1', mailboxIds: { 'Mb-inbox': true } }],
      },
      '0',
    ],
  ],
});

const EMAIL_SET_UPDATE_OK = JSON.stringify({
  methodResponses: [
    [
      'Email/set',
      { accountId: 'c', updated: { 'em-1': null } },
      '0',
    ],
  ],
});

const EMAIL_SET_DESTROY_OK = JSON.stringify({
  methodResponses: [
    [
      'Email/set',
      { accountId: 'c', destroyed: ['em-1'] },
      '0',
    ],
  ],
});

/**
 * Build a fetch mock that returns the supplied bodies in order on
 * each JMAP API POST. The /.well-known/jmap GET is always satisfied
 * with the session fixture.
 */
function makeSequencedFetch(
  apiBodies: readonly string[],
): { fetch: ReturnType<typeof vi.fn<typeof fetch>>; calls: string[] } {
  const calls: string[] = [];
  let i = 0;
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    if (url.endsWith('/.well-known/jmap')) {
      return new Response(SESSION_FIXTURE, { status: 200, statusText: 'OK' });
    }
    const body = String(init?.body ?? '');
    calls.push(body);
    const next = apiBodies[i++];
    if (next === undefined) {
      throw new Error(`unexpected API call #${i}: ${body.slice(0, 200)}`);
    }
    return new Response(next, { status: 200, statusText: 'OK' });
  });
  return { fetch: fetchMock, calls };
}

describe('mail.delete (two-stage soft delete, PR 19)', () => {
  it('issues Email/set update moving messages into the Trash mailbox', async () => {
    const { fetch: fetchMock, calls } = makeSequencedFetch([
      MAILBOX_GET_TRASH_AND_INBOX,
      EMAIL_GET_MEMBERSHIPS_ONE,
      EMAIL_SET_UPDATE_OK,
    ]);
    const inv = jmapInvoker({
      baseUrl: 'https://jmap.example.test',
      getAuthToken: () => 'tok',
      fetch: fetchMock,
    });

    const result = await inv.invoke('mail.delete', { emailIds: ['em-1'] });
    expect(result).toEqual({
      modifiedCount: 1,
      previousMailboxesByEmail: { 'em-1': ['Mb-inbox'] },
      trashMailboxId: 'Mb-trash',
    });

    // Three API calls: Mailbox/get (trash lookup) + Email/get
    // (memberships) + Email/set (the update).
    expect(calls).toHaveLength(3);
    expect(calls[0]).toMatch(/Mailbox\/get/);
    expect(calls[1]).toMatch(/Email\/get/);
    // The final call is Email/set update with the patch that sets
    // Trash on and Inbox off for em-1.
    expect(calls[2]).toMatch(/Email\/set/);
    expect(calls[2]).toMatch(/"mailboxIds\/Mb-trash":true/);
    expect(calls[2]).toMatch(/"mailboxIds\/Mb-inbox":false/);
    // And — critically — no `destroy` field.
    expect(calls[2]).not.toMatch(/"destroy":/);
  });

  it('dry-run returns the affected count without making any update', async () => {
    const { fetch: fetchMock, calls } = makeSequencedFetch([]);
    const inv = jmapInvoker({
      baseUrl: 'https://jmap.example.test',
      getAuthToken: () => 'tok',
      fetch: fetchMock,
    });

    const result = await inv.invoke(
      'mail.delete',
      { emailIds: ['em-1', 'em-2'] },
      { dryRun: true },
    );
    expect(result).toEqual({ affectedCount: 2, emails: [] });
    // Dry-run touches no JMAP at all.
    expect(calls).toHaveLength(0);
  });

  it('throws when the account has no Trash mailbox', async () => {
    const noTrashList = JSON.stringify({
      methodResponses: [
        [
          'Mailbox/get',
          { accountId: 'c', list: [] },
          '0',
        ],
      ],
    });
    const { fetch: fetchMock } = makeSequencedFetch([noTrashList]);
    const inv = jmapInvoker({
      baseUrl: 'https://jmap.example.test',
      getAuthToken: () => 'tok',
      fetch: fetchMock,
    });

    await expect(inv.invoke('mail.delete', { emailIds: ['em-1'] })).rejects.toThrow(
      /role: trash/i,
    );
  });
});

describe('mail.list-ids (PR 30, powers Empty trash)', () => {
  it('returns the emailIds returned by Email/query against the mailbox', async () => {
    const queryOk = JSON.stringify({
      methodResponses: [
        ['Email/query', { accountId: 'c', ids: ['em-1', 'em-2', 'em-3'] }, '0'],
      ],
    });
    const { fetch: fetchMock, calls } = makeSequencedFetch([queryOk]);
    const inv = jmapInvoker({
      baseUrl: 'https://jmap.example.test',
      getAuthToken: () => 'tok',
      fetch: fetchMock,
    });

    const result = await inv.invoke('mail.list-ids', { mailboxId: 'Mb-trash' });
    expect(result).toEqual({ emailIds: ['em-1', 'em-2', 'em-3'] });

    // The call must be an Email/query with the inMailbox filter.
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/Email\/query/);
    expect(calls[0]).toMatch(/"inMailbox":"Mb-trash"/);
    // And — critically — does NOT chain an Email/get; we just want ids.
    expect(calls[0]).not.toMatch(/Email\/get/);
  });

  it('returns an empty list when the mailbox is empty', async () => {
    const queryOk = JSON.stringify({
      methodResponses: [['Email/query', { accountId: 'c', ids: [] }, '0']],
    });
    const { fetch: fetchMock } = makeSequencedFetch([queryOk]);
    const inv = jmapInvoker({
      baseUrl: 'https://jmap.example.test',
      getAuthToken: () => 'tok',
      fetch: fetchMock,
    });
    const result = await inv.invoke('mail.list-ids', { mailboxId: 'Mb-trash' });
    expect(result).toEqual({ emailIds: [] });
  });
});

describe('mail.purge (hard destroy, PR 19)', () => {
  it('issues Email/set destroy for the given emailIds', async () => {
    const { fetch: fetchMock, calls } = makeSequencedFetch([EMAIL_SET_DESTROY_OK]);
    const inv = jmapInvoker({
      baseUrl: 'https://jmap.example.test',
      getAuthToken: () => 'tok',
      fetch: fetchMock,
    });

    const result = await inv.invoke('mail.purge', { emailIds: ['em-1'] });
    expect(result).toEqual({ deletedCount: 1 });
    // Single API call: Email/set destroy.
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/"destroy":\["em-1"\]/);
    // And — critically — no `update` field.
    expect(calls[0]).not.toMatch(/"update":/);
  });
});
