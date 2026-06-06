/**
 * @vitest-environment jsdom
 *
 * Tests for the Inbox unread badge on the Mail nav row (PR 37 /
 * Phase 3 #9). Live region + document.title behavior is covered in
 * App-level tests; this file is just the Sidebar component contract.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Sidebar } from '../sidebar.js';

const BASE_PROPS = {
  activeView: 'mail' as const,
  onNavigate: () => {},
  onCompose: () => {},
  onSignOut: () => {},
  theme: 'system' as const,
  onThemeChange: () => {},
};

afterEach(cleanup);

describe('Sidebar — Mail unread badge (PR 37)', () => {
  it('shows no badge when inboxUnreadCount is 0', () => {
    render(<Sidebar {...BASE_PROPS} inboxUnreadCount={0} />);
    const btn = screen.getByTestId('nav-mail');
    expect(btn).toBeInTheDocument();
    // No aria-label override → falls back to the default text label.
    expect(btn.getAttribute('aria-label')).toBeNull();
    expect(btn.textContent).not.toContain('5');
  });

  it('shows no badge when inboxUnreadCount is undefined', () => {
    render(<Sidebar {...BASE_PROPS} />);
    const btn = screen.getByTestId('nav-mail');
    expect(btn.getAttribute('aria-label')).toBeNull();
  });

  it('renders a count badge + aria "unread" suffix when inboxUnreadCount > 0', () => {
    render(<Sidebar {...BASE_PROPS} inboxUnreadCount={7} />);
    const btn = screen.getByTestId('nav-mail');
    expect(btn).toHaveAttribute('aria-label', 'Mail (7 unread)');
    expect(btn.textContent).toContain('7');
  });

  it('Outbox badge still works alongside the Mail badge (independent prop)', () => {
    render(
      <Sidebar
        {...BASE_PROPS}
        inboxUnreadCount={4}
        outboxCount={2}
      />,
    );
    expect(screen.getByTestId('nav-mail')).toHaveAttribute(
      'aria-label',
      'Mail (4 unread)',
    );
    expect(screen.getByTestId('nav-outbox')).toHaveAttribute(
      'aria-label',
      'Outbox (2 pending)',
    );
  });
});
