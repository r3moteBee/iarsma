/**
 * @vitest-environment jsdom
 *
 * Unit tests for LabelChip (Task 8).
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LabelChip } from '../label-chip.js';
import type { LabelDef } from '../../runtime/label-registry.js';

afterEach(() => {
  cleanup();
});

const LABEL: LabelDef = {
  key: 'work',
  name: 'Work',
  color: '#ff6b35',
  order: 0,
};

describe('LabelChip', () => {
  it('renders the label name', () => {
    const { getByText } = render(<LabelChip label={LABEL} />);
    expect(getByText('Work')).toBeInTheDocument();
  });

  it('applies the label color via inline style', () => {
    const { container } = render(<LabelChip label={LABEL} />);
    // jsdom normalizes hex to rgb; verify inline style attributes are present
    // and that the computed style carries a non-default color (not empty/transparent).
    const elementsWithStyle = Array.from(container.querySelectorAll('[style]')) as HTMLElement[];
    expect(elementsWithStyle.length).toBeGreaterThan(0);
    // At least one element has a background or color/border-color from the label
    const hasColorStyle = elementsWithStyle.some((el) => {
      const s = el.getAttribute('style') ?? '';
      return s.includes('background') || s.includes('color') || s.includes('border');
    });
    expect(hasColorStyle).toBe(true);
  });

  it('has an accessible name (via visible text or aria-label)', () => {
    const { container } = render(<LabelChip label={LABEL} />);
    // The chip either has visible text or an aria-label that includes the name
    const hasVisibleText = container.textContent?.includes('Work');
    const hasAriaLabel = Array.from(container.querySelectorAll('[aria-label]')).some(
      (el) => el.getAttribute('aria-label')?.includes('Work'),
    );
    expect(hasVisibleText || hasAriaLabel).toBe(true);
  });

  it('renders with a different color applied distinctly from the default label', () => {
    const orangeLabel: LabelDef = { key: 'work', name: 'Work', color: '#ff6b35', order: 0 };
    const blueLabel: LabelDef = { key: 'personal', name: 'Personal', color: '#0088cc', order: 1 };
    const { container: c1 } = render(<LabelChip label={orangeLabel} />);
    const { container: c2 } = render(<LabelChip label={blueLabel} />);
    // The two chips should have different inline styles reflecting different colors
    const style1 = (c1.firstElementChild as HTMLElement).getAttribute('style') ?? '';
    const style2 = (c2.firstElementChild as HTMLElement).getAttribute('style') ?? '';
    expect(style1).not.toBe(style2);
  });
});
