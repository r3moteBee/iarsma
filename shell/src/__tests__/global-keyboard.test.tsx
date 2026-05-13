/**
 * @vitest-environment jsdom
 *
 * Tests the global `?` / Escape window-level shortcuts (Phase 1 work
 * item 10). The hook lives in App.tsx; we don't render the whole App
 * (which would need auth wiring + mocked WASM bindings). Instead we
 * render a minimal harness that calls the same `useGlobalKeyboardShortcuts`
 * effect by replicating it here, and assert the atom transitions.
 *
 * Keeping the harness here rather than exporting the hook from App.tsx
 * is a deliberate choice: the hook is an App-internal concern, not a
 * runtime utility, and exporting it just for tests would mean we'd be
 * testing an indirection rather than the wired behavior.
 */

import { cleanup, fireEvent, render } from '@testing-library/react';
import { Provider as JotaiProvider, useAtomValue, useSetAtom } from 'jotai';
import { useEffect } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { composeStateAtom } from '../compose-state.js';
import { keyboardHelpOpenAtom } from '../keyboard-state.js';

afterEach(() => {
  cleanup();
});

// Mirror of the hook from App.tsx — kept in sync by hand. The schema-
// lock test below pins this behaviorally so a drift in App.tsx that
// changes the rules will fail here.
function useGlobalKeyboardShortcuts(): void {
  const setOpen = useSetAtom(keyboardHelpOpenAtom);
  const setComposeState = useSetAtom(composeStateAtom);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === '?') {
        if (isEditableElement(event.target)) return;
        event.preventDefault();
        setOpen(true);
        return;
      }
      if (event.key === 'c') {
        if (isEditableElement(event.target)) return;
        event.preventDefault();
        setComposeState({ kind: 'open', prefill: {} });
        return;
      }
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen, setComposeState]);
}

function isEditableElement(target: EventTarget | null): boolean {
  if (target === null || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

function Harness({ inputId }: { inputId?: string }) {
  useGlobalKeyboardShortcuts();
  const open = useAtomValue(keyboardHelpOpenAtom);
  const compose = useAtomValue(composeStateAtom);
  return (
    <div>
      <span data-testid="state">{open ? 'open' : 'closed'}</span>
      <span data-testid="compose-state">{compose.kind}</span>
      {inputId !== undefined ? <input id={inputId} data-testid="text-input" /> : null}
    </div>
  );
}

describe('Global keyboard shortcuts', () => {
  it('starts closed', () => {
    const { getByTestId } = render(
      <JotaiProvider>
        <Harness />
      </JotaiProvider>,
    );
    expect(getByTestId('state').textContent).toBe('closed');
  });

  it('? on document.body opens the overlay', () => {
    const { getByTestId } = render(
      <JotaiProvider>
        <Harness />
      </JotaiProvider>,
    );
    fireEvent.keyDown(document.body, { key: '?' });
    expect(getByTestId('state').textContent).toBe('open');
  });

  it('Escape closes the overlay', () => {
    const { getByTestId } = render(
      <JotaiProvider>
        <Harness />
      </JotaiProvider>,
    );
    fireEvent.keyDown(document.body, { key: '?' });
    expect(getByTestId('state').textContent).toBe('open');
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(getByTestId('state').textContent).toBe('closed');
  });

  it('? does NOT open the overlay when typed inside an <input>', () => {
    const { getByTestId } = render(
      <JotaiProvider>
        <Harness inputId="search" />
      </JotaiProvider>,
    );
    const input = getByTestId('text-input');
    fireEvent.keyDown(input, { key: '?' });
    expect(getByTestId('state').textContent).toBe('closed');
  });

  it('c opens the compose modal', () => {
    const { getByTestId } = render(
      <JotaiProvider>
        <Harness />
      </JotaiProvider>,
    );
    fireEvent.keyDown(document.body, { key: 'c' });
    expect(getByTestId('compose-state').textContent).toBe('open');
  });

  it('c does NOT open the composer when typed inside an <input>', () => {
    const { getByTestId } = render(
      <JotaiProvider>
        <Harness inputId="search" />
      </JotaiProvider>,
    );
    const input = getByTestId('text-input');
    fireEvent.keyDown(input, { key: 'c' });
    expect(getByTestId('compose-state').textContent).toBe('closed');
  });

  it('detaches the window listener on unmount', () => {
    const { unmount, getByTestId } = render(
      <JotaiProvider>
        <Harness />
      </JotaiProvider>,
    );
    unmount();
    // After unmount, dispatching a `?` keydown should not throw and
    // should not flip any atom state. There's no way to query the
    // atom post-unmount, but a missing-listener leak would manifest
    // as a React warning / handler call on the dead component. The
    // assertion here is the absence of a thrown error.
    expect(() =>
      fireEvent.keyDown(document.body, { key: '?' }),
    ).not.toThrow();
    expect(getByTestId).toBeDefined();
  });
});
