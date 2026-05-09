/**
 * axe-core harness for component-level a11y assertions (D-013, D-029,
 * CT-1 in `docs/implementation-plan.md`).
 *
 * Returns the violations array directly so tests can assert against
 * specific rule failures (or simply expect an empty list for the
 * baseline "must have zero violations" assertion).
 *
 * Usage (per-file jsdom env):
 *
 *     /\* @vitest-environment jsdom *\/
 *     import { render } from '@testing-library/react';
 *     import { runAxe } from './util/axe.js';
 *
 *     it('has no a11y violations', async () => {
 *       const { container } = render(<MyComponent />);
 *       expect(await runAxe(container)).toEqual([]);
 *     });
 */

import axe from 'axe-core';

export type AxeViolation = axe.Result;

/**
 * Run axe-core against `container` and return the array of violations.
 * Empty array = passing baseline. Configure rule overrides per-call when
 * a rule needs to be deferred with rationale (see axe-core's `runOnly`
 * and `rules` options).
 *
 * Why explicit `rules`/`reporter` defaults: axe defaults to WCAG 2.1 AA
 * which matches D-013. Locking it here means new tests don't drift; if
 * a rule needs an exception it should be opted out per-test with a
 * comment, not silently dropped from the suite.
 */
export async function runAxe(
  container: Element,
  options: axe.RunOptions = {},
): Promise<AxeViolation[]> {
  const result = await axe.run(container, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    ...options,
  });
  return result.violations;
}
