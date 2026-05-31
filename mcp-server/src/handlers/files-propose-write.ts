/**
 * Handler for `files.propose_write` (Phase 5b item 3).
 *
 * Dry-run reads the current file content from GitHub and returns a unified
 * diff against the proposed content. Commit appends a pending approval to
 * the user's `Approvals` mailbox via JMAP. The actual GitHub commit happens
 * browser-side after the human approves (D-053).
 *
 * The approval record's `params` field contains everything the browser
 * committer needs: target path, new content, commit message, encoding,
 * and the base SHA captured at proposal time. The browser uses that SHA
 * on commit so a concurrent edit between proposal and approval is detected.
 */

import type { ToolHandler } from '../invocation.js';
import { isBinaryPath, githubReadClient } from '../github-read.js';
import type { GithubConfigStore } from '../github-config.js';
import { createApproval, hashPreview } from '../approval-bridge.js';

export type FilesProposeWriteInput = {
  readonly path: string;
  readonly content: string;
  readonly encoding: 'utf-8' | 'base64';
  readonly message: string;
};

export type FilesProposeWriteDeps = {
  readonly configStore: GithubConfigStore;
  readonly jmapBaseUrl: string;
  readonly fetch?: typeof fetch;
};

const BINARY_DIFF_PLACEHOLDER = '(binary content omitted from diff)';

export function createFilesProposeWriteHandler(
  deps: FilesProposeWriteDeps,
): ToolHandler {
  return async (input, ctx) => {
    const params = parseInput(input);
    const config = deps.configStore.current();
    if (config === null) {
      throw configError();
    }
    const client = githubReadClient(
      config,
      deps.fetch !== undefined ? { fetchImpl: deps.fetch } : {},
    );

    const current = await fetchCurrent(client, params.path);
    const isBinary = isBinaryPath(params.path);
    const unified = isBinary
      ? buildBinaryPlaceholder(params.path, current === null)
      : unifiedDiff(
          params.path,
          current?.content ?? '',
          params.content,
          current === null,
        );
    const diff = {
      unified,
      baseSha: current?.sha ?? '',
      isCreate: current === null,
      isBinary,
    };
    const preview = {
      path: params.path,
      message: params.message,
      diff,
    };

    if (ctx.dryRun) {
      return preview;
    }

    if (ctx.bearerToken === undefined) {
      throw makeError(
        'not_configured',
        'files.propose_write: caller has no Stalwart API key — cannot append approval. ' +
          'Connect via HTTP transport with a token whose entry carries a stalwartApiKey.',
      );
    }

    const previewHashHex = await hashPreview(preview);
    const approvalId = await createApproval(
      {
        jmapBaseUrl: deps.jmapBaseUrl,
        stalwartApiKey: ctx.bearerToken,
        ...(deps.fetch !== undefined ? { fetch: deps.fetch } : {}),
      },
      {
        toolName: 'files.propose_write',
        requestingAgentId: ctx.agentId ?? 'unknown',
        requestingAgentName: ctx.agentName ?? ctx.agentId ?? 'unknown',
        params,
        preview,
        previewHashHex,
      },
    );
    return { approvalId };
  };
}

async function fetchCurrent(
  client: ReturnType<typeof githubReadClient>,
  path: string,
): Promise<{ content: string; sha: string } | null> {
  try {
    const got = await client.read(path);
    return { content: got.content, sha: got.sha };
  } catch (e) {
    if ((e as { code?: string }).code === 'not_found') {
      return null;
    }
    throw e;
  }
}

function buildBinaryPlaceholder(path: string, isCreate: boolean): string {
  const header = `--- a/${path}\n+++ b/${path}\n`;
  const body = isCreate
    ? `@@ new file @@\n+${BINARY_DIFF_PLACEHOLDER}\n`
    : `@@ binary diff @@\n-${BINARY_DIFF_PLACEHOLDER}\n+${BINARY_DIFF_PLACEHOLDER}\n`;
  return header + body;
}

// Unified diff. LCS-based for readable previews; context lines fixed at 3
// per the standard `diff -u` default.
const CONTEXT_LINES = 3;

export function unifiedDiff(
  path: string,
  oldText: string,
  newText: string,
  isCreate: boolean,
): string {
  const a = oldText.length === 0 ? [] : oldText.split('\n');
  const b = newText.length === 0 ? [] : newText.split('\n');
  const ops = diffLines(a, b);

  const header = isCreate
    ? `--- /dev/null\n+++ b/${path}\n`
    : `--- a/${path}\n+++ b/${path}\n`;

  if (ops.every((op) => op.kind === 'eq')) {
    return header;
  }

  const hunks = collectHunks(a, b, ops);
  return header + hunks.join('');
}

type DiffOp =
  | { readonly kind: 'eq'; readonly a: number; readonly b: number }
  | { readonly kind: 'del'; readonly a: number }
  | { readonly kind: 'add'; readonly b: number };

function diffLines(a: readonly string[], b: readonly string[]): readonly DiffOp[] {
  // Standard LCS DP table.
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        dp[i]![j] = dp[i + 1]![j + 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
      }
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: 'eq', a: i, b: j });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push({ kind: 'del', a: i });
      i++;
    } else {
      ops.push({ kind: 'add', b: j });
      j++;
    }
  }
  while (i < n) ops.push({ kind: 'del', a: i++ });
  while (j < m) ops.push({ kind: 'add', b: j++ });
  return ops;
}

