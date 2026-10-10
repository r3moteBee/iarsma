/**
 * Self-hosted Monaco for `@monaco-editor/react`.
 *
 * By default `@monaco-editor/react`'s loader injects a <script> pointing
 * at cdn.jsdelivr.net and pulls the whole editor from there at runtime,
 * i.e. third-party code executing in the origin that holds the OAuth
 * token-wrap key. The CSP (`script-src 'self'`, see index.html) blocks
 * that anyway; this module makes the editor work under it by handing the
 * loader the `monaco-editor` package bundled by Vite (`loader.config({
 * monaco })`), so the loader never builds a CDN URL.
 *
 * Imported only through the lazy `import()` in files-view.tsx, so the
 * multi-MB editor stays in its own chunk and costs nothing until the
 * Files view opens a text file. Configuration happens at module
 * evaluation, which the dynamic import guarantees runs before `Editor`
 * first mounts.
 */

import * as monaco from 'monaco-editor';
import { Editor, loader } from '@monaco-editor/react';
import { createMonacoWorker } from './workers.js';

self.MonacoEnvironment = { getWorker: createMonacoWorker };
loader.config({ monaco });

export { Editor };
