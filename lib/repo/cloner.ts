import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { simpleGit } from "simple-git";

/**
 * Clone a book repo into the local working area.
 *
 * The MVP supports any source `simple-git` accepts: a remote URL
 * (https/ssh) or a local path passed as `file:///abs/path`. For Windows local
 * sources we accept either `file:///C:/...` or a bare absolute path.
 *
 * The destination is always under `data/book-clones/{bookId}/`. We never
 * clone into the author's primary working copy — the whole point of cloning
 * is to keep a separate, lock-conflict-free copy.
 */
export interface CloneOptions {
  source: string;
  bookId: string;
  /** Override the default `data/book-clones` root. */
  rootDir?: string;
  /** Branch to check out. Defaults to remote HEAD. */
  branch?: string;
}

export interface CloneResult {
  localPath: string;
  defaultBranch: string;
}

export async function cloneBookRepo(opts: CloneOptions): Promise<CloneResult> {
  const root = resolve(opts.rootDir ?? "data/book-clones");
  const localPath = resolve(root, opts.bookId);

  if (existsSync(localPath)) {
    throw new Error(`destination already exists: ${localPath}`);
  }

  mkdirSync(dirname(localPath), { recursive: true });

  const git = simpleGit();
  const cloneArgs: string[] = [];
  if (opts.branch) cloneArgs.push("--branch", opts.branch);

  await git.clone(normalizeSource(opts.source), localPath, cloneArgs);

  const repoGit = simpleGit(localPath);
  const branchInfo = await repoGit.branch();

  // If the source was a local working copy, our origin now points at that
  // local path — and Git refuses to push to a non-bare working copy. Walk
  // through to its own origin and, if that's a real remote (github.com, etc),
  // rewrite ours to match. The author can still override later from the UI.
  if (!isRemoteUrl(opts.source)) {
    try {
      const upstream = simpleGit(opts.source);
      const upstreamOrigin = (await upstream.remote(["get-url", "origin"]) || "").trim();
      if (upstreamOrigin && isRemoteUrl(upstreamOrigin)) {
        await repoGit.remote(["set-url", "origin", upstreamOrigin]);
      }
    } catch {
      /* upstream may not be a git repo or may have no origin; that's fine */
    }
  }

  return {
    localPath,
    defaultBranch: branchInfo.current,
  };
}

function isRemoteUrl(s: string): boolean {
  return /^(https?:\/\/|git@|ssh:\/\/)/.test(s);
}

/**
 * Accept several conventional shapes for a local source on Windows.
 * - `file:///C:/Users/...` → returned as-is.
 * - `C:\Users\...` or `C:/Users/...` → returned as-is (simple-git handles both).
 * - Anything starting with `git@`, `https://`, `http://`, `ssh://` → as-is.
 */
function normalizeSource(source: string): string {
  return source;
}
