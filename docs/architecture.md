# Architecture

A read of this doc plus the README should be enough to navigate the codebase
without surprises.

## Big picture

Ghost Writer is a single-tenant Next.js app that mediates between three
worlds:

```
        ┌──────────────────┐
        │   Author UI      │   /books/<id>/...
        │   (Next.js RSC)  │
        └────────┬─────────┘
                 │ server actions
                 ▼
   ┌─────────────────────────────────────────────────────┐
   │                   Ghost Writer                      │
   │                                                     │
   │   lib/actions/  →  lib/interview-engine.ts  →  CLI  │
   │        │                    │                       │
   │        ├── lib/auth/        ├── lib/llm/modes/      │
   │        ├── lib/db/          └── lib/llm/models.ts   │
   │        ├── lib/repo/                                │
   │        └── lib/md/                                  │
   └────┬────────────────┬──────────────────────┬────────┘
        │                │                      │
        ▼                ▼                      ▼
   SQLite (libsql)   Book repo clone       Claude CLI
   data/             data/book-clones/     subprocess
   ghost-writer.db   {book_id}/            (stdio)

        ▲
        │
   ┌────┴─────────────┐
   │  Interviewee     │   /s/<token>
   │  (mobile web)    │
   └──────────────────┘
```

The four worlds:

1. **Author UI** — Next.js routes under `app/(author flow)`. Server
   components call server actions; client components handle state for
   forms and "Pensando…" indicators.
2. **Interviewee UI** — `app/s/[token]/`. Public route, JWT-bounded,
   never sees book material directly. Knows only its session.
3. **Local persistence** — a single SQLite file (`@libsql/client`) with
   Drizzle as the ORM, plus the local clone of the book repo on disk.
4. **External world** — Claude Code CLI as a subprocess (the only AI
   surface), GitHub remote via HTTPS+token (only on opt-in commit-and-push).

## Boundaries that matter

These are the seams the rest of the codebase swings on. If you change
them, ripple is wide; if you respect them, replacing implementations is
easy.

### `LLMClient` — `lib/llm/client.ts`

The only AI interface. Today there's one implementation
(`ClaudeCliClient` in `lib/llm/claude-cli.ts`) that spawns
`claude -p --output-format stream-json` and parses the stream. The
adapter accepts an optional `model` parameter so each task picks its
own; see `lib/llm/models.ts`.

Drop in any other client that satisfies this interface (Anthropic SDK
with prompt caching, OpenAI-compatible bridge, mock for tests) and the
rest of the system doesn't move.

### `RepoReader` / `RepoWriter` / `commitAndPush` — `lib/repo/`

Three operations on the book repo's local clone, in increasing order of
power:

- **`reader.ts`** — read named files, `git pull`. Path-traversal-guarded:
  any path that resolves outside the clone throws.
- **`writer.ts`** — write `_pendiente-<slug>.md` into a directory of the
  clone. The `_pendiente-` prefix is intentional: the author renames and
  commits manually.
- **`committer.ts`** — opt-in. ff-only pull, write, commit with the
  configured identity, push via short-lived `Authorization: Bearer`
  header. Token never enters the remote URL or `.git/config`.

The cloner (`cloner.ts`) handles the initial clone and, when the source
is a local working copy, walks through to its origin to pick up the real
GitHub URL.

### Auth seams — `lib/auth/`

- **`author.ts`** — single-tenant dev shortcut today (`DEV_AUTHOR_EMAIL`
  in `.env`). Magic-link auth lives behind the same interface when it
  ships.
- **`interviewee.ts`** — JWT signing and verification (`jose`). Secret
  read lazily so scripts that load `.env` after import don't fork onto a
  fallback. Each session row stores the `jti`; revocation is an insert
  into `revoked_tokens`.

### Schema — `lib/db/schema.ts`

Multi-tenant, multi-book, multi-mode from day one. Today only the
single-author + Interviewer-mode subset is exercised. Adding a mode is
a few new tables, not a redesign.

Key columns to know:

- `books.default_language` — drives the language the agent uses with the
  interviewee.
- `interview_templates.context_files` — JSON array of repo-relative
  paths on the per-template allow-list.
