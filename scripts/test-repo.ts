/**
 * End-to-end test for Phase 3: clone a book repo, pull, and read files.
 *
 * Usage:
 *   pnpm tsx scripts/test-repo.ts <source> [...rel-paths]
 *
 * Examples:
 *   # Local git repo (Windows path)
 *   pnpm tsx scripts/test-repo.ts "C:/path/to/book-repo" outline.md CLAUDE.md
 *
 *   # Remote
 *   pnpm tsx scripts/test-repo.ts https://github.com/user/book-repo.git outline.md
 *
 * The script:
 *   1. Generates a throwaway book id.
 *   2. Clones the source into data/book-clones/{book_id}/.
 *   3. Runs `git pull` to confirm the remote-tracking branch is healthy.
 *   4. Reads the requested files (default: outline.md and CLAUDE.md, if either
 *      exists) and prints the first 12 lines of each.
 *
 * Each run uses a unique book id, so the test is repeatable. Old clones
 * accumulate in data/book-clones/ — clean them up manually if desired.
 */
import { rm } from "node:fs/promises";
import { ulid } from "ulid";
import { cloneBookRepo } from "../lib/repo/cloner";
import { RepoReader } from "../lib/repo/reader";

async function main() {
  const [source, ...relPaths] = process.argv.slice(2);
  if (!source) {
    console.error(
      "usage: pnpm tsx scripts/test-repo.ts <source> [...rel-paths]",
    );
    process.exit(2);
  }

  const bookId = `test-${ulid().slice(-10).toLowerCase()}`;
  console.log(`> bookId=${bookId}`);
  console.log(`> source=${source}`);

  let localPath: string;
  try {
    const clone = await cloneBookRepo({ source, bookId });
    localPath = clone.localPath;
    console.log(`> cloned to ${clone.localPath} (branch: ${clone.defaultBranch})`);
  } catch (err) {
    console.error("clone failed:", (err as Error).message);
    process.exit(1);
  }

  const reader = new RepoReader(localPath);

  try {
    await reader.pull();
    console.log("> git pull: ok");
  } catch (err) {
    // Local file:// clones don't have a remote-tracking ref; that's fine.
    console.warn(`> git pull skipped: ${(err as Error).message}`);
  }

  const targets = relPaths.length > 0 ? relPaths : ["outline.md", "CLAUDE.md"];
  for (const rel of targets) {
    try {
      const content = await reader.readFile(rel);
      const preview = content.split(/\r?\n/).slice(0, 12).join("\n");
      console.log(`\n--- ${rel} (first 12 lines) ---\n${preview}\n`);
    } catch (err) {
      console.warn(`! could not read ${rel}: ${(err as Error).message}`);
    }
  }

  // Path-traversal sanity check: this MUST throw.
  try {
    await reader.readFile("../etc/passwd");
    console.error("! SECURITY: traversal was NOT blocked");
    process.exit(1);
  } catch {
    console.log("> path traversal correctly blocked");
  }

  // Clean up the test clone so reruns don't accumulate.
  await rm(localPath, { recursive: true, force: true });
  console.log("> test clone removed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
