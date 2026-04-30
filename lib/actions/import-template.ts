"use server";

import "server-only";

import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { z } from "zod";
import { getBookById } from "./books";
import { parseInterviewMd, type ParsedInterviewTemplate } from "../md/interview-template-parser";
import { RepoReader } from "../repo/reader";

export interface ImportableMd {
  /** Repo-relative path, forward-slashed. */
  path: string;
  /** Just the filename for display. */
  fileName: string;
  /** Subdir within entrevistas/, e.g. "terceros" or "tomas". */
  scope: string;
}

const InterviewSubdirs = ["terceros", "tomas", "autor"];
const ExcludedNames = (name: string) =>
  name.startsWith("_") || name.endsWith("-respuestas.md") || !name.endsWith(".md");

export async function listImportableMds(bookId: string): Promise<ImportableMd[]> {
  const book = await getBookById(bookId);
  if (!book) throw new Error("book not found");

  const out: ImportableMd[] = [];
  for (const sub of InterviewSubdirs) {
    const dir = join(book.repoLocalPath, "entrevistas", sub);
    let entries: string[] = [];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (ExcludedNames(name)) continue;
      const abs = join(dir, name);
      const rel = relative(book.repoLocalPath, abs).replace(/\\/g, "/");
      out.push({ path: rel, fileName: name, scope: sub });
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

const ParseSchema = z.object({
  bookId: z.string().min(1),
  relPath: z.string().min(1),
});

export interface ParsedTemplatePayload {
  parsed: ParsedInterviewTemplate;
  /** Pretty JSON the form can drop straight into the guide_blocks textarea. */
  guideBlocksJson: string;
  /** The original markdown source — handy if the author wants to keep editing. */
  rawMd: string;
  /** Repo-relative path the parser read from. */
  sourceMdPath: string;
}

/**
 * List every markdown file in the book repo (recursive), so the author can
 * pick context files for a template without typing paths.
 *
 * Excluded: `.git/`, `node_modules/`, anything starting with `_pendiente-`
 * (those are app-deposited drafts), and non-`.md` files.
 */
const SKIP_DIR_NAMES = new Set([".git", "node_modules", ".next", "dist", "build"]);

export interface RepoMdFile {
  /** Repo-relative path, forward-slashed. */
  path: string;
  /** Just the filename for display. */
  fileName: string;
  /** "" for repo root, otherwise the directory path. */
  dir: string;
}

export async function listRepoMarkdownFiles(bookId: string): Promise<RepoMdFile[]> {
  const book = await getBookById(bookId);
  if (!book) throw new Error("book not found");

  const out: RepoMdFile[] = [];
  await walk(book.repoLocalPath, book.repoLocalPath, out);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

async function walk(root: string, dir: string, acc: RepoMdFile[]): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIR_NAMES.has(name)) continue;
    if (name.startsWith("_pendiente-")) continue;
    const abs = join(dir, name);
    let s;
    try {
      s = await stat(abs);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      await walk(root, abs, acc);
    } else if (s.isFile() && name.toLowerCase().endsWith(".md")) {
      const rel = relative(root, abs).replace(/\\/g, "/");
      const lastSlash = rel.lastIndexOf("/");
      acc.push({
        path: rel,
        fileName: lastSlash >= 0 ? rel.slice(lastSlash + 1) : rel,
        dir: lastSlash >= 0 ? rel.slice(0, lastSlash) : "",
      });
    }
  }
}

export async function parseInterviewMdAction(
  input: { bookId: string; relPath: string },
): Promise<ParsedTemplatePayload> {
  const parsedInput = ParseSchema.parse(input);
  const book = await getBookById(parsedInput.bookId);
  if (!book) throw new Error("book not found");

  const reader = new RepoReader(book.repoLocalPath);
  const raw = await reader.readFile(parsedInput.relPath);

  const fallbackName = parsedInput.relPath.split("/").pop()!.replace(/\.md$/, "");
  const parsed = parseInterviewMd(raw, fallbackName);

  // The textarea-friendly JSON is shaped to match the InterviewTemplate's
  // `guideBlocks` JSON column directly.
  const guideBlocksJson = JSON.stringify(parsed.guideBlocks, null, 2);

  return {
    parsed,
    guideBlocksJson,
    rawMd: raw,
    sourceMdPath: parsedInput.relPath,
  };
}
