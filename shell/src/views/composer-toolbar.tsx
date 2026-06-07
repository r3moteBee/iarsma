/**
 * ComposerToolbar — formatting toolbar that drives a Squire editor
 * (PR 52 / CoWork #6).
 *
 * Renders a row of buttons above the editor: bold / italic / underline,
 * link, bullet+numbered lists, inline code + code block, blockquote,
 * clear formatting. Each button calls into Squire and refocuses the
 * editor so typing resumes in place.
 *
 * Active state is derived from Squire's path string. We subscribe to
 * the `pathChange`, `select`, and `input` custom events so the active
 * indicators update as the cursor moves and as the user types into a
 * formatted run.
 *
 * The toolbar is decoupled from the Composer's lifecycle: it takes a
 * `Squire | null` prop and is inert until the editor mounts. This lets
 * the parent component own the editor ref via `Composer`'s
 * `onEditorReady` callback without forwarding refs through React.
 */

import { useCallback, useEffect, useState } from 'react';
import type Squire from 'squire-rte';

import styles from './composer-toolbar.module.css';

type ActiveFormats = {
  readonly bold: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  readonly link: boolean;
  readonly ul: boolean;
  readonly ol: boolean;
  readonly inlineCode: boolean;
  readonly codeBlock: boolean;
  readonly quote: boolean;
};

const EMPTY_ACTIVE: ActiveFormats = {
  bold: false,
  italic: false,
  underline: false,
  link: false,
  ul: false,
  ol: false,
  inlineCode: false,
  codeBlock: false,
  quote: false,
};

/**
 * Squire emits a path string like "BODY>DIV>P>STRONG>EM". We split on
 * ">" and look for the tag we care about. PRE wins over CODE for the
 * inline-code indicator (a CODE inside a PRE is part of the code block
 * Squire builds via `code()`, not user-applied inline code — surfacing
 * both at once misleads the active state).
 */
export function pathToActive(path: string): ActiveFormats {
  const tags = new Set(path.toUpperCase().split('>'));
  const inPre = tags.has('PRE');
  return {
    bold: tags.has('B') || tags.has('STRONG'),
    italic: tags.has('I') || tags.has('EM'),
    underline: tags.has('U'),
    link: tags.has('A'),
    ul: tags.has('UL'),
    ol: tags.has('OL'),
    inlineCode: !inPre && tags.has('CODE'),
    codeBlock: inPre,
    quote: tags.has('BLOCKQUOTE'),
  };
}

export type ComposerToolbarProps = {
  readonly editor: Squire | null;
  /** Hint for tests / ARIA: e.g. "Message formatting". */
  readonly label?: string;
};

