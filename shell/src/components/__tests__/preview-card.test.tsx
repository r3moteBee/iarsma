/**
 * @vitest-environment jsdom
 *
 * PreviewCard — the shared propose/preview/commit surface from PR 6.
 * One component, two consumers (Compose's send-preview, Approvals'
 * per-row card). These tests pin its API contract.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PreviewCard } from '../preview-card.js';
import { runAxe } from '../../__tests__/util/axe.js';

afterEach(() => {
  cleanup();
});

describe('PreviewCard — header', () => {
  it('renders the title alone when no actor is provided', () => {
    render(<PreviewCard title="Send this message?" />);
    expect(
      screen.getByRole('heading', { name: 'Send this message?' }),
    ).toBeInTheDocument();
  });

  it('combines actor name and title in the header heading', () => {
    render(<PreviewCard actor={{ name: 'Triage Agent' }} title="mail.send" />);
    // Both pieces appear inside the same <h3>.
    const heading = screen.getByRole('heading');
    expect(heading.textContent).toContain('Triage Agent');
    expect(heading.textContent).toContain('mail.send');
  });

  it('renders badges next to the title', () => {
    render(<PreviewCard title="Approve?" badges={['mail.send', 'mail:send']} />);
    expect(screen.getByText('mail.send')).toBeInTheDocument();
    expect(screen.getByText('mail:send')).toBeInTheDocument();
  });

  it('renders meta text in the header', () => {
    render(<PreviewCard title="Test" meta="2 min ago" />);
    expect(screen.getByText('2 min ago')).toBeInTheDocument();
  });
});

describe('PreviewCard — details', () => {
  it('renders labeled rows as a definition list', () => {
    render(
      <PreviewCard
        title="Send"
        details={[
          { label: 'To', value: 'alice@example.net' },
          { label: 'Subject', value: 'Hello' },
        ]}
      />,
    );
    expect(screen.getByText('To')).toBeInTheDocument();
    expect(screen.getByText('alice@example.net')).toBeInTheDocument();
    expect(screen.getByText('Subject')).toBeInTheDocument();
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('renders the free-form body slot below the details', () => {
    render(
      <PreviewCard
        title="Test"
        body={<pre data-testid="body">body content here</pre>}
      />,
    );
    expect(screen.getByTestId('body')).toHaveTextContent('body content here');
  });
});

describe('PreviewCard — raw disclosure', () => {
  it('is closed by default', () => {
    render(<PreviewCard title="Test" rawPreview={{ a: 1 }} />);
    expect(screen.getByRole('button', { name: /show raw preview/i })).toBeInTheDocument();
    expect(screen.queryByText(/"a": 1/)).not.toBeInTheDocument();
  });

  it('toggles open on click', () => {
    render(<PreviewCard title="Test" rawPreview={{ a: 1 }} />);
    fireEvent.click(screen.getByRole('button', { name: /show raw preview/i }));
    expect(screen.getByText(/"a": 1/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /hide raw preview/i }));
    expect(screen.queryByText(/"a": 1/)).not.toBeInTheDocument();
  });

  it('is omitted entirely when no rawPreview is provided', () => {
    render(<PreviewCard title="Test" />);
    expect(screen.queryByRole('button', { name: /show raw preview/i })).toBeNull();
  });
});

describe('PreviewCard — footer actions', () => {
  it('renders primary + secondary buttons when status is pending', () => {
    const onApprove = vi.fn();
    const onDeny = vi.fn();
    render(
      <PreviewCard
        title="Test"
        primary={{ label: 'Approve', onClick: onApprove }}
        secondary={{ label: 'Deny', onClick: onDeny, intent: 'destructive' }}
        status="pending"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onApprove).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(onDeny).toHaveBeenCalledOnce();
  });

  it('hides action buttons and shows an approved pill when status is approved', () => {
    render(
      <PreviewCard
        title="Test"
        primary={{ label: 'Approve', onClick: () => {} }}
        status="approved"
      />,
    );
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.getByText('Approved')).toBeInTheDocument();
  });

  it('hides action buttons and shows a denied pill when status is denied', () => {
    render(
      <PreviewCard
        title="Test"
        primary={{ label: 'Approve', onClick: () => {} }}
        status="denied"
      />,
    );
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.getByText('Denied')).toBeInTheDocument();
  });

  it('disables the primary button when disabled is true', () => {
    render(
      <PreviewCard
        title="Test"
        primary={{ label: 'Approve', onClick: () => {}, disabled: true }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
  });
});

describe('PreviewCard — a11y', () => {
  it('has zero axe-core violations against WCAG 2.1 AA', async () => {
    const { container } = render(
      <PreviewCard
        title="Test preview"
        actor={{ name: 'Triage Agent', kind: 'agent' }}
        badges={['mail.send']}
        meta="2 min ago"
        details={[{ label: 'To', value: 'alice@example.net' }]}
        primary={{ label: 'Approve', onClick: () => {} }}
        secondary={{ label: 'Deny', onClick: () => {}, intent: 'destructive' }}
      />,
    );
    const violations = await runAxe(container);
    expect(violations.map((v) => v.id)).toEqual([]);
  });
});

