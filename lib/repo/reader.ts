import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { simpleGit } from "simple-git";

/**
 * Safe reader for a connected book repo.
 *
 * Two invariants:
 *   1. All paths are validated to live inside `repoLocalPath` — no traversal.
 *   2. The list of allowed paths is provided per-call by the caller; this
 *      module never decides what's readable on its own.
 */
export class RepoReader {
  constructor(private readonly repoLocalPath: string) {
    if (!existsSync(repoLocalPath)) {
      throw new Error(`book repo not found at ${repoLocalPath}`);
    }
  }

  async pull(): Promise<void> {
    const git = simpleGit(this.repoLocalPath);
    await git.pull();
  }

  /**
   * Read a list of files from the repo. Each `relPath` is checked to resolve
   * inside `repoLocalPath`; otherwise the call throws.
   */
  async readFiles(relPaths: string[]): Promise<{ path: string; content: string }[]> {
    const root = resolve(this.repoLocalPath) + sep;
    const out: { path: string; content: string }[] = [];
    for (const rel of relPaths) {
      const abs = resolve(this.repoLocalPath, rel);
      if (!abs.startsWith(root)) {
        throw new Error(`path escapes repo root: ${rel}`);
      }
      const content = await readFile(abs, "utf8");
      out.push({ path: rel.replace(/\\/g, "/"), content });
    }
    return out;
  }

  /** Read a single file. */
  async readFile(relPath: string): Promise<string> {
    const [{ content }] = await this.readFiles([relPath]);
    return content;
  }
}
