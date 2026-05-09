/**
 * Vitest test setup — only loaded by tests that opt into the jsdom
 * environment via the `@vitest-environment jsdom` pragma.
 *
 * Registers `@testing-library/jest-dom`'s custom matchers (`toBeVisible`,
 * `toHaveTextContent`, etc.) so component tests can assert against the
 * DOM idiomatically. Wired through `vite.config.ts`'s `test.setupFiles`.
 */

import '@testing-library/jest-dom/vitest';
