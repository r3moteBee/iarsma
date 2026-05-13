/**
 * Tests for buildReplyPrefill (Phase 2 work item 5).
 *
 * Pure function — no React, no DOM. Covers:
 *   - subject prefixing + dedup
 *   - recipient rules per mode (reply, reply-all, forward)
 *   - user-email excluded from computed recipients
 *   - quoted body via blockquote contenteditable=false
 *   - In-Reply-To from messageId, References extension
 *   - HTML body preserved; text-only fallback wraps in <pre>
 *   - forward has empty recipients and no thread linkage
 */

import { describe, expect, it } from 'vitest';
import { buildReplyPrefill } from '../reply-prefill.js';
import type { EmailFull } from '../../runtime/jmap-client.js';

function email(over: Partial<EmailFull> = {}): EmailFull {
  return {
    id: 'E-1',
    threadId: 'T-1',
    from: [{ name: 'Bob', email: 'bob@example.net' }],
    to: [
      { name: 'Alice', email: 'alice@example.net' },
      { email: 'brent@r3motely.net' },
    ],
    cc: [{ email: 'carol@example.net' }],
    subject: 'Project plan',
    preview: 'Hi everyone — here is the plan.',
    receivedAt: '2026-05-09T15:42:11Z',
    keywords: [{ name: '$seen', value: true }],
    size: 1024,
    bodyHtml: '<p>Hi everyone — here is the plan.</p>',
    attachments: [],
    messageId: ['<bob-001@example.net>'],
    inReplyTo: [],
    references: [],
    ...over,
  };
}

describe('buildReplyPrefill — subject prefix', () => {
  it('reply prepends "Re: " when subject lacks it', () => {
    const r = buildReplyPrefill({
      email: email(),
      mode: 'reply',
      userEmail: 'brent@r3motely.net',
    });
    expect(r.subject).toBe('Re: Project plan');
  });

  it('reply leaves the subject alone when it already starts with "Re:" (any case)', () => {
    const r = buildReplyPrefill({
      email: email({ subject: 'Re: Project plan' }),
      mode: 'reply',
      userEmail: 'brent@r3motely.net',
    });
    expect(r.subject).toBe('Re: Project plan');

    const r2 = buildReplyPrefill({
      email: email({ subject: 'RE: Project plan' }),
      mode: 'reply',
      userEmail: 'brent@r3motely.net',
    });
    expect(r2.subject).toBe('RE: Project plan');
  });

  it('forward prepends "Fwd: " when subject lacks it', () => {
    const r = buildReplyPrefill({
      email: email(),
      mode: 'forward',
      userEmail: 'brent@r3motely.net',
    });
    expect(r.subject).toBe('Fwd: Project plan');
  });
});

describe('buildReplyPrefill — recipients', () => {
  it('reply sets to = sender, no cc', () => {
    const r = buildReplyPrefill({
      email: email(),
      mode: 'reply',
      userEmail: 'brent@r3motely.net',
    });
    expect(r.to).toEqual([{ name: 'Bob', email: 'bob@example.net' }]);
    expect(r.cc).toBeUndefined();
  });

  it('reply-all sets to = sender, cc = original to + cc (minus self, deduped)', () => {
    const r = buildReplyPrefill({
      email: email(),
      mode: 'reply-all',
      userEmail: 'brent@r3motely.net',
    });
    expect(r.to).toEqual([{ name: 'Bob', email: 'bob@example.net' }]);
    // Alice was in original `to`; brent is self (excluded); carol was in cc.
    expect(r.cc).toEqual([
      { name: 'Alice', email: 'alice@example.net' },
      { email: 'carol@example.net' },
    ]);
  });

  it('reply-all dedups when sender also appears in original to/cc', () => {
    const r = buildReplyPrefill({
      email: email({
        from: [{ email: 'alice@example.net' }],
        to: [{ name: 'Alice', email: 'alice@example.net' }],
      }),
      mode: 'reply-all',
      userEmail: 'brent@r3motely.net',
    });
    expect(r.to).toEqual([{ email: 'alice@example.net' }]);
    expect(r.cc).toEqual([{ email: 'carol@example.net' }]);
  });

  it('reply excludes self when sender is the current user', () => {
    const r = buildReplyPrefill({
      email: email({ from: [{ email: 'brent@r3motely.net' }] }),
      mode: 'reply',
      userEmail: 'brent@r3motely.net',
    });
    expect(r.to).toBeUndefined();
  });

  it('forward leaves recipients empty', () => {
    const r = buildReplyPrefill({
      email: email(),
      mode: 'forward',
      userEmail: 'brent@r3motely.net',
    });
    expect(r.to).toBeUndefined();
    expect(r.cc).toBeUndefined();
  });
});

