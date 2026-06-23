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
});
