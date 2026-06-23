/**
 * MenuButton — accessible trigger + popover menu component (Task 5).
 *
 * A `<button aria-haspopup="menu" aria-expanded>` that toggles a
 * `<ul role="menu">` containing `<button role="menuitem">` items.
 *
 * Keyboard behaviour:
 *   ArrowDown / ArrowUp — move focus among enabled items
 *   Escape             — close and return focus to the trigger
 *   Click outside      — close (via document mousedown listener)
 *
 * Disabled items render with `aria-disabled="true"` + `title` for the
 * reason, and their `onSelect` is never called.
 */

import { useEffect, useRef, useState } from 'react';
import styles from './menu-button.module.css';

export type MenuItem = {
  readonly label: string;
  readonly key?: string;
  readonly onSelect: () => void;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  /** When defined, renders as `role="menuitemcheckbox"` with `aria-checked`.
   *  Activating a checkbox item calls `onSelect` but does NOT close the menu
   *  (multi-select pattern). */
  readonly checked?: boolean;
};

export function MenuButton({
  label,
  items,
  children,
  align = 'start',
}: {
  readonly label: string;
  readonly items: readonly MenuItem[];
  readonly children?: React.ReactNode;
  readonly align?: 'start' | 'end';
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    function handleMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (
        menuRef.current !== null &&
        !menuRef.current.contains(target) &&
        triggerRef.current !== null &&
        !triggerRef.current.contains(target)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [open]);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLUListElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const menu = menuRef.current;
      if (menu === null) return;
      const itemEls = Array.from(
        menu.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not([aria-disabled="true"]), button[role="menuitemcheckbox"]:not([aria-disabled="true"])'),
      );
      if (itemEls.length === 0) return;
      const focused = document.activeElement;
      const currentIndex = itemEls.indexOf(focused as HTMLButtonElement);
      let nextIndex: number;
      if (e.key === 'ArrowDown') {
        nextIndex = currentIndex < itemEls.length - 1 ? currentIndex + 1 : 0;
      } else {
        nextIndex = currentIndex > 0 ? currentIndex - 1 : itemEls.length - 1;
      }
      itemEls[nextIndex]?.focus();
    }
  }

  const menuClass = [
    styles['menu'],
    align === 'end' ? styles['alignEnd'] : styles['alignStart'],
  ].join(' ');

  return (
    <div className={styles['wrapper']}>
      <button
        ref={triggerRef}
        type="button"
        className={styles['trigger']}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {children ?? '⋯'}
      </button>
      {open && (
        <ul
          ref={menuRef}
          role="menu"
          className={menuClass}
          onKeyDown={handleKeyDown}
          aria-label={label}
        >
          {items.map((item) => {
            const isCheckbox = item.checked !== undefined;
            return (
              <li key={item.key ?? item.label} role="none">
                <button
                  type="button"
                  role={isCheckbox ? 'menuitemcheckbox' : 'menuitem'}
                  tabIndex={-1}
                  className={styles['menuItem']}
                  aria-checked={isCheckbox ? item.checked : undefined}
                  aria-disabled={item.disabled === true ? 'true' : undefined}
                  title={item.disabled === true ? item.disabledReason : undefined}
                  onClick={
                    item.disabled === true
                      ? undefined
                      : () => {
                          item.onSelect();
                          // Checkbox items stay open (multi-select); normal items close.
                          if (!isCheckbox) close();
                        }
                  }
                >
                  {isCheckbox ? (item.checked ? '✓ ' : '  ') : null}{item.label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
