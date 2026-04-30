import "server-only";

import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import * as schema from "./schema";

const dbPath = resolve(process.env.DATABASE_URL ?? "data/ghost-writer.sqlite");
const dir = dirname(dbPath);
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

const client = createClient({ url: `file:${dbPath}` });
export const db = drizzle(client, { schema });
export { schema };