export function ComposerToolbar(props: ComposerToolbarProps) {
  const { editor, label } = props;
  const [active, setActive] = useState<ActiveFormats>(EMPTY_ACTIVE);

  // Sync active state with Squire's path. `pathChange` covers cursor
  // movement; `select` covers selection changes that don't move the
  // caret head; `input` covers typing past a format boundary.
  useEffect(() => {
    if (editor === null) {
      setActive(EMPTY_ACTIVE);
      return;
    }
    const refresh = (): void => {
      setActive(pathToActive(editor.getPath()));
    };
    refresh();
    editor.addEventListener('pathChange', refresh);
    editor.addEventListener('select', refresh);
    editor.addEventListener('input', refresh);
    return () => {
      editor.removeEventListener('pathChange', refresh);
      editor.removeEventListener('select', refresh);
      editor.removeEventListener('input', refresh);
    };
  }, [editor]);

  const run = useCallback(
    (fn: (e: Squire) => void) => {
      if (editor === null) return;
      fn(editor);
      // Squire's commands move focus around; bring it back to the editor
      // so the next keypress lands inside the message body, not on the
      // toolbar button the user just clicked.
      try {
        editor.focus();
      } catch {
        // focus failures are non-fatal — the editor is still usable.
      }
      setActive(pathToActive(editor.getPath()));
    },
    [editor],
  );

  const onBold = useCallback(() => {
    run((e) => (e.hasFormat('B') || e.hasFormat('STRONG') ? e.removeBold() : e.bold()));
  }, [run]);
  const onItalic = useCallback(() => {
    run((e) => (e.hasFormat('I') || e.hasFormat('EM') ? e.removeItalic() : e.italic()));
  }, [run]);
  const onUnderline = useCallback(() => {
    run((e) => (e.hasFormat('U') ? e.removeUnderline() : e.underline()));
  }, [run]);

  const onLink = useCallback(() => {
    if (editor === null) return;
    if (editor.hasFormat('A')) {
      run((e) => e.removeLink());
      return;
    }
    const url = window.prompt('Link URL', 'https://');
    if (url === null || url.trim() === '') return;
    run((e) => e.makeLink(url.trim()));
  }, [editor, run]);

  const onBulletList = useCallback(() => {
    run((e) => (e.hasFormat('UL') ? e.removeList() : e.makeUnorderedList()));
  }, [run]);
  const onNumberedList = useCallback(() => {
    run((e) => (e.hasFormat('OL') ? e.removeList() : e.makeOrderedList()));
  }, [run]);

  const onInlineCode = useCallback(() => {
    // Force inline `<code>` regardless of selection collapsed-ness.
    // Squire's `toggleCode()` would convert a collapsed selection into
    // a `<pre>` code block — that's the code-block button's job.
    run((e) =>
      e.hasFormat('CODE') && !e.hasFormat('PRE')
        ? e.changeFormat(null, { tag: 'CODE' })
        : e.changeFormat({ tag: 'CODE' }, null),
    );
  }, [run]);
  const onCodeBlock = useCallback(() => {
    run((e) => (e.hasFormat('PRE') ? e.removeCode() : e.code()));
  }, [run]);

  const onQuote = useCallback(() => {
    run((e) => (e.hasFormat('BLOCKQUOTE') ? e.decreaseQuoteLevel() : e.increaseQuoteLevel()));
  }, [run]);

  const onClear = useCallback(() => {
    run((e) => e.removeAllFormatting());
  }, [run]);

  const disabled = editor === null;

  return (
    <div
      role="toolbar"
      aria-label={label ?? 'Message formatting'}
      className={styles['toolbar']}
    >
      <ToolbarButton
        label="Bold"
        shortcut="Ctrl+B"
        active={active.bold}
        disabled={disabled}
        onClick={onBold}
      >
        <BoldIcon />
      </ToolbarButton>
      <ToolbarButton
        label="Italic"
        shortcut="Ctrl+I"
        active={active.italic}
        disabled={disabled}
        onClick={onItalic}
      >
        <ItalicIcon />
      </ToolbarButton>
      <ToolbarButton
        label="Underline"
        shortcut="Ctrl+U"
        active={active.underline}
        disabled={disabled}
        onClick={onUnderline}
      >
        <UnderlineIcon />
      </ToolbarButton>
      <Separator />
      <ToolbarButton
        label={active.link ? 'Remove link' : 'Insert link'}
        active={active.link}
        disabled={disabled}
        onClick={onLink}
      >
        <LinkIcon />
      </ToolbarButton>
      <Separator />
      <ToolbarButton
        label="Bullet list"
        active={active.ul}
        disabled={disabled}
        onClick={onBulletList}
      >
        <BulletListIcon />
      </ToolbarButton>
      <ToolbarButton
        label="Numbered list"
        active={active.ol}
        disabled={disabled}
        onClick={onNumberedList}
      >
        <NumberedListIcon />
      </ToolbarButton>
      <Separator />
      <ToolbarButton
        label="Inline code"
        active={active.inlineCode}
        disabled={disabled}
        onClick={onInlineCode}
      >
        <InlineCodeIcon />
      </ToolbarButton>
      <ToolbarButton
        label="Code block"
        active={active.codeBlock}
        disabled={disabled}
        onClick={onCodeBlock}
      >
        <CodeBlockIcon />
      </ToolbarButton>
      <ToolbarButton
        label="Quote"
        active={active.quote}
        disabled={disabled}
        onClick={onQuote}
      >
        <QuoteIcon />
      </ToolbarButton>
      <Separator />
      <ToolbarButton
        label="Clear formatting"
        disabled={disabled}
        onClick={onClear}
      >
        <ClearIcon />
      </ToolbarButton>
    </div>
  );
}

