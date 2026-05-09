/**
 * @vitest-environment jsdom
 *
 * Per-component accessibility tests via axe-core (D-013, D-029, CT-1).
 *
 * The pattern this file establishes:
 *
 *   1. Render the component under test with React Testing Library.
 *   2. Hand the rendered container to `runAxe()`.
 *   3. Expect zero violations against WCAG 2.1 AA.
 *
 * New components add their own a11y test alongside their unit tests.
 * The baseline is "no axe violations" — exceptions get documented with a
 * scoped `axe.run` rule override and a comment explaining why.
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SignedOutView } from '../views/signed-out-view.js';
import { runAxe } from './util/axe.js';

// React Testing Library's auto-cleanup hooks into a global `afterEach` —
// vitest doesn't expose `afterEach` globally by default, so we register
// the teardown explicitly to keep the DOM scoped to one test at a time.
afterEach(() => {
  cleanup();
});

import type { ShellConfig } from '../config.js';

const SAMPLE_CONFIG: ShellConfig = {
  oidcIssuer: 'https://sw-mail.example.net',
  clientId: 'webmail',
  redirectUri: 'http://localhost:5173/auth/callback',
};

describe('a11y — SignedOutView', () => {
  it('has zero axe-core violations against WCAG 2.1 AA', async () => {
    const { container } = render(<SignedOutView config={SAMPLE_CONFIG} />);
    const violations = await runAxe(container);
    // Surface the rule ids in the failure message so a regression points
    // straight at the offending rule rather than dumping the full result.
    expect(violations.map((v) => v.id)).toEqual([]);
  });

  it('exposes a button labeled for sign-in', () => {
    const { getByRole } = render(<SignedOutView config={SAMPLE_CONFIG} />);
    const button = getByRole('button', { name: /sign in with stalwart/i });
    expect(button).toBeInTheDocument();
    expect(button).toBeEnabled();
  });

  it('uses semantic heading + landmark structure', () => {
    const { getByRole } = render(<SignedOutView config={SAMPLE_CONFIG} />);
    expect(getByRole('heading', { name: 'Sign in', level: 2 })).toBeInTheDocument();
  });
});
