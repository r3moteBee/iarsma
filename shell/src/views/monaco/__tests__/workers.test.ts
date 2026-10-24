/**
 * Monaco worker routing. Each `?worker` constructor is replaced with a
 * stub that records which worker entry was built, so the test pins the
 * label → worker table without a real Worker (none in Node).
 */

import { describe, expect, it, vi } from 'vitest';

function stubWorker(entry: string) {
  return {
    default: class {
      readonly entry = entry;
    },
  };
}

vi.mock('monaco-editor/esm/vs/editor/editor.worker?worker', () => stubWorker('editor'));
vi.mock('monaco-editor/esm/vs/language/css/css.worker?worker', () => stubWorker('css'));
vi.mock('monaco-editor/esm/vs/language/html/html.worker?worker', () => stubWorker('html'));
vi.mock('monaco-editor/esm/vs/language/json/json.worker?worker', () => stubWorker('json'));
vi.mock('monaco-editor/esm/vs/language/typescript/ts.worker?worker', () => stubWorker('ts'));

import { createMonacoWorker } from '../workers.js';

describe('createMonacoWorker', () => {
  it.each([
    ['json', 'json'],
    ['css', 'css'],
    ['scss', 'css'],
    ['less', 'css'],
    ['html', 'html'],
    ['handlebars', 'html'],
    ['razor', 'html'],
    ['typescript', 'ts'],
    ['javascript', 'ts'],
    ['editorWorkerService', 'editor'],
    ['markdown', 'editor'],
    ['', 'editor'],
  ])('label %j -> %s worker', (label, entry) => {
    const worker = createMonacoWorker('id', label) as unknown as { entry: string };
    expect(worker.entry).toBe(entry);
  });
});
