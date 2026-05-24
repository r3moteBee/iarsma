// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import { updateTabTitle, announceNewMail } from '../new-mail-notify.js';

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
