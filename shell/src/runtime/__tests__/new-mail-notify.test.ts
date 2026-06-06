// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import { updateTabTitle, announceNewMail, announceUnreadDelta } from '../new-mail-notify.js';

describe('updateTabTitle', () => {
  beforeEach(() => {
    document.title = 'Iarsma';
  });

  it('prepends unread count when > 0', () => {
    updateTabTitle(3);
    expect(document.title).toBe('(3) Iarsma');
  });

  it('resets to plain title when count is 0', () => {
    updateTabTitle(3);
    updateTabTitle(0);
    expect(document.title).toBe('Iarsma');
  });
});

describe('announceNewMail', () => {
  it('creates a live region and sets text content', () => {
    announceNewMail('alice@example.com');
    const el = document.querySelector('[aria-live="polite"]');
    expect(el).not.toBeNull();
    expect(el!.textContent).toBe('New message from alice@example.com');
  });
});

describe('announceUnreadDelta', () => {
  it('announces singular for delta=1', () => {
    announceUnreadDelta(1);
    const el = document.querySelector('[aria-live="polite"]');
    expect(el!.textContent).toBe('1 new message in Inbox.');
  });

  it('announces plural for delta>1', () => {
    announceUnreadDelta(3);
    const el = document.querySelector('[aria-live="polite"]');
    expect(el!.textContent).toBe('3 new messages in Inbox.');
  });

  it('is a no-op for delta<=0', () => {
    // Clear any prior announcement first by setting via singular case.
    announceUnreadDelta(1);
    announceUnreadDelta(0);
    announceUnreadDelta(-2);
    const el = document.querySelector('[aria-live="polite"]');
    // Stays at the last actual announcement; doesn't get wiped.
    expect(el!.textContent).toBe('1 new message in Inbox.');
  });
});