- `sessions.context_summary` — JSON of the precomputed summarizer output
  (added in optimization phase O.2). Reused on every turn after the
  first.
- `turns.vetoed` — interviewee can mark off-the-record. Renderer
  excludes from prose, lists in "Vetos del entrevistado".

## The interviewer turn loop

The single hottest path. Every turn:

1. **`lib/actions/turns.ts`** receives the interviewee's text via a
   server action.
2. Loads the session row, template, book, interviewee.
3. **`ensureSessionContextSummary`** — if `context_summary` is null,
   summarize all curated context once (~3-5 min) and persist. Otherwise
   reuse.
4. Reads `CLAUDE.md` from the local clone (a few KB; passed every turn).
5. Calls **`runInterviewerTurn`** in `lib/interview-engine.ts` with the
   summary, the block list, the conversation history, and the current
   block id.
6. The engine builds the system prompt (from `lib/llm/modes/interviewer.ts`)
   and the user prompt, writes the system prompt to a tempfile, spawns
   the CLI with `--append-system-prompt-file <tempfile>`, pipes the
   user prompt via stdin (with backpressure-aware write), parses the
   stream-json output.
7. The reply is JSON: `next_question`, `block_coverage`,
   `current_block_id`, `should_close`. Tolerant parser extracts JSON
   even if surrounded by prose; one retry with a strict reminder if
   that fails.
8. Server action persists the interviewee turn + the new interviewer
   turn, updates session state, and if `should_close` triggers the
   renderer to produce the `.md` transcript.

Performance signal in the dev server log:

```
[interviewer] turn: model=sonnet lang=es block=block-9 history=4
              mode=summary summaryBytes=9123 promptBytes=48234
```

`mode=summary` means the precomputed summary is in use (cheap turn);
`mode=raw ctxFiles=N ctxBytes=NNN` means we're falling back to raw
context (only happens before the summary is computed or if it was
explicitly cleared).

## Modes

Each mode is a prompt-builder file under `lib/llm/modes/`:

- **`summarizer.ts`** — runs once per session, produces JSON for
  `sessions.context_summary`.
- **`interviewer.ts`** — every turn. Has a denylist (`notas/inconsistencias`,
  `notas/permisos`, `notas/cronologia`) of files that don't help this
  mode and get filtered before reaching the prompt.
- **`renderer.ts`** — runs on session close. Produces the canonical
  markdown transcript.
- **(future) `architect.ts` / `writer.ts` / `researcher.ts`** — out of
  scope for now.

## Why these choices

- **CLI subprocess instead of Anthropic SDK.** Lets the project run on
  a Claude Pro/Max plan (the author's) without spending API dollars.
  Trade-off: no native prompt caching. Mitigated by the precomputed
  summary, which trades one expensive call for many cheap ones.
- **SQLite via libsql instead of better-sqlite3.** Native bindings for
  better-sqlite3 don't have prebuilt artifacts for Node 25 on Windows;
  libsql ships prebuilt and migrates to Postgres without a code change.
- **Server actions over a tRPC / API route layer.** Fewer files. Next 15
  + RSC + actions is the natural shape; we follow it.
- **No UI library beyond Tailwind.** Lower surface to maintain. Adding
  shadcn/ui is a one-time install if a component grows past 50 lines of
  hand-rolled.

## Things that surprised the author and should surprise you

- **Windows `cmd.exe` caps the command line at ~8191 chars.** That's why
  the system prompt goes through `--append-system-prompt-file` with a
  tempfile, not as a literal arg.
- **Stdin pipes have a 16 KB high water mark.** Without a write
  callback, calling `end()` on a 380 KB write hangs the child until
  timeout. The CLI client passes a callback to `write()` and only
  closes stdin after the buffer drains.
- **`server-only` import shims throw outside Next.** Several modules
  used to `import "server-only"` at the top, which broke `pnpm
  smoke:claude` and the other `scripts/`. They were dropped from
  modules that scripts touch; the modules are still server-only by
  virtue of using Node `child_process` and `fs`.
- **JWT_SECRET read at import time.** A previous bug had scripts and
  the dev server forking onto different fallback secrets because
  dotenv loaded after the auth module was imported. Now the secret is
  resolved on every sign / verify call.
