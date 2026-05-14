# Iarsma keyboard model — v1

**Last updated:** 2026-05-11
**Status:** authoritative for Phase 1. Reserved bindings (`c`, `r`, `x`) are documented but not yet wired and will land with their respective capabilities in Phase 2.

The keyboard model is the primary navigation surface for power users and an accessibility floor for screen-reader users. Every shipped binding lives in code at exactly one place and is documented here. The in-app help overlay (press <kbd>?</kbd>) renders this same model — both surfaces share the source of truth in `shell/src/runtime/keyboard-bindings.ts`.

## Conventions

- A binding is **scoped** to a view region: mailbox sidebar, thread list, thread view, or global.
- Bindings are case-sensitive unless noted. `?` is `Shift+/` on US layouts; the help overlay listens for the produced `?` character so non-US layouts can press whatever key produces `?` on theirs.
- Arrow keys mirror vim-style bindings where both are useful for muscle memory (`j`/<kbd>↓</kbd>, `k`/<kbd>↑</kbd>). Mailbox-tree navigation uses arrows exclusively to match the WAI-ARIA tree pattern.
- A binding never overrides a default browser shortcut whose loss would surprise the user (`Ctrl+R`, `Ctrl+F`, etc. all behave normally).

## Global

| Key | Action | Notes |
|-----|--------|-------|
| <kbd>?</kbd> | Open the keyboard help overlay | Suppressed while focus is inside a text input or contenteditable. |
| <kbd>c</kbd> | Compose new message | Opens the empty compose modal. Suppressed while focus is inside a text input or contenteditable. |
| <kbd>/</kbd> | Focus the search input | Selects existing text so the user can type a fresh query. Suppressed while focus is inside a text input or contenteditable. |
| <kbd>Escape</kbd> | Close any open overlay | Closes the keyboard help, the compose modal, or the send-confirmation modal — whichever is on top. Pressing it while the search input is focused clears the query. |

## Mailbox sidebar (left column)

Implements the [WAI-ARIA tree pattern](https://www.w3.org/WAI/ARIA/apg/patterns/treeview/). Defined in `shell/src/views/mailbox-list.tsx`.

| Key | Action |
|-----|--------|
| <kbd>↑</kbd> | Focus the previous visible row |
| <kbd>↓</kbd> | Focus the next visible row |
| <kbd>→</kbd> | Expand a collapsed node; if already expanded, focus the first child |
| <kbd>←</kbd> | Collapse an expanded node; if already collapsed (or a leaf), focus the parent |
| <kbd>Home</kbd> | Focus the first visible row |
| <kbd>End</kbd> | Focus the last visible row |
| <kbd>Enter</kbd> / <kbd>Space</kbd> | Open the focused mailbox (select for the thread list) |

`j` / `k` are *not* bound here on purpose — the WAI-ARIA tree pattern reserves arrow keys for hierarchy traversal, and overloading them with vim-style aliases would conflict with screen-reader-user expectations.

## Thread list (middle column)

Implements the [WAI-ARIA listbox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/listbox/). Defined in `shell/src/views/thread-list.tsx`.

| Key | Action |
|-----|--------|
| <kbd>j</kbd> / <kbd>↓</kbd> | Focus the next thread |
| <kbd>k</kbd> / <kbd>↑</kbd> | Focus the previous thread |
| <kbd>Home</kbd> | Focus the first thread |
| <kbd>End</kbd> | Focus the last thread |
| <kbd>Enter</kbd> / <kbd>Space</kbd> | Open the focused thread (load it into the thread view) |

## Thread view (right column)

Defined in `shell/src/views/thread-view.tsx`. The thread view contains an ordered list of messages; the latest message starts expanded, older messages start collapsed.

| Key | Action |
|-----|--------|
| <kbd>n</kbd> / <kbd>↓</kbd> | Focus the next message (auto-expands it) |
| <kbd>p</kbd> / <kbd>↑</kbd> | Focus the previous message (auto-expands it) |
| <kbd>e</kbd> | Expand all messages in the thread |
| <kbd>r</kbd> | Reply to the focused message |
| <kbd>R</kbd> | Reply-all to the focused message |

## Reserved (Phase 2)

Documented here so they don't get accidentally bound to something else. Implementation lands with the corresponding capability.

| Key | Reserved for | Scope |
|-----|--------------|-------|
| <kbd>f</kbd> | **Forward** the focused message | Thread view |
| <kbd>x</kbd> | Toggle selection (multi-select for bulk operations) | Thread list |
| <kbd>!</kbd> | Report as spam / move to junk | Thread list, thread view |
| <kbd>#</kbd> | Delete | Thread list, thread view |

## Out of scope (post-v1)

- Customizable bindings. v1 ships a fixed map; rebinding lands when there's a clear use case (international layouts, accessibility-tool integration). The help overlay is read-only.
- Chord bindings (`g i` for "go to inbox", etc.). The Phase 1 surface area is too small to need them; revisit when there are >10 useful destinations.
- Sticky modal modes (vim-style command mode). The single-press model keeps the muscle-memory cheap to learn.

## How to add a binding

1. Decide its scope. Global bindings live at the `<App>` level; per-view bindings live in the view's component file.
2. Register the binding in `shell/src/runtime/keyboard-bindings.ts` (the source of truth for the help overlay) with a stable key, scope, and human-readable description.
3. Wire the actual handler in the relevant component.
4. Add a test under `shell/src/views/__tests__/` or `shell/src/__tests__/`.
5. Update this document.

A binding without a corresponding entry in `keyboard-bindings.ts` will not appear in the help overlay; a binding listed but not implemented is treated as a documentation bug.
