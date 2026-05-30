/**
 * @vitest-environment jsdom
 *
 * Tests for FilesSettingsPanel (Phase 5a).
 *
 * Covers:
 *   - Shows form when not connected
 *   - Shows connected status when config provided
 *   - Connect button disabled when fields empty
 *   - Disconnect button calls onDisconnect
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FilesSettingsPanel } from '../files-settings-panel.js';

afterEach(cleanup);

describe('FilesSettingsPanel — disconnected', () => {
  it('shows the form when currentConfig is null', () => {
    render(
      <FilesSettingsPanel
        currentConfig={null}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(screen.getByLabelText(/personal access token/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/owner/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/repo/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/branch/i)).toBeInTheDocument();
  });

  it('branch field defaults to "main"', () => {
    render(
      <FilesSettingsPanel
        currentConfig={null}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(screen.getByLabelText(/branch/i)).toHaveValue('main');
  });

  it('Connect button is disabled when fields are empty', () => {
    render(
      <FilesSettingsPanel
        currentConfig={null}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(screen.getByRole('button', { name: /^connect$/i })).toBeDisabled();
  });

  it('Connect button is enabled when all fields are filled', () => {
    render(
      <FilesSettingsPanel
        currentConfig={null}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    fireEvent.change(screen.getByLabelText(/personal access token/i), {
      target: { value: 'ghp_xxx' },
    });
    fireEvent.change(screen.getByLabelText(/owner/i), { target: { value: 'octocat' } });
    fireEvent.change(screen.getByLabelText(/repo/i), { target: { value: 'demo' } });
    // Branch is already "main"
    expect(screen.getByRole('button', { name: /^connect$/i })).toBeEnabled();
  });

  it('Connect button is disabled when any field is empty (token cleared)', () => {
    render(
      <FilesSettingsPanel
        currentConfig={null}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    fireEvent.change(screen.getByLabelText(/owner/i), { target: { value: 'octocat' } });
    fireEvent.change(screen.getByLabelText(/repo/i), { target: { value: 'demo' } });
    // Token is empty
    expect(screen.getByRole('button', { name: /^connect$/i })).toBeDisabled();
  });

  it('calls onConnect with trimmed config on submit', async () => {
    const onConnect = vi.fn().mockResolvedValue(undefined);
    render(
      <FilesSettingsPanel
        currentConfig={null}
        onConnect={onConnect}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    fireEvent.change(screen.getByLabelText(/personal access token/i), {
      target: { value: ' ghp_secret ' },
    });
    fireEvent.change(screen.getByLabelText(/owner/i), { target: { value: 'octocat' } });
    fireEvent.change(screen.getByLabelText(/repo/i), { target: { value: 'demo' } });
    fireEvent.change(screen.getByLabelText(/branch/i), { target: { value: 'develop' } });

    fireEvent.click(screen.getByRole('button', { name: /^connect$/i }));

    await waitFor(() => {
      expect(onConnect).toHaveBeenCalledWith({
        token: 'ghp_secret',
        owner: 'octocat',
        repo: 'demo',
        branch: 'develop',
      });
    });
  });

  it('token field has type="password"', () => {
    render(
      <FilesSettingsPanel
        currentConfig={null}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(screen.getByLabelText(/personal access token/i)).toHaveAttribute('type', 'password');
  });
});

describe('FilesSettingsPanel — connected', () => {
  it('shows connected status when currentConfig is provided', () => {
    render(
      <FilesSettingsPanel
        currentConfig={{ owner: 'octocat', repo: 'demo', branch: 'main' }}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(screen.getByText(/connected to/i)).toBeInTheDocument();
    expect(screen.getByText('octocat/demo')).toBeInTheDocument();
    expect(screen.getByText(/branch: main/i)).toBeInTheDocument();
  });

  it('does not render the form when connected', () => {
    render(
      <FilesSettingsPanel
        currentConfig={{ owner: 'octocat', repo: 'demo', branch: 'main' }}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(screen.queryByLabelText(/personal access token/i)).toBeNull();
  });

  it('Disconnect button calls onDisconnect', async () => {
    const onDisconnect = vi.fn().mockResolvedValue(undefined);
    render(
      <FilesSettingsPanel
        currentConfig={{ owner: 'octocat', repo: 'demo', branch: 'main' }}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={onDisconnect}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^disconnect$/i }));
    await waitFor(() => {
      expect(onDisconnect).toHaveBeenCalled();
    });
  });
});
