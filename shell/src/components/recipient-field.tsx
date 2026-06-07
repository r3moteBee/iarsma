/**
 * RecipientField — text input with contact autocomplete (PR 47).
 *
 * Wraps the existing comma-separated recipient input that
 * compose-view.tsx uses. Reads contacts via `useContactList`, watches
 * the substring after the last comma as the user types, and shows
 * matching contacts in a dropdown. Arrow keys navigate, Enter/Tab
 * commits, Escape closes. The committed entry replaces the current
 * term with `Name <email>, ` so the user can keep typing.
 *
 * Validation behavior moved (PR 47 / CoWork #3): the parent decides
 * when to show errors. This component just owns the input value +
 * the suggestion popup; it does not render validation messages.
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { useContactList } from '../generated/capabilities/contact-list.js';

export type RecipientSuggestion = {
  readonly displayName: string;
  readonly email: string;
};

export type RecipientFieldProps = {
  readonly id: string;
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly onBlur?: (() => void) | undefined;
  readonly placeholder?: string | undefined;
  readonly className?: string | undefined;
  readonly ariaInvalid?: boolean | undefined;
  readonly ariaDescribedBy?: string | undefined;
};

// ── Pure helpers (also exported for unit testing) ────────────────

/**
 * Given the input value and the cursor position, return the
 * substring that the user is currently typing — i.e. everything
 * between the last comma before the cursor and the cursor itself.
 */
export function currentTerm(value: string, cursor: number): string {
  const upToCursor = value.slice(0, cursor);
  const lastComma = upToCursor.lastIndexOf(',');
  const start = lastComma === -1 ? 0 : lastComma + 1;
  return upToCursor.slice(start).trimStart();
}

/**
 * Replace the current term (the substring after the last comma
 * before the cursor) with a `Name <email>, ` chip. Returns the new
 * value + the new cursor position. The trailing `, ` lets the user
 * keep typing the next recipient without manual punctuation.
 */
export function applySuggestion(
  value: string,
  cursor: number,
  suggestion: RecipientSuggestion,
): { readonly value: string; readonly cursor: number } {
  const upToCursor = value.slice(0, cursor);
  const lastComma = upToCursor.lastIndexOf(',');
  const before = lastComma === -1
    ? ''
    : value.slice(0, lastComma + 1).replace(/\s+$/, '') + ' ';
  const after = value.slice(cursor);
  const chip = suggestion.displayName !== ''
    ? `${suggestion.displayName} <${suggestion.email}>`
    : suggestion.email;
  const next = `${before}${chip}, ${after.replace(/^\s+/, '')}`;
  return { value: next, cursor: before.length + chip.length + 2 };
}

/**
 * Score a candidate against the typed term. Higher is better.
 *   - exact email match (case-insensitive): 100
 *   - email starts with term:                80
 *   - name starts with term:                 70
 *   - email contains term:                   40
 *   - name contains term:                    30
 *   - no match:                              -1 (caller filters)
 */
export function scoreSuggestion(
  s: RecipientSuggestion,
  term: string,
): number {
  if (term === '') return -1;
  const t = term.toLowerCase();
  const e = s.email.toLowerCase();
  const n = s.displayName.toLowerCase();
  if (e === t) return 100;
  if (e.startsWith(t)) return 80;
  if (n.startsWith(t)) return 70;
  if (e.includes(t)) return 40;
  if (n.includes(t)) return 30;
  return -1;
}

// ── Component ────────────────────────────────────────────────────

const MAX_SUGGESTIONS = 6;

type Contact = {
  id: string;
  name?: { full?: string; given?: string; surname?: string };
  emails?: Array<{ address: string; label?: string }>;
};

function flattenContacts(contacts: ReadonlyArray<Contact>): RecipientSuggestion[] {
  const out: RecipientSuggestion[] = [];
  for (const c of contacts) {
    const display =
      c.name?.full ??
      [c.name?.given, c.name?.surname].filter(Boolean).join(' ') ??
      '';
    for (const e of c.emails ?? []) {
      out.push({ displayName: display, email: e.address });
    }
  }
  return out;
}

