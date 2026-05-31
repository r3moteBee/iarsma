/**
 * Handler for `files.list` (Phase 5b item 1).
 *
 * Delegates to the server-side read-only GitHub client. Returns an empty
 * entry list when the GitHub config is unset rather than failing loudly,
 * so an MCP client can probe the tool's availability via examples + a
 * "not configured" error code.
 */

import type { ToolHandler } from '../invocation.js';
import { githubReadClient } from '../github-read.js';
import type { GithubConfigStore } from '../github-config.js';

export type FilesListInput = {
  readonly path: string;
};

export function createFilesListHandler(
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
    const entries = await client.list(params.path);
    return { entries };
  };
}

function parseInput(input: unknown): FilesListInput {
  if (input === null || typeof input !== 'object') {
    throw badInput('files.list input must be an object');
  }
  const i = input as Record<string, unknown>;
  if (typeof i['path'] !== 'string') {
    throw badInput('files.list input.path must be a string');
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
    'files.list: GitHub not configured. Set IARSMA_GITHUB_TOKEN, IARSMA_GITHUB_OWNER, IARSMA_GITHUB_REPO (and optionally _BRANCH), or write run/github-config.json.',
  );
  (err as Error & { code?: string }).code = 'not_configured';
  return err;
}
