/**
 * MailboxList — sidebar tree of mailboxes (Phase 1 work item 2).
 *
 * Implements the WAI-ARIA tree pattern (https://www.w3.org/WAI/ARIA/apg/
 * patterns/treeview/) per D-013. Keyboard:
 *
 *   - ArrowDown / ArrowUp     move to the next / previous visible row
 *   - ArrowRight              expand if collapsed; if already expanded,
 *                             move to the first child
 *   - ArrowLeft               collapse if expanded; if already collapsed
 *                             (or it's a leaf), move to the parent
 *   - Home / End              first / last visible row
 *   - Enter / Space           activate (select)
 *
 * Roving tabindex: only the focused row carries `tabIndex={0}`; the
 * others are `tabIndex={-1}` so Tab moves out of the tree as a whole
 * rather than landing on each row. This is the recommended pattern for
 * tree widgets.
 *
 * Selection state lives in `selectedMailboxIdAtom` (mail-state.ts) so
 * the upcoming ThreadList (item 4) reads the same source.
 */

import { useAtom } from 'jotai';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { selectedMailboxIdAtom } from '../mail-state.js';
import { useMailboxList } from '../generated/capabilities/mailbox-list.js';
import {
  flattenVisible,
  foldMailboxTree,
  type MailboxTreeNode,
} from './mailbox-tree.js';

const ROLE_LABEL: Record<string, string> = {
  inbox: 'Inbox',
  sent: 'Sent',
  drafts: 'Drafts',
  trash: 'Trash',
  junk: 'Junk',
  archive: 'Archive',
  important: 'Important',
};

export function MailboxList() {
  const { data, error, isLoading } = useMailboxList({});
  const [selectedId, setSelectedId] = useAtom(selectedMailboxIdAtom);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const treeRef = useRef<HTMLUListElement | null>(null);

  const tree = useMemo(() => (data === undefined ? [] : foldMailboxTree(data)), [data]);

  // Expand all parents by default — sidebar trees are usually shallow
  // (1-2 levels deep on most accounts). User can collapse explicitly.
  useEffect(() => {
    if (tree.length === 0) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      forEachNode(tree, (n) => {
        if (n.children.length > 0) next.add(n.mailbox.id);
      });
      return next;
    });
  }, [tree]);

  // Auto-select the inbox the first time data lands. Fallback when no
  // inbox-role mailbox is present: the first row in *display order*
  // (i.e., the first node in the folded tree, after sortOrder + name
  // sorting). Using `data[0]` here would auto-select whatever JMAP
  // happened to return first, which doesn't match what the user sees.
  useEffect(() => {
    if (data === undefined || data.length === 0) return;
    if (selectedId !== null) return;
    const inbox = data.find((m) => m.role === 'inbox');
    const target = inbox ?? tree[0]?.mailbox;
    if (target !== undefined) setSelectedId(target.id);
  }, [data, selectedId, setSelectedId, tree]);

  // Keep focused row in sync with selection so a fresh load has somewhere
  // to land focus when the user presses Tab into the tree.
  useEffect(() => {
    if (focusedId === null && selectedId !== null) {
      setFocusedId(selectedId);
    }
  }, [selectedId, focusedId]);

  const isExpanded = useCallback((id: string) => expanded.has(id), [expanded]);
  const visibleRows = useMemo(
    () => flattenVisible(tree, isExpanded),
    [tree, isExpanded],
  );

  const focusRow = useCallback((id: string) => {
    setFocusedId(id);
    // Defer to the next tick so the new tabIndex applies before focus moves.
    queueMicrotask(() => {
      const el = treeRef.current?.querySelector<HTMLLIElement>(`[data-mailbox-id="${id}"]`);
      el?.focus();
    });
  }, []);

  const onSelect = useCallback(
    (id: string) => {
      setSelectedId(id);
      focusRow(id);
    },
    [setSelectedId, focusRow],
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
            setExpanded((s) => {
              const n = new Set(s);
              n.add(row.mailbox.id);
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
            setExpanded((s) => {
              const n = new Set(s);
              n.delete(row.mailbox.id);
              return n;
            });
          } else if (row.mailbox.parentId !== undefined) {
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
          onSelect(row.mailbox.id);
          break;
        }
      }
    },
    [focusedId, visibleRows, isExpanded, focusRow, onSelect],
  );

  if (isLoading) {
    return (
      <nav aria-label="Mailboxes" aria-busy="true">
        <p>Loading mailboxes…</p>
      </nav>
    );
  }
  if (error !== undefined) {
    return (
      <nav aria-label="Mailboxes">
        <p role="alert">Failed to load mailboxes: {error.message}</p>
      </nav>
    );
  }
  if (data === undefined || data.length === 0) {
    return (
      <nav aria-label="Mailboxes">
        <p>No mailboxes.</p>
      </nav>
    );
  }

  return (
    <nav aria-label="Mailboxes">
      <ul
        role="tree"
        aria-label="Mailboxes"
        ref={treeRef}
        onKeyDown={onKeyDown}
        // Outer list itself is not focusable; the focused row carries
        // tabIndex={0}. Lists with `role="tree"` skip default ul styles.
        style={{ listStyle: 'none', padding: 0, margin: 0 }}
      >
        {tree.map((node, i) => (
          <TreeRow
            key={node.mailbox.id}
            node={node}
            posInSet={i + 1}
            setSize={tree.length}
            isExpanded={isExpanded}
            onToggleExpand={(id) =>
              setExpanded((s) => {
                const n = new Set(s);
                if (n.has(id)) n.delete(id);
                else n.add(id);
                return n;
              })
            }
            selectedId={selectedId}
            onSelect={onSelect}
            focusedId={focusedId}
            onFocusChange={setFocusedId}
          />
        ))}
      </ul>
    </nav>
  );
}