function collectHunks(
  a: readonly string[],
  b: readonly string[],
  ops: readonly DiffOp[],
): readonly string[] {
  const hunks: string[] = [];
  let idx = 0;
  while (idx < ops.length) {
    // Skip eq runs longer than CONTEXT_LINES * 2 (no hunk needed).
    while (
      idx < ops.length &&
      ops[idx]!.kind === 'eq' &&
      runLengthFrom(ops, idx, 'eq') > CONTEXT_LINES
    ) {
      idx += runLengthFrom(ops, idx, 'eq');
    }
    if (idx >= ops.length) break;

    // Anchor: include up to CONTEXT_LINES of context before the change.
    const eqRunBefore = backwardEqRun(ops, idx);
    const start = Math.max(idx - Math.min(eqRunBefore, CONTEXT_LINES), 0);

    // Walk forward until we hit an eq run >= 2 * CONTEXT_LINES (which means
    // the next change is far enough away to start a new hunk).
    let end = idx;
    while (end < ops.length) {
      if (
        ops[end]!.kind === 'eq' &&
        runLengthFrom(ops, end, 'eq') >= CONTEXT_LINES * 2
      ) {
        break;
      }
      end++;
    }
    const trailingEqRun = end < ops.length ? CONTEXT_LINES : 0;
    end = Math.min(end + trailingEqRun, ops.length);

    hunks.push(renderHunk(a, b, ops.slice(start, end)));
    idx = end;
  }
  return hunks;
}

function runLengthFrom(
  ops: readonly DiffOp[],
  start: number,
  kind: DiffOp['kind'],
): number {
  let n = 0;
  while (start + n < ops.length && ops[start + n]!.kind === kind) n++;
  return n;
}

function backwardEqRun(ops: readonly DiffOp[], idx: number): number {
  let n = 0;
  while (idx - 1 - n >= 0 && ops[idx - 1 - n]!.kind === 'eq') n++;
  return n;
}

function renderHunk(
  a: readonly string[],
  b: readonly string[],
  hunkOps: readonly DiffOp[],
): string {
  let aStart = -1;
  let bStart = -1;
  let aCount = 0;
  let bCount = 0;
  const lines: string[] = [];
  for (const op of hunkOps) {
    if (op.kind === 'eq') {
      if (aStart === -1) {
        aStart = op.a;
        bStart = op.b;
      }
      lines.push(' ' + a[op.a]!);
      aCount++;
      bCount++;
    } else if (op.kind === 'del') {
      if (aStart === -1) {
        aStart = op.a;
        bStart = guessBStart(hunkOps);
      }
      lines.push('-' + a[op.a]!);
      aCount++;
    } else {
      if (aStart === -1) {
        aStart = guessAStart(hunkOps);
        bStart = op.b;
      }
      lines.push('+' + b[op.b]!);
      bCount++;
    }
  }
  // Diffs are 1-based.
  const header = `@@ -${aStart + 1},${aCount} +${bStart + 1},${bCount} @@\n`;
  return header + lines.join('\n') + '\n';
}

function guessAStart(hunkOps: readonly DiffOp[]): number {
  for (const op of hunkOps) {
    if (op.kind === 'eq') return op.a;
    if (op.kind === 'del') return op.a;
  }
  return 0;
}

function guessBStart(hunkOps: readonly DiffOp[]): number {
  for (const op of hunkOps) {
    if (op.kind === 'eq') return op.b;
    if (op.kind === 'add') return op.b;
  }
  return 0;
}

function parseInput(input: unknown): FilesProposeWriteInput {
  if (input === null || typeof input !== 'object') {
    throw badInput('files.propose_write input must be an object');
  }
  const i = input as Record<string, unknown>;
  if (typeof i['path'] !== 'string' || i['path'].length === 0) {
    throw badInput('files.propose_write input.path must be a non-empty string');
  }
  if (typeof i['content'] !== 'string') {
    throw badInput('files.propose_write input.content must be a string');
  }
  if (i['encoding'] !== 'utf-8' && i['encoding'] !== 'base64') {
    throw badInput("files.propose_write input.encoding must be 'utf-8' or 'base64'");
  }
  if (typeof i['message'] !== 'string' || i['message'].length === 0) {
    throw badInput('files.propose_write input.message must be a non-empty string');
  }
  return {
    path: i['path'],
    content: i['content'],
    encoding: i['encoding'] as 'utf-8' | 'base64',
    message: i['message'],
  };
}

function badInput(message: string): Error {
  const err = new Error(message);
  (err as Error & { code?: string }).code = 'invalid_input';
  return err;
}

function configError(): Error {
  return makeError(
    'not_configured',
    'files.propose_write: GitHub not configured. Set IARSMA_GITHUB_TOKEN, IARSMA_GITHUB_OWNER, IARSMA_GITHUB_REPO (and optionally _BRANCH), or write run/github-config.json.',
  );
}

function makeError(code: string, message: string): Error {
  const err = new Error(message);
  (err as Error & { code?: string }).code = code;
  return err;
}
