/**
 * Vitest test setup — only loaded by tests that opt into the jsdom
 * environment via the `@vitest-environment jsdom` pragma.
 *
 * Registers `@testing-library/jest-dom`'s custom matchers (`toBeVisible`,
 * `toHaveTextContent`, etc.) so component tests can assert against the
 * DOM idiomatically. Wired through `vite.config.ts`'s `test.setupFiles`.
 */

import '@testing-library/jest-dom/vitest';

// jsdom (as of v25) doesn't implement HTMLDialogElement.showModal /
// close. Polyfill the minimum behavior the shared <Dialog> component
// relies on (toggle the `open` attribute). Without this any test that
// mounts a component using <dialog> + showModal blows up with
// "el.showModal is not a function". Mirrors the per-describe polyfill
// in components.test.tsx and lifts it to global so consumers like
// ComposeView don't have to duplicate it.
if (typeof HTMLDialogElement !== 'undefined') {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
  }
}
