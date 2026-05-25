import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styles from './command-palette.module.css';

export type CommandItem = {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly icon?: string;
  readonly action: () => void;
};

export type CommandPaletteProps = {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly items: readonly CommandItem[];
};

export function CommandPalette({ open, onClose, items }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    if (query.trim() === '') return items;
    const q = query.toLowerCase();
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        (item.hint !== undefined && item.hint.toLowerCase().includes(q)),
    );
  }, [items, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [filtered]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const execute = useCallback(
    (index: number) => {
      const item = filtered[index];
      if (item !== undefined) {
        onClose();
        item.action();
      }
    },
    [filtered, onClose],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        execute(selectedIndex);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    },
    [filtered.length, selectedIndex, execute, onClose],
  );

  if (!open) return null;

  return (
    <div
      className={styles.backdrop}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="presentation"
    >
      <div className={styles.panel} role="dialog" aria-label="Command palette">
        <div className={styles.inputWrapper}>
          <input
            ref={inputRef}
            className={styles.input}
            type="text"
            placeholder="Type a command..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            aria-label="Command search"
          />
        </div>
        <div className={styles.results} role="listbox">
          {filtered.length === 0 ? (
            <div className={styles.empty}>No results</div>
          ) : (
            filtered.map((item, i) => (
              <div
                key={item.id}
                className={styles.item}
                data-selected={i === selectedIndex ? 'true' : undefined}
                role="option"
                aria-selected={i === selectedIndex}
                onClick={() => execute(i)}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                {item.icon !== undefined && (
                  <span className={styles.itemIcon}>{item.icon}</span>
                )}
                <span className={styles.itemLabel}>{item.label}</span>
                {item.hint !== undefined && (
                  <span className={styles.itemHint}>{item.hint}</span>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
