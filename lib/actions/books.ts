"use server";

import "server-only";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { simpleGit } from "simple-git";
import { ulid } from "ulid";
import { z } from "zod";
import { getCurrentAuthor } from "../auth/author";
import { db, schema } from "../db/client";
import { cloneBookRepo } from "../repo/cloner";

const ConnectBookSchema = z.object({
  title: z.string().min(1).max(200),
  source: z.string().min(1).max(500),
  defaultLanguage: z
    .string()
    .min(2)
    .max(8)
    .default("es")
    .transform((s) => s.toLowerCase()),
  repoUrl: z.string().max(500).optional().or(z.literal("")),
});

export async function connectBookAction(formData: FormData): Promise<void> {
  const author = await getCurrentAuthor();

  const parsed = ConnectBookSchema.parse({
    title: formData.get("title"),
    source: formData.get("source"),
    defaultLanguage: formData.get("defaultLanguage") || "es",
    repoUrl: formData.get("repoUrl") || "",
  });

  const bookId = ulid();
  const { localPath } = await cloneBookRepo({
    source: parsed.source,
    bookId,
  });

  await db.insert(schema.books).values({
    id: bookId,
    authorId: author.id,
    templateId: null,
    title: parsed.title,
    repoUrl: parsed.repoUrl || null,
    repoLocalPath: localPath,
    defaultLanguage: parsed.defaultLanguage,
    enabledModes: '["interviewer"]',
    createdAt: Date.now(),
  });

  revalidatePath("/");
  redirect(`/books/${bookId}`);
}

export async function listBooksForCurrentAuthor() {
  const author = await getCurrentAuthor();
  return db.query.books.findMany({
    where: eq(schema.books.authorId, author.id),
    orderBy: (b, { desc }) => [desc(b.createdAt)],
  });
}

export async function getBookById(id: string) {
  const author = await getCurrentAuthor();
  const book = await db.query.books.findFirst({
    where: eq(schema.books.id, id),
  });
  if (!book || book.authorId !== author.id) return null;
  return book;
}

/**
 * Inspect the clone's `origin` and report whether it can be pushed to (i.e.
 * is a remote like github.com, not a local working copy on disk).
 */
export async function getBookRemoteInfo(bookId: string): Promise<{
  originUrl: string | null;
  isPushable: boolean;
  reason: string | null;
  detectedGithubUrl: string | null;
}> {
  const book = await getBookById(bookId);
  if (!book) throw new Error("book not found");

  const git = simpleGit(book.repoLocalPath);
  let originUrl: string | null = null;
  try {
    originUrl = (await git.remote(["get-url", "origin"]) || "").trim() || null;
  } catch {
    originUrl = null;
  }

  // Try to detect a "real" GitHub remote by walking through any local-path
  // origin (the OneDrive copy) and reading ITS origin. Pure read; no writes.
  let detectedGithubUrl: string | null = null;
  if (originUrl && !/^(https?|git@|ssh):/.test(originUrl)) {
    try {
      const upstream = simpleGit(originUrl);
      const upstreamOrigin = (await upstream.remote(["get-url", "origin"]) || "").trim();
      if (upstreamOrigin && /github\.com/.test(upstreamOrigin)) {
        detectedGithubUrl = upstreamOrigin;
      }
    } catch {
      /* upstream may not be a git repo or may not exist */
    }
  }

  let isPushable = false;
  let reason: string | null = null;
  if (!originUrl) {
    reason = "Clone has no `origin` remote configured.";
  } else if (/^(https?|git@|ssh):/.test(originUrl) && /github\.com/.test(originUrl)) {
    isPushable = true;
  } else if (/^(https?|git@|ssh):/.test(originUrl)) {
    isPushable = true; // non-github remote, still pushable
  } else {
    reason =
      "Origin points to a local working copy on disk, which Git refuses to push to. Switch the remote to the book's GitHub URL.";
  }

  return { originUrl, isPushable, reason, detectedGithubUrl };
}

/**
 * Replace the clone's origin URL with a new one (typically the book's GitHub
 * URL). Also persists `repoUrl` on the book row so future UI shows it.
 */
const RelinkSchema = z.object({
  bookId: z.string().min(1),
  newOriginUrl: z
    .string()
    .min(1)
    .max(500)
    .regex(
      /^(https?:\/\/|git@|ssh:\/\/)/,
      "must be a remote URL (https://, git@, or ssh://)",
    ),
});

const SetBranchSchema = z.object({
  bookId: z.string().min(1),
  branch: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z0-9._\-/]+$/, "branch name has invalid chars"),
});

/**
 * Update the branch the app commits to. Default is "ghost-writer-staging"
 * so app commits don't interleave with the author's manual work on main.
 */
export async function setBookCommitBranchAction(input: {
  bookId: string;
  branch: string;
}): Promise<void> {
  const parsed = SetBranchSchema.parse(input);
  const book = await getBookById(parsed.bookId);
  if (!book) throw new Error("book not found");

  await db
    .update(schema.books)
    .set({ commitBranch: parsed.branch })
    .where(eq(schema.books.id, parsed.bookId));

  revalidatePath(`/books/${parsed.bookId}`);
  revalidatePath(`/books/${parsed.bookId}/entrevistador`);
}

export async function relinkBookOriginAction(input: {
  bookId: string;
  newOriginUrl: string;
}): Promise<void> {
  const parsed = RelinkSchema.parse(input);
  const book = await getBookById(parsed.bookId);
  if (!book) throw new Error("book not found");

  const git = simpleGit(book.repoLocalPath);
  // Try set-url; if no origin exists, add it.
  try {
    await git.remote(["set-url", "origin", parsed.newOriginUrl]);
  } catch {
    await git.addRemote("origin", parsed.newOriginUrl);
  }

  await db
    .update(schema.books)
    .set({ repoUrl: parsed.newOriginUrl })
    .where(eq(schema.books.id, parsed.bookId));

  revalidatePath(`/books/${parsed.bookId}`);
  revalidatePath(`/books/${parsed.bookId}/entrevistador`);
}
