/**
 * @vitest-environment jsdom
 *
 * Tests for the Outbox nav item in Sidebar (PR 27).
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

describe('Sidebar — Outbox nav (PR 27)', () => {
  it('hides the Outbox row when outboxCount is 0 or undefined', () => {
    render(<Sidebar {...BASE_PROPS} outboxCount={0} />);
    expect(screen.queryByTestId('nav-outbox')).not.toBeInTheDocument();
  });

  it('shows the Outbox row + a count badge when outboxCount > 0', () => {
    render(<Sidebar {...BASE_PROPS} outboxCount={3} />);
    const btn = screen.getByTestId('nav-outbox');
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute('aria-label', 'Outbox (3 pending)');
    expect(btn.textContent).toContain('3');
  });

  it('keeps the Outbox row visible when active even if count drops to 0', () => {
    // Pre-condition: user navigated to outbox while there was a hold,
    // then cancelled it. The nav row must stay so they can navigate
    // back out without it disappearing under their cursor.
    render(
      <Sidebar
        {...BASE_PROPS}
        activeView="outbox"
        outboxCount={0}
      />,
    );
    expect(screen.getByTestId('nav-outbox')).toBeInTheDocument();
  });
});
