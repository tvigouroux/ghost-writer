"use server";

import "server-only";

import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { z } from "zod";
import { verifyIntervieweeToken } from "../auth/interviewee";
import { db, schema } from "../db/client";
import { runInterviewerTurn } from "../interview-engine";
import { RepoReader } from "../repo/reader";
import type { BlockStatus, GuideBlock } from "../llm/modes/interviewer";

/**
 * State the interviewee UI needs to render the room.
 */
export interface RoomState {
  sessionId: string;
  status: "draft" | "live" | "paused" | "closed" | "delivered";
  intervieweeName: string;
  introMd: string | null;
  bookLanguage: string;
  blocks: { id: string; title: string }[];
  blockCoverage: Record<string, BlockStatus>;
  currentBlockId: string | null;
  turns: { id: string; role: "interviewer" | "interviewee"; text: string; vetoed: boolean }[];
  lastQuestion: string | null;
  shouldClose: boolean;
}

const TokenSchema = z.string().min(20);

export async function loadRoomFromToken(token: string): Promise<RoomState> {
  TokenSchema.parse(token);
  const claims = await verifyIntervieweeToken(token);

  const session = await db.query.sessions.findFirst({
    where: eq(schema.sessions.id, claims.sid),
  });
  if (!session) throw new Error("session not found");
  if (session.status === "delivered") {
    throw new Error("session already delivered");
  }
  // Reject tokens that have been revoked.
  const revoked = await db.query.revokedTokens.findFirst({
    where: eq(schema.revokedTokens.jti, claims.jti),
  });
  if (revoked) throw new Error("token revoked");

  const interviewee = await db.query.interviewees.findFirst({
    where: eq(schema.interviewees.id, claims.iid),
  });
  if (!interviewee) throw new Error("interviewee not found");

  const template = await db.query.interviewTemplates.findFirst({
    where: eq(schema.interviewTemplates.id, session.templateId),
  });
  if (!template) throw new Error("template not found");

  const book = await db.query.books.findFirst({
    where: eq(schema.books.id, template.bookId),
  });
  if (!book) throw new Error("book not found");

  const blocks = (JSON.parse(template.guideBlocks) as GuideBlock[]).map((b) => ({
    id: b.id,
    title: b.title,
  }));
  const coverage = JSON.parse(session.blockCoverage ?? "{}") as Record<string, BlockStatus>;

  const turns = await db.query.turns.findMany({
    where: eq(schema.turns.sessionId, session.id),
    orderBy: (t, { asc }) => [asc(t.ordinal)],
  });

  const lastQuestion =
    [...turns].reverse().find((t) => t.role === "interviewer")?.contentText ?? null;

  return {
    sessionId: session.id,
    status: session.status as RoomState["status"],
    intervieweeName: interviewee.displayName,
    introMd: template.introMd,
    bookLanguage: book.defaultLanguage,
    blocks,
    blockCoverage: coverage,
    currentBlockId: session.currentBlockId,
    turns: turns.map((t) => ({
      id: t.id,
      role: t.role as "interviewer" | "interviewee",
      text: t.contentText ?? "",
      vetoed: t.vetoed === 1,
    })),
    lastQuestion,
    shouldClose: false,
  };
}

/**
 * Internal helper: load full session context from a verified token.
 */
async function loadFullContext(token: string) {
  const claims = await verifyIntervieweeToken(token);
  const session = await db.query.sessions.findFirst({
    where: eq(schema.sessions.id, claims.sid),
  });
  if (!session) throw new Error("session not found");
  const template = await db.query.interviewTemplates.findFirst({
    where: eq(schema.interviewTemplates.id, session.templateId),
  });
  if (!template) throw new Error("template not found");
  const book = await db.query.books.findFirst({
    where: eq(schema.books.id, template.bookId),
  });
  if (!book) throw new Error("book not found");
  return { claims, session, template, book };
}

async function readBookContext(
  bookLocalPath: string,
  contextFiles: string[],
): Promise<{ claudeMd: string; contextFiles: { path: string; content: string }[] }> {
  const reader = new RepoReader(bookLocalPath);
  let claudeMd = "";
  try {
    claudeMd = await reader.readFile("CLAUDE.md");
  } catch {
    // book repo without CLAUDE.md is fine; just use empty string.
  }
  const ctx = contextFiles.length > 0 ? await reader.readFiles(contextFiles) : [];
  return { claudeMd, contextFiles: ctx };
}

/**
 * Generate the opening question. Called when the interviewee opens the room
 * and the session has no interviewer turn yet.
 */
