/**
 * @vitest-environment jsdom
 *
 * AccentPicker — §5.2 / PR 7. Six curated swatches in a radiogroup.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Provider as JotaiProvider } from 'jotai';
import { afterEach, describe, expect, it } from 'vitest';
import { AccentPicker } from '../accent-picker.js';
import { ACCENT_PRESETS } from '../../runtime/appearance.js';

afterEach(() => {
  cleanup();
  if (typeof localStorage !== 'undefined') localStorage.clear();
});

function renderPicker() {
  return render(
    <JotaiProvider>
      <AccentPicker />
    </JotaiProvider>,
  );
}

describe('AccentPicker — structure', () => {
  it('renders a labeled radiogroup', () => {
    renderPicker();
    expect(screen.getByRole('radiogroup', { name: 'Accent color' })).toBeInTheDocument();
  });

  it('renders one radio button per preset, labeled by name', () => {
    renderPicker();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(ACCENT_PRESETS.length);
    for (const preset of ACCENT_PRESETS) {
      expect(screen.getByRole('radio', { name: preset.name })).toBeInTheDocument();
    }
  });

  it('starts with Ember selected by default', () => {
    renderPicker();
    expect(screen.getByRole('radio', { name: 'Ember' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});

describe('AccentPicker — selection', () => {
  it('flips aria-checked when a swatch is clicked', () => {
    renderPicker();
    fireEvent.click(screen.getByRole('radio', { name: 'Sky' }));
    expect(screen.getByRole('radio', { name: 'Sky' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('radio', { name: 'Ember' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('persists the choice to localStorage', () => {
    renderPicker();
    fireEvent.click(screen.getByRole('radio', { name: 'Violet' }));
    // Atom-set persists synchronously; read back.
    const raw = localStorage.getItem('iarsma-appearance');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as { accent?: string };
    expect(parsed.accent).toBe('violet');
  });
});
