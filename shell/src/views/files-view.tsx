/**
 * FilesView -- file browser + editor UI for Phase 5a.
 *
 * Three-column layout:
 *   1. Left  (280px)  -- file tree, click dir to expand, click file to select.
 *   2. Center (flex)  -- file content: Monaco editor for text, metadata + download for binary.
 *   3. Right (240px)  -- commit history for the selected file (optional, hidden on small screens).
 *
 * Purely presentational -- all network calls (tree expansion, file content,
 * save, history) are delegated to callback props. Monaco is lazy-loaded so
 * the ~3MB bundle doesn't bloat the main shell.
 */

import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Dialog, EmptyState, Notice, Skeleton } from '../components/index.js';
import styles from './files-view.module.css';

// Lazy import — splits the Monaco editor bundle (~3MB) into a separate chunk.
const MonacoEditor = lazy(() =>
  import('@monaco-editor/react').then((m) => ({ default: m.Editor })),
);

// ── Types ─────────────────────────────────────────────────────────

export type FileTreeNode = {
  readonly path: string;
  readonly name: string;
  readonly type: 'file' | 'dir';
  readonly sha?: string;
  readonly size?: number;
};

export type FileContent = {
  readonly path: string;
  readonly sha: string;
  readonly content: string;
  readonly encoding: 'utf-8' | 'base64';
  readonly size: number;
};

export type CommitHistoryEntry = {
  readonly sha: string;
  readonly message: string;
  readonly author: string;
  readonly date: string;
};

export type FilesViewProps = {
  readonly config: { readonly owner: string; readonly repo: string; readonly branch: string } | null;
  readonly tree: readonly FileTreeNode[];
  readonly selectedPath: string | null;
  readonly selectedContent: FileContent | null;
  readonly history: readonly CommitHistoryEntry[];
  readonly isLoadingTree?: boolean;
  readonly isLoadingContent?: boolean;
  readonly error?: string | null;
  readonly onSelectPath: (path: string) => void;
  readonly onExpandDir: (path: string) => Promise<readonly FileTreeNode[]>;
  readonly onSave: (path: string, newContent: string, sha: string, message: string) => Promise<void>;
  readonly onDisconnect?: () => void;
  /** Optional callback for the empty-state "Connect to GitHub" button (e.g. navigate to settings). */
  readonly onOpenSettings?: () => void;
};

// ── Helpers ──────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatHistoryDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

/**
 * Map a file path's extension to a Monaco language id. Returns 'plaintext'
 * for unknown types.
 */
function languageForPath(path: string): string {
  const ext = path.toLowerCase().split('.').pop() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    json: 'json',
    md: 'markdown',
    css: 'css',
    html: 'html',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'plaintext',
    rs: 'rust',
    py: 'python',
    go: 'go',
    sh: 'shell',
  };
  return map[ext] ?? 'plaintext';
}

function decodeContent(content: FileContent): string {
  if (content.encoding === 'utf-8') return content.content;
  // base64 — try to decode for the editor; if the data is genuinely binary
  // we still surface it as text but callers should detect binary upstream.
  try {
    return atob(content.content);
  } catch {
    return '';
  }
}

function isTextFile(content: FileContent | null): boolean {
  return content !== null && content.encoding === 'utf-8';
}

/** Read the resolved theme from <html data-theme="..."> for Monaco. */
function getMonacoTheme(): 'vs-dark' | 'vs-light' {
  if (typeof document === 'undefined') return 'vs-light';
  const theme = document.documentElement.dataset['theme'];
  return theme === 'dark' ? 'vs-dark' : 'vs-light';
}

// ── Component ─────────────────────────────────────────────────────

