/**
 * Per-email undo metadata on the jmapInvoker's mailbox writes.
 *
 * A mailbox-patching mail.modify (move / restore) captures each
 * email's memberships before the write so buildInverse can undo per
 * email; mail.restore-mailboxes applies a distinct mailboxIds patch
 * per group in ONE Email/set. The mixed Inbox+Sent thread round trip
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

function emailGetMemberships(rows: Record<string, readonly string[]>): string {
  return JSON.stringify({
    methodResponses: [
      [
        'Email/get',
        {
          accountId: 'c',
          list: Object.entries(rows).map(([id, mailboxes]) => ({
            id,
            mailboxIds: Object.fromEntries(mailboxes.map((m) => [m, true])),
          })),
        },
        '0',
      ],
    ],
  });
}

function emailSetUpdated(ids: readonly string[]): string {
  return JSON.stringify({
    methodResponses: [
      ['Email/set', { accountId: 'c', updated: Object.fromEntries(ids.map((id) => [id, null])) }, '0'],
    ],
  });
}

/** Fetch mock answering each JMAP API POST with the next canned body
 *  (a number = that HTTP status); the session GET is always served. */
function makeSequencedFetch(apiBodies: ReadonlyArray<string | number>): {
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
    if (typeof next === 'number') return new Response('', { status: next, statusText: 'err' });
    return new Response(next, { status: 200, statusText: 'OK' });
  });
  return { fetch: fetchMock, calls };
}

function invokerWith(apiBodies: ReadonlyArray<string | number>) {
  const { fetch: fetchMock, calls } = makeSequencedFetch(apiBodies);
  const inv = jmapInvoker({
    baseUrl: 'https://jmap.example.test',
    getAuthToken: () => 'tok',
    fetch: fetchMock,
  });
  return { inv, calls };
}

/** The `update` map of an Email/set request body. */
function updateOf(body: string): Record<string, Record<string, boolean>> {
  const parsed = JSON.parse(body) as {
    methodCalls: [[string, { update: Record<string, Record<string, boolean>> }, string]];
  };
  expect(parsed.methodCalls[0][0]).toBe('Email/set');
  return parsed.methodCalls[0][1].update;
}

const THREAD = { 'em-in': ['Mb-inbox'], 'em-sent': ['Mb-sent'] } as const;
const MOVE = {
  emailIds: ['em-in', 'em-sent'],
  patch: { mailboxIds: { 'Mb-inbox': false, 'Mb-archive': true } },
};

describe('mail.modify captures memberships for mailbox patches', () => {
  it('reads memberships before the update and returns them', async () => {
    const { inv, calls } = invokerWith([emailGetMemberships(THREAD), emailSetUpdated(['em-in', 'em-sent'])]);
    const result = await inv.invoke('mail.modify', MOVE);
    expect(result).toEqual({
      modifiedCount: 2,
      previousMailboxesByEmail: { 'em-in': ['Mb-inbox'], 'em-sent': ['Mb-sent'] },
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatch(/Email\/get/);
    expect(calls[1]).toMatch(/Email\/set/);
  });

  it('does not read memberships for a keyword-only patch', async () => {
    const { inv, calls } = invokerWith([emailSetUpdated(['em-1'])]);
    const result = await inv.invoke('mail.modify', {
      emailIds: ['em-1'],
      patch: { keywords: { $seen: true } },
    });
    expect(result).toEqual({ modifiedCount: 1 });
    expect(calls).toHaveLength(1);
  });

  it('still moves when the membership read fails (no undo metadata)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { inv, calls } = invokerWith([500, emailSetUpdated(['em-in', 'em-sent'])]);
    const result = await inv.invoke('mail.modify', MOVE);
    expect(result).toEqual({ modifiedCount: 2 });
    expect(calls).toHaveLength(2);
    // Without memberships a bulk move registers no undo at all.
    expect(buildInverse('mail.modify', MOVE, result)).toBeNull();
    warn.mockRestore();
  });
});

describe('mail.restore-mailboxes', () => {
  it('applies each group its own patch in a single Email/set', async () => {
    const { inv, calls } = invokerWith([
      emailGetMemberships({ 'em-in': ['Mb-archive'], 'em-sent': ['Mb-sent', 'Mb-archive'] }),
      emailSetUpdated(['em-in', 'em-sent']),
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
    expect(calls).toHaveLength(2);
    expect(updateOf(calls[1]!)).toEqual({
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

  it('rejects an email listed in two groups', async () => {
    const { inv } = invokerWith([emailGetMemberships({ 'em-1': ['Mb-a'] })]);
    await expect(
      inv.invoke('mail.restore-mailboxes', {
        groups: [
          { emailIds: ['em-1'], mailboxIds: { 'Mb-a': true } },
          { emailIds: ['em-1'], mailboxIds: { 'Mb-b': true } },
        ],
      }),
    ).rejects.toMatchObject({ code: 'invalid_argument' });
  });
});

describe('mixed Inbox+Sent thread: undo restores each email exactly', () => {
  it('move Inbox→Archive, then undo', async () => {
    const { inv, calls } = invokerWith([
      emailGetMemberships(THREAD),
      emailSetUpdated(['em-in', 'em-sent']),
      emailGetMemberships({ 'em-in': ['Mb-archive'], 'em-sent': ['Mb-sent', 'Mb-archive'] }),
      emailSetUpdated(['em-in', 'em-sent']),
    ]);
    const result = await inv.invoke('mail.modify', MOVE);
    const undo = buildInverse('mail.modify', MOVE, result)!;
    await inv.invoke(undo.inverseAction, undo.inverseParams);
    expect(updateOf(calls[3]!)).toEqual({
      // Inbox mail back to Inbox, out of Archive …
      'em-in': { 'mailboxIds/Mb-inbox': true, 'mailboxIds/Mb-archive': false },
      // … the Sent reply only loses Archive — never lands in Inbox.
      'em-sent': { 'mailboxIds/Mb-archive': false },
    });
  });

  it('delete (soft, to Trash), then undo', async () => {
    const mailboxGet = JSON.stringify({
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
            ],
          },
          '0',
        ],
      ],
    });
    const { inv, calls } = invokerWith([
      mailboxGet,
      emailGetMemberships(THREAD),
      emailSetUpdated(['em-in', 'em-sent']),
      emailGetMemberships({ 'em-in': ['Mb-trash'], 'em-sent': ['Mb-trash'] }),
      emailSetUpdated(['em-in', 'em-sent']),
    ]);
    const params = { emailIds: ['em-in', 'em-sent'] };
    const result = await inv.invoke('mail.delete', params);
    const undo = buildInverse('mail.delete', params, result)!;
    await inv.invoke(undo.inverseAction, undo.inverseParams);
    expect(updateOf(calls[4]!)).toEqual({
      'em-in': { 'mailboxIds/Mb-inbox': true, 'mailboxIds/Mb-trash': false },
      'em-sent': { 'mailboxIds/Mb-sent': true, 'mailboxIds/Mb-trash': false },
    });
  });
});
