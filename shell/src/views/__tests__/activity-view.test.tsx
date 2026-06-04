/**
 * @vitest-environment jsdom
 *
 * Tests for ActivityView (Task -- Phase 3c).
 *
 * Covers:
 *   - Renders table with entries showing correct columns.
 *   - Expandable row shows params JSON when clicked.
 *   - Filter dropdowns render with options.
 *   - Pagination shows correct page info.
 *   - "Verify chain" button calls onVerify.
 *   - Integrity badge shows correct status (verified/failed/checking).
 *   - Empty state shows message.
 *   - Actor "You" for callerClass 'ui', agent name otherwise.
 *   - axe-core baseline.
 */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runAxe } from '../../__tests__/util/axe.js';
import type { ActivityEntry, ActivityViewProps } from '../activity-view.js';
import { ActivityView } from '../activity-view.js';

afterEach(cleanup);

const SAMPLE_ENTRIES: readonly ActivityEntry[] = [
  {
    seq: 1,
    timestamp: '2026-05-23T10:00:00Z',
    actor: 'You',
    callerClass: 'ui',
    action: 'mail.send',
    mode: 'commit',
    params: { to: 'alice@example.com', subject: 'Hello' },
    hashHex: 'abc123',
    prevHashHex: '000000',
  },
  {
    seq: 2,
    timestamp: '2026-05-23T11:00:00Z',
    actor: 'CI Bot',
    callerClass: 'agent',
    action: 'mail.draft',
    mode: 'preview',
    params: { body: 'Draft content' },
    provenance: {
      affectedJson: '{"mailboxId":"inbox"}',
      previewHashHex: 'def456',
    },
    hashHex: 'def789',
    prevHashHex: 'abc123',
  },
  {
    seq: 3,
    timestamp: '2026-05-23T12:00:00Z',
    actor: 'Cleanup Agent',
    callerClass: 'mcp',
    action: 'mail.delete',
    mode: 'commit',
    params: { threadId: '42' },
    hashHex: 'ghi012',
    prevHashHex: 'def789',
  },
];

const DEFAULT_FILTERS: ActivityViewProps['filters'] = {
  actor: 'all',
  action: 'all',
  mode: 'all',
  timeRange: 'all',
};

function defaultProps(overrides?: Partial<ActivityViewProps>): ActivityViewProps {
  return {
    entries: SAMPLE_ENTRIES,
    filters: DEFAULT_FILTERS,
    onFilterChange: vi.fn(),
    page: 1,
    pageSize: 25,
    totalEntries: 3,
    onPageChange: vi.fn(),
    ...overrides,
  };
}