export function FilesView({
  config,
  tree,
  selectedPath,
  selectedContent,
  history,
  isLoadingTree,
  isLoadingContent,
  onSelectPath,
  onExpandDir,
  onSave,
  onDisconnect,
  onOpenSettings,
}: FilesViewProps) {
  // Empty state — not connected.
  if (config === null) {
    return (
      <div className={styles['emptyContainer']}>
        <EmptyState
          title="Not connected to GitHub"
          description="Connect to a GitHub repository in Settings to browse and edit files."
          {...(onOpenSettings !== undefined
            ? { action: { label: 'Connect to GitHub', onClick: onOpenSettings } }
            : {})}
        />
      </div>
    );
  }

  return (
    <ConnectedFilesView
      config={config}
      tree={tree}
      selectedPath={selectedPath}
      selectedContent={selectedContent}
      history={history}
      {...(isLoadingTree !== undefined ? { isLoadingTree } : {})}
      {...(isLoadingContent !== undefined ? { isLoadingContent } : {})}
      onSelectPath={onSelectPath}
      onExpandDir={onExpandDir}
      onSave={onSave}
      {...(onDisconnect !== undefined ? { onDisconnect } : {})}
    />
  );
}

// ── Connected view (config != null) ───────────────────────────────

type ConnectedProps = Omit<FilesViewProps, 'config' | 'onOpenSettings'> & {
  readonly config: NonNullable<FilesViewProps['config']>;
};