type ToolbarButtonProps = {
  readonly label: string;
  readonly shortcut?: string;
  readonly active?: boolean;
  readonly disabled?: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
};

function ToolbarButton(props: ToolbarButtonProps) {
  const { label, shortcut, active, disabled, onClick, children } = props;
  const title = shortcut !== undefined ? `${label} (${shortcut})` : label;
  return (
    <button
      type="button"
      className={
        active === true
          ? `${styles['btn']} ${styles['btnActive']}`
          : styles['btn']
      }
      aria-label={label}
      aria-pressed={active === true}
      title={title}
      // mousedown→preventDefault keeps the editor selection alive across
      // the click; without this, clicking the toolbar collapses the
      // selection before the command runs, defeating wrap-selection.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled === true}
    >
      {children}
    </button>
  );
}

function Separator() {
  return <span aria-hidden="true" className={styles['separator']} />;
}

/* ──────────────────────────────────────────────────────────────────
 * Icons — feather/lucide-styled SVG to match the sidebar icon set.
 * 14x14 viewBox so they tuck into the toolbar height.
 * ────────────────────────────────────────────────────────────────── */

const ICON_PROPS = {
  width: '16',
  height: '16',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: '2',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function BoldIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M6 4h8a4 4 0 014 4 4 4 0 01-4 4H6z" />
      <path d="M6 12h9a4 4 0 014 4 4 4 0 01-4 4H6z" />
    </svg>
  );
}
function ItalicIcon() {
  return (
    <svg {...ICON_PROPS}>
      <line x1="19" y1="4" x2="10" y2="4" />
      <line x1="14" y1="20" x2="5" y2="20" />
      <line x1="15" y1="4" x2="9" y2="20" />
    </svg>
  );
}
function UnderlineIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M6 4v8a6 6 0 0012 0V4" />
      <line x1="4" y1="20" x2="20" y2="20" />
    </svg>
  );
}
function LinkIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M10 14a5 5 0 007.07 0l3-3a5 5 0 00-7.07-7.07l-1.5 1.5" />
      <path d="M14 10a5 5 0 00-7.07 0l-3 3a5 5 0 007.07 7.07l1.5-1.5" />
    </svg>
  );
}
function BulletListIcon() {
  return (
    <svg {...ICON_PROPS}>
      <line x1="9" y1="6" x2="20" y2="6" />
      <line x1="9" y1="12" x2="20" y2="12" />
      <line x1="9" y1="18" x2="20" y2="18" />
      <circle cx="4" cy="6" r="1" />
      <circle cx="4" cy="12" r="1" />
      <circle cx="4" cy="18" r="1" />
    </svg>
  );
}
function NumberedListIcon() {
  return (
    <svg {...ICON_PROPS}>
      <line x1="10" y1="6" x2="21" y2="6" />
      <line x1="10" y1="12" x2="21" y2="12" />
      <line x1="10" y1="18" x2="21" y2="18" />
      <path d="M4 6h1v4" />
      <path d="M4 10h2" />
      <path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" />
    </svg>
  );
}
function InlineCodeIcon() {
  return (
    <svg {...ICON_PROPS}>
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}
function CodeBlockIcon() {
  return (
    <svg {...ICON_PROPS}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <polyline points="9 9 7 12 9 15" />
      <polyline points="15 9 17 12 15 15" />
    </svg>
  );
}
function QuoteIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M6 17h3a2 2 0 002-2v-2a2 2 0 00-2-2H5V8a3 3 0 013-3" />
      <path d="M15 17h3a2 2 0 002-2v-2a2 2 0 00-2-2h-4V8a3 3 0 013-3" />
    </svg>
  );
}
function ClearIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M20 20H7L3 12l4-8h13a1 1 0 011 1v14a1 1 0 01-1 1z" />
      <line x1="18" y1="9" x2="12" y2="15" />
      <line x1="12" y1="9" x2="18" y2="15" />
    </svg>
  );
}
