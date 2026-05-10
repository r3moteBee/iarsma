/**
 * Host wrapper around the `iarsma:html-sanitizer` WASM component.
 *
 * Per D-038 the component is pure — this module is a one-line bridge
 * exposing the typed surface to the React shell. Production callers
 * (MessageView in `views/thread-view.tsx`) call `sanitizeHtml` before
 * setting any sender-controlled bytes via `dangerouslySetInnerHTML`.
 *
 * `allowExternalImages` defaults to false. The MessageView surfaces a
 * per-message toggle that flips it true when the user opts in to
 * "show external content."
 */

// `sanitize` is the WIT interface name; the function within is also
// `sanitize`. Import as a namespace to disambiguate.
import { sanitize as sanitizerInterface } from '@iarsma/wasm-bindings/html-sanitizer';

export function sanitizeHtml(html: string, allowExternalImages = false): string {
  return sanitizerInterface.sanitize(html, allowExternalImages);
}
