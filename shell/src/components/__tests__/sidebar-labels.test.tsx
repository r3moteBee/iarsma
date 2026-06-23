/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Sidebar } from '../sidebar.js';
import type { LabelDef } from '../../runtime/label-registry.js';

// Stub out child components that need complex mocks
vi.mock('../mailbox-tree-view.js', () => ({
  MailboxTreeView: () => null,
}));
vi.mock('../accent-picker.js', () => ({
  AccentPicker: () => null,
}));
vi.mock('../density-selector.js', () => ({
  DensitySelector: () => null,
}));

const LABELS: LabelDef[] = [
  { key: 'lbl:work', name: 'Work', color: '#ff6b35', order: 0 },
  { key: 'lbl:personal', name: 'Personal', color: '#3b82f6', order: 1 },
];

function makeProps(overrides?: Partial<React.ComponentProps<typeof Sidebar>>) {
  return {
    activeView: 'mail' as const,
    onNavigate: vi.fn(),
    onCompose: vi.fn(),
    onSignOut: vi.fn(),
    theme: 'system' as const,
    onThemeChange: vi.fn(),
    labels: LABELS,
    onLabelSelect: vi.fn(),
    onNewLabel: vi.fn(),
    ...overrides,
  };
}

afterEach(cleanup);

// Reset localStorage before each test
beforeEach(() => {
  localStorage.clear();
});

describe('Sidebar Labels section', () => {
  it('renders one row per label with the label name', () => {
    render(<Sidebar {...makeProps()} />);
    expect(screen.getByText('Work')).toBeInTheDocument();
    expect(screen.getByText('Personal')).toBeInTheDocument();
  });

  it('renders a colored dot for each label', () => {
    render(<Sidebar {...makeProps()} />);
    // Two dots with data-testid="label-dot"
    const dots = screen.getAllByTestId('label-dot');
    expect(dots).toHaveLength(2);
  });

  it('calls onLabelSelect with the key when a label row is clicked', () => {
    const onLabelSelect = vi.fn();
    render(<Sidebar {...makeProps({ onLabelSelect })} />);
    fireEvent.click(screen.getByText('Work'));
    expect(onLabelSelect).toHaveBeenCalledWith('lbl:work');
  });

  it('calls onNewLabel when "+ New label" is clicked', () => {
    const onNewLabel = vi.fn();
    render(<Sidebar {...makeProps({ onNewLabel })} />);
    fireEvent.click(screen.getByRole('button', { name: '+ New label' }));
    expect(onNewLabel).toHaveBeenCalledTimes(1);
  });

  it('collapse toggle hides label rows and persists to localStorage', () => {
    render(<Sidebar {...makeProps()} />);
    // Initially expanded - labels visible
    expect(screen.getByText('Work')).toBeInTheDocument();
    // Click the collapse toggle
    const toggle = screen.getByTestId('labels-section-toggle');
    fireEvent.click(toggle);
    // Labels should be hidden
    expect(screen.queryByText('Work')).not.toBeInTheDocument();
    // Check localStorage
    expect(localStorage.getItem('iarsma-labels-collapsed')).toBe('1');
  });

  it('restores collapsed state from localStorage on mount', () => {
    localStorage.setItem('iarsma-labels-collapsed', '1');
    render(<Sidebar {...makeProps()} />);
    // Labels should be hidden since collapsed=true persisted
    expect(screen.queryByText('Work')).not.toBeInTheDocument();
  });

  it('renders nothing in the labels section when labels array is empty', () => {
    render(<Sidebar {...makeProps({ labels: [] })} />);
    // No label rows, but the Labels header/collapse control should still show
    expect(screen.queryByText('Work')).not.toBeInTheDocument();
    expect(screen.getByText('Labels')).toBeInTheDocument();
    expect(screen.getByTestId('labels-section-toggle')).toBeInTheDocument();
  });
});

// ── Label row "…" actions menu ───────────────────────────────────────

describe('Sidebar Label row actions menu', () => {
  it('renders a "…" MenuButton for each label row', () => {
    render(<Sidebar {...makeProps()} />);
    // Each label row should have an actions menu button
    expect(screen.getByRole('button', { name: /actions for work/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /actions for personal/i })).toBeInTheDocument();
  });

  it('clicking "…" opens a menu with Rename, Recolor, Delete items', () => {
    render(<Sidebar {...makeProps()} />);
    fireEvent.click(screen.getByRole('button', { name: /actions for work/i }));
    expect(screen.getByRole('menuitem', { name: /rename/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /recolor/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /delete/i })).toBeInTheDocument();
  });

  it('clicking Rename calls onRenameLabel with the label key', () => {
    const onRenameLabel = vi.fn();
    render(<Sidebar {...makeProps({ onRenameLabel })} />);
    fireEvent.click(screen.getByRole('button', { name: /actions for work/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /rename/i }));
    expect(onRenameLabel).toHaveBeenCalledWith('lbl:work');
  });

  it('clicking Recolor calls onRecolorLabel with the label key', () => {
    const onRecolorLabel = vi.fn();
    render(<Sidebar {...makeProps({ onRecolorLabel })} />);
    fireEvent.click(screen.getByRole('button', { name: /actions for work/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /recolor/i }));
    expect(onRecolorLabel).toHaveBeenCalledWith('lbl:work');
  });

  it('clicking Delete calls onDeleteLabel with the label key', () => {
    const onDeleteLabel = vi.fn();
    render(<Sidebar {...makeProps({ onDeleteLabel })} />);
    fireEvent.click(screen.getByRole('button', { name: /actions for work/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /delete/i }));
    expect(onDeleteLabel).toHaveBeenCalledWith('lbl:work');
  });
});