describe('buildReplyPrefill — quoted body', () => {
  it('wraps the original html body in a contenteditable=false blockquote', () => {
    const r = buildReplyPrefill({
      email: email(),
      mode: 'reply',
      userEmail: 'brent@r3motely.net',
    });
    expect(r.bodyHtml).toContain('<blockquote contenteditable="false">');
    expect(r.bodyHtml).toContain('Bob &lt;bob@example.net&gt;');
    expect(r.bodyHtml).toContain('2026-05-09T15:42:11Z');
    expect(r.bodyHtml).toContain('Hi everyone — here is the plan.');
  });

  it('falls back to wrapping bodyText in <pre> when bodyHtml is absent', () => {
    const { bodyHtml: _html, ...rest } = email();
    const r = buildReplyPrefill({
      email: { ...(rest as EmailFull), bodyText: 'plain text body' },
      mode: 'reply',
      userEmail: 'brent@r3motely.net',
    });
    expect(r.bodyHtml).toContain('<pre>plain text body</pre>');
  });

  it('escapes HTML in the attribution line', () => {
    const r = buildReplyPrefill({
      email: email({ from: [{ name: 'Carol <evil>', email: 'a@b.c' }] }),
      mode: 'reply',
      userEmail: 'brent@r3motely.net',
    });
    expect(r.bodyHtml).toContain('Carol &lt;evil&gt;');
    expect(r.bodyHtml).not.toContain('Carol <evil>');
  });
});

describe('buildReplyPrefill — thread linkage', () => {
  it('reply sets inReplyTo to the original messageId[0]', () => {
    const r = buildReplyPrefill({
      email: email(),
      mode: 'reply',
      userEmail: 'brent@r3motely.net',
    });
    expect(r.inReplyTo).toBe('<bob-001@example.net>');
  });

  it('reply extends references with the messageId when not already there', () => {
    const r = buildReplyPrefill({
      email: email({
        references: ['<thread-root@example.net>', '<reply-1@example.net>'],
      }),
      mode: 'reply',
      userEmail: 'brent@r3motely.net',
    });
    expect(r.references).toBe(
      '<thread-root@example.net> <reply-1@example.net> <bob-001@example.net>',
    );
  });

  it('reply does not duplicate the messageId in references when already present', () => {
    const r = buildReplyPrefill({
      email: email({ references: ['<bob-001@example.net>'] }),
      mode: 'reply',
      userEmail: 'brent@r3motely.net',
    });
    expect(r.references).toBe('<bob-001@example.net>');
  });

  it('forward omits inReplyTo and references (forward starts a new chain)', () => {
    const r = buildReplyPrefill({
      email: email(),
      mode: 'forward',
      userEmail: 'brent@r3motely.net',
    });
    expect(r.inReplyTo).toBeUndefined();
    expect(r.references).toBeUndefined();
  });

  it('omits inReplyTo + references entirely when the source has no messageId', () => {
    const r = buildReplyPrefill({
      email: email({ messageId: [] }),
      mode: 'reply',
      userEmail: 'brent@r3motely.net',
    });
    expect(r.inReplyTo).toBeUndefined();
    expect(r.references).toBeUndefined();
  });
});
