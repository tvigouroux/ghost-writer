/**
 * Generate a fresh interviewee token for an existing session, useful when
 * debugging the room route without going through the create-session UI.
 *
 * Usage: pnpm tsx scripts/db-make-token.ts <sessionId>
 */
import { config } from "dotenv";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import * as schema from "../lib/db/schema";
import { signIntervieweeToken } from "../lib/auth/interviewee";

config();

async function main() {
  const sessionId = process.argv[2];
  if (!sessionId) {
    console.error("usage: pnpm tsx scripts/db-make-token.ts <sessionId>");
    process.exit(2);
  }
  const c = createClient({ url: "file:data/ghost-writer.sqlite" });
  const db = drizzle(c, { schema });
  const s = await db.query.sessions.findFirst({ where: eq(schema.sessions.id, sessionId) });
  if (!s) throw new Error("session not found");
  const token = await signIntervieweeToken(
    { sid: s.id, iid: s.intervieweeId },
    { ttlSeconds: 3600 },
  );
  // Update the session's jti so the room actually accepts this new token.
  await db
    .update(schema.sessions)
    .set({ tokenJti: token.jti, tokenExpiresAt: token.expiresAt })
    .where(eq(schema.sessions.id, sessionId));
  console.log("token:");
  console.log(token.jwt);
  console.log("");
  console.log("url: http://localhost:3000/s/" + token.jwt);
  c.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
