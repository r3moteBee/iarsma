/**
 * @vitest-environment jsdom
 *
 * Tests for ApprovalsView (Task — Phase 3b).
 *
 * Covers:
 *   - Renders pending approvals with agent name and tool name.
 *   - Approve button calls onApprove with the correct ID.
 *   - Deny button calls onDeny with the correct ID.
 *   - Tab filtering shows only matching status.
 *   - Pending tab shows count badge.
 *   - Empty state renders correct message.
 *   - Preview toggle expands/collapses.
 *   - Approved/denied items don't show action buttons.
 *   - axe-core baseline.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runAxe } from '../../__tests__/util/axe.js';
import type { ApprovalCardData } from '../approvals-view.js';
import { ApprovalsView } from '../approvals-view.js';

afterEach(cleanup);

const SAMPLE_APPROVALS: readonly ApprovalCardData[] = [
  {
    id: 'appr-1',
    toolName: 'mail.send',
    agentName: 'CI Bot',
    summary: 'mail.send to alice@example.com — 2 attachments',
    requestedAt: new Date(Date.now() - 3 * 60_000).toISOString(), // 3 min ago
    status: 'pending',
    preview: { to: 'alice@example.com', subject: 'Build report' },
    params: { attachments: 2 },
  },
  {
    id: 'appr-2',
    toolName: 'mail.delete',
    agentName: 'Cleanup Agent',
    summary: 'mail.delete thread #42',
    requestedAt: new Date(Date.now() - 60 * 60_000).toISOString(), // 1 hour ago
    status: 'approved',
    preview: { threadId: '42' },
    params: {},
  },
  {
    id: 'appr-3',
    toolName: 'mail.send',
    agentName: 'Spam Bot',
    summary: 'mail.send to spam@example.com',
    requestedAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString(), // 2 hours ago
    status: 'denied',
    preview: { to: 'spam@example.com' },
    params: {},
  },
  {
    id: 'appr-4',
    toolName: 'mail.draft',
    agentName: 'Draft Agent',
    summary: 'mail.draft for review',
    requestedAt: new Date(Date.now() - 5 * 60_000).toISOString(), // 5 min ago
    status: 'pending',
    preview: { body: 'Draft content' },
    params: {},
  },
];

function noop() {
  return Promise.resolve();
}

describe('ApprovalsView', () => {
  describe('rendering', () => {
    it('renders pending approvals with agent name and tool name', () => {
      render(
        <ApprovalsView approvals={SAMPLE_APPROVALS} onApprove={noop} onDeny={noop} />,
      );

      // Default tab is "Pending", so only pending items show
      expect(screen.getByText('CI Bot')).toBeInTheDocument();
      expect(screen.getByText('mail.send')).toBeInTheDocument();
      expect(screen.getByText('Draft Agent')).toBeInTheDocument();
      expect(screen.getByText('mail.draft')).toBeInTheDocument();
    });

    it('renders summary line', () => {
      render(
        <ApprovalsView approvals={SAMPLE_APPROVALS} onApprove={noop} onDeny={noop} />,
      );

      // PR 6: PreviewCard renders the actor name and the summary in
      // the same heading ("Agent — summary"). Match the summary as a
      // substring instead of the full element text.
      expect(
        screen.getByText(/mail\.send to alice@example\.com — 2 attachments/),
      ).toBeInTheDocument();
    });

    it('renders relative timestamp', () => {
      render(
        <ApprovalsView approvals={SAMPLE_APPROVALS} onApprove={noop} onDeny={noop} />,
      );

      expect(screen.getByText('3 min ago')).toBeInTheDocument();
    });
  });

  describe('actions', () => {
    it('approve button calls onApprove with the correct ID', async () => {
      const onApprove = vi.fn(noop);
      render(
        <ApprovalsView approvals={SAMPLE_APPROVALS} onApprove={onApprove} onDeny={noop} />,
      );

      const approveButtons = screen.getAllByRole('button', { name: /^approve$/i });
      fireEvent.click(approveButtons[0]!);

      await waitFor(() => {
        expect(onApprove).toHaveBeenCalledWith('appr-1');
      });
    });

    it('deny button calls onDeny with the correct ID', async () => {
      const onDeny = vi.fn(noop);
      render(
        <ApprovalsView approvals={SAMPLE_APPROVALS} onApprove={noop} onDeny={onDeny} />,
      );

      const denyButtons = screen.getAllByRole('button', { name: /^deny$/i });
      fireEvent.click(denyButtons[0]!);

      await waitFor(() => {
        expect(onDeny).toHaveBeenCalledWith('appr-1');
      });
    });

    it('approved/denied items do not show action buttons', () => {
      render(
        <ApprovalsView approvals={SAMPLE_APPROVALS} onApprove={noop} onDeny={noop} />,
      );

      // Switch to "All" tab
      fireEvent.click(screen.getByRole('button', { name: /all/i }));

      // The approved item (Cleanup Agent) and denied item (Spam Bot) should be visible
      expect(screen.getByText('Cleanup Agent')).toBeInTheDocument();
      expect(screen.getByText('Spam Bot')).toBeInTheDocument();

      // Only 2 approve buttons (for the 2 pending items) and 2 deny buttons
      const approveButtons = screen.getAllByRole('button', { name: /^approve$/i });
      const denyButtons = screen.getAllByRole('button', { name: /^deny$/i });
      expect(approveButtons).toHaveLength(2);
      expect(denyButtons).toHaveLength(2);
    });
  });

  describe('tab filtering', () => {
    it('defaults to pending tab', () => {
      render(
        <ApprovalsView approvals={SAMPLE_APPROVALS} onApprove={noop} onDeny={noop} />,
      );

      // Pending tab is active
      const pendingTab = screen.getByRole('button', { name: /pending/i });
      expect(pendingTab).toHaveAttribute('aria-current', 'page');

      // Only pending items visible
      expect(screen.getByText('CI Bot')).toBeInTheDocument();
      expect(screen.getByText('Draft Agent')).toBeInTheDocument();
      expect(screen.queryByText('Cleanup Agent')).not.toBeInTheDocument();
      expect(screen.queryByText('Spam Bot')).not.toBeInTheDocument();
    });

    it('approved tab shows only approved items', () => {
      render(
        <ApprovalsView approvals={SAMPLE_APPROVALS} onApprove={noop} onDeny={noop} />,
      );

      fireEvent.click(screen.getByRole('button', { name: /approved/i }));

      expect(screen.getByText('Cleanup Agent')).toBeInTheDocument();
      expect(screen.queryByText('CI Bot')).not.toBeInTheDocument();
      expect(screen.queryByText('Spam Bot')).not.toBeInTheDocument();
    });

    it('denied tab shows only denied items', () => {
      render(
        <ApprovalsView approvals={SAMPLE_APPROVALS} onApprove={noop} onDeny={noop} />,
      );

      fireEvent.click(screen.getByRole('button', { name: /denied/i }));

      expect(screen.getByText('Spam Bot')).toBeInTheDocument();
      expect(screen.queryByText('CI Bot')).not.toBeInTheDocument();
      expect(screen.queryByText('Cleanup Agent')).not.toBeInTheDocument();
    });

    it('all tab shows every item', () => {
      render(
        <ApprovalsView approvals={SAMPLE_APPROVALS} onApprove={noop} onDeny={noop} />,
      );

      fireEvent.click(screen.getByRole('button', { name: /all/i }));

      expect(screen.getByText('CI Bot')).toBeInTheDocument();
      expect(screen.getByText('Cleanup Agent')).toBeInTheDocument();
      expect(screen.getByText('Spam Bot')).toBeInTheDocument();
      expect(screen.getByText('Draft Agent')).toBeInTheDocument();
    });

    it('pending tab shows count badge', () => {
      render(
        <ApprovalsView
          approvals={SAMPLE_APPROVALS}
          onApprove={noop}
          onDeny={noop}
          pendingCount={2}
        />,
      );

      const pendingTab = screen.getByRole('button', { name: /pending/i });
      expect(within(pendingTab).getByText('2')).toBeInTheDocument();
    });
  });

  describe('empty states', () => {
    it('shows correct message when no pending approvals', () => {
      const approvedOnly: readonly ApprovalCardData[] = [
        {
          id: 'appr-2',
          toolName: 'mail.delete',
          agentName: 'Cleanup Agent',
          summary: 'mail.delete thread #42',
          requestedAt: new Date().toISOString(),
          status: 'approved',
          preview: null,
          params: {},
        },
      ];

      render(
        <ApprovalsView approvals={approvedOnly} onApprove={noop} onDeny={noop} />,
      );

      expect(
        screen.getByText(/no pending approvals/i),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/agents that require approval will appear here/i),
      ).toBeInTheDocument();
    });

    it('shows correct message when no approvals at all', () => {
      render(
        <ApprovalsView approvals={[]} onApprove={noop} onDeny={noop} />,
      );

      expect(screen.getByText(/no approval history yet/i)).toBeInTheDocument();
    });
  });

  describe('preview toggle', () => {
    it('expands and collapses the raw-preview section', () => {
      render(
        <ApprovalsView approvals={SAMPLE_APPROVALS} onApprove={noop} onDeny={noop} />,
      );

      // PR 6: SAMPLE_APPROVALS use the `mail.send` tool which doesn't
      // have a structured formatter today — PreviewCard falls back to
      // the "Show raw preview" disclosure (closed by default).
      expect(screen.queryByText(/"to": "alice@example\.com"/)).not.toBeInTheDocument();

      const showButtons = screen.getAllByRole('button', { name: /show raw preview/i });
      fireEvent.click(showButtons[0]!);

      expect(screen.getByText(/"to": "alice@example\.com"/)).toBeInTheDocument();

      const hideButton = screen.getByRole('button', { name: /hide raw preview/i });
      fireEvent.click(hideButton);

      expect(screen.queryByText(/"to": "alice@example\.com"/)).not.toBeInTheDocument();
    });
  });

  describe('loading state', () => {
    it('shows loading indicator when isLoading is true', () => {
      render(
        <ApprovalsView
          approvals={[]}
          onApprove={noop}
          onDeny={noop}
          isLoading={true}
        />,
      );

      expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('has no axe violations', async () => {
      const { container } = render(
        <ApprovalsView approvals={SAMPLE_APPROVALS} onApprove={noop} onDeny={noop} />,
      );

      expect(await runAxe(container)).toEqual([]);
    });
  });
});
