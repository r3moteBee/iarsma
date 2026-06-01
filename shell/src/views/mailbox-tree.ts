/**
 * Pure tree-folding utility for the mailbox sidebar (Phase 1 work item 2).
 *
 * `mailbox.list` returns a flat array of mailboxes with `parentId`
 * pointers; the sidebar renders a hierarchical tree. Folding lives in
 * its own pure module so it's trivially testable + reusable from
 * future consumers (calendar/contacts have similar parent-child
 * hierarchies in JMAP per RFC 8621).
 *
 * PR 3.5: generalized to accept any record shape carrying the four
 * fields the fold cares about (id, name, parentId?, sortOrder?). The
 * sidebar's slimmer `MailboxEntry` shape flows through alongside the
 * full JMAP `Mailbox`; missing `sortOrder` defaults to 0 so unsorted
 * input falls back to alphabetical by name.
 */

/**
 * Minimal shape `foldMailboxTree` consumes. Both `Mailbox` (the JMAP
 * type) and `MailboxEntry` (the sidebar's projection) satisfy it.
 */
export type MailboxLike = {
  readonly id: string;
  readonly name: string;
  readonly parentId?: string | null;
  readonly sortOrder?: number;
};

export type MailboxTreeNode<T extends MailboxLike = MailboxLike> = {
  readonly mailbox: T;
  /** Depth from the root (0 = top-level). */
  readonly depth: number;
  readonly children: ReadonlyArray<MailboxTreeNode<T>>;
};

/**
 * Fold a flat mailbox array into a sorted tree.
 *
 * Sort order at each level: by `sortOrder` ascending, then by `name`
 * (case-insensitive locale-aware).
 *
 * **Orphans** (mailboxes whose `parentId` references a mailbox not in
 * the input) are surfaced at the top level rather than dropped — better
 * to render an inconsistently-structured tree than to silently lose
 * data. Surfacing the orphan to the top makes the inconsistency visible
 * in the UI and to whichever consumer eventually inspects the tree.
 *
 * **Cycles** (rare; would imply a server bug) are broken by treating
 * any node revisited during the depth walk as a top-level entry.
 */
export function foldMailboxTree<T extends MailboxLike>(
  flat: ReadonlyArray<T>,
): MailboxTreeNode<T>[] {
  if (flat.length === 0) return [];

  // Index by id for O(1) parent lookup.
  const byId = new Map<string, T>();
  for (const m of flat) byId.set(m.id, m);

  // Group children under each parent id. A `null` key holds top-level
  // mailboxes plus any orphan / cycle-broken nodes (see below).
  const childrenOf = new Map<string | null, T[]>();
  function addChild(parent: string | null, child: T): void {
    const list = childrenOf.get(parent);
    if (list === undefined) childrenOf.set(parent, [child]);
    else list.push(child);
  }

  for (const m of flat) {
    // Treat both `undefined` and `null` parentId as top-level (the JMAP
    // type uses undefined; the sidebar's MailboxEntry uses null).
    if (m.parentId === undefined || m.parentId === null) {
      addChild(null, m);
      continue;
    }
    if (m.parentId === m.id) {
      // Self-cycle: a node can't be its own ancestor. Treat as top-level
      // rather than orphan'ing it under a phantom self-reference.
      addChild(null, m);
      continue;
    }
    if (!byId.has(m.parentId)) {
      // Orphan: parent id references a missing mailbox. Surface at top.
      addChild(null, m);
      continue;
    }
    addChild(m.parentId, m);
  }

  const visited = new Set<string>();

  function buildNode(m: T, depth: number): MailboxTreeNode<T> {
    visited.add(m.id);
    const rawChildren = childrenOf.get(m.id) ?? [];
    const children = sortRows(rawChildren)
      .filter((c) => !visited.has(c.id))
      .map((c) => buildNode(c, depth + 1));
    return { mailbox: m, depth, children };
  }

  const top = sortRows(childrenOf.get(null) ?? []);
  return top.map((m) => buildNode(m, 0));
}

/**
 * Flatten the tree back into a visible-row order respecting collapse
 * state. Used by the keyboard handler to compute next/previous focus
 * targets without re-walking the tree on every keypress.
 */
export function flattenVisible<T extends MailboxLike>(
  tree: ReadonlyArray<MailboxTreeNode<T>>,
  isExpanded: (id: string) => boolean,
): MailboxTreeNode<T>[] {
  const out: MailboxTreeNode<T>[] = [];
  function walk(node: MailboxTreeNode<T>): void {
    out.push(node);
    if (node.children.length === 0) return;
    if (!isExpanded(node.mailbox.id)) return;
    for (const child of node.children) walk(child);
  }
  for (const root of tree) walk(root);
  return out;
}

function sortRows<T extends MailboxLike>(rows: ReadonlyArray<T>): T[] {
  return [...rows].sort((a, b) => {
    const ao = a.sortOrder ?? 0;
    const bo = b.sortOrder ?? 0;
    if (ao !== bo) return ao - bo;
    return a.name.localeCompare(b.name);
  });
}