export async function startOrContinueAction(token: string): Promise<RoomState> {
  const { session, template, book } = await loadFullContext(token);

  // If there's already an interviewer turn, just return the room.
  const existingTurns = await db.query.turns.findMany({
    where: eq(schema.turns.sessionId, session.id),
  });
  if (existingTurns.some((t) => t.role === "interviewer")) {
    return loadRoomFromToken(token);
  }

  // Mark the session live + record startedAt.
  if (session.status !== "live") {
    await db
      .update(schema.sessions)
      .set({ status: "live", startedAt: Date.now() })
      .where(eq(schema.sessions.id, session.id));
  }

  const blocks = JSON.parse(template.guideBlocks) as GuideBlock[];
  const coverage = JSON.parse(session.blockCoverage ?? "{}") as Record<string, BlockStatus>;
  const contextFilesPaths = JSON.parse(template.contextFiles) as string[];

  const { claudeMd, contextFiles } = await readBookContext(
    book.repoLocalPath,
    contextFilesPaths,
  );

  const result = await runInterviewerTurn({
    bookLanguage: book.defaultLanguage,
    bookClaudeMd: claudeMd,
    templateSystemPrompt: template.systemPrompt,
    contextFiles,
    blocks,
    blockCoverage: coverage,
    currentBlockId: session.currentBlockId ?? blocks[0]?.id ?? "",
    history: [],
  });

  await db.insert(schema.turns).values({
    id: ulid(),
    sessionId: session.id,
    ordinal: 1,
    role: "interviewer",
    blockId: result.currentBlockId,
    contentText: result.nextQuestion,
    audioPath: null,
    vetoed: 0,
    createdAt: Date.now(),
  });

  await db
    .update(schema.sessions)
    .set({
      currentBlockId: result.currentBlockId,
      blockCoverage: JSON.stringify(result.blockCoverage),
    })
    .where(eq(schema.sessions.id, session.id));

  return loadRoomFromToken(token);
}

/**
 * Submit an interviewee's text turn and run the agent for the next question.
 */
export async function submitTextTurnAction(
  token: string,
  text: string,
): Promise<RoomState> {
  const safeText = z.string().min(1).max(10_000).parse(text);
  const { session, template, book } = await loadFullContext(token);
  if (session.status === "closed" || session.status === "delivered") {
    throw new Error("session is already closed");
  }

  const existingTurns = await db.query.turns.findMany({
    where: eq(schema.turns.sessionId, session.id),
    orderBy: (t, { asc }) => [asc(t.ordinal)],
  });
  const nextOrdinal = (existingTurns.at(-1)?.ordinal ?? 0) + 1;

  await db.insert(schema.turns).values({
    id: ulid(),
    sessionId: session.id,
    ordinal: nextOrdinal,
    role: "interviewee",
    blockId: session.currentBlockId,
    contentText: safeText,
    audioPath: null,
    vetoed: 0,
    createdAt: Date.now(),
  });

  const blocks = JSON.parse(template.guideBlocks) as GuideBlock[];
  const coverage = JSON.parse(session.blockCoverage ?? "{}") as Record<string, BlockStatus>;
  const contextFilesPaths = JSON.parse(template.contextFiles) as string[];
  const { claudeMd, contextFiles } = await readBookContext(
    book.repoLocalPath,
    contextFilesPaths,
  );

  const history = [
    ...existingTurns.map((t) => ({
      role: t.role as "interviewer" | "interviewee",
      text: t.contentText ?? "",
    })),
    { role: "interviewee" as const, text: safeText },
  ];

  const result = await runInterviewerTurn({
    bookLanguage: book.defaultLanguage,
    bookClaudeMd: claudeMd,
    templateSystemPrompt: template.systemPrompt,
    contextFiles,
    blocks,
    blockCoverage: coverage,
    currentBlockId: session.currentBlockId ?? blocks[0]?.id ?? "",
    history,
  });

  await db.insert(schema.turns).values({
    id: ulid(),
    sessionId: session.id,
    ordinal: nextOrdinal + 1,
    role: "interviewer",
    blockId: result.currentBlockId,
    contentText: result.nextQuestion,
    audioPath: null,
    vetoed: 0,
    createdAt: Date.now(),
  });

  await db
    .update(schema.sessions)
    .set({
      currentBlockId: result.currentBlockId,
      blockCoverage: JSON.stringify(result.blockCoverage),
      ...(result.shouldClose ? { status: "closed", closedAt: Date.now() } : {}),
    })
    .where(eq(schema.sessions.id, session.id));

  const room = await loadRoomFromToken(token);
  return { ...room, shouldClose: result.shouldClose };
}

/**
 * Toggle the veto flag on a turn the interviewee owns.
 */
export async function vetoTurnAction(
  token: string,
  turnId: string,
  vetoed: boolean,
): Promise<RoomState> {
  const { session } = await loadFullContext(token);
  const turn = await db.query.turns.findFirst({
    where: eq(schema.turns.id, turnId),
  });
  if (!turn || turn.sessionId !== session.id) throw new Error("turn not found");
  if (turn.role !== "interviewee") throw new Error("only interviewee turns can be vetoed");
  await db
    .update(schema.turns)
    .set({ vetoed: vetoed ? 1 : 0 })
    .where(eq(schema.turns.id, turnId));
  return loadRoomFromToken(token);
}

/**
 * Interviewee closes the session manually.
 */
export async function closeSessionAction(token: string): Promise<RoomState> {
  const { session } = await loadFullContext(token);
  if (session.status === "closed" || session.status === "delivered") {
    return loadRoomFromToken(token);
  }
  await db
    .update(schema.sessions)
    .set({ status: "closed", closedAt: Date.now() })
    .where(eq(schema.sessions.id, session.id));
  return loadRoomFromToken(token);
}
