# Ghost Writer

Web platform for assisted book creation. Claude conducts interviews (with the
author and with third parties such as family, friends, coaches) and helps
draft, structure, and fact-check the manuscript — while the author retains
full control of the repository and what gets committed.

> **Status**: MVP under construction. The first feature is the **Interviewer
> mode for third parties** (private link, mobile-first, audio + text).

## Vision

A book lives in its own GitHub repository, organized with the conventions of
the **Cowork-with-Claude** methodology. Ghost Writer connects to that repo and
exposes four modes over the same content:

- **Architect** — outline and chapter planning.
- **Interviewer** — conducts live interviews; deposits processed transcripts in
  the book repo for the author to review and commit.
- **Writer** — drafts chapters from interviews + outline, with traceable
  citations.
- **Researcher** — detects inconsistencies and verifies facts against project
  notes.

Creating a new book applies a **book template** (e.g. `memoir-cowork`) to a
fresh repo, scaffolding folders, `CLAUDE.md`, outline, and interview templates.

## Privacy by design

- The book draft is **never** exposed to interviewees.
- Claude Max credentials live **only** server-side (CLI subprocess).
- One private room per interviewee; what X said is never injected into Y's room.
- The author curates per-interview which files are loaded as context. Default
  is closed: nothing visible unless explicitly enabled.
- Ghost Writer **never commits** to the book repo. It deposits files prefixed
  with `_pendiente-` for the author to review, rename, and commit from their
  own workstation.
- Interviewees can veto turns; vetoed content is preserved in metadata and
  visibly excluded from the processed transcript.

## Local development

Prerequisites:

- Node.js 20+
- pnpm
- Claude CLI authenticated with a Max session (`claude login`, run once)

```bash
cp .env.example .env
# edit .env: at minimum set JWT_SECRET (32+ bytes base64) and DEV_AUTHOR_EMAIL
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm smoke:claude          # verify CLI subprocess works
pnpm dev
```

To let an external interviewee reach the dev server, run a tunnel in a second
terminal:

```bash
cloudflared tunnel --url http://localhost:3000
```

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind · shadcn/ui · SQLite
(better-sqlite3) + Drizzle · Claude CLI subprocess · Groq Whisper · simple-git.

See [`docs/tech-stack.md`](docs/tech-stack.md) for the rationale.

## Documentation

- [`docs/tech-stack.md`](docs/tech-stack.md) — stack and rationale.
- [`docs/data-model.md`](docs/data-model.md) — entities and DDL.
- [`docs/interview-flow.md`](docs/interview-flow.md) — end-to-end interview flow.
- [`docs/modes.md`](docs/modes.md) — the four modes and their contracts.
- [`docs/book-template.md`](docs/book-template.md) — how book templates work.
- [`docs/open-decisions.md`](docs/open-decisions.md) — open decisions.

## Working language

The interviewee UI is in **Spanish**. Code, comments, and internal docs are in
**English**. User-facing strings live in `lib/i18n/`.

## License

TBD.
