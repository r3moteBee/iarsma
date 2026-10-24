import { describe, it, expect } from 'vitest';
import { parseEventUpdateResponse, parseEventDeleteResponse } from '../jmap-client.js';

const wrap = (method: string, result: unknown) =>
  JSON.stringify({ methodResponses: [[method, result, '0']] });

describe('event parsers — event_not_found mapping', () => {
  it('update: notFound → event_not_found', () => {
    expect.assertions(2);
    const body = wrap('CalendarEvent/set', { notUpdated: { ev1: { type: 'notFound' } } });
    expect(() => parseEventUpdateResponse(body)).toThrowError(/not found|event_not_found/i);
    try { parseEventUpdateResponse(body); } catch (e) { expect((e as { code: string }).code).toBe('event_not_found'); }
  });

  it('update: other rejection stays jmap_set_error', () => {
    expect.assertions(1);
    const body = wrap('CalendarEvent/set', { notUpdated: { ev1: { type: 'forbidden' } } });
    try { parseEventUpdateResponse(body); } catch (e) { expect((e as { code: string }).code).toBe('jmap_set_error'); }
  });

  it('delete: notFound → event_not_found', () => {
    expect.assertions(1);
    const body = wrap('CalendarEvent/set', { notDestroyed: { ev1: { type: 'notFound' } } });
    try { parseEventDeleteResponse(body); } catch (e) { expect((e as { code: string }).code).toBe('event_not_found'); }
  });

  it('delete: success returns {deleted:true}', () => {
    const body = wrap('CalendarEvent/set', { destroyed: ['ev1'] });
    expect(parseEventDeleteResponse(body)).toEqual({ deleted: true });
  });

  it('update: success returns {updated:true}', () => {
    const body = wrap('CalendarEvent/set', { updated: { ev1: null } });
    expect(parseEventUpdateResponse(body)).toEqual({ updated: true });
  });
});
