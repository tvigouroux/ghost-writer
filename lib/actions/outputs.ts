"use server";

import "server-only";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { ulid } from "ulid";
import { renderInterviewOutput } from "../interview-engine";
import { getCurrentAuthor } from "../auth/author";
import { db, schema } from "../db/client";
import { RepoReader } from "../repo/reader";
import type { BlockStatus, GuideBlock } from "../llm/modes/interviewer";

/**
 * Reload context and regenerate the processed-transcript markdown for a
 * session. Used when the auto-render at close failed, or when the author
 * tweaked something (e.g. vetoed a turn after the fact) and wants the file
 * rebuilt.
 */
export async function regenerateOutputAction(sessionId: string): Promise<{
  outputId: string;
}> {
  const author = await getCurrentAuthor();

  const session = await db.query.sessions.findFirst({
    where: eq(schema.sessions.id, sessionId),
  });
  if (!session) throw new Error("session not found");

  const template = await db.query.interviewTemplates.findFirst({
    where: eq(schema.interviewTemplates.id, session.templateId),
  });
  if (!template) throw new Error("template not found");

  const book = await db.query.books.findFirst({
    where: eq(schema.books.id, template.bookId),
  });
  if (!book || book.authorId !== author.id) throw new Error("book not found");

  const interviewee = await db.query.interviewees.findFirst({
    where: eq(schema.interviewees.id, session.intervieweeId),
  });
  if (!interviewee) throw new Error("interviewee not found");

  const blocks = JSON.parse(template.guideBlocks) as GuideBlock[];
  const coverage = JSON.parse(session.blockCoverage ?? "{}") as Record<string, BlockStatus>;

  const turnsRows = await db.query.turns.findMany({
    where: eq(schema.turns.sessionId, sessionId),
    orderBy: (t, { asc }) => [asc(t.ordinal)],
  });

  const reader = new RepoReader(book.repoLocalPath);
  let claudeMd = "";
  try {
    claudeMd = await reader.readFile("CLAUDE.md");
  } catch {
    /* missing CLAUDE.md is acceptable */
  }

  const ts = new Date(session.closedAt ?? Date.now());
  const sessionDate = `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, "0")}-${String(ts.getDate()).padStart(2, "0")}`;

  const md = await renderInterviewOutput({
    bookLanguage: book.defaultLanguage,
    bookClaudeMd: claudeMd,
    templateName: template.name,
    intervieweeName: interviewee.displayName,
    intervieweeRelation: interviewee.relation ?? null,
    blocks,
    blockCoverage: coverage,
    turns: turnsRows.map((t) => ({
      ordinal: t.ordinal,
      role: t.role as "interviewer" | "interviewee",
      blockId: t.blockId,
      text: t.contentText ?? "",
      vetoed: t.vetoed === 1,
    })),
    sessionDate,
    closedBy: "agent",
    sessionId,
  });

  const existing = await db.query.outputs.findFirst({
    where: eq(schema.outputs.sessionId, sessionId),
  });
  let outputId: string;
  if (existing) {
    outputId = existing.id;
    await db
      .update(schema.outputs)
      .set({ processedMd: md, approvedByAuthor: 0 })
      .where(eq(schema.outputs.id, existing.id));
  } else {
    outputId = ulid();
    await db.insert(schema.outputs).values({
      id: outputId,
      sessionId,
      processedMd: md,
      deliveredMdPath: null,
      deliveredAt: null,
      approvedByAuthor: 0,
      createdAt: Date.now(),
    });
  }

  revalidatePath(`/books/${template.bookId}/entrevistador`);
  revalidatePath(`/books/${template.bookId}/outputs/${outputId}`);
  return { outputId };
}

export async function getOutputForAuthor(outputId: string) {
  const author = await getCurrentAuthor();

  const output = await db.query.outputs.findFirst({
    where: eq(schema.outputs.id, outputId),
  });
  if (!output) return null;

  const session = await db.query.sessions.findFirst({
    where: eq(schema.sessions.id, output.sessionId),
  });
  if (!session) return null;

  const template = await db.query.interviewTemplates.findFirst({
    where: eq(schema.interviewTemplates.id, session.templateId),
  });
  if (!template) return null;

  const book = await db.query.books.findFirst({
    where: eq(schema.books.id, template.bookId),
  });
  if (!book || book.authorId !== author.id) return null;

  const interviewee = await db.query.interviewees.findFirst({
    where: eq(schema.interviewees.id, session.intervieweeId),
  });

  return {
    output,
    session,
    template,
    book,
    interviewee,
  };
}

export async function listOutputsForBook(bookId: string) {
  // Fetch outputs whose session belongs to a template of this book.
  const templates = await db.query.interviewTemplates.findMany({
    where: eq(schema.interviewTemplates.bookId, bookId),
  });
  if (templates.length === 0) return new Map<string, string>();
  const templateIds = new Set(templates.map((t) => t.id));
  const allSessions = await db.query.sessions.findMany();
  const sessionIds = new Set(
    allSessions.filter((s) => templateIds.has(s.templateId)).map((s) => s.id),
  );
  const allOutputs = await db.query.outputs.findMany();
  // Map session_id → output_id for quick lookup in the UI.
  const map = new Map<string, string>();
  for (const o of allOutputs) {
    if (sessionIds.has(o.sessionId)) map.set(o.sessionId, o.id);
  }
  return map;
}
