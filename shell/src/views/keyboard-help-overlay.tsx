/**
 * KeyboardHelpOverlay — modal listing every wired binding (Phase 1
 * work item 10). Triggered by the global `?` key; dismissed by Escape
 * or click outside the dialog.
 *
 * ARIA: modal dialog pattern. The dialog gets focus on open; closing
 * restores focus to whatever was active before. We do NOT implement a
 * full focus trap (Tab cycling within the dialog) — there's nothing
 * focusable inside except the close button, and Tab landing on the
 * browser chrome is the right behavior. If/when the overlay grows
 * interactive content, swap in a real focus-trap library.
 *
 * State lives in `keyboardHelpOpenAtom` so any component can open it.
 * The window-level `?` listener is wired in `App.tsx`.
 */

import { useAtom } from 'jotai';
import { useEffect, useRef } from 'react';
import {
  KEYBOARD_BINDINGS,
  SCOPE_LABELS,
  bindingsByScope,
  type BindingScope,
} from '../runtime/keyboard-bindings.js';
import { keyboardHelpOpenAtom } from '../keyboard-state.js';

export function KeyboardHelpOverlay() {
  const [open, setOpen] = useAtom(keyboardHelpOpenAtom);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // On open: remember the previously-focused element and move focus
  // into the dialog. On close: restore focus.
  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current =
      typeof document !== 'undefined'
        ? (document.activeElement as HTMLElement | null)
        : null;
    dialogRef.current?.focus();
    return () => {
      previouslyFocusedRef.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  const grouped = bindingsByScope();
  // Stable display order matches the order of declarations in
  // KEYBOARD_BINDINGS (Map preserves insertion order).
  const scopes = [...grouped.keys()];

  return (
    <div
      role="presentation"
      onClick={(e) => {
        // Click on the backdrop (this div) — but not on the dialog —
        // closes the overlay. The dialog stops propagation.
        if (e.target === e.currentTarget) setOpen(false);
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="keyboard-help-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--surface-1)',
          color: 'var(--text-1)',
          maxWidth: '40em',
          maxHeight: '85vh',
          overflow: 'auto',
          padding: '1.25em',
          borderRadius: 8,
          border: '1px solid var(--border)',
          boxShadow: 'var(--shadow-md)',
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            marginBottom: '0.75em',
          }}
        >
          <h2 id="keyboard-help-title" style={{ margin: 0 }}>
            Keyboard shortcuts
          </h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close keyboard shortcuts"
            style={{
              background: 'none',
              color: 'var(--text-1)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: '0.25em 0.5em',
              cursor: 'pointer',
            }}
          >
            Close (Esc)
          </button>
        </header>
        {scopes.map((scope) => (
          <BindingGroup
            key={scope}
            scope={scope}
            bindings={grouped.get(scope) ?? []}
          />
        ))}
        <p style={{ marginTop: '1em', color: 'var(--text-2)', fontSize: '0.9em' }}>
          See <code>docs/keyboard.md</code> for the full reference, including
          reserved bindings for future capabilities.
        </p>
      </div>
    </div>
  );
}

function BindingGroup(props: {
  readonly scope: BindingScope;
  readonly bindings: ReadonlyArray<{ keys: string; action: string }>;
}) {
  return (
    <section aria-labelledby={`kbd-group-${props.scope}`}>
      <h3
        id={`kbd-group-${props.scope}`}
        style={{ margin: '0.75em 0 0.25em', fontSize: '1em' }}
      >
        {SCOPE_LABELS[props.scope]}
      </h3>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          {props.bindings.map((b) => (
            <tr
              key={`${b.keys}|${b.action}`}
              style={{ borderTop: '1px solid var(--border)' }}
            >
              <th
                scope="row"
                style={{
                  textAlign: 'left',
                  width: '12em',
                  padding: '0.25em 0',
                  fontFamily:
                    'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
                  fontWeight: 'normal',
                }}
              >
                <kbd>{b.keys}</kbd>
              </th>
              <td style={{ padding: '0.25em 0', color: 'var(--text-1)' }}>
                {b.action}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** Re-export so tests can assert the lock between this overlay and the
 *  source-of-truth bindings list. */
export { KEYBOARD_BINDINGS };
