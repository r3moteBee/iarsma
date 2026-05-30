/**
 * @vitest-environment jsdom
 *
 * Tests for FilesView (Phase 5a).
 *
 * Covers:
 *   - Renders empty state when config is null
 *   - Renders file tree with directories and files
 *   - Clicking a directory calls onExpandDir
 *   - Clicking a file calls onSelectPath
 *   - Binary file shows download button (no editor)
 *   - Text file shows Monaco (mock the lazy import)
 *   - Save button appears when content is modified
 *   - Commit dialog opens on save click
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);

// jsdom does not implement HTMLDialogElement.showModal() natively.
beforeEach(() => {
  HTMLDialogElement.prototype.showModal ??= vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close ??= vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

// Mock @monaco-editor/react so the lazy import resolves synchronously to a
// lightweight textarea that drives onChange. This avoids loading the ~3MB
// Monaco bundle in tests and lets us assert on the editor's value.
vi.mock('@monaco-editor/react', () => ({
  Editor: ({
    value,
    onChange,
  }: {
    value?: string;
    onChange?: (v: string | undefined) => void;
  }) => (
    <textarea
      data-testid="monaco-editor"
      value={value ?? ''}
      onChange={(e) => onChange?.(e.target.value)}
    />
  ),
}));

import type { FileContent, FileTreeNode, FilesViewProps } from '../files-view.js';
import { FilesView } from '../files-view.js';

const CONFIG = { owner: 'octocat', repo: 'demo', branch: 'main' };

const SAMPLE_TREE: readonly FileTreeNode[] = [
  { path: 'src', name: 'src', type: 'dir' },
  { path: 'README.md', name: 'README.md', type: 'file', sha: 'sha-readme', size: 1024 },
  { path: 'image.png', name: 'image.png', type: 'file', sha: 'sha-img', size: 4096 },
];

const TEXT_CONTENT: FileContent = {
  path: 'README.md',
  sha: 'sha-readme',
  content: '# Hello\n\nWorld',
  encoding: 'utf-8',
  size: 14,
};

const BINARY_CONTENT: FileContent = {
  path: 'image.png',
  sha: 'sha-img',
  // small base64 (any 4 bytes)
  content: 'iVBORw0KGgo=',
  encoding: 'base64',
  size: 12300,
};

function renderView(overrides: Partial<FilesViewProps> = {}) {
  const props: FilesViewProps = {
    config: CONFIG,
    tree: SAMPLE_TREE,
    selectedPath: null,
    selectedContent: null,
    history: [],
    onSelectPath: vi.fn(),
    onExpandDir: vi.fn().mockResolvedValue([]),
    onSave: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return { ...render(<FilesView {...props} />), props };
}

describe('FilesView — empty state', () => {
  it('renders empty state when config is null', () => {
    render(
      <FilesView
        config={null}
        tree={[]}
        selectedPath={null}
        selectedContent={null}
        history={[]}
        onSelectPath={vi.fn()}
        onExpandDir={vi.fn().mockResolvedValue([])}
        onSave={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(screen.getByText(/not connected to github/i)).toBeInTheDocument();
  });

  it('shows "Connect to GitHub" button when onOpenSettings is provided', () => {
    const onOpenSettings = vi.fn();
    render(
      <FilesView
        config={null}
        tree={[]}
        selectedPath={null}
        selectedContent={null}
        history={[]}
        onSelectPath={vi.fn()}
        onExpandDir={vi.fn().mockResolvedValue([])}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onOpenSettings={onOpenSettings}
      />,
    );
    const btn = screen.getByRole('button', { name: /connect to github/i });
    fireEvent.click(btn);
    expect(onOpenSettings).toHaveBeenCalled();
  });
});

describe('FilesView — tree', () => {
  it('renders file tree with directories and files', () => {
    renderView();
    expect(screen.getByText('src')).toBeInTheDocument();
    expect(screen.getByText('README.md')).toBeInTheDocument();
    expect(screen.getByText('image.png')).toBeInTheDocument();
  });

  it('clicking a directory calls onExpandDir', async () => {
    const onExpandDir = vi.fn().mockResolvedValue([
      { path: 'src/index.ts', name: 'index.ts', type: 'file' as const, sha: 'sha-index' },
    ]);
    renderView({ onExpandDir });
    fireEvent.click(screen.getByText('src'));
    await waitFor(() => {
      expect(onExpandDir).toHaveBeenCalledWith('src');
    });
  });

  it('clicking a file calls onSelectPath', () => {
    const onSelectPath = vi.fn();
    renderView({ onSelectPath });
    fireEvent.click(screen.getByText('README.md'));
    expect(onSelectPath).toHaveBeenCalledWith('README.md');
  });

  it('expanded directory shows children after expansion', async () => {
    const onExpandDir = vi.fn().mockResolvedValue([
      { path: 'src/index.ts', name: 'index.ts', type: 'file' as const, sha: 'sha-index' },
    ]);
    renderView({ onExpandDir });
    fireEvent.click(screen.getByText('src'));
    await waitFor(() => {
      expect(screen.getByText('index.ts')).toBeInTheDocument();
    });
  });

  it('shows repo title in tree header', () => {
    renderView();
    expect(screen.getByText('octocat/demo')).toBeInTheDocument();
  });
});

describe('FilesView — content', () => {
  it('text file shows Monaco editor with content', async () => {
    renderView({ selectedPath: 'README.md', selectedContent: TEXT_CONTENT });
    await waitFor(() => {
      expect(screen.getByTestId('monaco-editor')).toBeInTheDocument();
    });
    expect(screen.getByTestId('monaco-editor')).toHaveValue('# Hello\n\nWorld');
  });

  it('binary file shows download button (no editor)', () => {
    renderView({ selectedPath: 'image.png', selectedContent: BINARY_CONTENT });
    expect(screen.queryByTestId('monaco-editor')).toBeNull();
    expect(screen.getByText(/binary file/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /download/i })).toBeInTheDocument();
  });

  it('binary file shows file size', () => {
    renderView({ selectedPath: 'image.png', selectedContent: BINARY_CONTENT });
    // 12300 bytes = 12.0 KB
    expect(screen.getByText(/12\.0 KB/)).toBeInTheDocument();
  });

  it('shows loading placeholder when isLoadingContent', () => {
    renderView({ selectedPath: 'README.md', isLoadingContent: true });
    expect(screen.getByText(/loading file content/i)).toBeInTheDocument();
  });

  it('shows placeholder when no file selected', () => {
    renderView();
    expect(screen.getByText(/select a file from the tree/i)).toBeInTheDocument();
  });
});

describe('FilesView — save flow', () => {
  it('save button does not appear when content is unmodified', async () => {
    renderView({ selectedPath: 'README.md', selectedContent: TEXT_CONTENT });
    await waitFor(() => {
      expect(screen.getByTestId('monaco-editor')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /^save$/i })).toBeNull();
  });

  it('save button appears when content is modified', async () => {
    renderView({ selectedPath: 'README.md', selectedContent: TEXT_CONTENT });
    await waitFor(() => {
      expect(screen.getByTestId('monaco-editor')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByTestId('monaco-editor'), {
      target: { value: '# Modified' },
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^save$/i })).toBeInTheDocument();
    });
  });

  it('commit dialog opens on save click', async () => {
    renderView({ selectedPath: 'README.md', selectedContent: TEXT_CONTENT });
    await waitFor(() => {
      expect(screen.getByTestId('monaco-editor')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByTestId('monaco-editor'), {
      target: { value: '# Modified' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(screen.getByText('Commit changes', { selector: 'h2' })).toBeInTheDocument();
    expect(screen.getByLabelText(/commit message/i)).toBeInTheDocument();
  });

  it('clicking Commit in dialog calls onSave with path, content, sha, message', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderView({
      selectedPath: 'README.md',
      selectedContent: TEXT_CONTENT,
      onSave,
    });
    await waitFor(() => {
      expect(screen.getByTestId('monaco-editor')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByTestId('monaco-editor'), {
      target: { value: '# Modified' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    // Modify the commit message
    fireEvent.change(screen.getByLabelText(/commit message/i), {
      target: { value: 'docs: tweak readme' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^commit$/i }));
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        'README.md',
        '# Modified',
        'sha-readme',
        'docs: tweak readme',
      );
    });
  });

  it('Commit button is disabled when commit message is empty', async () => {
    renderView({ selectedPath: 'README.md', selectedContent: TEXT_CONTENT });
    await waitFor(() => {
      expect(screen.getByTestId('monaco-editor')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByTestId('monaco-editor'), {
      target: { value: '# Modified' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    fireEvent.change(screen.getByLabelText(/commit message/i), {
      target: { value: '' },
    });
    expect(screen.getByRole('button', { name: /^commit$/i })).toBeDisabled();
  });
});

describe('FilesView — history', () => {
  it('shows commit history when a file is selected and history is non-empty', () => {
    renderView({
      selectedPath: 'README.md',
      selectedContent: TEXT_CONTENT,
      history: [
        {
          sha: 'abc1234def',
          message: 'Initial commit',
          author: 'Alice',
          date: '2026-05-01T10:00:00Z',
        },
        {
          sha: 'def5678ghi',
          message: 'Update docs',
          author: 'Bob',
          date: '2026-05-15T10:00:00Z',
        },
      ],
    });
    expect(screen.getByText('Initial commit')).toBeInTheDocument();
    expect(screen.getByText('Update docs')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('history pane is hidden when history is empty', () => {
    renderView({ selectedPath: 'README.md', selectedContent: TEXT_CONTENT, history: [] });
    expect(screen.queryByRole('complementary', { name: /commit history/i })).toBeNull();
  });
});

describe('FilesView — disconnect', () => {
  it('shows disconnect button when onDisconnect is provided', () => {
    const onDisconnect = vi.fn();
    renderView({ onDisconnect });
    expect(screen.getByRole('button', { name: /disconnect/i })).toBeInTheDocument();
  });

  it('disconnect button calls onDisconnect', () => {
    const onDisconnect = vi.fn();
    renderView({ onDisconnect });
    fireEvent.click(screen.getByRole('button', { name: /disconnect/i }));
    expect(onDisconnect).toHaveBeenCalled();
  });
});
