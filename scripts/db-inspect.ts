import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "../lib/db/schema";

async function main() {
  const c = createClient({ url: "file:data/ghost-writer.sqlite" });
  const db = drizzle(c, { schema });

  const authors = await db.query.authors.findMany();
  console.log("authors:", authors.length);

  const books = await db.query.books.findMany();
  console.log("books:", books.length);
  for (const b of books) console.log("  ", b.id, b.title, "lang=", b.defaultLanguage);

  const tpl = await db.query.interviewTemplates.findMany();
  console.log("templates:", tpl.length);
  for (const t of tpl) console.log("  ", t.id, t.name, "blocks=", JSON.parse(t.guideBlocks).length, "ctx=", JSON.parse(t.contextFiles).length);

  const itw = await db.query.interviewees.findMany();
  console.log("interviewees:", itw.length);

  const sessions = await db.query.sessions.findMany();
  console.log("sessions:", sessions.length);
  for (const s of sessions) {
    console.log(
      "  ",
      s.id,
      s.status,
      "jti=",
      s.tokenJti,
      "expires=",
      new Date(s.tokenExpiresAt).toISOString(),
    );
  }

  c.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
