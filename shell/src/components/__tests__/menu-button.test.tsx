/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MenuButton } from '../menu-button.js';
afterEach(cleanup);

describe('MenuButton', () => {
  it('opens on click and invokes the selected item', () => {
    const onSelect = vi.fn();
    render(<MenuButton label="Folder actions" items={[{ label: 'Rename', onSelect }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Folder actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
  it('does not invoke a disabled item and exposes its reason', () => {
    const onSelect = vi.fn();
    render(<MenuButton label="Folder actions" items={[{ label: 'Delete', onSelect, disabled: true, disabledReason: 'has subfolders' }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Folder actions' }));
    const item = screen.getByRole('menuitem', { name: /Delete/ });
    expect(item).toHaveAttribute('aria-disabled', 'true');
    expect(item).toHaveAttribute('title', 'has subfolders');
    fireEvent.click(item);
    expect(onSelect).not.toHaveBeenCalled();
  });
  it('closes on Escape', () => {
    render(<MenuButton label="Folder actions" items={[{ label: 'Rename', onSelect: () => {} }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Folder actions' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });
  it('menu items have tabIndex=-1 (roving tabindex, not in Tab order)', () => {
    render(
      <MenuButton
        label="Folder actions"
        items={[
          { label: 'Rename', onSelect: () => {} },
          { label: 'Delete', onSelect: () => {}, disabled: true, disabledReason: 'in use' },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Folder actions' }));
    const menuItems = screen.getAllByRole('menuitem');
    for (const item of menuItems) {
      expect(item).toHaveAttribute('tabindex', '-1');
    }
  });
  it('renders two items with identical labels when distinct key props are provided', () => {
    render(
      <MenuButton
        label="Move to"
        items={[
          { label: 'Inbox', key: 'mailbox-1', onSelect: () => {} },
          { label: 'Inbox', key: 'mailbox-2', onSelect: () => {} },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Move to' }));
    const menuItems = screen.getAllByRole('menuitem', { name: 'Inbox' });
    expect(menuItems).toHaveLength(2);
  });

  // ── Checkbox variant (Task 10) ──────────────────────────────────────

  it('a checkbox item renders role="menuitemcheckbox" with correct aria-checked', () => {
    render(
      <MenuButton
        label="Label actions"
        items={[
          { label: 'Work', key: 'work', checked: true, onSelect: () => {} },
          { label: 'Personal', key: 'personal', checked: false, onSelect: () => {} },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Label actions' }));
    const workItem = screen.getByRole('menuitemcheckbox', { name: /Work/i });
    const personalItem = screen.getByRole('menuitemcheckbox', { name: /Personal/i });
    expect(workItem).toHaveAttribute('aria-checked', 'true');
    expect(personalItem).toHaveAttribute('aria-checked', 'false');
  });

  it('activating a checkbox item calls onSelect but the menu stays open', () => {
    const onSelect = vi.fn();
    render(
      <MenuButton
        label="Label actions"
        items={[
          { label: 'Work', key: 'work', checked: false, onSelect },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Label actions' }));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Work/i }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    // Menu must still be open
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  // ── Trigger size variant (v0.13.1 regression fix) ──────────────────

  it('applies the triggerSmall class when size="sm" is passed', () => {
    render(
      <MenuButton label="Move to…" size="sm" items={[{ label: 'Inbox', onSelect: () => {} }]} />,
    );
    const trigger = screen.getByRole('button', { name: 'Move to…' });
    expect(trigger.className).toContain('triggerSmall');
  });

  it('does NOT apply the triggerSmall class by default (no size prop)', () => {
    render(
      <MenuButton label="Move to…" items={[{ label: 'Inbox', onSelect: () => {} }]} />,
    );
    const trigger = screen.getByRole('button', { name: 'Move to…' });
    expect(trigger.className).not.toContain('triggerSmall');
  });

  it('a normal (non-checkbox) item still closes the menu on select', () => {
    const onSelect = vi.fn();
    render(
      <MenuButton
        label="Folder actions"
        items={[{ label: 'Rename', onSelect }]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Folder actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
