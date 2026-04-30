import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "../lib/db/schema";

config();

async function main() {
  const sessionId = process.argv[2];
  if (!sessionId) {
    console.error("usage: pnpm tsx scripts/db-inspect-session.ts <sessionId>");
    process.exit(2);
  }
  const c = createClient({ url: "file:data/ghost-writer.sqlite" });
  const db = drizzle(c, { schema });

  const s = await db.query.sessions.findFirst({
    where: eq(schema.sessions.id, sessionId),
  });
  if (!s) throw new Error("session not found");

  console.log("session:", s.id);
  console.log("  status         :", s.status);
  console.log("  current_block  :", s.currentBlockId);
  console.log("  started_at     :", s.startedAt ? new Date(s.startedAt).toISOString() : "—");
  console.log("  closed_at      :", s.closedAt ? new Date(s.closedAt).toISOString() : "—");
  console.log("  block_coverage :", s.blockCoverage);
  console.log(
    "  context_summary:",
    s.contextSummary ? `${s.contextSummary.length} chars (cached)` : "(none)",
  );

  const turns = await db.query.turns.findMany({
    where: eq(schema.turns.sessionId, sessionId),
    orderBy: (t, { asc }) => [asc(t.ordinal)],
  });
  console.log(`\nturns: ${turns.length}`);
  for (const t of turns) {
    const veto = t.vetoed ? " [VETOED]" : "";
    const block = t.blockId ? ` (${t.blockId})` : "";
    console.log(
      `\n  #${t.ordinal} ${t.role.toUpperCase()}${block}${veto}\n${(t.contentText ?? "").trim()}`,
    );
  }

  const out = await db.query.outputs.findFirst({
    where: eq(schema.outputs.sessionId, sessionId),
  });
  console.log("\noutput:");
  if (!out) {
    console.log("  (no output row — render at close failed or wasn't run)");
  } else {
    console.log("  id           :", out.id);
    console.log("  delivered_at :", out.deliveredAt ? new Date(out.deliveredAt).toISOString() : "—");
    console.log("  approved     :", out.approvedByAuthor ? "yes" : "no");
    console.log("  processed_md :", out.processedMd.length, "chars");
    console.log("\n--- processed_md ---");
    console.log(out.processedMd);
    console.log("--- end processed_md ---");
  }

  c.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
