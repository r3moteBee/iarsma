/**
 * Single source of truth for the in-app keyboard help overlay (Phase 1
 * work item 10). Mirrors `docs/keyboard.md` — every entry there has an
 * entry here.
 *
 * The component code that handles a key still lives in the view file
 * (e.g. `views/thread-list.tsx`); this module is documentation, not
 * dispatch. The help overlay reads from `KEYBOARD_BINDINGS` so adding a
 * binding to a single file makes it discoverable in the UI.
 *
 * Reserved bindings (Phase 2: c, r, R, x, !, #, /) are intentionally
 * NOT included here — listing un-wired keys in the help overlay would
 * confuse users. They appear in `docs/keyboard.md` instead.
 */

export type BindingScope =
  | 'global'
  | 'mailbox-sidebar'
  | 'thread-list'
  | 'thread-view';

export const SCOPE_LABELS: Readonly<Record<BindingScope, string>> = {
  global: 'Global',
  'mailbox-sidebar': 'Mailbox sidebar',
  'thread-list': 'Thread list',
  'thread-view': 'Thread view',
};

export type Binding = {
  /** Human-readable key label, e.g. "?" or "j / ↓". Used by the help
   *  overlay. The actual key event matching happens in the view file
   *  (this module is documentation, not dispatch). */
  readonly keys: string;
  /** Short description of the action. Renders in the help overlay. */
  readonly action: string;
  readonly scope: BindingScope;
};

export const KEYBOARD_BINDINGS: ReadonlyArray<Binding> = [
  // Global ─────────────────────────────────────────────────────────
  { keys: '?', action: 'Show this keyboard help', scope: 'global' },
  { keys: 'c', action: 'Compose new message', scope: 'global' },
  { keys: 'Esc', action: 'Close any open overlay', scope: 'global' },
  // Mailbox sidebar ────────────────────────────────────────────────
  { keys: '↑', action: 'Focus previous mailbox', scope: 'mailbox-sidebar' },
  { keys: '↓', action: 'Focus next mailbox', scope: 'mailbox-sidebar' },
  {
    keys: '→',
    action: 'Expand collapsed node or focus first child',
    scope: 'mailbox-sidebar',
  },
  {
    keys: '←',
    action: 'Collapse expanded node or focus parent',
    scope: 'mailbox-sidebar',
  },
  { keys: 'Home', action: 'Focus first mailbox', scope: 'mailbox-sidebar' },
  { keys: 'End', action: 'Focus last mailbox', scope: 'mailbox-sidebar' },
  {
    keys: 'Enter / Space',
    action: 'Open focused mailbox',
    scope: 'mailbox-sidebar',
  },
  // Thread list ────────────────────────────────────────────────────
  { keys: 'j / ↓', action: 'Focus next thread', scope: 'thread-list' },
  { keys: 'k / ↑', action: 'Focus previous thread', scope: 'thread-list' },
  { keys: 'Home', action: 'Focus first thread', scope: 'thread-list' },
  { keys: 'End', action: 'Focus last thread', scope: 'thread-list' },
  {
    keys: 'Enter / Space',
    action: 'Open focused thread',
    scope: 'thread-list',
  },
  // Thread view ────────────────────────────────────────────────────
  {
    keys: 'n / ↓',
    action: 'Focus next message (auto-expand)',
    scope: 'thread-view',
  },
  {
    keys: 'p / ↑',
    action: 'Focus previous message (auto-expand)',
    scope: 'thread-view',
  },
  {
    keys: 'e',
    action: 'Expand all messages in thread',
    scope: 'thread-view',
  },
  { keys: 'r', action: 'Reply to focused message', scope: 'thread-view' },
  {
    keys: 'R',
    action: 'Reply-all to focused message',
    scope: 'thread-view',
  },
];

/** Bindings grouped by scope, preserving the order each entry appears
 *  in `KEYBOARD_BINDINGS`. */
export function bindingsByScope(): ReadonlyMap<BindingScope, Binding[]> {
  const out = new Map<BindingScope, Binding[]>();
  for (const b of KEYBOARD_BINDINGS) {
    const bucket = out.get(b.scope);
    if (bucket === undefined) out.set(b.scope, [b]);
    else bucket.push(b);
  }
  return out;
}
