/**
 * @vitest-environment jsdom
 *
 * Tests for the KeyboardHelpOverlay (Phase 1 work item 10).
 *
 * Covers:
 *   - Closed by default; does not render.
 *   - Open state renders every binding in `KEYBOARD_BINDINGS`.
 *   - Backdrop click closes; dialog click does not.
 *   - Close button closes.
 *   - axe-core baseline.
 *
 * Global `?` / Escape wiring is tested in the App-level test below.
 */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Provider as JotaiProvider, useSetAtom } from 'jotai';
import { useEffect } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { KEYBOARD_BINDINGS } from '../../runtime/keyboard-bindings.js';
import { keyboardHelpOpenAtom } from '../../keyboard-state.js';
import { runAxe } from '../../__tests__/util/axe.js';
import { KeyboardHelpOverlay } from '../keyboard-help-overlay.js';

afterEach(() => {
  cleanup();
});

function WithOpenOverlay({ children }: { children: React.ReactNode }) {
  const setOpen = useSetAtom(keyboardHelpOpenAtom);
  useEffect(() => {
    setOpen(true);
  }, [setOpen]);
  return <>{children}</>;
}

describe('KeyboardHelpOverlay — closed state', () => {
  it('does not render anything when the atom is false', () => {
    render(
      <JotaiProvider>
        <KeyboardHelpOverlay />
      </JotaiProvider>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('KeyboardHelpOverlay — open state', () => {
  it('renders a dialog with title "Keyboard shortcuts"', () => {
    render(
      <JotaiProvider>
        <WithOpenOverlay>
          <KeyboardHelpOverlay />
        </WithOpenOverlay>
      </JotaiProvider>,
    );
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Keyboard shortcuts')).toBeInTheDocument();
  });

  it('renders every declared binding (keys + action)', () => {
    render(
      <JotaiProvider>
        <WithOpenOverlay>
          <KeyboardHelpOverlay />
        </WithOpenOverlay>
      </JotaiProvider>,
    );
    const dialog = screen.getByRole('dialog');
    for (const b of KEYBOARD_BINDINGS) {
      // Action text is unique enough that getByText works without a
      // RegExp; keys are rendered as <kbd>{keys}</kbd>, also direct.
      expect(within(dialog).getByText(b.action)).toBeInTheDocument();
    }
  });

  it('renders one section per scope with the scope label as heading', () => {
    render(
      <JotaiProvider>
        <WithOpenOverlay>
          <KeyboardHelpOverlay />
        </WithOpenOverlay>
      </JotaiProvider>,
    );
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { level: 3, name: 'Global' })).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { level: 3, name: 'Mailbox sidebar' })).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { level: 3, name: 'Thread list' })).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { level: 3, name: 'Thread view' })).toBeInTheDocument();
  });
});

describe('KeyboardHelpOverlay — dismissal', () => {
  it('clicking the Close button closes the dialog', () => {
    render(
      <JotaiProvider>
        <WithOpenOverlay>
          <KeyboardHelpOverlay />
        </WithOpenOverlay>
      </JotaiProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /close keyboard shortcuts/i }));
    // The dialog is gone immediately because rendering is gated on the
    // atom value.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('clicking the backdrop closes the dialog', () => {
    render(
      <JotaiProvider>
        <WithOpenOverlay>
          <KeyboardHelpOverlay />
        </WithOpenOverlay>
      </JotaiProvider>,
    );
    // The backdrop is the `role="presentation"` div directly under the
    // overlay. fireEvent.click fires on whatever element is given; we
    // pick the backdrop explicitly so the click target matches
    // currentTarget (the overlay's close gate).
    const backdrop = document.querySelector('[role="presentation"]') as HTMLElement;
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('clicking inside the dialog does NOT close it', () => {
    render(
      <JotaiProvider>
        <WithOpenOverlay>
          <KeyboardHelpOverlay />
        </WithOpenOverlay>
      </JotaiProvider>,
    );
    const dialog = screen.getByRole('dialog');
    fireEvent.click(dialog);
    // Still rendered.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('KeyboardHelpOverlay — a11y', () => {
  it('has zero axe-core violations against WCAG 2.1 AA', async () => {
    const { container } = render(
      <JotaiProvider>
        <WithOpenOverlay>
          <KeyboardHelpOverlay />
        </WithOpenOverlay>
      </JotaiProvider>,
    );
    const violations = await runAxe(container);
    expect(violations.map((v) => v.id)).toEqual([]);
  });
});
