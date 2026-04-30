"use server";

import "server-only";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { ulid } from "ulid";
import { z } from "zod";
import { signIntervieweeToken } from "../auth/interviewee";
import { db, schema } from "../db/client";
import { getBookById } from "./books";

const GuideBlockSchema = z.object({
  id: z.string().min(1).max(60),
  title: z.string().min(1).max(200),
  objective: z.string().min(1),
  seedQuestions: z.array(z.string()).optional().default([]),
  mustCover: z.boolean().default(false),
});

const CreateInterviewTemplateSchema = z.object({
  bookId: z.string().min(1),
  name: z.string().min(1).max(200),
  systemPrompt: z.string().min(1),
  introMd: z.string().optional().default(""),
  /** JSON-encoded array of guide blocks. */
  guideBlocksJson: z.string().min(2),
  /** Newline-separated list of repo-relative paths. */
  contextFilesText: z.string().optional().default(""),
  sourceMdPath: z.string().optional().or(z.literal("")),
});

export async function createInterviewTemplateAction(formData: FormData): Promise<void> {
  const parsed = CreateInterviewTemplateSchema.parse({
    bookId: formData.get("bookId"),
    name: formData.get("name"),
    systemPrompt: formData.get("systemPrompt"),
    introMd: formData.get("introMd") || "",
    guideBlocksJson: formData.get("guideBlocksJson"),
    contextFilesText: formData.get("contextFilesText") || "",
    sourceMdPath: formData.get("sourceMdPath") || "",
  });

  const book = await getBookById(parsed.bookId);
  if (!book) throw new Error("book not found");

  let blocks: unknown;
  try {
    blocks = JSON.parse(parsed.guideBlocksJson);
  } catch {
    throw new Error("guide_blocks must be valid JSON");
  }
  const blocksParsed = z.array(GuideBlockSchema).parse(blocks);

  const contextFiles = parsed.contextFilesText
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const id = ulid();
  await db.insert(schema.interviewTemplates).values({
    id,
    bookId: parsed.bookId,
    name: parsed.name,
    systemPrompt: parsed.systemPrompt,
    introMd: parsed.introMd || null,
    guideBlocks: JSON.stringify(blocksParsed),
    contextFiles: JSON.stringify(contextFiles),
    sourceMdPath: parsed.sourceMdPath || null,
    createdAt: Date.now(),
  });

  revalidatePath(`/books/${parsed.bookId}`);
}

const CreateIntervieweeSchema = z.object({
  bookId: z.string().min(1),
  displayName: z.string().min(1).max(120),
  relation: z.string().max(120).optional().or(z.literal("")),
  notes: z.string().max(1000).optional().or(z.literal("")),
});

export async function createIntervieweeAction(formData: FormData): Promise<void> {
  const parsed = CreateIntervieweeSchema.parse({
    bookId: formData.get("bookId"),
    displayName: formData.get("displayName"),
    relation: formData.get("relation") || "",
    notes: formData.get("notes") || "",
  });

  const book = await getBookById(parsed.bookId);
  if (!book) throw new Error("book not found");

  const id = ulid();
  await db.insert(schema.interviewees).values({
    id,
    bookId: parsed.bookId,
    displayName: parsed.displayName,
    relation: parsed.relation || null,
    notes: parsed.notes || null,
    createdAt: Date.now(),
  });

  revalidatePath(`/books/${parsed.bookId}`);
}

const CreateSessionSchema = z.object({
  bookId: z.string().min(1),
  templateId: z.string().min(1),
  intervieweeId: z.string().min(1),
});

export interface CreateSessionResult {
  sessionId: string;
  link: string;
}

