/**
 * Per-email undo metadata on the jmapInvoker's mailbox writes.
 *
 * A mailbox-patching mail.modify (move / restore) captures each
 * email's memberships — an Email/get riding ahead of the Email/set in
 * the same request — so buildInverse can undo per email;
 * mail.restore-mailboxes applies a distinct mailboxIds patch per group
 * in ONE Email/set. The mixed Inbox+Sent thread round trip
 * proves undo no longer files a Sent reply into Inbox (or vice versa).
 */

import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { jmapInvoker } from '../invoker.js';
import { buildInverse } from '../undo-registry.js';

const SESSION_FIXTURE = readFileSync(
  resolve(__dirname, '../../../../components/jmap-client/tests/fixtures/session.json'),
  'utf8',
);

type MethodResponse = readonly [string, unknown, string];

function emailGetMemberships(
  rows: Record<string, readonly string[]>,
  callId = '0',
): MethodResponse {
  return [
    'Email/get',
    {
      accountId: 'c',
      list: Object.entries(rows).map(([id, mailboxes]) => ({
        id,
        mailboxIds: Object.fromEntries(mailboxes.map((m) => [m, true])),
      })),
    },
    callId,
  ];
}

function emailSetUpdated(ids: readonly string[]): MethodResponse {
  return ['Email/set', { accountId: 'c', updated: Object.fromEntries(ids.map((id) => [id, null])) }, '0'];
}

/** A JMAP response body carrying these method responses, in order. */
function respond(...methodResponses: MethodResponse[]): string {
  return JSON.stringify({ methodResponses });
}

/** The update, with its memberships read riding ahead in one request. */
function capturedUpdate(rows: Record<string, readonly string[]>): string {
  return respond(emailGetMemberships(rows, 'prev'), emailSetUpdated(Object.keys(rows)));
}

/** Fetch mock answering each JMAP API POST with the next canned body
 *  the session GET is always served. */
