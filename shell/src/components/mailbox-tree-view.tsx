/**
 * MailboxTreeView — WAI-ARIA tree of mailboxes for the sidebar (PR 3.5).
 *
 * Lifts the keyboard + ARIA model from the orphaned `views/mailbox-list.tsx`
 * (Phase 1's tree, never wired into the production shell) into a
 * props-driven component the sidebar mounts directly. Uses the sidebar's
 * existing CSS classes for visual consistency.
 *
 * Keyboard (WAI-ARIA tree pattern):
 *   ArrowDown / ArrowUp     next / previous visible row
 *   ArrowRight              expand if collapsed; else focus first child
 *   ArrowLeft               collapse if expanded; else focus parent
 *   Home / End              first / last visible row
 *   Enter / Space           activate (select)
 *
 * Roving tabindex: only the focused row carries `tabIndex={0}`, so Tab
 * moves out of the tree as a whole rather than landing on each row.
 *
 * Collapse state persists to localStorage under
 * `iarsma-mailbox-collapsed`. Default is expand-all; presence in the
 * set means the user explicitly collapsed that parent.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import {
  flattenVisible,
  foldMailboxTree,
  type MailboxTreeNode,
} from '../views/mailbox-tree.js';
import styles from './sidebar.module.css';

export type MailboxRow = {
  readonly id: string;
  readonly name: string;
  readonly role?: string;
  readonly unreadCount: number;
  readonly parentId?: string | null;
  readonly sortOrder?: number;
};

export type MailboxTreeViewProps = {
  readonly mailboxes: readonly MailboxRow[];
  readonly selectedId?: string;
  readonly onSelect: (id: string) => void;
  /** Storage key for the per-parent collapsed set. The default works for
   *  the single-user shell; surface a key parameter for tests + future
   *  multi-account variants. */
  readonly storageKey?: string;
};

const ROLE_LABEL: Record<string, string> = {
  inbox: 'Inbox',
  sent: 'Sent',
  drafts: 'Drafts',
  trash: 'Trash',
  junk: 'Junk',
  archive: 'Archive',
  important: 'Important',
};

const DEFAULT_STORAGE_KEY = 'iarsma-mailbox-collapsed';

function loadCollapsed(key: string): ReadonlySet<string> {
  if (typeof localStorage === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((s): s is string => typeof s === 'string'));
  } catch {
    return new Set();
  }
}

function saveCollapsed(key: string, set: ReadonlySet<string>): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify([...set]));
  } catch {
    // Quota exceeded / private mode — non-fatal.
  }
}

function labelFor(m: { name: string; role?: string }): string {
  if (m.role !== undefined && ROLE_LABEL[m.role] !== undefined) {
    return ROLE_LABEL[m.role]!;
  }
  return m.name;
}

export function MailboxTreeView({
  mailboxes,
  selectedId,
  onSelect,
  storageKey = DEFAULT_STORAGE_KEY,
}: MailboxTreeViewProps) {
  // Collapsed-set model (not expanded-set): default is expand-all,
  // explicit collapses are persisted. Sidebar trees are shallow and a
  // user who collapses a node expects it to stay collapsed.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() =>
    loadCollapsed(storageKey),
  );
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const treeRef = useRef<HTMLUListElement | null>(null);

  const tree = useMemo(() => foldMailboxTree(mailboxes), [mailboxes]);
  const isExpanded = useCallback((id: string) => !collapsed.has(id), [collapsed]);
  const visibleRows = useMemo(
    () => flattenVisible(tree, isExpanded),
    [tree, isExpanded],
  );

  // Persist on every mutation. Cheap; the set is tiny.
  useEffect(() => {
    saveCollapsed(storageKey, collapsed);
  }, [collapsed, storageKey]);

  // Keep focused row aligned with selection so Tab into the tree lands
  // on something sensible.
  useEffect(() => {
    if (focusedId === null && selectedId !== undefined) {
      setFocusedId(selectedId);
    }
  }, [selectedId, focusedId]);

  const focusRow = useCallback((id: string) => {
    setFocusedId(id);
    // Defer so the new tabIndex applies before DOM focus moves.
    queueMicrotask(() => {
      const el = treeRef.current?.querySelector<HTMLLIElement>(
        `[data-mailbox-id="${CSS.escape(id)}"]`,
      );
      el?.focus();
    });
  }, []);

  const handleSelect = useCallback(
    (id: string) => {
      onSelect(id);
      focusRow(id);
    },
    [onSelect, focusRow],
  );

  const toggleExpand = useCallback(
    (id: string) => {
      setCollapsed((s) => {
        const n = new Set(s);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      });
    },
    [],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLUListElement>) => {
      if (focusedId === null) return;
      const idx = visibleRows.findIndex((r) => r.mailbox.id === focusedId);
      if (idx < 0) return;
      const row = visibleRows[idx]!;

      switch (event.key) {
        case 'ArrowDown': {
          event.preventDefault();
          const next = visibleRows[idx + 1];
          if (next !== undefined) focusRow(next.mailbox.id);
          break;
        }
        case 'ArrowUp': {
          event.preventDefault();
          const prev = visibleRows[idx - 1];
          if (prev !== undefined) focusRow(prev.mailbox.id);
          break;
        }
        case 'ArrowRight': {
          event.preventDefault();
          if (row.children.length === 0) break;
          if (!isExpanded(row.mailbox.id)) {
            setCollapsed((s) => {
              const n = new Set(s);
              n.delete(row.mailbox.id);
              return n;
            });
          } else {
            const firstChild = row.children[0];
            if (firstChild !== undefined) focusRow(firstChild.mailbox.id);
          }
          break;
        }
        case 'ArrowLeft': {
          event.preventDefault();
          if (row.children.length > 0 && isExpanded(row.mailbox.id)) {
            setCollapsed((s) => {
              const n = new Set(s);
              n.add(row.mailbox.id);
              return n;
            });
          } else if (
            row.mailbox.parentId !== undefined &&
            row.mailbox.parentId !== null
          ) {
            focusRow(row.mailbox.parentId);
          }
          break;
        }
        case 'Home': {
          event.preventDefault();
          const first = visibleRows[0];
          if (first !== undefined) focusRow(first.mailbox.id);
          break;
        }
        case 'End': {
          event.preventDefault();
          const last = visibleRows[visibleRows.length - 1];
          if (last !== undefined) focusRow(last.mailbox.id);
          break;
        }
        case 'Enter':
        case ' ': {
          event.preventDefault();
          handleSelect(row.mailbox.id);
          break;
        }
      }
    },
    [focusedId, visibleRows, isExpanded, focusRow, handleSelect],
  );

  if (mailboxes.length === 0) return null;

  return (
    <ul
      role="tree"
      aria-label="Mailboxes"
      ref={treeRef}
      onKeyDown={onKeyDown}
      style={{ listStyle: 'none', padding: 0, margin: 0 }}
    >
      {tree.map((node, i) => (
        <TreeRow
          key={node.mailbox.id}
          node={node}
          posInSet={i + 1}
          setSize={tree.length}
          isExpanded={isExpanded}
          onToggleExpand={toggleExpand}
          selectedId={selectedId}
          onSelect={handleSelect}
          focusedId={focusedId}
          onFocusChange={setFocusedId}
        />
      ))}
    </ul>
  );
}

