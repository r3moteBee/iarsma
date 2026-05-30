/**
 * FilesSettingsPanel — settings UI for the GitHub Files integration (Phase 5a).
 *
 * When *not* connected:
 *   - Renders a form: Personal Access Token, Owner, Repo, Branch (default "main").
 *   - "Connect" submits the config; button is disabled until all fields are filled.
 *
 * When connected:
 *   - Shows "Connected to {owner}/{repo}" and a "Disconnect" button.
 *
 * Purely presentational — token persistence and validation are delegated to
 * the parent via `onConnect`/`onDisconnect`.
 */

import { useState } from 'react';
import { Button, Input } from '../components/index.js';

// ── Props ────────────────────────────────────────────────────────

export type FilesSettingsPanelProps = {
  readonly currentConfig: { readonly owner: string; readonly repo: string; readonly branch: string } | null;
  readonly onConnect: (config: {
    readonly token: string;
    readonly owner: string;
    readonly repo: string;
    readonly branch: string;
  }) => Promise<void>;
  readonly onDisconnect: () => Promise<void>;
};

// ── Component ────────────────────────────────────────────────────

export function FilesSettingsPanel({
  currentConfig,
  onConnect,
  onDisconnect,
}: FilesSettingsPanelProps) {
  return (
    <section
      aria-labelledby="files-settings-heading"
      style={{
        marginBottom: '2em',
        padding: '1em 1.25em',
        border: '1px solid var(--surface-3)',
        borderRadius: 'var(--radius-md, 8px)',
        background: 'var(--surface-1)',
      }}
    >
      <h3 id="files-settings-heading" style={{ marginTop: 0 }}>GitHub Files</h3>
      <p style={{ color: 'var(--text-2)', marginTop: 0, fontSize: '0.9em' }}>
        Connect a GitHub repository to browse and edit files directly from this app.
      </p>
      {currentConfig === null ? (
        <ConnectForm onConnect={onConnect} />
      ) : (
        <ConnectedStatus config={currentConfig} onDisconnect={onDisconnect} />
      )}
    </section>
  );
}

// ── Connect form ─────────────────────────────────────────────────

function ConnectForm({
  onConnect,
}: {
  readonly onConnect: FilesSettingsPanelProps['onConnect'];
}) {
  const [token, setToken] = useState('');
  const [owner, setOwner] = useState('');
  const [repo, setRepo] = useState('');
  const [branch, setBranch] = useState('main');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    token.trim() !== '' &&
    owner.trim() !== '' &&
    repo.trim() !== '' &&
    branch.trim() !== '' &&
    !isSubmitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setIsSubmitting(true);
    try {
      await onConnect({
        token: token.trim(),
        owner: owner.trim(),
        repo: repo.trim(),
        branch: branch.trim(),
      });
      // Clear sensitive field on success.
      setToken('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} aria-label="Connect to GitHub">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75em', maxWidth: '32em' }}>
        <Input
          label="Personal Access Token"
          type="password"
          value={token}
          onChange={setToken}
          placeholder="ghp_..."
        />
        <Input label="Owner" value={owner} onChange={setOwner} placeholder="octocat" />
        <Input label="Repo" value={repo} onChange={setRepo} placeholder="my-repo" />
        <Input label="Branch" value={branch} onChange={setBranch} placeholder="main" />
        {error !== null ? (
          <div
            role="alert"
            style={{
              padding: '0.5em 0.75em',
              background: 'color-mix(in srgb, var(--destructive) 10%, transparent)',
              color: 'var(--destructive)',
              borderRadius: 'var(--radius-sm, 4px)',
              fontSize: '0.875em',
            }}
          >
            {error}
          </div>
        ) : null}
        <div>
          <Button type="submit" variant="primary" disabled={!canSubmit}>
            {isSubmitting ? 'Connecting...' : 'Connect'}
          </Button>
        </div>
      </div>
    </form>
  );
}

// ── Connected status ─────────────────────────────────────────────

function ConnectedStatus({
  config,
  onDisconnect,
}: {
  readonly config: NonNullable<FilesSettingsPanelProps['currentConfig']>;
  readonly onDisconnect: FilesSettingsPanelProps['onDisconnect'];
}) {
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const handleDisconnect = async () => {
    setIsDisconnecting(true);
    try {
      await onDisconnect();
    } finally {
      setIsDisconnecting(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '1em',
        flexWrap: 'wrap',
      }}
    >
      <span>
        Connected to{' '}
        <code style={{ fontWeight: 600 }}>
          {config.owner}/{config.repo}
        </code>{' '}
        <span style={{ color: 'var(--text-3)', fontSize: '0.875em' }}>
          (branch: {config.branch})
        </span>
      </span>
      <Button
        variant="secondary"
        size="sm"
        onClick={handleDisconnect}
        disabled={isDisconnecting}
      >
        {isDisconnecting ? 'Disconnecting...' : 'Disconnect'}
      </Button>
    </div>
  );
}
