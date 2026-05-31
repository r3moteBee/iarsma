/**
 * Handler for `files.read` (Phase 5b item 2).
 */

import type { ToolHandler } from '../invocation.js';
import { githubReadClient } from '../github-read.js';
import type { GithubConfigStore } from '../github-config.js';

export type FilesReadInput = {
  readonly path: string;
};

export function createFilesReadHandler(
  configStore: GithubConfigStore,
  opts?: { fetch?: typeof fetch },
): ToolHandler {
  return async (input) => {
    const params = parseInput(input);
    const config = configStore.current();
    if (config === null) {
      throw configError();
    }
    const client = githubReadClient(
      config,
      opts?.fetch !== undefined ? { fetchImpl: opts.fetch } : {},
    );
    return client.read(params.path);
  };
}

function parseInput(input: unknown): FilesReadInput {
  if (input === null || typeof input !== 'object') {
    throw badInput('files.read input must be an object');
  }
  const i = input as Record<string, unknown>;
  if (typeof i['path'] !== 'string' || i['path'].length === 0) {
    throw badInput('files.read input.path must be a non-empty string');
  }
  return { path: i['path'] };
}

function badInput(message: string): Error {
  const err = new Error(message);
  (err as Error & { code?: string }).code = 'invalid_input';
  return err;
}

function configError(): Error {
  const err = new Error(
    'files.read: GitHub not configured. Set IARSMA_GITHUB_TOKEN, IARSMA_GITHUB_OWNER, IARSMA_GITHUB_REPO (and optionally _BRANCH), or write run/github-config.json.',
  );
  (err as Error & { code?: string }).code = 'not_configured';
  return err;
}
