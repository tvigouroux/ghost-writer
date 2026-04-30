# CLAUDE.md — rules for Cowork sessions on this repo

This is the repository of **Ghost Writer**, a web platform that helps authors
create books with Claude's assistance. It is **not** a book repository itself.

When working on this repo:

## Working language

- Code, identifiers, comments, internal docs: **English**.
- This `CLAUDE.md`, `docs/decisiones-abiertas.md`, and conversation: **Spanish**
  is fine.
- Strings shown to interviewees: **Spanish** (Chilean register), in `lib/i18n/`.

## Architectural principles

- **Multi-tenant, multi-book, multi-mode from day one.** MVP is single-author,
  single-book, single-mode (Interviewer), but the schema and code paths are
  built so that adding modes and books is additive, not surgical.
- **Privacy by design is non-negotiable.** The interviewee never sees the book
  draft. Per-interview context allow-list. Default closed.
- **Claude never commits.** All writes to a book repo land in a `_pendiente-`
  prefixed file or equivalent staging marker. The author commits from their
  own clone.
- **Adapter pattern for external dependencies.** `lib/llm/`, `lib/stt/`,
  `lib/repo/` expose interfaces with at least one implementation each. Swap is
  a config change, not a refactor.
- **Plain markdown over YAML frontmatter** when writing into book repos. The
  reference book repo this MVP targets uses headers + bold metadata; we honor
  that convention when emitting transcripts.

## Conventions

- Filenames in source: kebab-case.
- Filenames written into book repos: kebab-case with optional `NN-` numeric
  prefix (matches the reference repo's convention).
- Database IDs: ULIDs (`ulid` package).
- Time: store as `INTEGER` unix milliseconds in DB.
- Errors at trust boundaries (interviewee input, repo paths, env vars): use
  `zod` and fail closed.

## Don't do

- Don't add YAML frontmatter to files written into book repos.
- Don't push to a book repo's remote from the app.
- Don't auto-detect contradictions across interviews in the Interviewer mode —
  that's the Researcher mode's job.
- Don't expose stack traces or repo paths in error responses to the
  interviewee UI.

## Reference book repo

The MVP is built against an existing memoir-in-progress book repo connected by
the author. The repo URL and local path are configured at runtime (per-book in
the database) and are never hard-coded here. The platform clones the book repo
into `data/book-clones/{book_id}/` and works on that copy; it never writes to
the author's primary working copy (which may be synced via OneDrive, Dropbox,
or similar).
