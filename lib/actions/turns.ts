"use server";

import "server-only";

import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { z } from "zod";
import { verifyIntervieweeToken } from "../auth/interviewee";
import { db, schema } from "../db/client";
import {
  renderInterviewOutput,
  runInterviewerTurn,
  summarizeContext,
} from "../interview-engine";
import { RepoReader } from "../repo/reader";
import {
  isContextDenied,
  type BlockStatus,
  type GuideBlock,
} from "../llm/modes/interviewer";

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

/**
 * Generate the processed-transcript markdown for a closed session and persist
 * it as an `outputs` row. Idempotent: if an output already exists for the
 * session it is overwritten with the freshly rendered markdown.
 *
 * Caller responsibilities: the session must be marked closed before calling
 * this (the output reflects the final block_coverage).
 */
async function renderAndStoreOutput(
  sessionId: string,
  closedBy: "agent" | "interviewee",
): Promise<void> {
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
  if (!book) throw new Error("book not found");
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

  // Multi-session continuity: if the template has a sourceMdPath that
  // resolves to a `*-respuestas.md` aggregator already in the repo, read
  // it and pass to the renderer so the new transcript ENRICHES the file
  // instead of replacing it. Same logic applies if the prior output was
  // already delivered somewhere — we use that path.
  const priorOutput = await db.query.outputs.findFirst({
    where: eq(schema.outputs.sessionId, sessionId),
  });
  const aggregatorPath = pickAggregatorPath(
    template.sourceMdPath,
    template.respuestasMdPath,
    priorOutput?.deliveredMdPath,
  );
  let existingTranscript: string | undefined;
  if (aggregatorPath) {
    try {
      existingTranscript = await reader.readFile(aggregatorPath);
    } catch {
      /* file doesn't exist yet — first session; renderer falls back to standalone */
    }
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
    closedBy,
    sessionId,
    existingTranscript,
  });

  const existing = priorOutput;
  if (existing) {
    await db
      .update(schema.outputs)
      .set({ processedMd: md })
      .where(eq(schema.outputs.id, existing.id));
  } else {
    await db.insert(schema.outputs).values({
      id: ulid(),
      sessionId,
      processedMd: md,
      deliveredMdPath: null,
      deliveredAt: null,
      approvedByAuthor: 0,
      createdAt: Date.now(),
    });
  }
}

/**
 * Pick the path inside the book repo where this transcript should live as a
 * cumulative aggregate across sessions. Order of preference:
 *   1. The output's prior deliveredMdPath (definitive — author already
 *      committed there before).
 *   2. The template's explicit respuestasMdPath (author-configured at
 *      template creation time).
 *   3. The template's sourceMdPath transformed into a "-respuestas" sibling
 *      (e.g. `entrevistas/tomas/02-intentos-previos.md` →
 *      `entrevistas/tomas/02-intentos-previos-respuestas.md`).
 *   4. `null` — first session, no aggregator yet, renderer produces a
 *      standalone document.
 */
function pickAggregatorPath(
  sourceMdPath: string | null,
  respuestasMdPath: string | null,
  deliveredMdPath: string | null | undefined,
): string | null {
  if (deliveredMdPath) return deliveredMdPath;
  if (respuestasMdPath) return respuestasMdPath;
  if (!sourceMdPath) return null;
  if (/-respuestas\.md$/i.test(sourceMdPath)) return sourceMdPath;
  return sourceMdPath.replace(/\.md$/i, "-respuestas.md");
}

/**
 * Seed block_coverage + current_block_id from a context_summary so the
 * interviewer doesn't restart from scratch when prior sessions already
 * covered most of the territory. Returns the seeded values; falls back to
 * "all pending" + first block if the summary is missing or unparseable.
 */
function seedCoverageFromSummary(
  blocks: GuideBlock[],
  contextSummaryJson: string | null,
): { coverage: Record<string, BlockStatus>; currentBlockId: string } {
  const coverage: Record<string, BlockStatus> = {};
  if (contextSummaryJson) {
    try {
      const summary = JSON.parse(contextSummaryJson);
      for (const b of blocks) {
        const bs = summary?.block_summaries?.[b.id];
        const c = bs?.coverage_in_context;
        if (c === "covered") coverage[b.id] = "covered";
        else if (c === "partial") coverage[b.id] = "partial";
        else coverage[b.id] = "pending";
      }
    } catch {
      for (const b of blocks) coverage[b.id] = "pending";
    }
  } else {
    for (const b of blocks) coverage[b.id] = "pending";
  }
  const firstUncovered =
    blocks.find((b) => coverage[b.id] !== "covered")?.id ?? blocks[0]?.id ?? "";
  return { coverage, currentBlockId: firstUncovered };
}

async function readBookClaudeMd(bookLocalPath: string): Promise<string> {
  const reader = new RepoReader(bookLocalPath);
  try {
    return await reader.readFile("CLAUDE.md");
  } catch {
    return "";
  }
}