function TreeRow(props: {
  readonly node: MailboxTreeNode;
  readonly posInSet: number;
  readonly setSize: number;
  readonly isExpanded: (id: string) => boolean;
  readonly onToggleExpand: (id: string) => void;
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  readonly focusedId: string | null;
  readonly onFocusChange: (id: string) => void;
}) {
  const { node, posInSet, setSize, isExpanded, onToggleExpand, selectedId, onSelect, focusedId } =
    props;
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
      onClick={(e) => {
        e.stopPropagation();
        onSelect(mailbox.id);
      }}
      onFocus={(e) => {
        // Sync the React `focusedId` state with DOM focus changes
        // (mouse / programmatic .focus() / Tab from outside the tree).
        // Without this the keyboard handler reads a stale focusedId
        // and acts on the wrong row.
        e.stopPropagation();
        props.onFocusChange(mailbox.id);
      }}
      // Prevent the inner row from triggering parent selection on click.
      style={{ outline: 'inherit' }}
    >
      <span
        // Visual row content. Padding-left scales with depth.
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: '0.5em',
          paddingLeft: `${depth * 1.25}em`,
          fontWeight: isSelected ? 600 : 400,
        }}
      >
        {hasChildren ? (
          <button
            type="button"
            aria-label={expanded === true ? 'Collapse' : 'Expand'}
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(mailbox.id);
            }}
            // The toggle is a sibling control to the row label; per the
            // ARIA tree pattern the row itself (not the toggle) carries
            // aria-expanded, so the toggle stays plain.
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            tabIndex={-1}
          >
            {expanded === true ? '▾' : '▸'}
          </button>
        ) : (
          <span aria-hidden="true" style={{ display: 'inline-block', width: '1em' }} />
        )}
        <span>{labelFor(mailbox)}</span>
        {mailbox.unreadEmails > 0 ? (
          <span
            // Visible badge; the screen-reader text below makes the count
            // explicit so the badge isn't dependent on visual recognition.
            aria-hidden="true"
            style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}
          >
            {mailbox.unreadEmails}
          </span>
        ) : null}
        {mailbox.unreadEmails > 0 ? (
          <span style={visuallyHidden}>
            {`, ${mailbox.unreadEmails} unread`}
          </span>
        ) : null}
      </span>
      {hasChildren && expanded === true ? (
        <ul
          role="group"
          style={{ listStyle: 'none', padding: 0, margin: 0 }}
        >
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
              onFocusChange={props.onFocusChange}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function labelFor(m: { name: string; role?: string }): string {
  // Prefer the JMAP `name` for ordinary folders; for special-use roles,
  // surface the canonical English label so "INBOX" doesn't show in
  // all-caps and so non-default mailbox names still read clearly.
  if (m.role !== undefined && ROLE_LABEL[m.role] !== undefined) {
    return ROLE_LABEL[m.role]!;
  }
  return m.name;
}

const visuallyHidden = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0,0,0,0)',
  whiteSpace: 'nowrap',
  border: 0,
} as const;

function forEachNode(
  nodes: ReadonlyArray<MailboxTreeNode>,
  fn: (n: MailboxTreeNode) => void,
): void {
  for (const n of nodes) {
    fn(n);
    forEachNode(n.children, fn);
  }
}
