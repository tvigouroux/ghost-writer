import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Multi-tenant + multi-book + multi-mode from day one.
// MVP only exercises a subset of these tables (authors, books, interviewees,
// interview_templates, sessions, turns, outputs, revoked_tokens). The
// book_templates table seeds the catalog of project templates that "create
// new book" will apply later.

export const authors = sqliteTable("authors", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  githubHandle: text("github_handle"),
  displayName: text("display_name"),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
});

export const bookTemplates = sqliteTable("book_templates", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  manifestPath: text("manifest_path").notNull(),
  isBuiltin: integer("is_builtin").notNull().default(1),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
});

export const books = sqliteTable("books", {
  id: text("id").primaryKey(),
  authorId: text("author_id")
    .notNull()
    .references(() => authors.id, { onDelete: "cascade" }),
  templateId: text("template_id").references(() => bookTemplates.id),
  title: text("title").notNull(),
  repoUrl: text("repo_url"),
  repoLocalPath: text("repo_local_path").notNull(),
  // BCP-47 code of the book's primary interaction language. Drives the
  // language Claude uses when speaking to interviewees and writing transcripts.
  defaultLanguage: text("default_language").notNull().default("es"),
  // JSON array of enabled modes, e.g. ["interviewer"] in MVP.
  enabledModes: text("enabled_modes").notNull().default('["interviewer"]'),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
});

export const interviewees = sqliteTable("interviewees", {
  id: text("id").primaryKey(),
  bookId: text("book_id")
    .notNull()
    .references(() => books.id, { onDelete: "cascade" }),
  displayName: text("display_name").notNull(),
  relation: text("relation"),
  notes: text("notes"),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
});

export const interviewTemplates = sqliteTable("interview_templates", {
  id: text("id").primaryKey(),
  bookId: text("book_id")
    .notNull()
    .references(() => books.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  systemPrompt: text("system_prompt").notNull(),
  introMd: text("intro_md"),
  // JSON: [{id, title, objective, seed_questions[], must_cover}]
  guideBlocks: text("guide_blocks").notNull(),
  // JSON: ["outline.md", "acerca-de-mi.md", ...] — paths relative to the book repo root.
  contextFiles: text("context_files").notNull().default("[]"),
  sourceMdPath: text("source_md_path"),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  templateId: text("template_id")
    .notNull()
    .references(() => interviewTemplates.id),
  intervieweeId: text("interviewee_id")
    .notNull()
    .references(() => interviewees.id),
  status: text("status").notNull(), // 'draft'|'live'|'paused'|'closed'|'delivered'
  tokenJti: text("token_jti").notNull().unique(),
  tokenExpiresAt: integer("token_expires_at").notNull(),
  currentBlockId: text("current_block_id"),
  // JSON: {block_id: 'covered'|'partial'|'pending'}
  blockCoverage: text("block_coverage"),
  startedAt: integer("started_at"),
  closedAt: integer("closed_at"),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
});

export const turns = sqliteTable("turns", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  ordinal: integer("ordinal").notNull(),
  role: text("role").notNull(), // 'interviewer'|'interviewee'
  blockId: text("block_id"),
  contentText: text("content_text"),
  audioPath: text("audio_path"),
  vetoed: integer("vetoed").notNull().default(0),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
});

export const outputs = sqliteTable("outputs", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .unique()
    .references(() => sessions.id),
  processedMd: text("processed_md").notNull(),
  deliveredMdPath: text("delivered_md_path"),
  deliveredAt: integer("delivered_at"),
  approvedByAuthor: integer("approved_by_author").notNull().default(0),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
});

export const revokedTokens = sqliteTable("revoked_tokens", {
  jti: text("jti").primaryKey(),
  revokedAt: integer("revoked_at").notNull().default(sql`(unixepoch() * 1000)`),
});

export type Author = typeof authors.$inferSelect;
export type Book = typeof books.$inferSelect;
export type Interviewee = typeof interviewees.$inferSelect;
export type InterviewTemplate = typeof interviewTemplates.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Turn = typeof turns.$inferSelect;
export type Output = typeof outputs.$inferSelect;
