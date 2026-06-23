/**
 * @vitest-environment jsdom
 *
 * P1.3 — discoverable Help entry. A persistent, visible button in the
 * sidebar footer opens the keyboard-shortcuts overlay, so users find
 * help without already knowing the `?` shortcut.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

describe('Sidebar — Help entry (P1.3)', () => {
  it('renders a persistent Help button', () => {
    render(<Sidebar {...BASE_PROPS} />);
    expect(
      screen.getByRole('button', { name: /help|shortcut/i }),
    ).toBeInTheDocument();
  });

  it('invokes onOpenHelp when clicked', () => {
    const onOpenHelp = vi.fn();
    render(<Sidebar {...BASE_PROPS} onOpenHelp={onOpenHelp} />);
    fireEvent.click(screen.getByRole('button', { name: /help|shortcut/i }));
    expect(onOpenHelp).toHaveBeenCalledTimes(1);
  });
});
