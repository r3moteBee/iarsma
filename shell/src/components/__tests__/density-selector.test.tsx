/**
 * @vitest-environment jsdom
 *
 * DensitySelector — §5.3 / PR 7. Three-way segmented control.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Provider as JotaiProvider } from 'jotai';
import { afterEach, describe, expect, it } from 'vitest';
import { DensitySelector } from '../density-selector.js';

afterEach(() => {
  cleanup();
  if (typeof localStorage !== 'undefined') localStorage.clear();
});

function renderSelector() {
  return render(
    <JotaiProvider>
      <DensitySelector />
    </JotaiProvider>,
  );
}

describe('DensitySelector', () => {
  it('renders three labeled options', () => {
    renderSelector();
    expect(screen.getByRole('group', { name: 'Density' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dense' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Normal' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Spacious' })).toBeInTheDocument();
  });

  it('starts with Normal pressed', () => {
    renderSelector();
    expect(screen.getByRole('button', { name: 'Normal' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Dense' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('flips the pressed state when an option is clicked', () => {
    renderSelector();
    fireEvent.click(screen.getByRole('button', { name: 'Spacious' }));
    expect(screen.getByRole('button', { name: 'Spacious' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Normal' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('persists the choice to localStorage', () => {
    renderSelector();
    fireEvent.click(screen.getByRole('button', { name: 'Dense' }));
    const raw = localStorage.getItem('iarsma-appearance');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as { density?: string };
    expect(parsed.density).toBe('dense');
  });
});
