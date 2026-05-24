/**
 * @vitest-environment jsdom
 *
 * Render + behavior tests for the reusable component library (Phase 4).
 *
 * Each describe block covers one component with basic rendering and
 * interaction assertions. Accessibility-specific tests live separately
 * in the a11y test file.
 */

import { cleanup, render, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Button } from '../button.js';
import { Input } from '../input.js';
import { Badge } from '../badge.js';
import { Avatar } from '../avatar.js';
import { Card } from '../card.js';
import { Skeleton } from '../skeleton.js';
import { EmptyState } from '../empty-state.js';
import { Dialog } from '../dialog.js';

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------
describe('Button', () => {
  it('renders children as text content', () => {
    const { getByRole } = render(<Button>Save</Button>);
    expect(getByRole('button')).toHaveTextContent('Save');
  });

  it('fires onClick when clicked', () => {
    const handler = vi.fn();
    const { getByRole } = render(<Button onClick={handler}>Click</Button>);
    fireEvent.click(getByRole('button'));
    expect(handler).toHaveBeenCalledOnce();
  });

  it('does not fire onClick when disabled', () => {
    const handler = vi.fn();
    const { getByRole } = render(
      <Button onClick={handler} disabled>
        Click
      </Button>,
    );
    expect(getByRole('button')).toBeDisabled();
  });

  it('applies the correct type attribute', () => {
    const { getByRole } = render(<Button type="submit">Go</Button>);
    expect(getByRole('button')).toHaveAttribute('type', 'submit');
  });

  it('defaults to type="button"', () => {
    const { getByRole } = render(<Button>Go</Button>);
    expect(getByRole('button')).toHaveAttribute('type', 'button');
  });

  it('forwards aria-label', () => {
    const { getByRole } = render(<Button aria-label="Close dialog">X</Button>);
    expect(getByRole('button')).toHaveAttribute('aria-label', 'Close dialog');
  });
});

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
describe('Input', () => {
  it('renders a label when provided', () => {
    const { getByLabelText } = render(
      <Input label="Email" value="" onChange={() => {}} />,
    );
    expect(getByLabelText('Email')).toBeInTheDocument();
  });

  it('fires onChange with the new value', () => {
    const handler = vi.fn();
    const { getByRole } = render(
      <Input value="" onChange={handler} />,
    );
    fireEvent.change(getByRole('textbox'), { target: { value: 'hello' } });
    expect(handler).toHaveBeenCalledWith('hello');
  });

  it('renders an error message', () => {
    const { getByText } = render(
      <Input value="" onChange={() => {}} error="Required field" />,
    );
    expect(getByText('Required field')).toBeInTheDocument();
  });

  it('associates the error with the input via aria-describedby', () => {
    const { getByRole, getByText } = render(
      <Input id="email" value="" onChange={() => {}} error="Required" />,
    );
    const input = getByRole('textbox');
    const error = getByText('Required');
    expect(input).toHaveAttribute('aria-describedby', error.id);
  });

  it('marks the input as invalid when error is present', () => {
    const { getByRole } = render(
      <Input value="" onChange={() => {}} error="Bad" />,
    );
    expect(getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
  });
});

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------
describe('Badge', () => {
  it('renders children', () => {
    const { getByText } = render(<Badge>42</Badge>);
    expect(getByText('42')).toBeInTheDocument();
  });

  it('renders with status variant showing a dot indicator', () => {
    const { container } = render(<Badge variant="status" color="success">Online</Badge>);
    // Status badges have a dot element
    const dot = container.querySelector('[class*="dot"]');
    expect(dot).not.toBeNull();
  });

  it('renders with scope variant', () => {
    const { getByText } = render(<Badge variant="scope">mail:read</Badge>);
    expect(getByText('mail:read')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Avatar
// ---------------------------------------------------------------------------
describe('Avatar', () => {
  it('renders initials from a two-part name', () => {
    const { getByText } = render(<Avatar name="Brent Sauer" />);
    expect(getByText('BS')).toBeInTheDocument();
  });

  it('renders a single initial for a one-part name', () => {
    const { getByText } = render(<Avatar name="Brent" />);
    expect(getByText('B')).toBeInTheDocument();
  });

  it('produces a consistent color for the same name', () => {
    const { container: a } = render(<Avatar name="Alice Smith" />);
    const { container: b } = render(<Avatar name="Alice Smith" />);
    const styleA = a.firstElementChild?.getAttribute('style');
    const styleB = b.firstElementChild?.getAttribute('style');
    expect(styleA).toBe(styleB);
  });

  it('applies aria-label with the full name', () => {
    const { getByLabelText } = render(<Avatar name="Brent Sauer" />);
    expect(getByLabelText('Brent Sauer')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------
describe('Card', () => {
  it('renders children', () => {
    const { getByText } = render(<Card>Card content</Card>);
    expect(getByText('Card content')).toBeInTheDocument();
  });

  it('fires onClick when clickable', () => {
    const handler = vi.fn();
    const { getByText } = render(<Card onClick={handler}>Click me</Card>);
    fireEvent.click(getByText('Click me'));
    expect(handler).toHaveBeenCalledOnce();
  });

  it('applies role when provided', () => {
    const { getByRole } = render(<Card role="listitem">Item</Card>);
    expect(getByRole('listitem')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------
describe('Skeleton', () => {
  it('renders with text variant by default', () => {
    const { container } = render(<Skeleton />);
    const el = container.firstElementChild;
    expect(el).not.toBeNull();
  });

  it('renders circle variant', () => {
    const { container } = render(<Skeleton variant="circle" />);
    const el = container.firstElementChild;
    expect(el?.className).toContain('circle');
  });

  it('renders rect variant', () => {
    const { container } = render(<Skeleton variant="rect" />);
    const el = container.firstElementChild;
    expect(el?.className).toContain('rect');
  });

  it('applies custom width and height', () => {
    const { container } = render(<Skeleton width="200px" height="40px" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.width).toBe('200px');
    expect(el.style.height).toBe('40px');
  });
});

// ---------------------------------------------------------------------------
// EmptyState
// ---------------------------------------------------------------------------
describe('EmptyState', () => {
  it('renders title', () => {
    const { getByText } = render(<EmptyState title="No messages" />);
    expect(getByText('No messages')).toBeInTheDocument();
  });

  it('renders description when provided', () => {
    const { getByText } = render(
      <EmptyState title="No messages" description="Your inbox is empty" />,
    );
    expect(getByText('Your inbox is empty')).toBeInTheDocument();
  });

  it('renders action button when provided', () => {
    const handler = vi.fn();
    const { getByRole } = render(
      <EmptyState
        title="No messages"
        action={{ label: 'Refresh', onClick: handler }}
      />,
    );
    const button = getByRole('button', { name: 'Refresh' });
    fireEvent.click(button);
    expect(handler).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------
describe('Dialog', () => {
  // jsdom does not implement HTMLDialogElement.showModal() natively.
  // Polyfill the bare minimum so the component can call it.
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal ??= vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    HTMLDialogElement.prototype.close ??= vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
  });

  it('renders title and children when open', () => {
    const { getByText } = render(
      <Dialog open onClose={() => {}} title="Confirm">
        Are you sure?
      </Dialog>,
    );
    expect(getByText('Confirm')).toBeInTheDocument();
    expect(getByText('Are you sure?')).toBeInTheDocument();
  });

  it('calls onClose when the close button is clicked', () => {
    const handler = vi.fn();
    const { getByRole } = render(
      <Dialog open onClose={handler} title="Test">
        Body
      </Dialog>,
    );
    fireEvent.click(getByRole('button', { name: /close/i }));
    expect(handler).toHaveBeenCalledOnce();
  });

  it('renders footer when provided', () => {
    const { getByText } = render(
      <Dialog open onClose={() => {}} title="Test" footer={<span>Footer content</span>}>
        Body
      </Dialog>,
    );
    expect(getByText('Footer content')).toBeInTheDocument();
  });

  it('calls onClose on Escape key via cancel event', () => {
    const handler = vi.fn();
    const { getByRole } = render(
      <Dialog open onClose={handler} title="Test">
        Body
      </Dialog>,
    );
    const dialog = getByRole('dialog');
    fireEvent(dialog, new Event('cancel'));
    expect(handler).toHaveBeenCalledOnce();
  });
});
