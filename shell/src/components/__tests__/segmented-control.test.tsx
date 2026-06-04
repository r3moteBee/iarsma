/**
 * @vitest-environment jsdom
 *
 * Tests for SegmentedControl (PR 11 — §12).
 *
 * Covers:
 *   - Renders one button per option.
 *   - aria-pressed reflects the current value.
 *   - onChange fires with the option value on click.
 *   - Icon option falls back to label as accessible name.
 *   - Disabled option is unclickable.
 *   - axe-core baseline.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runAxe } from '../../__tests__/util/axe.js';
import { SegmentedControl, type SegmentedOption } from '../segmented-control.js';

afterEach(cleanup);

type Mode = 'a' | 'b' | 'c';

const OPTIONS: ReadonlyArray<SegmentedOption<Mode>> = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' },
];

describe('SegmentedControl', () => {
  it('renders one button per option with the option label', () => {
    render(
      <SegmentedControl
        label="Letter"
        options={OPTIONS}
        value="a"
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'Alpha' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Beta' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gamma' })).toBeInTheDocument();
  });

  it('marks the active option with aria-pressed=true', () => {
    render(
      <SegmentedControl
        label="Letter"
        options={OPTIONS}
        value="b"
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'Beta' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Alpha' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('calls onChange with the option value when clicked', () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        label="Letter"
        options={OPTIONS}
        value="a"
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Beta' }));
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('uses the label as accessible name when an icon is supplied', () => {
    const iconOpts: ReadonlyArray<SegmentedOption<'l' | 'r'>> = [
      { value: 'l', label: 'Left', icon: <span data-testid="icon-left">L</span> },
      { value: 'r', label: 'Right', icon: <span data-testid="icon-right">R</span> },
    ];
    render(
      <SegmentedControl
        label="Side"
        options={iconOpts}
        value="l"
        onChange={() => {}}
      />,
    );
    // Accessible name comes from aria-label, not body text.
    expect(screen.getByRole('button', { name: 'Left' })).toBeInTheDocument();
    expect(screen.getByTestId('icon-left')).toBeInTheDocument();
  });

  it('respects a disabled option', () => {
    const opts: ReadonlyArray<SegmentedOption<Mode>> = [
      { value: 'a', label: 'Alpha' },
      { value: 'b', label: 'Beta', disabled: true },
    ];
    const onChange = vi.fn();
    render(
      <SegmentedControl
        label="Letter"
        options={opts}
        value="a"
        onChange={onChange}
      />,
    );
    const beta = screen.getByRole('button', { name: 'Beta' });
    expect(beta).toBeDisabled();
    fireEvent.click(beta);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <SegmentedControl
        label="Letter"
        options={OPTIONS}
        value="a"
        onChange={() => {}}
      />,
    );
    expect(await runAxe(container)).toEqual([]);
  });
});
