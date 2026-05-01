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
  /** Optional explicit aggregator path for cumulative transcripts. */
  respuestasMdPath: z.string().optional().or(z.literal("")),
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
    respuestasMdPath: formData.get("respuestasMdPath") || "",
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
    respuestasMdPath: parsed.respuestasMdPath || null,
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

/**
 * Hard-delete an interview template along with every session, turn, and
 * output that depends on it. Files already pushed to the book repo are
 * NOT touched — git history keeps them.
 */
export async function deleteInterviewTemplateAction(
  templateId: string,
): Promise<void> {
  const template = await db.query.interviewTemplates.findFirst({
    where: eq(schema.interviewTemplates.id, templateId),
  });
  if (!template) return;
  const book = await getBookById(template.bookId);
  if (!book) throw new Error("book not found");

  // Cascade manually: outputs → turns → sessions → template.
  // (Foreign keys on sessions don't have onDelete cascade for the template
  // pointer, and outputs reference sessions, so order matters.)
  const sessionsOfTemplate = await db.query.sessions.findMany({
    where: eq(schema.sessions.templateId, templateId),
  });
  for (const s of sessionsOfTemplate) {
    await db.delete(schema.outputs).where(eq(schema.outputs.sessionId, s.id));
    await db.delete(schema.turns).where(eq(schema.turns.sessionId, s.id));
  }
  await db
    .delete(schema.sessions)
    .where(eq(schema.sessions.templateId, templateId));
  await db
    .delete(schema.interviewTemplates)
    .where(eq(schema.interviewTemplates.id, templateId));

  revalidatePath(`/books/${template.bookId}/entrevistador`);
}

/**
 * Force-recompute and persist the session's context_summary. Used after the
 * author edits the book repo (added entries to outline.md, added a notes
 * file, etc.) to refresh what the interviewer agent knows.
 */
export async function recalculateSessionSummaryAction(
  sessionId: string,
): Promise<void> {
  const session = await db.query.sessions.findFirst({
    where: eq(schema.sessions.id, sessionId),
  });
  if (!session) throw new Error("session not found");
  // Clear it so the next ensure-call recomputes.
  await db
    .update(schema.sessions)
    .set({ contextSummary: null, contextSummaryAt: null })
    .where(eq(schema.sessions.id, sessionId));
  // Re-trigger immediately so the wait happens here, not on the next turn.
  const { ensureSessionContextSummary } = await import("./turns");
  await ensureSessionContextSummary(sessionId);

  const template = await db.query.interviewTemplates.findFirst({
    where: eq(schema.interviewTemplates.id, session.templateId),
  });
  if (template) revalidatePath(`/books/${template.bookId}/entrevistador`);
}

/**
 * Wipe a session's turns and output so the room reopens fresh: status→draft,
 * block_coverage→all "pending", current_block_id→first block, startedAt /
 * closedAt cleared, JTI rotated so the previous link stops working. Useful
 * when the author wants to redo the interview after iterating on the prompt
 * or context.
 *
 * The cached context_summary is **preserved by default** so prompt-iteration
 * cycles don't pay the 4-5 minute recompute every time. Pass
 * `dropSummary: true` to also clear it (use after editing repo files or the
 * summarizer prompt itself).
 */
export async function resetSessionAction(
  sessionId: string,
  dropSummary = false,
): Promise<void> {
  const session = await db.query.sessions.findFirst({
    where: eq(schema.sessions.id, sessionId),
  });
  if (!session) throw new Error("session not found");

  const template = await db.query.interviewTemplates.findFirst({
    where: eq(schema.interviewTemplates.id, session.templateId),
  });
  if (!template) throw new Error("template not found");
  const book = await getBookById(template.bookId);
  if (!book) throw new Error("book not found");

  const blocks = JSON.parse(template.guideBlocks) as { id: string }[];

  // Seed coverage from the cached context_summary when we're keeping it.
  // Without this seed, "reset" would always restart from "all pending" and
  // the interviewer would re-ask material the prior interviews already
  // captured.
  let initialCoverage: Record<string, "pending" | "partial" | "covered">;
  let initialCurrent: string | null = blocks[0]?.id ?? null;
  if (!dropSummary && session.contextSummary) {
    const seeded: Record<string, "pending" | "partial" | "covered"> = {};
    try {
      const sum = JSON.parse(session.contextSummary);
      for (const b of blocks) {
        const c = sum?.block_summaries?.[b.id]?.coverage_in_context;
        if (c === "covered") seeded[b.id] = "covered";
        else if (c === "partial") seeded[b.id] = "partial";
        else seeded[b.id] = "pending";
      }
      initialCoverage = seeded;
      initialCurrent =
        blocks.find((b) => seeded[b.id] !== "covered")?.id ?? blocks[0]?.id ?? null;
    } catch {
      initialCoverage = Object.fromEntries(blocks.map((b) => [b.id, "pending"])) as Record<string, "pending">;
    }
  } else {
    initialCoverage = Object.fromEntries(blocks.map((b) => [b.id, "pending"])) as Record<string, "pending">;
  }

  // Mint a new token so the old link is invalidated by jti rotation.
  const token = await signIntervieweeToken({
    sid: session.id,
    iid: session.intervieweeId,
  });

  await db.delete(schema.turns).where(eq(schema.turns.sessionId, sessionId));
  await db.delete(schema.outputs).where(eq(schema.outputs.sessionId, sessionId));
  const updates: Record<string, unknown> = {
    status: "draft",
    currentBlockId: initialCurrent,
    blockCoverage: JSON.stringify(initialCoverage),
    startedAt: null,
    closedAt: null,
    tokenJti: token.jti,
    tokenExpiresAt: token.expiresAt,
  };
  if (dropSummary) {
    updates.contextSummary = null;
    updates.contextSummaryAt = null;
  }
  await db.update(schema.sessions).set(updates).where(eq(schema.sessions.id, sessionId));

  revalidatePath(`/books/${template.bookId}/entrevistador`);
}

/**
 * Hard-delete a session and everything tied to it (turns, output). The
 * interviewee record stays — sessions can be reissued for the same person.
 */
export async function deleteSessionAction(sessionId: string): Promise<void> {
  const session = await db.query.sessions.findFirst({
    where: eq(schema.sessions.id, sessionId),
  });
  if (!session) return;
  const template = await db.query.interviewTemplates.findFirst({
    where: eq(schema.interviewTemplates.id, session.templateId),
  });
  if (!template) throw new Error("template not found");
  const book = await getBookById(template.bookId);
  if (!book) throw new Error("book not found");

  await db.delete(schema.outputs).where(eq(schema.outputs.sessionId, sessionId));
  await db.delete(schema.turns).where(eq(schema.turns.sessionId, sessionId));
  await db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId));

  revalidatePath(`/books/${template.bookId}/entrevistador`);
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
