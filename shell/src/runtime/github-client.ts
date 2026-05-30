/**
 * GitHubClient — REST client for the GitHub Contents API.
 *
 * Used by the webmail "files" surface (Phase 5a) to list, read, write,
 * and delete files in a single configured repository.
 *
 * Direct fetch against `https://api.github.com` — no WIT/WASM yet
 * (usability first; abstract later if a second backend appears).
 *
 * Reference: https://docs.github.com/en/rest/repos/contents
 *
 * All requests carry:
 *   - `Authorization: Bearer <token>`
 *   - `Accept: application/vnd.github+json`
 *   - `X-GitHub-Api-Version: 2022-11-28`
 *
 * UTF-8 handling: GitHub returns base64-encoded blob content. For text
 * files we decode to a UTF-8 string via TextDecoder; for binary files
 * (detected by extension) we keep the base64 payload as-is so callers
 * can store or download it without lossy re-encoding.
 */

// ── Types ───────────────────────────────────────────────────────────

export type GitHubConfig = {
  readonly token: string;
  readonly owner: string;
  readonly repo: string;
  /** Branch to read/write against. Defaults to 'main'. */
  readonly branch?: string;
};

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
  /** Decoded UTF-8 string for text files; raw base64 for binary. */
  readonly content: string;
  readonly encoding: 'utf-8' | 'base64';
  readonly size: number;
};

export type CommitResult = {
  readonly sha: string;
  readonly url: string;
};

export type CommitInfo = {
  readonly sha: string;
  readonly message: string;
  readonly author: string;
  readonly date: string;
};

export interface GitHubClient {
  /** List entries at a directory path. Pass '' for repo root. */
  list(path: string): Promise<readonly FileEntry[]>;
  /** Read the file at the given path. */
  read(path: string): Promise<FileContent>;
  /** Create or update a file. Pass `sha` when updating an existing file. */
  write(
    path: string,
    content: string,
    message: string,
    sha?: string,
  ): Promise<CommitResult>;
  /** Delete a file. `sha` is the current blob SHA (required by GitHub). */
  delete(path: string, message: string, sha: string): Promise<CommitResult>;
  /** Commit history for a single path. */
  history(path: string, limit?: number): Promise<readonly CommitInfo[]>;
}

// ── Helpers (module-private) ────────────────────────────────────────

/** Encode each path segment but leave '/' separators intact. */
function encodeContentsPath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

/** Strip embedded newlines that GitHub injects into base64 payloads. */
function stripBase64Whitespace(s: string): string {
  return s.replace(/\s+/g, '');
}

/** Decode a base64 string into a UTF-8 string. */
function decodeBase64Utf8(b64: string): string {
  const binary = atob(stripBase64Whitespace(b64));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder('utf-8').decode(bytes);
}

/** Encode a UTF-8 string into a base64 payload (no embedded newlines). */
function encodeUtf8Base64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

/** Best-effort binary detection by extension. */
export function isBinaryPath(path: string): boolean {
  return /\.(png|jpg|jpeg|gif|webp|svg|ico|pdf|zip|tar|gz|bz2|7z|wasm|bin|exe|dll|so|dylib|mp3|mp4|mov|avi|woff|woff2|ttf|otf)$/i.test(
    path,
  );
}

// ── Raw response shapes (only the fields we read) ───────────────────

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

type CommitResponse = {
  readonly commit: {
    readonly sha: string;
    readonly html_url: string;
  };
};

type HistoryItemResponse = {
  readonly sha: string;
  readonly commit: {
    readonly message: string;
    readonly author: {
      readonly name: string;
      readonly date: string;
    };
  };
};

// ── Factory ─────────────────────────────────────────────────────────

export type GitHubClientOptions = {
  /** Override `fetch` (for tests). */
  readonly fetchImpl?: typeof fetch;
  /** Override API base URL (for tests / GitHub Enterprise). */
  readonly baseUrl?: string;
};

export function githubClient(
  config: GitHubConfig,
  opts?: GitHubClientOptions,
): GitHubClient {
  const base = opts?.baseUrl ?? 'https://api.github.com';
  const branch = config.branch ?? 'main';
  const doFetch: typeof fetch = opts?.fetchImpl ?? fetch;

  async function api(path: string, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${config.token}`);
    headers.set('Accept', 'application/vnd.github+json');
    headers.set('X-GitHub-Api-Version', '2022-11-28');
    if (init?.body !== undefined && init.body !== null) {
      if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }
    }
    return doFetch(`${base}${path}`, { ...init, headers });
  }

  function contentsUrl(path: string, query?: string): string {
    const encoded = encodeContentsPath(path);
    const suffix = query !== undefined ? `?${query}` : '';
    return `/repos/${config.owner}/${config.repo}/contents/${encoded}${suffix}`;
  }

  async function errorText(resp: Response): Promise<string> {
    try {
      return await resp.text();
    } catch {
      return '';
    }
  }

  return {
    async list(path) {
      const resp = await api(contentsUrl(path, `ref=${encodeURIComponent(branch)}`));
      if (!resp.ok) {
        throw new Error(`github list ${path}: ${resp.status} ${await errorText(resp)}`);
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

    async read(path) {
      const resp = await api(contentsUrl(path, `ref=${encodeURIComponent(branch)}`));
      if (!resp.ok) {
        throw new Error(`github read ${path}: ${resp.status} ${await errorText(resp)}`);
      }
      const data = (await resp.json()) as FileGetResponse;
      const treatAsText = !isBinaryPath(path);
      let content: string;
      let encoding: 'utf-8' | 'base64';
      if (treatAsText) {
        content = decodeBase64Utf8(data.content);
        encoding = 'utf-8';
      } else {
        content = stripBase64Whitespace(data.content);
        encoding = 'base64';
      }
      return {
        path: data.path,
        sha: data.sha,
        content,
        encoding,
        size: data.size,
      };
    },

    async write(path, content, message, sha) {
      const encoded = encodeUtf8Base64(content);
      const body: Record<string, unknown> = {
        message,
        content: encoded,
        branch,
      };
      if (sha !== undefined) body.sha = sha;
      const resp = await api(contentsUrl(path), {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        throw new Error(`github write ${path}: ${resp.status} ${await errorText(resp)}`);
      }
      const data = (await resp.json()) as CommitResponse;
      return { sha: data.commit.sha, url: data.commit.html_url };
    },

    async delete(path, message, sha) {
      const resp = await api(contentsUrl(path), {
        method: 'DELETE',
        body: JSON.stringify({ message, sha, branch }),
      });
      if (!resp.ok) {
        throw new Error(`github delete ${path}: ${resp.status} ${await errorText(resp)}`);
      }
      const data = (await resp.json()) as CommitResponse;
      return { sha: data.commit.sha, url: data.commit.html_url };
    },

    async history(path, limit = 30) {
      const query = [
        `path=${encodeURIComponent(path)}`,
        `sha=${encodeURIComponent(branch)}`,
        `per_page=${limit}`,
      ].join('&');
      const resp = await api(
        `/repos/${config.owner}/${config.repo}/commits?${query}`,
      );
      if (!resp.ok) {
        throw new Error(`github history ${path}: ${resp.status} ${await errorText(resp)}`);
      }
      const data = (await resp.json()) as readonly HistoryItemResponse[];
      return data.map((c) => ({
        sha: c.sha,
        message: c.commit.message,
        author: c.commit.author.name,
        date: c.commit.author.date,
      }));
    },
  };
}
