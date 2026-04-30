import "server-only";

import { existsSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

/**
 * Safe writer for a connected book repo.
 *
 * Strict policy:
 *   - Only writes to paths starting with a configured staging prefix
 *     (default: filename starts with `_pendiente-`) or under an explicitly
 *     allowed staging directory.
 *   - Never commits, never pushes.
 *   - Never overwrites a file unless explicitly told.
 */
export class RepoWriter {
  constructor(private readonly repoLocalPath: string) {
    if (!existsSync(repoLocalPath)) {
      throw new Error(`book repo not found at ${repoLocalPath}`);
    }
  }

  /**
   * Write a markdown file with the `_pendiente-` prefix. The author renames
   * and commits from their workstation.
   */
  async writePending(opts: {
    /** Directory relative to repo root, e.g. "entrevistas/terceros". */
    relDir: string;
    /** Slug used in the filename, e.g. "04-coach-trail". */
    slug: string;
    /** Markdown content. */
    content: string;
    overwrite?: boolean;
  }): Promise<string> {
    const root = resolve(this.repoLocalPath) + sep;
    const filename = `_pendiente-${opts.slug}.md`;
    const abs = resolve(this.repoLocalPath, opts.relDir, filename);
    if (!abs.startsWith(root)) {
      throw new Error(`path escapes repo root: ${opts.relDir}/${filename}`);
    }
    if (existsSync(abs) && !opts.overwrite) {
      throw new Error(`file already exists: ${abs}`);
    }
    mkdirSync(dirname(abs), { recursive: true });
    await writeFile(abs, opts.content, "utf8");
    return abs;
  }
}
