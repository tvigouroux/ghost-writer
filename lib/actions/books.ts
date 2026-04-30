"use server";

import "server-only";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
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
