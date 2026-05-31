/**
 * Server-side read-only GitHub client (Phase 5b).
 *
 * Mirrors the read surface of `shell/src/runtime/github-client.ts`, minus
 * write/delete/history. The MCP server is intentionally read-only against
 * GitHub: writes happen browser-side after human approval (D-053). Sharing
 * the contract — same fields, same encoding rules — keeps proposal previews
 * binary-compatible with the eventual browser commit.
 *
 * Reuses the browser client's path-encoding and base64 rules; Node 20+ has
 * `atob`, `TextDecoder`, and `fetch` as globals.
 */
import type { GithubConfig } from './github-config.js';

export type FileEntry = {
  readonly path: string;
  readonly name: string;
  readonly type: 'file' | 'dir';
  readonly sha?: string;
  readonly size?: number;
};

export type FileContent = {
  readonly path: string;
  readonly sha: string;
  readonly size: number;
  readonly content: string;
  readonly encoding: 'utf-8' | 'base64';
};

export interface GithubReadClient {
  list(path: string): Promise<readonly FileEntry[]>;
  read(path: string): Promise<FileContent>;
}

export function isBinaryPath(path: string): boolean {
  return /\.(png|jpg|jpeg|gif|webp|svg|ico|pdf|zip|tar|gz|bz2|7z|wasm|bin|exe|dll|so|dylib|mp3|mp4|mov|avi|woff|woff2|ttf|otf)$/i.test(
    path,
  );
}

function encodeContentsPath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function stripBase64Whitespace(s: string): string {
  return s.replace(/\s+/g, '');
}

function decodeBase64Utf8(b64: string): string {
  const binary = Buffer.from(stripBase64Whitespace(b64), 'base64');
  return binary.toString('utf-8');
}

type ContentsItemResponse = {
  readonly path: string;
  readonly name: string;
  readonly type: string;
  readonly sha?: string;
  readonly size?: number;
};

type FileGetResponse = {
  readonly path: string;
  readonly sha: string;
  readonly size: number;
  readonly content: string;
  readonly encoding: string;
};

export type GithubReadClientOptions = {
  readonly fetchImpl?: typeof fetch;
  readonly baseUrl?: string;
};

export function githubReadClient(
  config: GithubConfig,
  opts?: GithubReadClientOptions,
): GithubReadClient {
  const base = opts?.baseUrl ?? 'https://api.github.com';
  const branch = config.branch ?? 'main';
  const doFetch: typeof fetch = opts?.fetchImpl ?? fetch;

  async function api(p: string): Promise<Response> {
    return doFetch(`${base}${p}`, {
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
  }

  function contentsUrl(p: string): string {
    const encoded = encodeContentsPath(p);
    return `/repos/${config.owner}/${config.repo}/contents/${encoded}?ref=${encodeURIComponent(branch)}`;
  }

  async function errorText(resp: Response): Promise<string> {
    try {
      return await resp.text();
    } catch {
      return '';
    }
  }

  return {
    async list(p) {
      const resp = await api(contentsUrl(p));
      if (!resp.ok) {
        throw makeError(resp.status, `github list ${p}: ${resp.status} ${await errorText(resp)}`);
      }
      const data = (await resp.json()) as ContentsItemResponse | readonly ContentsItemResponse[];
      const arr: readonly ContentsItemResponse[] = Array.isArray(data) ? data : [data];
      return arr.map((e) => {
        const entry: FileEntry = {
          path: e.path,
          name: e.name,
          type: e.type === 'dir' ? 'dir' : 'file',
          ...(e.sha !== undefined ? { sha: e.sha } : {}),
          ...(e.size !== undefined ? { size: e.size } : {}),
        };
        return entry;
      });
    },

    async read(p) {
      const resp = await api(contentsUrl(p));
      if (!resp.ok) {
        throw makeError(resp.status, `github read ${p}: ${resp.status} ${await errorText(resp)}`);
      }
      const data = (await resp.json()) as FileGetResponse;
      const treatAsText = !isBinaryPath(p);
      const content = treatAsText
        ? decodeBase64Utf8(data.content)
        : stripBase64Whitespace(data.content);
      return {
        path: data.path,
        sha: data.sha,
        size: data.size,
        content,
        encoding: treatAsText ? 'utf-8' : 'base64',
      };
    },
  };
}

function makeError(status: number, message: string): Error {
  const err = new Error(message);
  const code =
    status === 401 || status === 403
      ? 'unauthorized'
      : status === 404
        ? 'not_found'
        : 'github_http_error';
  (err as Error & { code?: string }).code = code;
  return err;
}
