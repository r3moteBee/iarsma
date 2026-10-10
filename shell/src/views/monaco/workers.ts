/**
 * Monaco web-worker wiring for the bundled (self-hosted) editor.
 *
 * Monaco runs its language services in web workers and asks the host
 * page for them via `self.MonacoEnvironment.getWorker(workerId, label)`.
 * Vite's `?worker` suffix turns each worker entry into its own
 * same-origin chunk under `assets/` and hands back a constructor, so the
 * workers load under the CSP's `worker-src 'self'` with no CDN and no
 * blob: indirection.
 *
 * Kept in its own module so tests can mock it: the `?worker` imports
 * only resolve inside Vite's bundler pipeline, and jsdom has no Worker.
 */

import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

/**
 * Map a Monaco worker label to its worker. Labels come from the
 * language contributions bundled with `monaco-editor`; anything without
 * a dedicated language service (markdown, yaml, rust, ...) gets the
 * generic editor worker.
 */
export function createMonacoWorker(_workerId: string, label: string): Worker {
  switch (label) {
    case 'json':
      return new JsonWorker();
    case 'css':
    case 'scss':
    case 'less':
      return new CssWorker();
    case 'html':
    case 'handlebars':
    case 'razor':
      return new HtmlWorker();
    case 'typescript':
    case 'javascript':
      return new TsWorker();
    default:
      return new EditorWorker();
  }
}
