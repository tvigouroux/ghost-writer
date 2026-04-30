import "server-only";

import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { db, schema } from "../db/client";

/**
 * Author auth — MVP single-tenant.
 *
 * In dev, set DEV_AUTHOR_EMAIL in .env. The first request creates an author
 * row for that email; subsequent requests reuse it. No password, no session.
 *
 * In prod (Phase 10+), this is replaced with a magic-link flow via Resend.
 */
export interface CurrentAuthor {
  id: string;
  email: string;
  displayName: string | null;
}

export async function getCurrentAuthor(): Promise<CurrentAuthor> {
  const email = process.env.DEV_AUTHOR_EMAIL;
  if (!email) {
    throw new Error(
      "no DEV_AUTHOR_EMAIL set; magic-link flow not yet implemented",
    );
  }

  const existing = await db.query.authors.findFirst({
    where: eq(schema.authors.email, email),
  });
  if (existing) {
    return {
      id: existing.id,
      email: existing.email,
      displayName: existing.displayName,
    };
  }

  const id = ulid();
  await db.insert(schema.authors).values({
    id,
    email,
    displayName: null,
    githubHandle: null,
    createdAt: Date.now(),
  });
  return { id, email, displayName: null };
}
