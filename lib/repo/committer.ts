import { existsSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { simpleGit } from "simple-git";

/**
 * Commit a file (typically a processed interview transcript) to a book repo
 * and push to its remote. Bypasses the default `_pendiente-` staging
 * convention — the author opts into this explicitly.
 *
 * Auth: Personal Access Token from process.env.GITHUB_TOKEN, passed as a
 * one-shot HTTP Authorization header via `-c http.extraheader=...`. We do
 * NOT bake the token into the remote URL or log it.
 *
 * Sync policy: ff-only pull before commit. If the local clone has diverged
 * from the remote, fail with a clear message instead of merging or
 * force-pushing.
 */
export interface CommitOptions {
  /** Local clone path. Must be inside the app's data/book-clones/ area. */
  repoLocalPath: string;
  /** Repo path of the file to write (forward-slashed, relative to repo root). */
  relPath: string;
  /** Markdown content. */
  content: string;
  /** Commit message. The author writes this. */
  commitMessage: string;
  /** Branch to push. Defaults to "main". */
  branch?: string;
}

export interface CommitResult {
  commitHash: string;
  /** Best-effort URL to view the commit on GitHub, if the remote is github.com. */
  commitUrl: string | null;
  /** Absolute path of the file we just wrote. */
  absPath: string;
}

const TOKEN_REDACT = "<redacted>";

export async function commitAndPush(opts: CommitOptions): Promise<CommitResult> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error(
      "GITHUB_TOKEN is not set. Add a Personal Access Token to .env to enable commit-and-push.",
    );
  }
  if (!existsSync(opts.repoLocalPath)) {
    throw new Error(`book repo not found at ${opts.repoLocalPath}`);
  }

  const branch = opts.branch ?? "main";

  // Path-traversal guard: the relPath must resolve inside the clone.
  const root = resolve(opts.repoLocalPath) + sep;
  const abs = resolve(opts.repoLocalPath, opts.relPath);
  if (!abs.startsWith(root)) {
    throw new Error(`path escapes repo root: ${opts.relPath}`);
  }

  // GitHub git-over-HTTPS expects Basic auth with the token as the password
  // and any non-empty username (`x-access-token` is the convention). Bearer
  // auth works for the REST API but is rejected by the git smart-HTTP
  // protocol on github.com — that's why a token that authenticates fine
  // against api.github.com still fails on `git push` if you send it as Bearer.
  const basicAuth = Buffer.from(`x-access-token:${token}`).toString("base64");
  const authHeader = `Authorization: Basic ${basicAuth}`;
  const git = simpleGit(opts.repoLocalPath);

  // 1. Sync remote before writing. ff-only fails loudly on divergence.
  try {
    await git.raw([
      "-c",
      `http.extraheader=${authHeader}`,
      "pull",
      "--ff-only",
      "origin",
      branch,
    ]);
  } catch (err) {
    throw new Error(
      `git pull --ff-only failed (clone diverged from remote?): ${redact((err as Error).message, token)}`,
    );
  }

  // 2. Write the file.
  mkdirSync(dirname(abs), { recursive: true });
  await writeFile(abs, opts.content, "utf8");

  // 3. Stage + commit. Configure the commit author for this single command
  // so we don't mutate the clone's permanent git config.
  const authorName = process.env.GITHUB_AUTHOR_NAME || "Ghost Writer Bot";
  const authorEmail = process.env.GITHUB_AUTHOR_EMAIL || "ghost-writer-bot@local";

  await git.add([opts.relPath]);

  // Was anything actually staged?
  const status = await git.status();
  const hasChanges =
    status.staged.includes(opts.relPath) ||
    status.created.includes(opts.relPath) ||
    status.modified.includes(opts.relPath);

  if (hasChanges) {
    await git.raw([
      "-c",
      `user.name=${authorName}`,
      "-c",
      `user.email=${authorEmail}`,
      "commit",
      "-m",
      opts.commitMessage,
    ]);
  } else if (status.ahead > 0) {
    // No new changes to stage, but the local clone has commits the remote
    // hasn't seen yet. This typically happens after a previous attempt
    // committed locally but failed to push (e.g. an earlier auth bug).
    // Skip the commit step and go straight to pushing what's already here.
    /* fall through to push */
  } else {
    throw new Error(
      `nothing to commit for ${opts.relPath} — file is byte-identical to HEAD and there are no local commits ahead of origin`,
    );
  }

  // 4. Push.
  try {
    await git.raw([
      "-c",
      `http.extraheader=${authHeader}`,
      "push",
      "origin",
      branch,
    ]);
  } catch (err) {
    throw new Error(`git push failed: ${redact((err as Error).message, token)}`);
  }

  // 5. Resolve the commit hash + best-effort GitHub URL.
  const commitHash = (await git.revparse(["HEAD"])).trim();
  const remotes = await git.getRemotes(true);
  const origin = remotes.find((r) => r.name === "origin");
  const commitUrl = origin ? githubCommitUrl(origin.refs.fetch, commitHash) : null;

  return { commitHash, commitUrl, absPath: abs };
}

function githubCommitUrl(remoteUrl: string, hash: string): string | null {
  // Accept https://github.com/owner/repo[.git] and git@github.com:owner/repo[.git]
  const https = remoteUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (https) return `https://github.com/${https[1]}/${https[2]}/commit/${hash}`;
  const ssh = remoteUrl.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (ssh) return `https://github.com/${ssh[1]}/${ssh[2]}/commit/${hash}`;
  return null;
}

function redact(s: string, token: string): string {
  if (!token) return s;
  return s.split(token).join(TOKEN_REDACT);
}