async function readBookContext(
  bookLocalPath: string,
  contextFiles: string[],
): Promise<{ claudeMd: string; contextFiles: { path: string; content: string }[] }> {
  const reader = new RepoReader(bookLocalPath);
  const claudeMd = await readBookClaudeMd(bookLocalPath).catch(() => "");
  const ctx = contextFiles.length > 0 ? await reader.readFiles(contextFiles) : [];
  return { claudeMd, contextFiles: ctx };
}

/**
 * Compute and persist sessions.context_summary for the given session if it
 * doesn't have one yet. Idempotent. Returns the (current or freshly stored)
 * summary string. Exported so other server actions (e.g. "Recalcular
 * resumen") can trigger it without copying the body.
 */
export async function ensureSessionContextSummary(sessionId: string): Promise<string | null> {
  const session = await db.query.sessions.findFirst({
    where: eq(schema.sessions.id, sessionId),
  });
  if (!session) throw new Error("session not found");
  if (session.contextSummary) return session.contextSummary;

  const template = await db.query.interviewTemplates.findFirst({
    where: eq(schema.interviewTemplates.id, session.templateId),
  });
  if (!template) throw new Error("template not found");
  const book = await db.query.books.findFirst({
    where: eq(schema.books.id, template.bookId),
  });
  if (!book) throw new Error("book not found");
  const interviewee = await db.query.interviewees.findFirst({
    where: eq(schema.interviewees.id, session.intervieweeId),
  });
  if (!interviewee) throw new Error("interviewee not found");

  const blocks = JSON.parse(template.guideBlocks) as GuideBlock[];
  const allPaths = JSON.parse(template.contextFiles) as string[];
  // Apply the interviewer mode denylist before summarizing — no point in
  // burning tokens digesting files the interviewer wouldn't see anyway.
  const filteredPaths = allPaths.filter((p) => !isContextDenied(p));
  const { claudeMd, contextFiles } = await readBookContext(book.repoLocalPath, filteredPaths);

  const summary = await summarizeContext({
    bookLanguage: book.defaultLanguage,
    bookClaudeMd: claudeMd,
    templateName: template.name,
    templateSystemPrompt: template.systemPrompt,
    intervieweeName: interviewee.displayName,
    intervieweeRelation: interviewee.relation ?? null,
    blocks,
    contextFiles,
  });

  const summaryJson = JSON.stringify(summary);
  await db
    .update(schema.sessions)
    .set({
      contextSummary: summaryJson,
      contextSummaryAt: Date.now(),
    })
    .where(eq(schema.sessions.id, sessionId));

  return summaryJson;
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

  // Compute the per-session context summary if missing. The cost lives on
  // the first turn; from here on every turn reuses it.
  const contextSummary = await ensureSessionContextSummary(session.id);

  const blocks = JSON.parse(template.guideBlocks) as GuideBlock[];
  let coverage = JSON.parse(session.blockCoverage ?? "{}") as Record<string, BlockStatus>;
  let currentBlockId = session.currentBlockId ?? blocks[0]?.id ?? "";

  // First-turn seeding: if every block is still "pending", the summary may
  // tell us which ones are already covered in prior materials. Seed from
  // there so the model doesn't restart from block-1 asking for recap.
  const allPending = Object.values(coverage).every((v) => v === "pending");
  if (allPending && contextSummary) {
    const seeded = seedCoverageFromSummary(blocks, contextSummary);
    coverage = seeded.coverage;
    currentBlockId = seeded.currentBlockId;
    await db
      .update(schema.sessions)
      .set({
        blockCoverage: JSON.stringify(coverage),
        currentBlockId,
      })
      .where(eq(schema.sessions.id, session.id));
  }

  const claudeMd = await readBookClaudeMd(book.repoLocalPath);

  // We pass empty contextFiles when we have a summary; the prompt builder
  // uses one or the other, not both.
  const result = await runInterviewerTurn({
    bookLanguage: book.defaultLanguage,
    bookClaudeMd: claudeMd,
    templateSystemPrompt: template.systemPrompt,
    contextFiles: [],
    contextSummary: contextSummary ?? undefined,
    blocks,
    blockCoverage: coverage,
    currentBlockId,
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
  const contextSummary = await ensureSessionContextSummary(session.id);
  const claudeMd = await readBookClaudeMd(book.repoLocalPath);

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
    contextFiles: [],
    contextSummary: contextSummary ?? undefined,
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

  if (result.shouldClose) {
    // Render is best-effort: if it fails, the session is still closed and the
    // author can retry from the output page.
    try {
      await renderAndStoreOutput(session.id, "agent");
    } catch (err) {
      console.error("renderAndStoreOutput (agent close) failed:", err);
    }
  }

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
  try {
    await renderAndStoreOutput(session.id, "interviewee");
  } catch (err) {
    console.error("renderAndStoreOutput (interviewee close) failed:", err);
  }
  return loadRoomFromToken(token);
}
