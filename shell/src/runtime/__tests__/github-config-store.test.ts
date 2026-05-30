/**
 * Tests for the GitHubConfigStore in-memory implementation.
 *
 * Coverage:
 *   - save + load round-trips
 *   - load returns null when nothing is stored
 *   - save overwrites the previous record
 *   - clear removes the stored record
 *   - clear is a no-op when nothing is stored
 */

import { describe, expect, it } from 'vitest';
import {
  inMemoryGitHubConfigStore,
  type GitHubStoredConfig,
} from '../github-config-store.js';

function makeConfig(
  overrides?: Partial<GitHubStoredConfig>,
): GitHubStoredConfig {
  return {
    token: 'ghp_secret_token',
    owner: 'octocat',
    repo: 'demo',
    branch: 'main',
    connectedAt: '2026-05-30T12:00:00Z',
    ...overrides,
  };
}

describe('inMemoryGitHubConfigStore', () => {
  it('save + load round-trips a record', async () => {
    const store = inMemoryGitHubConfigStore();
    const config = makeConfig();

    await store.save(config);
    const loaded = await store.load();

    expect(loaded).toEqual(config);
  });

  it('load returns null when nothing is stored', async () => {
    const store = inMemoryGitHubConfigStore();

    const loaded = await store.load();

    expect(loaded).toBeNull();
  });

  it('save overwrites the previous record', async () => {
    const store = inMemoryGitHubConfigStore();
    const original = makeConfig({ repo: 'repo-a', branch: 'main' });
    const updated = makeConfig({ repo: 'repo-b', branch: 'dev' });

    await store.save(original);
    await store.save(updated);

    const loaded = await store.load();
    expect(loaded).toEqual(updated);
    expect(loaded!.repo).toBe('repo-b');
    expect(loaded!.branch).toBe('dev');
  });

  it('clear removes a stored record', async () => {
    const store = inMemoryGitHubConfigStore();

    await store.save(makeConfig());
    await store.clear();

    expect(await store.load()).toBeNull();
  });

  it('clear is a no-op when nothing is stored', async () => {
    const store = inMemoryGitHubConfigStore();

    // Should not throw.
    await store.clear();

    expect(await store.load()).toBeNull();
  });
});
