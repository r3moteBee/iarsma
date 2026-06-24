/**
 * Tests for the three `calendar.*` switch cases in `jmapInvoker` (Task 6).
 *
 * Drives the PRODUCTION `jmapInvoker` with a mocked fetch/session to cover
 * the 3 new switch cases:
 *
 *   calendar.create  — calls Calendar/set create; returns { calendarId }
 *   calendar.update  — calls Calendar/set update; returns { updated: true }
 *   calendar.delete  — destructive; dryRun=true → { isDefault } preview via
 *                      Calendar/get; dryRun=false → Calendar/set destroy
 *
 * Mirror of invoker-labels.test.ts setup — session is bootstrapped via
 * /.well-known/jmap with the shared session.json fixture; API calls go to
 * the SESSION_API_URL; any other URL throws.
 */

import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { jmapInvoker } from '../invoker.js';

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

/**
 * Build a Calendar/get response with the given list of calendars.
 */
function calendarGetResponse(
  calendars: Array<{ id: string; name: string; color?: string; isDefault?: boolean; isVisible?: boolean }>,
): string {
  return jsonStr({
    methodResponses: [
      [
        'Calendar/get',
        {
          accountId: ACCOUNT_ID,
          state: 's0',
          list: calendars.map((c) => ({
            id: c.id,
            name: c.name,
            ...(c.color !== undefined ? { color: c.color } : {}),
            isDefault: c.isDefault ?? false,
            isVisible: c.isVisible ?? true,
          })),
          notFound: [],
        },
        '0',
      ],
    ],
  });
}

/**
 * Build a Calendar/set create success response.
 */
function calendarSetCreateOk(calendarId: string): string {
  return jsonStr({
    methodResponses: [
      [
        'Calendar/set',
        {
          accountId: ACCOUNT_ID,
          newState: 's1',
          created: { c0: { id: calendarId } },
        },
        '0',
      ],
    ],
  });
}

/**
 * Build a Calendar/set update success response.
 */
function calendarSetUpdateOk(calendarId: string): string {
  return jsonStr({
    methodResponses: [
      [
        'Calendar/set',
        {
          accountId: ACCOUNT_ID,
          newState: 's2',
          updated: { [calendarId]: null },
        },
        '0',
      ],
    ],
  });
}

/**
 * Build a Calendar/set destroy success response.
 */
function calendarSetDestroyOk(calendarId: string): string {
  return jsonStr({
    methodResponses: [
      [
        'Calendar/set',
        {
          accountId: ACCOUNT_ID,
          newState: 's3',
          destroyed: [calendarId],
        },
        '0',
      ],
    ],
  });
}

// ─── Fetch mock factory ───────────────────────────────────────────────────────

/**
 * All JMAP API calls must go to the session's apiUrl.
 * Requests to any other URL throw immediately.
 */
const SESSION_API_URL = 'https://sw-mail.example.net/jmap/';