function TreeRow<T extends MailboxRow>(props: {
  readonly node: MailboxTreeNode<T>;
  readonly posInSet: number;
  readonly setSize: number;
  readonly isExpanded: (id: string) => boolean;
  readonly onToggleExpand: (id: string) => void;
  readonly selectedId: string | undefined;
  readonly onSelect: (id: string) => void;
  readonly focusedId: string | null;
  readonly onFocusChange: (id: string) => void;
}) {
  const {
    node,
    posInSet,
    setSize,
    isExpanded,
    onToggleExpand,
    selectedId,
    onSelect,
    focusedId,
    onFocusChange,
  } = props;
  const { mailbox, depth, children } = node;
  const hasChildren = children.length > 0;
  const expanded = hasChildren ? isExpanded(mailbox.id) : undefined;
  const isSelected = mailbox.id === selectedId;
  const isFocusable = focusedId === null ? isSelected : focusedId === mailbox.id;

  return (
    <li
      role="treeitem"
      aria-level={depth + 1}
      aria-posinset={posInSet}
      aria-setsize={setSize}
      aria-selected={isSelected}
      {...(expanded !== undefined ? { 'aria-expanded': expanded } : {})}
      tabIndex={isFocusable ? 0 : -1}
      data-mailbox-id={mailbox.id}
      data-testid={`sidebar-mailbox-${mailbox.id}`}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(mailbox.id);
      }}
      onFocus={(e) => {
        // Sync React focusedId with DOM focus changes (mouse / programmatic
        // .focus() / Tab into the tree). Without this the key handler reads
        // a stale focusedId and acts on the wrong row.
        e.stopPropagation();
        onFocusChange(mailbox.id);
      }}
      // Outline inherits so the focus ring lives on the visible row span
      // below, not the bare <li>.
      style={{ outline: 'inherit' }}
    >
      <span
        className={`${styles['mailboxItem']} ${isSelected ? styles['mailboxItemSelected'] : ''}`}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            aria-label={expanded === true ? `Collapse ${labelFor(mailbox)}` : `Expand ${labelFor(mailbox)}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(mailbox.id);
            }}
            // Per the ARIA tree pattern, the row (not the toggle) carries
            // aria-expanded — the toggle stays plain so screen readers
            // announce the row state instead of two competing values.
            tabIndex={-1}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              color: 'inherit',
              fontSize: 'inherit',
              lineHeight: 1,
              width: '1em',
            }}
          >
            {expanded === true ? '▾' : '▸'}
          </button>
        ) : (
          <span aria-hidden="true" style={{ display: 'inline-block', width: '1em' }} />
        )}
        <span className={styles['mailboxName']}>{labelFor(mailbox)}</span>
        {mailbox.unreadCount > 0 ? (
          <span
            aria-hidden="true"
            className={styles['mailboxUnread']}
          >
            {mailbox.unreadCount}
          </span>
        ) : null}
        {mailbox.unreadCount > 0 ? (
          <span style={visuallyHidden}>{`, ${mailbox.unreadCount} unread`}</span>
        ) : null}
      </span>
      {hasChildren && expanded === true ? (
        <ul role="group" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {children.map((child, i) => (
            <TreeRow
              key={child.mailbox.id}
              node={child}
              posInSet={i + 1}
              setSize={children.length}
              isExpanded={isExpanded}
              onToggleExpand={onToggleExpand}
              selectedId={selectedId}
              onSelect={onSelect}
              focusedId={focusedId}
              onFocusChange={onFocusChange}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

const visuallyHidden = {
  position: 'absolute' as const,
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0,0,0,0)',
  whiteSpace: 'nowrap' as const,
  border: 0,
};
