/**
 * Composer — React wrapper around `squire-rte` (Phase 2 work item 1).
 *
 * Squire owns the DOM inside the editor root; React owns mounting,
 * unmounting, and prop-driven config changes. The bridge is one
 * useEffect that constructs Squire on mount and tears it down on
 * unmount.
 *
 * Design notes:
 *
 *   - **Uncontrolled with initial value.** `value` is read on mount and
 *     used to seed Squire's HTML; subsequent React-side changes to
 *     `value` are *not* synced back into the editor. Squire is a
 *     stateful DOM widget; round-tripping through React state would
 *     stomp the cursor on every keystroke. To programmatically clear
 *     or replace the contents (e.g. when opening a different draft),
 *     remount the component by changing its `key` prop.
 *   - **onChange fires on every input.** The caller can debounce in
 *     userland (e.g., save-on-blur or 500ms throttle for drafts).
 *   - **Paste routes through the WASM sanitizer.** Every paste passes
 *     through `sanitizeToDOMFragment` so the ammonia component decides
 *     what tags / attributes / URLs survive (matches received-message
 *     sanitization — single source of truth).
 *   - **Quoted blocks `contenteditable="false"`.** Reply / forward
 *     prepends a `<blockquote>` with `contenteditable="false"` so the
 *     user can't accidentally edit the quoted history. Squire respects
 *     the standard attribute; nothing special needed beyond honoring
 *     it in the initial `value`.
 *   - **`a11y`.** The editor root is a `role="textbox"` with
 *     `aria-multiline="true"` (Squire sets this) and accepts
 *     `aria-label` / `aria-labelledby` via the `label` prop.
 */

import { useEffect, useRef } from 'react';
import Squire from 'squire-rte';
import { sanitizeToDOMFragment } from '../runtime/sanitize-fragment.js';

export type ComposerProps = {
  /** Initial HTML — read once on mount. To replace, change `key`. */
  readonly value?: string;
  /** Fires on every Squire `input` event with the current HTML. */
  readonly onChange?: (html: string) => void;
  /** ARIA label for the editor textbox. */
  readonly label: string;
  /**
   * Optional placeholder text shown when the editor is empty. Rendered
   * via CSS `::before` rather than baked into the editor content so it
   * doesn't pollute `getHTML()`. (Phase 2 first cut ships without —
   * lands when there's a real composer screen to host it.)
   */
  readonly placeholder?: string;
  /** Optional `id` for `aria-labelledby` consumers. */
  readonly id?: string;
};

export function Composer(props: ComposerProps) {
  const { value, onChange, label, placeholder, id } = props;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<Squire | null>(null);

  // onChange is held in a ref so the effect doesn't re-init Squire on
  // every parent re-render. Squire init is heavy (mutation observer +
  // event listeners + clipboard handlers); we want to do it once.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return;

    const editor = new Squire(root, {
      sanitizeToDOMFragment,
    });

    if (value !== undefined && value !== '') {
      editor.setHTML(value);
    }

    const handler = () => {
      onChangeRef.current?.(editor.getHTML());
    };
    editor.addEventListener('input', handler);

    editorRef.current = editor;

    return () => {
      editor.removeEventListener('input', handler);
      editor.destroy();
      editorRef.current = null;
    };
    // Dependencies intentionally empty: Squire is initialized ONCE per
    // component lifetime. To replace content, the caller re-mounts via
    // a `key` change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={rootRef}
      role="textbox"
      aria-label={label}
      aria-multiline="true"
      contentEditable
      // Squire writes its own attributes onto the root; suppress the
      // React warning that comes from contentEditable + descendants.
      suppressContentEditableWarning
      {...(id !== undefined ? { id } : {})}
      {...(placeholder !== undefined
        ? { 'data-placeholder': placeholder }
        : {})}
      data-testid="composer-root"
      style={{
        minHeight: '8em',
        padding: '0.5em 0.75em',
        border: '1px solid rgba(0,0,0,0.2)',
        borderRadius: 4,
        outline: 'inherit',
      }}
    />
  );
}