export function RecipientField({
  id,
  value,
  onChange,
  onBlur,
  placeholder,
  className,
  ariaInvalid,
  ariaDescribedBy,
}: RecipientFieldProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const contactsHook = useContactList({});
  const allSuggestions = useMemo<RecipientSuggestion[]>(
    () => flattenContacts(((contactsHook.data ?? { contacts: [] }).contacts) as Contact[]),
    [contactsHook.data],
  );

  // Cursor position and the candidate matches at that cursor.
  const [cursor, setCursor] = useState(value.length);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);

  const term = useMemo(() => currentTerm(value, cursor), [value, cursor]);
  const matches = useMemo<RecipientSuggestion[]>(() => {
    if (term === '') return [];
    const scored = allSuggestions
      .map((s) => ({ s, score: scoreSuggestion(s, term) }))
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_SUGGESTIONS)
      .map((x) => x.s);
    return scored;
  }, [allSuggestions, term]);

  // Reset active index when matches change; close when none.
  useEffect(() => {
    if (matches.length === 0) {
      setOpen(false);
      setActiveIdx(0);
    } else {
      setOpen(true);
      setActiveIdx((i) => Math.min(i, matches.length - 1));
    }
  }, [matches]);

  const commit = useCallback(
    (suggestion: RecipientSuggestion) => {
      const next = applySuggestion(value, cursor, suggestion);
      onChange(next.value);
      setOpen(false);
      // Re-focus + restore cursor on the next tick once React has
      // applied the controlled value.
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (el !== null) {
          el.focus();
          el.setSelectionRange(next.cursor, next.cursor);
          setCursor(next.cursor);
        }
      });
    },
    [value, cursor, onChange],
  );

  const handleChange = (e: ChangeEvent<HTMLInputElement>): void => {
    onChange(e.target.value);
    setCursor(e.target.selectionStart ?? e.target.value.length);
  };

  const handleKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (!open || matches.length === 0) return;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIdx((i) => (i + 1) % matches.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIdx((i) => (i - 1 + matches.length) % matches.length);
        break;
      case 'Enter':
      case 'Tab': {
        const pick = matches[activeIdx];
        if (pick !== undefined) {
          e.preventDefault();
          commit(pick);
        }
        break;
      }
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        break;
    }
  };

  const listboxId = useId();

  // Inline-style suggestion popup. CSS Modules are the project
  // pattern but a single-component popup with no theme coupling
  // works fine inline and avoids a new .module.css just for this.
  const popupStyle: CSSProperties = {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    zIndex: 10,
    margin: 0,
    padding: '0.25em 0',
    listStyle: 'none',
    background: 'var(--surface-1)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    boxShadow: '0 4px 12px color-mix(in srgb, var(--fg) 12%, transparent)',
    maxHeight: '14em',
    overflowY: 'auto',
  };

  return (
    <span style={{ position: 'relative', display: 'block' }}>
      <input
        ref={inputRef}
        id={id}
        type="text"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKey}
        onBlur={(e) => {
          // Delay close so click-on-suggestion fires first.
          setTimeout(() => setOpen(false), 100);
          onBlur?.();
          setCursor(e.target.selectionStart ?? e.target.value.length);
        }}
        onSelect={(e) => {
          const el = e.currentTarget;
          setCursor(el.selectionStart ?? el.value.length);
        }}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
        role="combobox"
        aria-expanded={open && matches.length > 0}
        aria-controls={listboxId}
        aria-autocomplete="list"
        {...(ariaInvalid !== undefined ? { 'aria-invalid': ariaInvalid } : {})}
        {...(ariaDescribedBy !== undefined ? { 'aria-describedby': ariaDescribedBy } : {})}
      />
      {open && matches.length > 0 ? (
        <ul
          id={listboxId}
          role="listbox"
          style={popupStyle}
          data-testid={`${id}-suggestions`}
        >
          {matches.map((m, i) => (
            <li
              key={`${m.email}-${i}`}
              role="option"
              aria-selected={i === activeIdx}
              onMouseDown={(e) => {
                // mousedown so we beat the input's blur.
                e.preventDefault();
                commit(m);
              }}
              onMouseEnter={() => setActiveIdx(i)}
              style={{
                padding: '0.35em 0.75em',
                cursor: 'pointer',
                background: i === activeIdx
                  ? 'color-mix(in srgb, var(--accent) 14%, transparent)'
                  : 'transparent',
              }}
            >
              {m.displayName !== '' ? (
                <>
                  <span style={{ fontWeight: 500 }}>{m.displayName}</span>{' '}
                  <span style={{ color: 'var(--fg-muted)' }}>
                    &lt;{m.email}&gt;
                  </span>
                </>
              ) : (
                <span>{m.email}</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </span>
  );
}
