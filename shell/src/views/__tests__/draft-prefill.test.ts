/**
 * Tests for buildDraftPrefill (Phase 2 work item 8).
 *
 * Differs from buildReplyPrefill in three ways the assertions pin:
 *   - subject is NOT prefixed (no Re: / Fwd:)
 *   - body is the verbatim original (no <blockquote> wrapping)
 *   - threading headers (inReplyTo / references) preserved when the
 *     draft was started as a reply
 */

import { describe, expect, it } from 'vitest';
import { buildDraftPrefill } from '../draft-prefill.js';
import type { EmailFull } from '../../runtime/jmap-client.js';

function email(over: Partial<EmailFull> = {}): EmailFull {
  return {
    id: 'E-draft',
    threadId: 'T-draft',
    from: [{ email: 'brent@example.net' }],
    to: [{ email: 'alice@example.net' }],
    subject: 'project plan',
    preview: '',
    receivedAt: '2026-05-12T00:00:00Z',
    keywords: [{ name: '$draft', value: true }],
    size: 1024,
    bodyHtml: '<p>Hi Alice — here is the plan.</p>',
    attachments: [],
    messageId: ['<draft-1@example.net>'],
    inReplyTo: [],
    references: [],
    ...over,
  };
}

describe('buildDraftPrefill — subject + body', () => {
  it('uses the subject verbatim — no Re: / Fwd: prefix', () => {
    expect(buildDraftPrefill(email()).subject).toBe('project plan');
  });

  it('uses bodyHtml verbatim (no blockquote / attribution wrapping)', () => {
    const p = buildDraftPrefill(email());
    expect(p.bodyHtml).toBe('<p>Hi Alice — here is the plan.</p>');
    expect(p.bodyHtml).not.toContain('blockquote');
  });

  it('uses bodyText when bodyHtml is absent', () => {
    const { bodyHtml: _h, ...rest } = email();
    const p = buildDraftPrefill({
      ...(rest as EmailFull),
      bodyText: 'plain only',
    });
    expect(p.bodyText).toBe('plain only');
    expect(p.bodyHtml).toBeUndefined();
  });
});

describe('buildDraftPrefill — recipients', () => {
  it('preserves to / cc / bcc verbatim', () => {
    const p = buildDraftPrefill(
      email({
        cc: [{ email: 'carol@example.net' }],
        bcc: [{ email: 'bcc@example.net' }],
      }),
    );
    expect(p.to).toEqual([{ email: 'alice@example.net' }]);
    expect(p.cc).toEqual([{ email: 'carol@example.net' }]);
    expect(p.bcc).toEqual([{ email: 'bcc@example.net' }]);
  });

  it('omits empty recipient lists', () => {
    const { to: _to, cc: _cc, ...rest } = email();
    const p = buildDraftPrefill(rest as EmailFull);
    expect(p.to).toBeUndefined();
    expect(p.cc).toBeUndefined();
  });
});

describe('buildDraftPrefill — threading', () => {
  it('preserves inReplyTo + references when the draft was started as a reply', () => {
    const p = buildDraftPrefill(
      email({
        inReplyTo: ['<original@example.net>'],
        references: ['<root@example.net>', '<original@example.net>'],
      }),
    );
    expect(p.inReplyTo).toBe('<original@example.net>');
    expect(p.references).toBe(
      '<root@example.net> <original@example.net>',
    );
  });

  it('omits both when the draft has no thread linkage', () => {
    const p = buildDraftPrefill(email());
    expect(p.inReplyTo).toBeUndefined();
    expect(p.references).toBeUndefined();
  });
});
