/**
 * `sanitizeToDOMFragment` adapter for Squire (Phase 2 work item 1).
 *
 * Squire's `config.sanitizeToDOMFragment` callback is the chokepoint
 * every paste flows through. We route it through the ammonia WASM
 * component (D-051, PR-13) so pasted Word / Outlook / web markup is
 * normalized the same way received message bodies are. Single source
 * of truth: anything that ends up as HTML in our message store has
 * been through the WASM sanitizer.
 *
 * `allowExternalImages` is hardcoded `false` here. A composer paste
 * containing remote images strips them — composers don't have a
 * "show external images" toggle, and we don't want senders to
 * accidentally leak tracking pixels through copy-paste from an
 * existing email thread.
 */

import { sanitizeHtml } from './sanitizer.js';

export function sanitizeToDOMFragment(html: string): DocumentFragment {
  const safe = sanitizeHtml(html, false);
  // `<template>` parses its innerHTML into an inert DocumentFragment —
  // exactly the contract Squire expects, and the parse runs in a
  // document context so it can't trigger side effects (no resource
  // loads, no script execution).
  const template = document.createElement('template');
  template.innerHTML = safe;
  return template.content;
}
