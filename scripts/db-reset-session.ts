/**
 * Wipe a session's turns and output so the room reopens fresh: status →
 * draft, block_coverage → all "pending", current_block_id → first block,
 * startedAt/closedAt cleared. Useful when iterating on the interviewer
 * prompt and you want to regenerate the opening question.
 *
 * Usage: pnpm tsx scripts/db-reset-session.ts <sessionId>
 */
import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "../lib/db/schema";

config();

async function main() {
  const args = process.argv.slice(2);
  const sessionId = args.find((a) => !a.startsWith("--"));
  const dropSummary = args.includes("--drop-summary");
  if (!sessionId) {
    console.error(
      "usage: pnpm tsx scripts/db-reset-session.ts <sessionId> [--drop-summary]",
    );
    console.error(
      "  By default the cached context summary is preserved so prompt iterations don't pay the 4-5min recompute.",
    );
    console.error(
      "  Pass --drop-summary to clear it (use after editing repo files or the summarizer prompt).",
    );
    process.exit(2);
  }

  const c = createClient({ url: "file:data/ghost-writer.sqlite" });
  const db = drizzle(c, { schema });

  const session = await db.query.sessions.findFirst({
    where: eq(schema.sessions.id, sessionId),
  });
  if (!session) throw new Error("session not found");

  const template = await db.query.interviewTemplates.findFirst({
    where: eq(schema.interviewTemplates.id, session.templateId),
  });
  if (!template) throw new Error("template not found");

  const blocks = JSON.parse(template.guideBlocks) as { id: string }[];
  const initialCoverage: Record<string, "pending"> = {};
  for (const b of blocks) initialCoverage[b.id] = "pending";

  const deletedTurns = await db
    .delete(schema.turns)
    .where(eq(schema.turns.sessionId, sessionId));
  const deletedOutputs = await db
    .delete(schema.outputs)
    .where(eq(schema.outputs.sessionId, sessionId));

  const updates: Record<string, unknown> = {
    status: "draft",
    currentBlockId: blocks[0]?.id ?? null,
    blockCoverage: JSON.stringify(initialCoverage),
    startedAt: null,
    closedAt: null,
  };
  if (dropSummary) {
    updates.contextSummary = null;
    updates.contextSummaryAt = null;
  }

  await db.update(schema.sessions).set(updates).where(eq(schema.sessions.id, sessionId));

  console.log("session reset:", sessionId);
  console.log("  deleted turns rows  :", (deletedTurns as any).rowsAffected ?? "(unknown)");
  console.log("  deleted output rows :", (deletedOutputs as any).rowsAffected ?? "(unknown)");
  console.log("  status              : draft");
  console.log("  current_block_id    :", blocks[0]?.id ?? "(none)");
  console.log("  block_coverage      : all 'pending' (", blocks.length, "blocks )");
  console.log(
    "  context_summary     :",
    dropSummary ? "cleared (will recompute next open)" : "preserved",
  );

  c.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
