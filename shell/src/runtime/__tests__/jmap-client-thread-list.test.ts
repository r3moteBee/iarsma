import { describe, expect, it } from 'vitest';
import { buildThreadListRequest } from '../jmap-client.js';

describe('buildThreadListRequest', () => {
  const accountId = 'acct-1';

  it('builds filter:{inMailbox} when mailboxId is provided', () => {
    const json = buildThreadListRequest({ accountId, mailboxId: 'Mb01' });
    const body = JSON.parse(json);
    const [, args] = body.methodCalls[0];
    expect(args.filter).toEqual({ inMailbox: 'Mb01' });
  });

  it('builds filter:{hasKeyword} when hasKeyword is provided', () => {
    const json = buildThreadListRequest({ accountId, hasKeyword: 'lbl:work' });
    const body = JSON.parse(json);
    const [, args] = body.methodCalls[0];
    expect(args.filter).toEqual({ hasKeyword: 'lbl:work' });
  });

  it('throws when neither mailboxId nor hasKeyword is provided', () => {
    expect(() => buildThreadListRequest({ accountId })).toThrow(
      /exactly one of mailboxId or hasKeyword/,
    );
  });

  it('throws when both mailboxId and hasKeyword are provided', () => {
    expect(() =>
      buildThreadListRequest({ accountId, mailboxId: 'Mb01', hasKeyword: 'lbl:work' }),
    ).toThrow(/exactly one of mailboxId or hasKeyword/);
  });

  it('includes position, limit, sort, collapseThreads, calculateTotal', () => {
    const json = buildThreadListRequest({ accountId, mailboxId: 'Mb01', position: 10, limit: 25 });
    const body = JSON.parse(json);
    const [, args] = body.methodCalls[0];
    expect(args.position).toBe(10);
    expect(args.limit).toBe(25);
    expect(args.collapseThreads).toBe(true);
    expect(args.calculateTotal).toBe(true);
    expect(args.sort).toEqual([{ property: 'receivedAt', isAscending: false }]);
  });
});
