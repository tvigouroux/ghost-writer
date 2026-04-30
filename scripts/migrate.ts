import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

async function main() {
  const dbPath = resolve(process.env.DATABASE_URL ?? "data/ghost-writer.sqlite");
  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const client = createClient({ url: `file:${dbPath}` });
  const db = drizzle(client);

  await migrate(db, { migrationsFolder: "./lib/db/migrations" });
  console.log(`migrated: ${dbPath}`);
  client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
