/**
 * GitHub configuration loader for the MCP server (Phase 5b).
 *
 * The MCP server needs its own read-only GitHub PAT + repo coordinates;
 * the browser keeps its own IDB-stored config for human writes. These
 * two configs are parallel by design (D-053): the server proposes,
 * the browser commits on human approval.
 *
 * Source priority:
 *   1. environment variables IARSMA_GITHUB_{TOKEN,OWNER,REPO,BRANCH}
 *   2. JSON file at IARSMA_GITHUB_CONFIG_FILE (default `./run/github-config.json`)
 *
 * The env path wins when both are present. A SIGHUP reloads the file
 * source (same pattern as `tokens.json`).
 */

import { readFileSync } from 'node:fs';

export type GithubConfig = {
  readonly token: string;
  readonly owner: string;
  readonly repo: string;
  readonly branch?: string;
};

export type GithubConfigStore = {
  readonly current: () => GithubConfig | null;
  readonly reload: () => void;
};

const DEFAULT_CONFIG_FILE = './run/github-config.json';

export function loadGithubConfigStore(
  env: NodeJS.ProcessEnv = process.env,
): GithubConfigStore {
  const filePath = env['IARSMA_GITHUB_CONFIG_FILE'] ?? DEFAULT_CONFIG_FILE;
  let cached: GithubConfig | null = resolve(env, filePath);
  return {
    current: () => cached,
    reload: () => {
      cached = resolve(env, filePath);
    },
  };
}

function resolve(
  env: NodeJS.ProcessEnv,
  filePath: string,
): GithubConfig | null {
  const fromEnv = fromEnvVars(env);
  if (fromEnv !== null) return fromEnv;
  return fromFile(filePath);
}

function fromEnvVars(env: NodeJS.ProcessEnv): GithubConfig | null {
  const token = env['IARSMA_GITHUB_TOKEN'];
  const owner = env['IARSMA_GITHUB_OWNER'];
  const repo = env['IARSMA_GITHUB_REPO'];
  if (
    token === undefined ||
    owner === undefined ||
    repo === undefined ||
    token === '' ||
    owner === '' ||
    repo === ''
  ) {
    return null;
  }
  const branch = env['IARSMA_GITHUB_BRANCH'];
  return {
    token,
    owner,
    repo,
    ...(branch !== undefined && branch !== '' ? { branch } : {}),
  };
}

function fromFile(filePath: string): GithubConfig | null {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object') return null;
  const o = parsed as Record<string, unknown>;
  if (
    typeof o['token'] !== 'string' ||
    typeof o['owner'] !== 'string' ||
    typeof o['repo'] !== 'string'
  ) {
    return null;
  }
  return {
    token: o['token'],
    owner: o['owner'],
    repo: o['repo'],
    ...(typeof o['branch'] === 'string' && o['branch'] !== ''
      ? { branch: o['branch'] }
      : {}),
  };
}