function ConnectedFilesView({
  config,
  tree,
  selectedPath,
  selectedContent,
  history,
  isLoadingTree,
  isLoadingContent,
  error,
  onSelectPath,
  onExpandDir,
  onSave,
  onDisconnect,
}: ConnectedProps) {
  // Track editor buffer separately so we can detect "modified" state.
  const [editorBuffer, setEditorBuffer] = useState<string>('');
  const [bufferPath, setBufferPath] = useState<string | null>(null);
  const [bufferSha, setBufferSha] = useState<string | null>(null);
  const [commitDialogOpen, setCommitDialogOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Whenever a new file's content arrives, reset the editor buffer.
  useEffect(() => {
    if (selectedContent === null) {
      setBufferPath(null);
      setBufferSha(null);
      setEditorBuffer('');
      return;
    }
    // Only reset if this is a *different* file (or first load).
    if (selectedContent.path !== bufferPath || selectedContent.sha !== bufferSha) {
      setBufferPath(selectedContent.path);
      setBufferSha(selectedContent.sha);
      setEditorBuffer(decodeContent(selectedContent));
    }
  }, [selectedContent, bufferPath, bufferSha]);

  const isText = isTextFile(selectedContent);
  const originalContent = selectedContent !== null ? decodeContent(selectedContent) : '';
  const isModified =
    selectedContent !== null && isText && editorBuffer !== originalContent;

  const handleEditorChange = useCallback((value: string | undefined) => {
    setEditorBuffer(value ?? '');
  }, []);

  const handleSaveClick = () => {
    if (!isModified) return;
    setCommitMessage(`Update ${selectedContent?.path ?? ''}`);
    setSaveError(null);
    setCommitDialogOpen(true);
  };

  const handleCommitConfirm = async () => {
    if (selectedContent === null) return;
    if (commitMessage.trim() === '') {
      setSaveError('Commit message is required');
      return;
    }
    setIsSaving(true);
    setSaveError(null);
    try {
      await onSave(selectedContent.path, editorBuffer, selectedContent.sha, commitMessage.trim());
      setCommitDialogOpen(false);
      setCommitMessage('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSaveError(msg);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCommitCancel = () => {
    if (isSaving) return;
    setCommitDialogOpen(false);
    setSaveError(null);
  };

  const handleDownload = () => {
    if (selectedContent === null) return;
    const data =
      selectedContent.encoding === 'base64'
        ? selectedContent.content
        : btoa(unescape(encodeURIComponent(selectedContent.content)));
    const link = document.createElement('a');
    link.href = `data:application/octet-stream;base64,${data}`;
    link.download = selectedContent.path.split('/').pop() ?? 'file';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className={styles['container']}>
      {/* ── Left: file tree ──────────────────────────── */}
      <aside className={styles['treePane']} aria-label="File tree">
        <header className={styles['treeHeader']}>
          <span className={styles['treeHeaderTitle']} title={`${config.owner}/${config.repo}`}>
            {config.owner}/{config.repo}
          </span>
          {onDisconnect !== undefined && (
            <Button variant="ghost" size="sm" onClick={onDisconnect} aria-label="Disconnect">
              Disconnect
            </Button>
          )}
        </header>
        {isLoadingTree === true ? (
          <div style={{ padding: '0.5em 0.75em' }}>
            <Skeleton height="1em" />
            <div style={{ height: 6 }} />
            <Skeleton height="1em" />
            <div style={{ height: 6 }} />
            <Skeleton height="1em" />
          </div>
        ) : error !== null && error !== undefined ? (
          <div style={{ margin: '0.5em' }}>
            <Notice variant="error">{error}</Notice>
          </div>
        ) : tree.length === 0 ? (
          <div style={{ padding: '0.75em', color: 'var(--text-3)', fontSize: 'var(--text-sm)' }}>
            No files in this repo.
          </div>
        ) : (
          <FileTree
            nodes={tree}
            selectedPath={selectedPath}
            onSelectPath={onSelectPath}
            onExpandDir={onExpandDir}
          />
        )}
      </aside>

      {/* ── Center: content ──────────────────────────── */}
      <section className={styles['contentPane']} aria-label="File content">
        <header className={styles['contentHeader']}>
          <span className={styles['contentPath']}>
            {isModified ? <span className={styles['modifiedDot']} aria-hidden="true" /> : null}
            {selectedPath ?? 'No file selected'}
          </span>
          <div className={styles['contentActions']}>
            {isModified ? (
              <Button variant="primary" size="sm" onClick={handleSaveClick}>
                Save
              </Button>
            ) : null}
          </div>
        </header>

        <div className={styles['editorArea']}>
          {isLoadingContent === true ? (
            <div className={styles['editorPlaceholder']}>Loading file content...</div>
          ) : selectedContent === null ? (
            <div className={styles['editorPlaceholder']}>
              Select a file from the tree to view its content.
            </div>
          ) : isText ? (
            <Suspense
              fallback={<div className={styles['editorPlaceholder']}>Loading editor...</div>}
            >
              <MonacoEditor
                height="100%"
                language={languageForPath(selectedContent.path)}
                theme={getMonacoTheme()}
                value={editorBuffer}
                onChange={handleEditorChange}
                options={{
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  fontSize: 13,
                  wordWrap: 'on',
                }}
              />
            </Suspense>
          ) : (
            <div className={styles['binaryView']}>
              <p>
                Binary file <span className={styles['binaryMeta']}>({formatBytes(selectedContent.size)})</span>
              </p>
              <Button variant="primary" onClick={handleDownload}>
                Download
              </Button>
            </div>
          )}
        </div>
      </section>

      {/* ── Right: commit history (optional) ────────── */}
      {selectedPath !== null && history.length > 0 ? (
        <aside className={styles['historyPane']} aria-label="Commit history">
          <header className={styles['historyHeader']}>History</header>
          <ul className={styles['historyList']}>
            {history.map((entry) => (
              <li key={entry.sha} className={styles['historyItem']}>
                <div className={styles['historyMessage']}>{entry.message}</div>
                <div className={styles['historyAuthor']}>{entry.author}</div>
                <div className={styles['historyMeta']}>
                  {shortSha(entry.sha)} · {formatHistoryDate(entry.date)}
                </div>
              </li>
            ))}
          </ul>
        </aside>
      ) : null}

      {/* ── Commit dialog ────────────────────────────── */}
      <CommitDialog
        open={commitDialogOpen}
        path={selectedContent?.path ?? ''}
        message={commitMessage}
        onMessageChange={setCommitMessage}
        onCommit={handleCommitConfirm}
        onCancel={handleCommitCancel}
        isSaving={isSaving}
        {...(saveError !== null ? { error: saveError } : {})}
      />
    </div>
  );
}

// ── File tree (recursive) ─────────────────────────────────────────

type FileTreeProps = {
  readonly nodes: readonly FileTreeNode[];
  readonly selectedPath: string | null;
  readonly onSelectPath: (path: string) => void;
  readonly onExpandDir: (path: string) => Promise<readonly FileTreeNode[]>;
};

function FileTree({ nodes, selectedPath, onSelectPath, onExpandDir }: FileTreeProps) {
  return (
    <ul className={styles['treeList']} role="tree">
      {nodes.map((node) => (
        <TreeNode
          key={node.path}
          node={node}
          depth={0}
          selectedPath={selectedPath}
          onSelectPath={onSelectPath}
          onExpandDir={onExpandDir}
        />
      ))}
    </ul>
  );
}

type TreeNodeProps = {
  readonly node: FileTreeNode;
  readonly depth: number;
  readonly selectedPath: string | null;
  readonly onSelectPath: (path: string) => void;
  readonly onExpandDir: (path: string) => Promise<readonly FileTreeNode[]>;
};

function TreeNode({ node, depth, selectedPath, onSelectPath, onExpandDir }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<readonly FileTreeNode[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const isSelected = selectedPath === node.path;
  const indent = useMemo<React.CSSProperties>(
    () => ({ paddingLeft: `${0.6 + depth * 1}em` }),
    [depth],
  );

  const handleClick = async () => {
    if (node.type === 'dir') {
      if (!expanded && children === null) {
        setIsLoading(true);
        try {
          const fetched = await onExpandDir(node.path);
          setChildren(fetched);
        } finally {
          setIsLoading(false);
        }
      }
      setExpanded((e) => !e);
    } else {
      onSelectPath(node.path);
    }
  };

  return (
    <li role="treeitem" aria-expanded={node.type === 'dir' ? expanded : undefined}>
      <button
        type="button"
        className={[styles['treeItem'], isSelected ? styles['treeItemSelected'] : ''].filter(Boolean).join(' ')}
        onClick={handleClick}
        style={indent}
        aria-current={isSelected ? 'true' : undefined}
      >
        <span className={styles['treeIcon']} aria-hidden="true">
          {node.type === 'dir' ? (expanded ? '▾' : '▸') : '·'}
        </span>
        <span className={styles['treeName']}>{node.name}</span>
      </button>
      {node.type === 'dir' && expanded ? (
        <ul role="group" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {isLoading ? (
            <li style={{ padding: '0.3em 0.75em', fontSize: '0.85em', color: 'var(--text-3)' }}>
              Loading...
            </li>
          ) : children !== null ? (
            children.map((child) => (
              <TreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                selectedPath={selectedPath}
                onSelectPath={onSelectPath}
                onExpandDir={onExpandDir}
              />
            ))
          ) : null}
        </ul>
      ) : null}
    </li>
  );
}

// ── Commit dialog ─────────────────────────────────────────────────

type CommitDialogProps = {
  readonly open: boolean;
  readonly path: string;
  readonly message: string;
  readonly onMessageChange: (msg: string) => void;
  readonly onCommit: () => void;
  readonly onCancel: () => void;
  readonly isSaving: boolean;
  readonly error?: string;
};

function CommitDialog({
  open,
  path,
  message,
  onMessageChange,
  onCommit,
  onCancel,
  isSaving,
  error,
}: CommitDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title="Commit changes"
      footer={
        <div className={styles['dialogFooter']}>
          <Button variant="secondary" onClick={onCancel} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={onCommit}
            disabled={isSaving || message.trim() === ''}
          >
            {isSaving ? 'Committing...' : 'Commit'}
          </Button>
        </div>
      }
    >
      <div className={styles['commitForm']}>
        <div className={styles['commitFormPath']}>{path}</div>
        <label htmlFor="commit-message-input" style={{ fontSize: '0.875em', fontWeight: 500 }}>
          Commit message
        </label>
        <textarea
          id="commit-message-input"
          value={message}
          onChange={(e) => onMessageChange(e.target.value)}
          rows={4}
          style={{
            font: 'inherit',
            padding: '0.4em 0.6em',
            border: '1px solid var(--surface-3)',
            borderRadius: 'var(--radius-sm, 4px)',
            color: 'var(--text-1)',
            background: 'var(--surface-1)',
            resize: 'vertical',
          }}
        />
        {error !== undefined ? <Notice variant="error">{error}</Notice> : null}
      </div>
    </Dialog>
  );
}
