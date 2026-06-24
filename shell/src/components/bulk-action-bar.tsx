/**
 * Bulk action bar (#5) — rendered in the thread-list header toolbar slot
 * when one or more conversations are selected. Reuses MenuButton for the
 * Move / Label menus (parity with the per-row actions) and plain Buttons
 * for the discrete mark-read / mark-unread / delete actions.
 */
import { MenuButton } from './menu-button.js';
import { Button } from './button.js';
import {
  MoveToFolderIcon,
  LabelTagIcon,
  MarkReadIcon,
  MarkUnreadIcon,
  TrashIcon,
} from './icons.js';
import styles from './bulk-action-bar.module.css';

export type BulkActionBarProps = {
  readonly count: number;
  readonly moveTargets: ReadonlyArray<{ readonly id: string; readonly label: string }>;
  readonly labels: ReadonlyArray<{ readonly key: string; readonly name: string }>;
  readonly onMarkRead: () => void;
  readonly onMarkUnread: () => void;
  readonly onMove: (targetMailboxId: string) => void;
  readonly onLabelToggle: (labelKey: string) => void;
  readonly onDelete: () => void;
  readonly onClear: () => void;
};

export function BulkActionBar(props: BulkActionBarProps): JSX.Element {
  return (
    <div className={styles['bar']} role="region" aria-label="Bulk actions">
      <span className={styles['count']} aria-live="polite">
        {props.count} selected
      </span>
      <button
        type="button"
        className={styles['clear']}
        onClick={props.onClear}
        aria-label="Clear selection"
        title="Clear selection"
      >
        ✕
      </button>
      <span className={styles['spacer']} />
      <Button variant="ghost" size="sm" onClick={props.onMarkRead} aria-label="Mark read">
        <MarkReadIcon /> Mark read
      </Button>
      <Button variant="ghost" size="sm" onClick={props.onMarkUnread} aria-label="Mark unread">
        <MarkUnreadIcon /> Mark unread
      </Button>
      {props.moveTargets.length > 0 ? (
        <MenuButton
          size="sm"
          label="Move selected to…"
          items={props.moveTargets.map((m) => ({
            key: m.id,
            label: m.label,
            onSelect: () => props.onMove(m.id),
          }))}
        >
          <MoveToFolderIcon />
        </MenuButton>
      ) : null}
      {props.labels.length > 0 ? (
        <MenuButton
          size="sm"
          label="Label selected"
          items={props.labels.map((lbl) => ({
            key: lbl.key,
            label: lbl.name,
            onSelect: () => props.onLabelToggle(lbl.key),
          }))}
        >
          <LabelTagIcon />
        </MenuButton>
      ) : null}
      <Button variant="destructive" size="sm" onClick={props.onDelete} aria-label="Delete selected">
        <TrashIcon /> Delete
      </Button>
    </div>
  );
}