function makeSequencedFetch(apiBodies: readonly string[]): {
  fetch: ReturnType<typeof vi.fn<typeof fetch>>;
  calls: string[];
} {
  const calls: string[] = [];
  let i = 0;
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
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

function invokerWith(apiBodies: readonly string[]) {
  const { fetch: fetchMock, calls } = makeSequencedFetch(apiBodies);
  const inv = jmapInvoker({
    baseUrl: 'https://jmap.example.test',
    getAuthToken: () => 'tok',
    fetch: fetchMock,
  });
  return { inv, calls };
}

/** The method calls of a JMAP request body. */
function callsOf(body: string): Array<[string, Record<string, unknown>, string]> {
  return (JSON.parse(body) as { methodCalls: Array<[string, Record<string, unknown>, string]> })
    .methodCalls;
}

/** The `update` map of the Email/set in a request body. */
function updateOf(body: string): Record<string, Record<string, boolean>> {
  const set = callsOf(body).find(([name]) => name === 'Email/set');
  expect(set).toBeDefined();
  return set![1].update as Record<string, Record<string, boolean>>;
}

const THREAD = { 'em-in': ['Mb-inbox'], 'em-sent': ['Mb-sent'] } as const;
const MOVE = {
  emailIds: ['em-in', 'em-sent'],
  patch: { mailboxIds: { 'Mb-inbox': false, 'Mb-archive': true } },
};

describe('mail.modify captures memberships for mailbox patches', () => {
  it('reads memberships ahead of the update in the same request and returns them', async () => {
    const { inv, calls } = invokerWith([capturedUpdate(THREAD)]);
    const result = await inv.invoke('mail.modify', MOVE);
    expect(result).toEqual({
      modifiedCount: 2,
      previousMailboxesByEmail: { 'em-in': ['Mb-inbox'], 'em-sent': ['Mb-sent'] },
    });
    // One round trip: Email/get THEN Email/set, so the read sees the
    // state immediately before the write.
    expect(calls).toHaveLength(1);
    expect(callsOf(calls[0]!).map(([name, args, id]) => [name, id, args.ids ?? null])).toEqual([
      ['Email/get', 'prev', ['em-in', 'em-sent']],
      ['Email/set', '0', null],
    ]);
  });

  it('does not read memberships for a keyword-only patch', async () => {
    const { inv, calls } = invokerWith([respond(emailSetUpdated(['em-1']))]);
    const result = await inv.invoke('mail.modify', {
      emailIds: ['em-1'],
      patch: { keywords: { $seen: true } },
    });
    expect(result).toEqual({ modifiedCount: 1 });
    expect(callsOf(calls[0]!).map(([name]) => name)).toEqual(['Email/set']);
  });

  it('still moves when the server fails the membership read (no undo metadata)', async () => {
    const { inv } = invokerWith([
      respond(['error', { type: 'serverFail' }, 'prev'], emailSetUpdated(['em-in', 'em-sent'])),
    ]);
    const result = await inv.invoke('mail.modify', MOVE);
    expect(result).toEqual({ modifiedCount: 2 });
    // Without memberships a bulk move registers no undo at all.
    expect(buildInverse('mail.modify', MOVE, result)).toBeNull();
  });

  it('still surfaces a rejected update', async () => {
    const { inv } = invokerWith([
      respond(emailGetMemberships(THREAD, 'prev'), [
        'Email/set',
        { accountId: 'c', notUpdated: { 'em-in': { type: 'notFound' } } },
        '0',
      ]),
    ]);
    await expect(inv.invoke('mail.modify', MOVE)).rejects.toMatchObject({
      code: 'jmap_set_error',
    });
  });
});

describe('mail.restore-mailboxes', () => {
  it('applies each group its own patch in a single Email/set', async () => {
    const { inv, calls } = invokerWith([
      capturedUpdate({ 'em-in': ['Mb-archive'], 'em-sent': ['Mb-sent', 'Mb-archive'] }),
    ]);
    const result = await inv.invoke('mail.restore-mailboxes', {
      groups: [
        { emailIds: ['em-in'], mailboxIds: { 'Mb-inbox': true, 'Mb-archive': false } },
        { emailIds: ['em-sent'], mailboxIds: { 'Mb-archive': false } },
      ],
    });
    expect(result).toEqual({
      modifiedCount: 2,
      previousMailboxesByEmail: { 'em-in': ['Mb-archive'], 'em-sent': ['Mb-sent', 'Mb-archive'] },
    });
    expect(calls).toHaveLength(1);
    expect(updateOf(calls[0]!)).toEqual({
      'em-in': { 'mailboxIds/Mb-inbox': true, 'mailboxIds/Mb-archive': false },
      'em-sent': { 'mailboxIds/Mb-archive': false },
    });
  });

  it('dry-run previews without touching JMAP', async () => {
    const { inv, calls } = invokerWith([]);
    const result = await inv.invoke(
      'mail.restore-mailboxes',
      {
        groups: [
          { emailIds: ['em-1', 'em-2'], mailboxIds: { 'Mb-inbox': true } },
          { emailIds: ['em-3'], mailboxIds: { 'Mb-sent': true } },
        ],
      },
      { dryRun: true },
    );
    expect(result).toEqual({ affectedCount: 3, emails: [] });
    expect(calls).toHaveLength(0);
  });

  it('rejects an email listed in two groups without sending anything', async () => {
    const { inv, calls } = invokerWith([]);
    await expect(
      inv.invoke('mail.restore-mailboxes', {
        groups: [
          { emailIds: ['em-1'], mailboxIds: { 'Mb-a': true } },
          { emailIds: ['em-1'], mailboxIds: { 'Mb-b': true } },
        ],
      }),
    ).rejects.toMatchObject({ code: 'invalid_argument' });
    expect(calls).toHaveLength(0);
  });
});

describe('mixed Inbox+Sent thread: undo restores each email exactly', () => {
  it('move Inbox→Archive, then undo', async () => {
    const { inv, calls } = invokerWith([
      capturedUpdate(THREAD),
      capturedUpdate({ 'em-in': ['Mb-archive'], 'em-sent': ['Mb-sent', 'Mb-archive'] }),
    ]);
    const result = await inv.invoke('mail.modify', MOVE);
    const undo = buildInverse('mail.modify', MOVE, result)!;
    await inv.invoke(undo.inverseAction, undo.inverseParams);
    expect(updateOf(calls[1]!)).toEqual({
      // Inbox mail back to Inbox, out of Archive …
      'em-in': { 'mailboxIds/Mb-inbox': true, 'mailboxIds/Mb-archive': false },
      // … the Sent reply only loses Archive — never lands in Inbox.
      'em-sent': { 'mailboxIds/Mb-archive': false },
    });
  });

  it('delete (soft, to Trash), then undo', async () => {
    const { inv, calls } = invokerWith([
      MAILBOX_GET_TRASH,
      respond(emailGetMemberships(THREAD)),
      respond(emailSetUpdated(['em-in', 'em-sent'])),
      capturedUpdate({ 'em-in': ['Mb-trash'], 'em-sent': ['Mb-trash'] }),
    ]);
    const params = { emailIds: ['em-in', 'em-sent'] };
    const result = await inv.invoke('mail.delete', params);
    const undo = buildInverse('mail.delete', params, result)!;
    await inv.invoke(undo.inverseAction, undo.inverseParams);
    expect(updateOf(calls[3]!)).toEqual({
      'em-in': { 'mailboxIds/Mb-inbox': true, 'mailboxIds/Mb-trash': false },
      'em-sent': { 'mailboxIds/Mb-sent': true, 'mailboxIds/Mb-trash': false },
    });
  });
});

const MAILBOX_GET_TRASH = respond([
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
    ],
  },
  '0',
]);