export async function createSessionAction(
  formData: FormData,
): Promise<CreateSessionResult> {
  const parsed = CreateSessionSchema.parse({
    bookId: formData.get("bookId"),
    templateId: formData.get("templateId"),
    intervieweeId: formData.get("intervieweeId"),
  });

  const book = await getBookById(parsed.bookId);
  if (!book) throw new Error("book not found");

  const template = await db.query.interviewTemplates.findFirst({
    where: eq(schema.interviewTemplates.id, parsed.templateId),
  });
  if (!template || template.bookId !== parsed.bookId) {
    throw new Error("template not found for this book");
  }
  const interviewee = await db.query.interviewees.findFirst({
    where: eq(schema.interviewees.id, parsed.intervieweeId),
  });
  if (!interviewee || interviewee.bookId !== parsed.bookId) {
    throw new Error("interviewee not found for this book");
  }

  const sessionId = ulid();
  const token = await signIntervieweeToken({
    sid: sessionId,
    iid: parsed.intervieweeId,
  });

  // Pick the first block as the starting one.
  const blocks = JSON.parse(template.guideBlocks) as { id: string }[];
  const firstBlockId = blocks[0]?.id ?? null;
  const initialCoverage: Record<string, "pending"> = {};
  for (const b of blocks) initialCoverage[b.id] = "pending";

  await db.insert(schema.sessions).values({
    id: sessionId,
    templateId: parsed.templateId,
    intervieweeId: parsed.intervieweeId,
    status: "draft",
    tokenJti: token.jti,
    tokenExpiresAt: token.expiresAt,
    currentBlockId: firstBlockId,
    blockCoverage: JSON.stringify(initialCoverage),
    startedAt: null,
    closedAt: null,
    createdAt: Date.now(),
  });

  const baseUrl = process.env.PUBLIC_BASE_URL ?? "http://localhost:3000";
  const link = `${baseUrl}/s/${token.jwt}`;

  revalidatePath(`/books/${parsed.bookId}`);
  return { sessionId, link };
}

/**
 * Mint a fresh JWT for an existing session and update its tokenJti so the
 * room route accepts it. Used when the author lost the original link (the
 * link is never persisted; only the jti is, and the jti only validates one
 * specific JWT). The previous jti is invalidated by this swap.
 */
export async function regenerateSessionLinkAction(
  sessionId: string,
): Promise<CreateSessionResult> {
  const session = await db.query.sessions.findFirst({
    where: eq(schema.sessions.id, sessionId),
  });
  if (!session) throw new Error("session not found");

  // Verify the caller owns the parent book (defense in depth).
  const template = await db.query.interviewTemplates.findFirst({
    where: eq(schema.interviewTemplates.id, session.templateId),
  });
  if (!template) throw new Error("template not found");
  const book = await getBookById(template.bookId);
  if (!book) throw new Error("book not found");

  if (session.status === "closed" || session.status === "delivered") {
    throw new Error("session already closed; cannot regenerate link");
  }

  const token = await signIntervieweeToken({
    sid: session.id,
    iid: session.intervieweeId,
  });

  await db
    .update(schema.sessions)
    .set({ tokenJti: token.jti, tokenExpiresAt: token.expiresAt })
    .where(eq(schema.sessions.id, sessionId));

  const baseUrl = process.env.PUBLIC_BASE_URL ?? "http://localhost:3000";
  const link = `${baseUrl}/s/${token.jwt}`;

  revalidatePath(`/books/${template.bookId}`);
  return { sessionId, link };
}

export async function listInterviewTemplates(bookId: string) {
  return db.query.interviewTemplates.findMany({
    where: eq(schema.interviewTemplates.bookId, bookId),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
  });
}

export async function listInterviewees(bookId: string) {
  return db.query.interviewees.findMany({
    where: eq(schema.interviewees.bookId, bookId),
    orderBy: (i, { desc }) => [desc(i.createdAt)],
  });
}

export async function listSessions(bookId: string) {
  // Join sessions → templates (to filter by book) and pull interviewee names.
  const templates = await listInterviewTemplates(bookId);
  if (templates.length === 0) return [];
  const templateIds = new Set(templates.map((t) => t.id));
  const all = await db.query.sessions.findMany({
    orderBy: (s, { desc }) => [desc(s.createdAt)],
  });
  return all.filter((s) => templateIds.has(s.templateId));
}