function makeFetch(opts: {
  apiBodies: string[];
}): { fetch: ReturnType<typeof vi.fn<typeof fetch>>; apiCalls: string[] } {
  const apiCalls: string[] = [];
  let apiIdx = 0;
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
    if (url === SESSION_API_URL) {
      const body = String(init?.body ?? '');
      apiCalls.push(body);
      const next = opts.apiBodies[apiIdx++];
      if (next === undefined) {
        throw new Error(`Unexpected API call #${apiIdx}: ${body.slice(0, 200)}`);
      }
      return new Response(next, { status: 200 });
    }
    throw new Error(
      `fetch mock: unexpected URL "${url}" — all JMAP API calls must go to session apiUrl (${SESSION_API_URL})`,
    );
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

// ─── calendar.create ─────────────────────────────────────────────────────────

describe('jmapInvoker — calendar.create', () => {
  it('issues a Calendar/set create with name and returns { calendarId }', async () => {
    const { fetch: fetchMock, apiCalls } = makeFetch({
      apiBodies: [calendarSetCreateOk('cal-1')],
    });
    const inv = makeInvoker(fetchMock);
    const result = await inv.invoke('calendar.create', { name: 'Work' }) as { calendarId: string };
    expect(result.calendarId).toBe('cal-1');
    expect(apiCalls).toHaveLength(1);
    const body = JSON.parse(apiCalls[0]!);
    const [method, args] = body.methodCalls[0];
    expect(method).toBe('Calendar/set');
    expect(args.create.c0.name).toBe('Work');
    expect(args.create.c0.color).toBeUndefined();
  });

  it('includes color in Calendar/set create when provided', async () => {
    const { fetch: fetchMock, apiCalls } = makeFetch({
      apiBodies: [calendarSetCreateOk('cal-2')],
    });
    const inv = makeInvoker(fetchMock);
    const result = await inv.invoke('calendar.create', { name: 'Personal', color: '#ff6b35' }) as { calendarId: string };
    expect(result.calendarId).toBe('cal-2');
    const body = JSON.parse(apiCalls[0]!);
    const [, args] = body.methodCalls[0];
    expect(args.create.c0.name).toBe('Personal');
    expect(args.create.c0.color).toBe('#ff6b35');
  });
});

// ─── calendar.update ─────────────────────────────────────────────────────────

describe('jmapInvoker — calendar.update', () => {
  it('issues a Calendar/set update with name and returns { updated: true }', async () => {
    const { fetch: fetchMock, apiCalls } = makeFetch({
      apiBodies: [calendarSetUpdateOk('cal-1')],
    });
    const inv = makeInvoker(fetchMock);
    const result = await inv.invoke('calendar.update', { calendarId: 'cal-1', name: 'Work Renamed' });
    expect(result).toEqual({ updated: true });
    const body = JSON.parse(apiCalls[0]!);
    const [method, args] = body.methodCalls[0];
    expect(method).toBe('Calendar/set');
    expect(args.update['cal-1'].name).toBe('Work Renamed');
  });

  it('includes color in Calendar/set update when provided', async () => {
    const { fetch: fetchMock, apiCalls } = makeFetch({
      apiBodies: [calendarSetUpdateOk('cal-1')],
    });
    const inv = makeInvoker(fetchMock);
    await inv.invoke('calendar.update', { calendarId: 'cal-1', color: '#ff9d23' });
    const body = JSON.parse(apiCalls[0]!);
    const [, args] = body.methodCalls[0];
    expect(args.update['cal-1'].color).toBe('#ff9d23');
    // name not sent since not provided
    expect(args.update['cal-1'].name).toBeUndefined();
  });
});

// ─── calendar.delete ─────────────────────────────────────────────────────────

describe('jmapInvoker — calendar.delete', () => {
  it('dryRun=true returns { isDefault: false } for a non-default calendar', async () => {
    const { fetch: fetchMock, apiCalls } = makeFetch({
      apiBodies: [
        calendarGetResponse([
          { id: 'cal-1', name: 'Work', isDefault: false },
          { id: 'cal-default', name: 'Default Calendar', isDefault: true },
        ]),
      ],
    });
    const inv = makeInvoker(fetchMock);
    const result = await inv.invoke('calendar.delete', { calendarId: 'cal-1' }, { dryRun: true });
    expect(result).toEqual({ isDefault: false });
    // No Calendar/set (destroy) should have been called.
    expect(apiCalls.some((c) => c.includes('"destroy"'))).toBe(false);
  });

  it('dryRun=true returns { isDefault: true } for the default calendar', async () => {
    const { fetch: fetchMock } = makeFetch({
      apiBodies: [
        calendarGetResponse([
          { id: 'cal-default', name: 'Default Calendar', isDefault: true },
        ]),
      ],
    });
    const inv = makeInvoker(fetchMock);
    const result = await inv.invoke('calendar.delete', { calendarId: 'cal-default' }, { dryRun: true });
    expect(result).toEqual({ isDefault: true });
  });

  it('dryRun=true returns { isDefault: false } when calendar id not found in list', async () => {
    const { fetch: fetchMock } = makeFetch({
      apiBodies: [
        calendarGetResponse([
          { id: 'cal-other', name: 'Other', isDefault: false },
        ]),
      ],
    });
    const inv = makeInvoker(fetchMock);
    const result = await inv.invoke('calendar.delete', { calendarId: 'cal-missing' }, { dryRun: true });
    expect(result).toEqual({ isDefault: false });
  });

  it('commit (dryRun=false) calls Calendar/set destroy without onDestroyRemoveEvents when removeEvents=false', async () => {
    const { fetch: fetchMock, apiCalls } = makeFetch({
      apiBodies: [
        // First: Calendar/get for the default-calendar guard
        calendarGetResponse([{ id: 'cal-1', name: 'Work', isDefault: false }]),
        // Second: Calendar/set destroy
        calendarSetDestroyOk('cal-1'),
      ],
    });
    const inv = makeInvoker(fetchMock);
    const result = await inv.invoke('calendar.delete', { calendarId: 'cal-1', removeEvents: false });
    expect(result).toEqual({ deleted: true });
    // apiCalls[0] is the Calendar/get; apiCalls[1] is the Calendar/set destroy
    const body = JSON.parse(apiCalls[1]!);
    const [method, args] = body.methodCalls[0];
    expect(method).toBe('Calendar/set');
    expect(args.destroy).toContain('cal-1');
    // When removeEvents=false, flag must NOT be sent
    expect(args.onDestroyRemoveEvents).toBeUndefined();
  });

  it('commit sends onDestroyRemoveEvents=true when removeEvents=true', async () => {
    const { fetch: fetchMock, apiCalls } = makeFetch({
      apiBodies: [
        // First: Calendar/get for the default-calendar guard
        calendarGetResponse([{ id: 'cal-1', name: 'Work', isDefault: false }]),
        // Second: Calendar/set destroy
        calendarSetDestroyOk('cal-1'),
      ],
    });
    const inv = makeInvoker(fetchMock);
    const result = await inv.invoke('calendar.delete', { calendarId: 'cal-1', removeEvents: true });
    expect(result).toEqual({ deleted: true });
    const body = JSON.parse(apiCalls[1]!);
    const [, args] = body.methodCalls[0];
    expect(args.destroy).toContain('cal-1');
    expect(args.onDestroyRemoveEvents).toBe(true);
  });

  it('commit rejects with calendar_is_default and does NOT issue Calendar/set destroy for a default calendar', async () => {
    const { fetch: fetchMock, apiCalls } = makeFetch({
      apiBodies: [
        // Only Calendar/get is expected — no destroy should follow
        calendarGetResponse([
          { id: 'cal-default', name: 'Default Calendar', isDefault: true },
        ]),
      ],
    });
    const inv = makeInvoker(fetchMock);
    await expect(
      inv.invoke('calendar.delete', { calendarId: 'cal-default' }),
    ).rejects.toMatchObject({ code: 'calendar_is_default' });
    // Confirm no Calendar/set destroy was issued
    expect(apiCalls.some((c) => c.includes('"destroy"'))).toBe(false);
  });
});
