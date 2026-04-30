/**
 * Test the interview-template parser against a real .md file.
 *
 * Usage:
 *   pnpm tsx scripts/test-parser.ts "path/to/file.md"
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { parseInterviewMd } from "../lib/md/interview-template-parser";

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: pnpm tsx scripts/test-parser.ts <path>");
    process.exit(2);
  }
  const raw = await readFile(path, "utf8");
  const parsed = parseInterviewMd(raw, basename(path).replace(/\.md$/, ""));
  console.log("name:", parsed.name);
  console.log("introMd length:", parsed.introMd?.length ?? 0);
  console.log("warnings:", parsed.warnings);
  console.log("blocks:", parsed.guideBlocks.length);
  for (const b of parsed.guideBlocks) {
    console.log(`  - ${b.id}: ${b.title}`);
    console.log(`      objective: ${b.objective.slice(0, 100)}…`);
    console.log(`      seedQuestions: ${b.seedQuestions.length}`);
    if (b.seedQuestions.length > 0) {
      console.log(`        e.g. "${b.seedQuestions[0]}"`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