describe('ActivityView', () => {
  describe('rendering', () => {
    it('renders table with entries showing correct columns', () => {
      render(<ActivityView {...defaultProps()} />);

      // Table header columns exist in table
      const table = screen.getByRole('table');
      expect(within(table).getByText('Timestamp')).toBeInTheDocument();
      expect(within(table).getByText('Actor')).toBeInTheDocument();
      expect(within(table).getByText('Action')).toBeInTheDocument();
      expect(within(table).getByText('Mode')).toBeInTheDocument();
      expect(within(table).getByText('Details')).toBeInTheDocument();

      // Entry data visible in table (actors/actions appear in both dropdown
      // and table, so scope the query to the table element)
      expect(within(table).getByText('You')).toBeInTheDocument();
      expect(within(table).getByText('CI Bot')).toBeInTheDocument();
      expect(within(table).getByText('Cleanup Agent')).toBeInTheDocument();
      expect(within(table).getByText('mail.send')).toBeInTheDocument();
      expect(within(table).getByText('mail.draft')).toBeInTheDocument();
      expect(within(table).getByText('mail.delete')).toBeInTheDocument();
    });

    it('displays actor as "You" for callerClass ui', () => {
      const uiEntry: ActivityEntry[] = [
        {
          seq: 1,
          timestamp: '2026-05-23T10:00:00Z',
          actor: 'You',
          callerClass: 'ui',
          action: 'auth.signin',
          params: {},
          hashHex: 'aaa',
          prevHashHex: '000',
        },
      ];
      render(
        <ActivityView
          {...defaultProps({ entries: uiEntry, totalEntries: 1 })}
        />,
      );

      const table = screen.getByRole('table');
      expect(within(table).getByText('You')).toBeInTheDocument();
    });

    it('displays agent name for non-ui callerClass', () => {
      const agentEntry: ActivityEntry[] = [
        {
          seq: 1,
          timestamp: '2026-05-23T10:00:00Z',
          actor: 'My Agent',
          callerClass: 'agent',
          action: 'mail.read',
          params: {},
          hashHex: 'bbb',
          prevHashHex: '000',
        },
      ];
      render(
        <ActivityView
          {...defaultProps({ entries: agentEntry, totalEntries: 1 })}
        />,
      );

      const table = screen.getByRole('table');
      expect(within(table).getByText('My Agent')).toBeInTheDocument();
    });
  });

  describe('expandable rows', () => {
    it('shows structured params when row is clicked', () => {
      render(<ActivityView {...defaultProps()} />);

      // Params not visible initially
      expect(screen.queryByText('alice@example.com')).not.toBeInTheDocument();

      // Click expand button for first row
      const expandButtons = screen.getAllByRole('button', { name: /expand/i });
      fireEvent.click(expandButtons[0]!);

      // §8.5: detail panel renders params as labeled rows, not a raw
      // JSON dump. Key and value should each be present as their own
      // nodes.
      expect(screen.getByText('to')).toBeInTheDocument();
      expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    });

    it('exposes a "view raw JSON" toggle inside the detail panel', () => {
      render(<ActivityView {...defaultProps()} />);

      const expandButtons = screen.getAllByRole('button', { name: /expand/i });
      fireEvent.click(expandButtons[0]!);

      // Raw JSON not shown by default — only the structured rows are.
      expect(screen.queryByText(/"to": "alice@example.com"/)).not.toBeInTheDocument();

      // Reveal raw JSON.
      const rawToggle = screen.getByRole('button', { name: /view raw json/i });
      fireEvent.click(rawToggle);
      expect(screen.getByText(/"to": "alice@example.com"/)).toBeInTheDocument();
    });

    it('shows provenance when present', () => {
      render(<ActivityView {...defaultProps()} />);

      // Click expand on second row (CI Bot, which has provenance)
      const expandButtons = screen.getAllByRole('button', { name: /expand/i });
      fireEvent.click(expandButtons[1]!);

      expect(screen.getByText(/affectedJson/i)).toBeInTheDocument();
      expect(screen.getByText(/def456/)).toBeInTheDocument();
    });

    it('shows hash chain info when expanded', () => {
      render(<ActivityView {...defaultProps()} />);

      const expandButtons = screen.getAllByRole('button', { name: /expand/i });
      fireEvent.click(expandButtons[0]!);

      expect(screen.getByText(/seq/i)).toBeInTheDocument();
      expect(screen.getByText(/abc123/)).toBeInTheDocument();
      expect(screen.getByText(/000000/)).toBeInTheDocument();
    });

    it('collapses when clicked again', () => {
      render(<ActivityView {...defaultProps()} />);

      const expandButtons = screen.getAllByRole('button', { name: /expand/i });
      fireEvent.click(expandButtons[0]!);

      // Detail panel visible (param value renders structured)
      expect(screen.getByText('alice@example.com')).toBeInTheDocument();

      // Click collapse
      const collapseButton = screen.getByRole('button', { name: /collapse/i });
      fireEvent.click(collapseButton);

      // Detail panel hidden
      expect(screen.queryByText('alice@example.com')).not.toBeInTheDocument();
    });
  });

  describe('filter dropdowns', () => {
    it('renders actor dropdown with options from entries', () => {
      render(<ActivityView {...defaultProps()} />);

      const actorSelect = screen.getByLabelText(/actor/i);
      expect(actorSelect).toBeInTheDocument();

      const options = within(actorSelect as HTMLElement).getAllByRole('option');
      const values = options.map((o) => o.textContent);
      expect(values).toContain('All');
      expect(values).toContain('You');
      expect(values).toContain('CI Bot');
      expect(values).toContain('Cleanup Agent');
    });

    it('renders action dropdown with unique tool names', () => {
      render(<ActivityView {...defaultProps()} />);

      const actionSelect = screen.getByLabelText(/action/i);
      const options = within(actionSelect as HTMLElement).getAllByRole('option');
      const values = options.map((o) => o.textContent);
      expect(values).toContain('All');
      expect(values).toContain('mail.send');
      expect(values).toContain('mail.draft');
      expect(values).toContain('mail.delete');
    });

    it('renders mode dropdown', () => {
      render(<ActivityView {...defaultProps()} />);

      const modeSelect = screen.getByLabelText(/mode/i);
      const options = within(modeSelect as HTMLElement).getAllByRole('option');
      const values = options.map((o) => o.textContent);
      expect(values).toContain('All');
      expect(values).toContain('Preview');
      expect(values).toContain('Commit');
    });

    it('renders time range dropdown', () => {
      render(<ActivityView {...defaultProps()} />);

      const timeSelect = screen.getByLabelText(/time range/i);
      const options = within(timeSelect as HTMLElement).getAllByRole('option');
      const values = options.map((o) => o.textContent);
      expect(values).toContain('All');
      expect(values).toContain('Last hour');
      expect(values).toContain('Today');
      expect(values).toContain('Last 7 days');
    });

    it('calls onFilterChange when a filter changes', () => {
      const onFilterChange = vi.fn();
      render(
        <ActivityView {...defaultProps({ onFilterChange })} />,
      );

      const modeSelect = screen.getByLabelText(/mode/i);
      fireEvent.change(modeSelect, { target: { value: 'preview' } });

      expect(onFilterChange).toHaveBeenCalledWith('mode', 'preview');
    });
  });

  describe('pagination', () => {
    it('shows correct page info', () => {
      render(
        <ActivityView
          {...defaultProps({ page: 2, pageSize: 1, totalEntries: 3 })}
        />,
      );

      expect(screen.getByText(/page 2 of 3/i)).toBeInTheDocument();
    });

    it('calls onPageChange when next is clicked', () => {
      const onPageChange = vi.fn();
      render(
        <ActivityView
          {...defaultProps({ page: 1, pageSize: 1, totalEntries: 3, onPageChange })}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: /next/i }));
      expect(onPageChange).toHaveBeenCalledWith(2);
    });

    it('calls onPageChange when previous is clicked', () => {
      const onPageChange = vi.fn();
      render(
        <ActivityView
          {...defaultProps({ page: 2, pageSize: 1, totalEntries: 3, onPageChange })}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: /previous/i }));
      expect(onPageChange).toHaveBeenCalledWith(1);
    });

    it('disables previous on first page', () => {
      render(
        <ActivityView
          {...defaultProps({ page: 1, pageSize: 1, totalEntries: 3 })}
        />,
      );

      expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();
    });

    it('disables next on last page', () => {
      render(
        <ActivityView
          {...defaultProps({ page: 3, pageSize: 1, totalEntries: 3 })}
        />,
      );

      expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
    });
  });

  describe('integrity badge', () => {
    it('shows "Verify chain" button when unchecked', () => {
      const onVerify = vi.fn();
      render(
        <ActivityView
          {...defaultProps({ integrityStatus: 'unchecked', onVerify })}
        />,
      );

      const verifyButton = screen.getByRole('button', { name: /verify chain/i });
      expect(verifyButton).toBeInTheDocument();

      fireEvent.click(verifyButton);
      expect(onVerify).toHaveBeenCalled();
    });

    it('shows green verified status', () => {
      render(
        <ActivityView
          {...defaultProps({ integrityStatus: 'verified' })}
        />,
      );

      // "Verified" appears both in the visible Badge and the
      // visually-hidden aria-live region — getAllByText covers both.
      expect(screen.getAllByText(/verified/i).length).toBeGreaterThan(0);
    });

    it('shows red failed status with error', () => {
      render(
        <ActivityView
          {...defaultProps({
            integrityStatus: 'failed',
            integrityError: 'Hash mismatch at seq 5',
          })}
        />,
      );

      expect(screen.getAllByText(/failed/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/hash mismatch at seq 5/i).length).toBeGreaterThan(0);
    });

    it('shows spinner when checking', () => {
      render(
        <ActivityView
          {...defaultProps({ integrityStatus: 'checking' })}
        />,
      );

      expect(screen.getByText(/checking/i)).toBeInTheDocument();
    });
  });

  describe('empty state', () => {
    it('shows message when no entries', () => {
      render(
        <ActivityView
          {...defaultProps({ entries: [], totalEntries: 0 })}
        />,
      );

      expect(screen.getByText(/no activity recorded yet/i)).toBeInTheDocument();
    });
  });

  describe('loading state', () => {
    it('shows loading indicator when isLoading is true', () => {
      render(
        <ActivityView
          {...defaultProps({ isLoading: true })}
        />,
      );

      expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });
  });

  describe('undo button (PR 21, §8.5)', () => {
    it('omits the Undo button when undoableSeqs is undefined', () => {
      render(<ActivityView {...defaultProps()} />);
      expect(screen.queryByRole('button', { name: /undo/i })).not.toBeInTheDocument();
    });

    it('shows Undo only on rows whose seq is in undoableSeqs', () => {
      render(
        <ActivityView
          {...defaultProps({
            undoableSeqs: new Set([1]),
            onUndo: vi.fn(),
          })}
        />,
      );
      // SAMPLE_ENTRIES has seqs 1, 2, 3. Only seq 1 should get an
      // Undo button.
      const buttons = screen.getAllByRole('button', { name: /undo/i });
      expect(buttons).toHaveLength(1);
    });

    it('clicking Undo calls onUndo with the entry seq', () => {
      const onUndo = vi.fn();
      render(
        <ActivityView
          {...defaultProps({ undoableSeqs: new Set([2]), onUndo })}
        />,
      );
      const btn = screen.getByRole('button', { name: /undo/i });
      fireEvent.click(btn);
      expect(onUndo).toHaveBeenCalledWith(2);
    });
  });

  describe('accessibility', () => {
    it('has no axe violations', async () => {
      const { container } = render(
        <ActivityView {...defaultProps()} />,
      );

      expect(await runAxe(container)).toEqual([]);
    });
  });
});
