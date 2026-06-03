/**
 * @vitest-environment jsdom
 *
 * Notice — shared banner-shaped notification (§8.8 / PR 6.5).
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Notice } from '../notice.js';
import { runAxe } from '../../__tests__/util/axe.js';

afterEach(() => {
  cleanup();
});

describe('Notice — role mapping', () => {
  it('uses role=alert for the error variant', () => {
    const { container } = render(<Notice variant="error">Something broke</Notice>);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('uses role=status for non-error variants', () => {
    const { container, rerender } = render(<Notice variant="info">FYI</Notice>);
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    rerender(<Notice variant="warning">Heads up</Notice>);
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    rerender(<Notice variant="success">Saved</Notice>);
    expect(container.querySelector('[role="status"]')).not.toBeNull();
  });

  it('defaults to the info variant (role=status)', () => {
    const { container } = render(<Notice>just text</Notice>);
    expect(container.querySelector('[role="status"]')).not.toBeNull();
  });
});

describe('Notice — content', () => {
  it('renders children inline', () => {
    render(<Notice variant="error">Send failed: timeout</Notice>);
    expect(screen.getByText('Send failed: timeout')).toBeInTheDocument();
  });

  it('renders structured children (ReactNode body)', () => {
    render(
      <Notice variant="warning">
        <strong>Heads up:</strong> partial result.
      </Notice>,
    );
    expect(screen.getByText('Heads up:')).toBeInTheDocument();
    expect(screen.getByText(/partial result/)).toBeInTheDocument();
  });
});

describe('Notice — dismiss', () => {
  it('renders no dismiss button by default', () => {
    render(<Notice variant="info">FYI</Notice>);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('fires onDismiss when the × is clicked', () => {
    const onDismiss = vi.fn();
    render(
      <Notice variant="warning" onDismiss={onDismiss}>
        Heads up
      </Notice>,
    );
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('uses the custom ariaLabel on the dismiss button when provided', () => {
    render(
      <Notice variant="warning" onDismiss={() => {}} ariaLabel="Close warning">
        Heads up
      </Notice>,
    );
    expect(screen.getByRole('button', { name: 'Close warning' })).toBeInTheDocument();
  });
});

describe('Notice — a11y', () => {
  it('has zero axe-core violations against WCAG 2.1 AA', async () => {
    const { container } = render(
      <Notice variant="error">Send failed: connection refused.</Notice>,
    );
    const violations = await runAxe(container);
    expect(violations.map((v) => v.id)).toEqual([]);
  });

  it('axe passes with a dismiss button', async () => {
    const { container } = render(
      <Notice variant="warning" onDismiss={() => {}}>
        Heads up
      </Notice>,
    );
    const violations = await runAxe(container);
    expect(violations.map((v) => v.id)).toEqual([]);
  });
});
